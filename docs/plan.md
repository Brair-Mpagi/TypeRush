# TypeRush — Software Engineering Design Document

## 0. Purpose

The original concept doc specifies *what* the product should feel like. This document specifies *how* to build it: architecture, data structures, algorithms with complexity bounds, persistence model, and a delivery plan sized in engineering effort rather than feature checklists. It assumes a single engineer or small team building a web-first client, with an optional backend deferred to a later phase.

---

## 1. Goals / Non-Goals

**Goals for v1 (MVP):**
- A deterministic, frame-rate-independent falling-word game loop.
- Correct, testable typing-metrics computation (WPM, accuracy, error rate).
- A difficulty model that is a pure function of a small state vector, not scattered `if` statements.
- Local persistence (no backend dependency) with a schema that survives to v2/v3 without migration pain.

**Explicit non-goals for v1:**
- Multiplayer, accounts, cloud sync — these add distributed-systems complexity (consistency, auth, abuse handling) that isn't justified until the core loop is validated.
- An ECS (Entity-Component-System) framework — the entity count (tens of words on screen) doesn't warrant it. Revisit only if power-ups/particle effects push entity count into the hundreds.

---

## 2. High-Level Architecture

Layered, with a hard boundary between **simulation** (pure, testable, no DOM/Canvas access) and **presentation** (rendering, input capture). This is the single most important architectural decision: it lets you unit-test the entire game and typing engine without a browser.

```
┌─────────────────────────────────────────────┐
│  Presentation Layer                          │
│  Canvas/DOM renderer · Input capture · UI    │
└───────────────────┬───────────────────────────┘
                    │  commands (KeyEvent) / render(state)
┌───────────────────▼───────────────────────────┐
│  Application Layer                            │
│  Game loop driver · FSM (screen/mode state)  │
└───────────────────┬───────────────────────────┘
                    │
┌───────────────────▼───────────────────────────┐
│  Simulation Core (pure functions, no I/O)     │
│  WordSpawner · CollisionSystem · ScoreEngine  │
│  DifficultyController · TypingAnalytics       │
└───────────────────┬───────────────────────────┘
                    │
┌───────────────────▼───────────────────────────┐
│  Persistence Layer                            │
│  IndexedDB (client) — SQLite via Tauri         │
│  (desktop) — optional REST sync (v4)          │
└─────────────────────────────────────────────┘
```

The simulation core takes `(state, dt, inputEvents) → newState`. This is a **reducer pattern**, which gives you three things for free: replayability (record inputs, replay for bug repro), deterministic testing, and trivial "rewind" for a future practice-mode feature.

---

## 3. Domain Model

```typescript
interface WordEntity {
  id: string;
  text: string;
  typedIndex: number;      // chars matched so far — O(1) progress check
  x: number;
  y: number;
  speed: number;           // px/sec
  spawnTime: number;
  arrivalTime: number;     // precomputed: time this word reaches the floor
}

interface Keystroke {
  key: string;
  expected: string;
  correct: boolean;
  timestamp: number;
  wordId: string;
}

interface SessionState {
  mode: 'learning' | 'arcade' | 'speedTest' | 'accuracy' | 'survival';
  level: number;
  score: number;
  combo: number;
  lives: number;
  activeWords: WordEntity[];
  keystrokes: Keystroke[];   // append-only log, source of truth for all metrics
  startedAt: number;
  elapsed: number;
}

interface DifficultyParams {
  fallSpeed: number;         // px/sec
  spawnIntervalMs: number;
  wordLengthRange: [number, number];
  maxConcurrentWords: number;
  vocabularyTier: number;    // index into word-bank tiers
}
```

Design note: `keystrokes` is an append-only event log. Every derived metric (WPM, accuracy, consistency, per-key error rates) is a pure fold over this log. This means metrics are never a separate mutable counter that can drift out of sync — they're recomputed or incrementally folded from a single source of truth.

---

## 4. Game Loop & Timing

Use a variable timestep driven by `requestAnimationFrame`, with delta-time clamping to avoid the "spiral of death" on tab-refocus (where `dt` can spike to seconds):

```typescript
let lastTime = performance.now();

function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.05); // clamp to 50ms
  lastTime = now;
  state = update(state, dt, pendingInputEvents);
  pendingInputEvents = [];
  render(state);
  requestAnimationFrame(frame);
}
```

