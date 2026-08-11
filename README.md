# TypeRush

A typing trainer built as a space shooter. Words ride enemy craft descending on your ship; every correct key
fires a bolt, and a word that reaches the bottom costs you a life.

Built to the design in [docs/plan.md](docs/plan.md) — the section references (§) throughout the code and this
README point back at it.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 157 tests: unit, property-based, replay, perf budget
npm run build    # typecheck + production bundle
```

## What's built

| Phase | Scope | State |
|---|---|---|
| 1. Core loop | FSM, game loop, spawn/fall, input matching, pooling | done |
| 2. Progression | Levels, lives, combo, difficulty function, game over | done |
| 3. Analytics | Keystroke log, WPM/accuracy/consistency folds, results screen | done |
| 4. Persistence | IndexedDB schema, session history, progress aggregation | done |
| 5. Learning curriculum | Staged lessons, virtual keyboard, finger guidance | not started |
| 6. Personalization | Weak-key tracking, alias-sampled word gen, adaptive difficulty | done |
| 7. Gamification | XP (done), achievements, daily challenges | partial |
| 8. Backend/social | Leaderboards, multiplayer | out of scope by design |

Five modes ship: learning, arcade, speed test, accuracy and survival.

## Architecture

The one structural rule: **simulation never touches the DOM, and the game loop never runs inside React.**

```
src/
  sim/          pure simulation core — no DOM, no I/O, no Math.random()
    update.ts     (ctx, state, dt, inputs) → { state, events }
    difficulty.ts pure f(level) → params, plus EMA/hysteresis adaptation
    metrics.ts    WPM / accuracy / consistency as folds over the keystroke log
    alias.ts      Vose alias sampler — O(1) weighted word draws
    minheap.ts    arrival-time heap for miss detection; top-k for weak keys
    pool.ts       fixed-capacity entity pool
    headless.ts   drive the sim without a browser (tests, balance tuning)
  app/          loop driver + pub/sub store
  render/       Canvas 2D renderer
    vfx.ts        starfield, projectiles, explosions, shake — driven by game events
  ui/           React screens, HUD, preferences
  persistence/  IndexedDB repository
```

`update()` is deterministic: the same seed and the same inputs always produce the same session, which is what
makes replay tests and bug reproduction possible. It mutates the state and pooled entities it owns — that is what
pooling buys — but performs no I/O and draws no randomness it does not thread through state.

### Decisions worth knowing

- **The shooter fiction lives entirely in the renderer.** Words are enemy craft descending on your ship, and each
  correct key fires a bolt that tracks its target; kills burst into particles, a word that gets through hits the
  ship and shakes the screen. None of that reaches the simulation — the VFX layer is a consumer of the same event
  stream the tests read, so the core stays headless and the visuals can change without touching gameplay.
- **Metrics are folds, never counters.** Every number on the results screen is recomputed from the append-only
  keystroke log, so WPM and accuracy cannot drift out of sync with what was actually typed (§9).
- **Miss detection is an event stream.** Arrival times are precomputed at spawn and popped off a min-heap, rather
  than being a conditional buried in the render loop — which is what makes headless simulation possible (§8).
- **Difficulty is a function, not a switch.** `difficultyForLevel(level)` is monotonic and property-tested;
  balancing means moving constants (§6.1).
- **Adaptation has a dead zone.** EMA-smoothed accuracy with separate up (0.97) and down (0.85) thresholds, so
  difficulty doesn't flip-flop every few words (§6.2).
- **Pressure rises with the clock, not only with the level.** Several words are in the air from level 1, and a
  bounded in-run ramp (up to ×1.9 over ~3 minutes) speeds up spawns, fall speed and concurrency. The ramp applies
  at spawn time only — words already falling keep their speed, so nothing on screen ever jumps and the precomputed
  arrival times stay valid.
- **`dt` is clamped to 50ms** and the game pauses on `visibilitychange`, so a backgrounded tab can't drop every
  word at once (§4, §18).
- **Raw keystrokes are never persisted.** Only per-key attempt/error aggregates reach storage; keystroke timing is
  sensitive telemetry (§11).

### Accessibility (§14)

- Reduced motion (auto-detected from `prefers-reduced-motion`, overridable) removes ambient animation, the drifting
  grid and danger glow.
- The canvas is `aria-hidden` and paired with an ARIA live region that announces the current and next word, since
  canvas content is invisible to assistive technology.
- The weak-key chart carries its meaning in numbers and a stripe pattern, not hue alone; a high-contrast theme is
  available.
- Every control is keyboard reachable, and typing is captured at the window so nothing needs to be clicked first.

## Testing

```bash
npm test               # everything
npx vitest run src/sim # simulation core only — runs in Node, no browser
```

- **Unit** — difficulty, scoring, metric folds, FSM table, pool, heap.
- **Property-based** (fast-check) — accuracy ∈ [0,1] over fuzzed logs, combo never exceeds its cap, difficulty
  monotonicity, alias-sampler distribution.
- **Replay/determinism** — identical seed and inputs produce byte-identical keystroke logs and event streams.
- **Integration** — headless sessions driven by a synthetic player; engine tests over a hand-cranked rAF clock
  covering delta clamping, pause semantics and the game-over hand-off.
- **Performance budget** — update cost at full concurrency stays well inside a frame.

## Controls

| Key | Action |
|---|---|
| letters/symbols | type the highlighted word |
| Backspace | un-type a character (does not erase the logged error) |
| Escape | pause / resume |

## Deploying

The game is entirely client-side — no server, no API routes, no environment variables. Everything it stores lives
in the player's own IndexedDB, so a static host is all it needs.

```bash
npx vercel        # preview deployment
npx vercel --prod # production
```

[vercel.json](vercel.json) pins the parts that are easy to get wrong on a static SPA:

- **Build** runs `npm run build`, which typechecks before bundling — a type error fails the deployment rather
  than shipping.
- **SPA rewrite** serves `index.html` for any path. Static files still win, so hashed assets resolve normally.
  This is also why `base` is `/` and not `./`: relative asset URLs would resolve against the requested path and
  404 on any deep link.
- **Caching**: hashed assets are immutable for a year; `index.html` always revalidates, so a deploy takes effect
  on the next load.
- **Headers**: a strict CSP (`default-src 'self'`, no inline scripts), `nosniff`, `frame-ancestors 'none'` and a
  closed `Permissions-Policy`. The app makes no network requests and loads no third-party code, so this costs
  nothing. `style-src` allows `'unsafe-inline'` for one dynamic width on the weak-key bars — the directive that
  matters for XSS, `script-src`, stays locked down.

Verified against the production bundle served with exactly these headers: the app boots on a deep link, IndexedDB
and WebAudio work, and a full run plays with no console errors.

Any other static host works too — build with `npm run build` and serve `dist/` with the same SPA fallback.