Word position updates as `y += speed * dt`, not `y += speed` per frame — this is what makes the game behave identically on a 60Hz and 144Hz display. This single detail is the most common bug in falling-word game clones.

**Object pooling:** word entities are created and destroyed at high frequency (every spawn/despawn). In JS, this creates GC churn that causes frame-time jitter — visible as stutter during fast-paced levels. Pool a fixed-size array of `WordEntity` objects and recycle rather than allocate/`delete`.

---

## 5. Application State: Finite State Machine

Screen/mode transitions belong in an explicit FSM, not boolean flags (`isPlaying`, `isPaused`, `isGameOver`) that can enter invalid combinations.

```
Menu → LevelSelect → Loading → Playing ⇄ Paused
                                  │
                                  ▼
                              GameOver → Results → Menu
```

```typescript
type GameFSMState = 'menu' | 'levelSelect' | 'loading' | 'playing' | 'paused' | 'gameOver' | 'results';

const transitions: Record<GameFSMState, GameFSMState[]> = {
  menu: ['levelSelect'],
  levelSelect: ['loading', 'menu'],
  loading: ['playing'],
  playing: ['paused', 'gameOver'],
  paused: ['playing', 'menu'],
  gameOver: ['results'],
  results: ['menu', 'levelSelect'],
};
```

An explicit transition table makes illegal states unreachable and is trivially unit-testable: assert every UI action only fires transitions present in the table.

---

## 6. Word Spawning & Difficulty

### 6.1 Difficulty as a pure function

`DifficultyParams` should be `f(level: number) → DifficultyParams`, not hardcoded per-level branching:

```typescript
function difficultyForLevel(level: number): DifficultyParams {
  return {
    fallSpeed: 60 + level * 8,                     // px/sec, tune via playtesting
    spawnIntervalMs: Math.max(2000 - level * 120, 400),
    wordLengthRange: [
      Math.min(2 + Math.floor(level / 2), 4),
      Math.min(4 + level, 14),
    ],
    maxConcurrentWords: Math.min(1 + Math.floor(level / 3), 6),
    vocabularyTier: Math.min(Math.floor(level / 2), TIER_COUNT - 1),
  };
}
```

This is a monotonic, continuous function — easy to reason about, easy to balance by adjusting a handful of constants, and easy to property-test (e.g. "fallSpeed(level) is non-decreasing").

### 6.2 Adaptive difficulty (survival/arcade modes)

Use an exponentially-weighted moving average (EMA) of recent accuracy and speed, rather than raw last-value, to avoid over-reacting to a single lucky or unlucky word:

```
ema_accuracy(t) = α · accuracy(t) + (1 − α) · ema_accuracy(t−1)     // α ≈ 0.2
```

Adjust difficulty with hysteresis (separate up/down thresholds) to prevent oscillation:

```
if ema_accuracy > 0.97 and ema_wpm trending up  → level += 1
if ema_accuracy < 0.85                          → level -= 1
```

The gap between 0.85 and 0.97 is the "dead zone" — without it, difficulty flip-flops every few words, which feels erratic to the player.

### 6.3 Weighted word selection (targeting weak keys)

Naive weighted random selection is O(n) per pick (linear scan through cumulative weights). If the word bank is a few thousand entries and you're spawning every ~1s, this is fine unweighted — but once you're re-weighting toward the player's weak keys, precompute with the **alias method** (Walker/Vose): O(n) one-time setup, O(1) per sample.

```typescript
class AliasSampler {
  private prob: number[];
  private alias: number[];
  constructor(weights: number[]) { /* O(n) Vose's algorithm setup */ }
  sample(): number { /* O(1): random bucket + coin flip */ }
}
```

Rebuild the sampler when the weak-key profile changes materially (e.g., every N words or at level-up), not every frame.

---

## 7. Input Pipeline & Matching

Each expected word is matched with an index pointer, not string slicing (`word.slice(typedIndex)`), to keep per-keystroke cost O(1):

```typescript
function handleKeydown(word: WordEntity, key: string, now: number): Keystroke {
  const expected = word.text[word.typedIndex];
  const correct = key === expected;
  if (correct) word.typedIndex++;
  return { key, expected, correct, timestamp: now, wordId: word.id };
}
```

On `typedIndex === word.text.length`, the word is complete: remove from `activeWords`, apply score/combo, return to pool.

---

## 8. Collision / Miss Detection

Rendering necessarily touches every active word each frame (O(n), unavoidable). But **miss-detection** doesn't need to be a per-frame conditional buried in the render loop — decouple it for testability and to support headless simulation (useful for the balance-tuning tooling below):

Precompute `arrivalTime = spawnTime + (floorY - spawnY) / speed` at spawn time, and push into a **min-heap keyed by arrivalTime**. Each tick, pop and fire "miss" events for any word whose `arrivalTime <= now` — O(log n) per miss rather than an O(n) scan with a conditional inside it. For the scale here (≤6 concurrent words) this is a micro-optimization, but it's the right shape: it turns "did anything reach the bottom" into an explicit, testable event stream instead of an implicit side effect of the render loop.

---

## 9. Scoring, Combo, Metrics — Formulas

```
score(word)   = base(len) + speedBonus(completionTime) + comboMultiplier(streak)
comboMultiplier(streak) = 1 + floor(streak / 10)          // ×1 → ×5, matches spec's tiers

WPM           = (correctChars / 5) / (elapsedSeconds / 60)
accuracy      = correctChars / totalChars
errorRate     = incorrectKeystrokes / totalKeystrokes

// consistency: coefficient of variation of inter-keystroke intervals (lower = steadier)
consistency   = 1 − (stddev(intervals) / mean(intervals))
```

All of these are pure folds over the `keystrokes[]` log described in §3 — write them as standalone functions `(Keystroke[]) → number` and unit-test with fixed input arrays. Do not compute these as running mutable counters scattered through the update loop; that's where off-by-one and double-count bugs live.

---

## 10. Error Analysis / Weak-Key Detection

Maintain a `Map<char, {attempts: number, errors: number}>` built incrementally from the keystroke log (O(1) amortized update per keystroke). To surface the top-k problem keys for the personalized-exercise generator, use a **min-heap of size k** rather than sorting the whole map: O(n log k) instead of O(n log n) — matters once you're tracking 40+ keys/punctuation/digits across a long session history.

Personalized word selection then filters/weights the word bank toward words containing the top-k weak characters — this reuses the alias sampler from §6.3 with weights derived from the error map.

---

## 11. Persistence

**v1: fully client-local**, no backend. This eliminates an entire class of problems (auth, network latency masking input, data races) for a feature that doesn't need them yet.

- **Web:** IndexedDB (via a thin wrapper like `idb`), storing sessions and aggregated progress.
- **Desktop (Tauri):** SQLite file, same schema, gives you a real query engine for the stats/progress views for free.

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at INTEGER
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  mode TEXT,
  level INTEGER,
  duration_ms INTEGER,
  wpm REAL,
  accuracy REAL,
  score INTEGER,
  errors INTEGER,
  created_at INTEGER
);

CREATE TABLE typing_errors (
  session_id TEXT REFERENCES sessions(id),
  key_char TEXT,
  attempts INTEGER,
  errors INTEGER,
  PRIMARY KEY (session_id, key_char)
);

CREATE TABLE progress (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  xp INTEGER DEFAULT 0,
  best_wpm REAL DEFAULT 0,
  best_accuracy REAL DEFAULT 0,
  highest_level_unlocked INTEGER DEFAULT 1
);

CREATE INDEX idx_sessions_user_created ON sessions(user_id, created_at);
```

Deliberately **not** persisting individual keystrokes long-term — the `typing_errors` table is a per-session aggregate. Raw keystroke logs live in memory for the duration of a session (needed for the metric folds in §9) and are discarded after aggregation, unless you specifically want replay/analytics features later — in which case, store them, but as a separate opt-in export rather than default persistence, since raw keystroke timing is sensitive telemetry.

**v4 backend** (leaderboards/multiplayer): a small REST or WebSocket service that only ever receives the aggregated `sessions` row plus a signed score — never raw keystrokes — both for privacy and to reduce attack surface for score-tampering.

---

## 12. Rendering Strategy

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| DOM + CSS transforms | Simple, accessible by default, easy hit-testing | Layout thrash risk at >30 concurrent animated nodes | Fine for MVP (≤6 concurrent words) |
| Canvas 2D | No DOM overhead, full control, good for particle/power-up effects later | Manual accessibility (need a shadow DOM/ARIA layer for screen readers) | Best long-term choice |
| WebGL | Overkill here | Unjustified complexity for 2D falling text | Skip |

Recommendation: **Canvas 2D**, with a parallel invisible DOM layer (or ARIA live region) mirroring word text for screen-reader support — see §16.

---

## 13. Testing Strategy

Because the simulation core is pure (§2), most of the system is unit-testable without a browser:

- **Unit tests:** `difficultyForLevel`, scoring formulas, WPM/accuracy folds, FSM transition table, alias sampler correctness (statistical distribution check over N samples).
- **Property-based tests** (e.g. `fast-check`): invariants like "accuracy ∈ [0,1] for any keystroke sequence," "WPM is never negative," "combo never exceeds max tier," fuzzed over randomly generated keystroke logs.
- **Golden/replay tests:** record a real input session (array of timestamped `KeyEvent`s) once, replay it through `update()`, and assert final score/WPM/accuracy match a recorded snapshot — catches regressions from refactors of the update loop.
- **Integration tests:** headless run of `update()` over synthetic frames to verify miss-detection heap fires at correct times.
- **Performance budget test:** assert `update()` + `render()` stays under a 16.6ms frame budget with `maxConcurrentWords` active, ideally measured via CI on a throttled CPU profile, not just locally.

---

## 14. Accessibility

- Falling-word motion must be pausable/disableable (`prefers-reduced-motion`) — for this genre it's not optional polish, it's required for users with vestibular disorders.
- Canvas rendering needs a parallel accessible text layer (ARIA live region announcing current word) for screen-reader users, since canvas content is invisible to assistive tech by default.
- Color contrast for the virtual keyboard heatmap should not rely on hue alone (colorblind-safe palette + shape/pattern redundancy).

---

## 15. Security Notes

Minimal attack surface for v1 since there's no backend. Two things worth doing now rather than retrofitting later:
- If custom word lists (user-imported vocabulary) are ever allowed, treat imported text as data, never render it as HTML — sanitize before any DOM insertion.
- When leaderboards (v4) arrive, don't trust client-submitted scores: recompute/validate score bounds server-side against `duration_ms`/`wpm`/`accuracy` plausibility (a session claiming 400 WPM at 100% accuracy for 5 minutes is trivially rejectable), and sign session results if you want stronger tamper resistance.

---

## 16. Recommended Stack

```
Frontend        React + TypeScript (UI chrome, menus, stats screens)
Render surface  Canvas 2D (game view only — not wrapped in React's reconciler)
State           Simulation core owns state; React subscribes via a thin store
                (Zustand or plain pub/sub) — do NOT drive the game loop through
                React re-renders, that couples frame timing to React's scheduler
Persistence     IndexedDB (idb) — web; SQLite — desktop via Tauri
Desktop wrapper Tauri (smaller binary, less attack surface than Electron)
Testing         Vitest + fast-check for property tests
```

The one non-negotiable: **the game loop must not live inside a React component's render cycle.** Run it as an independent loop that pushes state into a store; let React subscribe to that store for UI (score, HUD, menus) only. Mixing them is the most common cause of jank in React-based games.

---

## 17. Delivery Roadmap (effort-sized)

| Phase | Scope | Rough effort |
|---|---|---|
| 1. Core loop | FSM, game loop, word spawn/fall, input matching, pooling | 1.5–2 wks |
| 2. Progression | Levels, lives, combo, difficulty function, game-over | 1 wk |
| 3. Analytics | Keystroke log, WPM/accuracy/consistency folds, results screen | 1 wk |
| 4. Persistence | IndexedDB schema, session history, progress aggregation | 0.5–1 wk |
| 5. Learning curriculum | Staged lessons, virtual keyboard, finger guidance | 1.5–2 wks |
| 6. Personalization | Weak-key tracking, alias-sampled word gen, adaptive difficulty | 1–1.5 wks |
| 7. Gamification | XP, achievements, daily challenges | 1 wk |
| 8. Backend/social | Leaderboards, score validation, multiplayer | separate project |

Phases 1–4 constitute a legitimately shippable, testable MVP — everything else builds on a stable simulation core rather than being bolted onto a prototype.

---

## 18. Key Risks

- **Timing drift on tab backgrounding:** browsers throttle `requestAnimationFrame` in inactive tabs; clamp `dt` (§4) and consider pausing on `visibilitychange` rather than letting the loop free-run with a huge delta.
- **Difficulty oscillation:** without EMA + hysteresis (§6.2), adaptive difficulty feels erratic — this is the single most common playtesting complaint in this genre.
- **Canvas accessibility debt:** easy to defer, expensive to retrofit — build the ARIA live-region layer alongside the renderer, not after.