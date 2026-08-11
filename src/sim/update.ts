import { ADAPT_EVERY_WORDS, adaptLevel, difficultyAt, ema, MAX_LEVEL, startingLives } from './difficulty';
import { MinHeap } from './minheap';
import { weakestKeys, buildErrorMap, wpm } from './metrics';
import { WordPool } from './pool';
import { nextRandom } from './rng';
import { wordScore } from './scoring';
import { WordSelector } from './spawner';
import {
  CHAR_WIDTH,
  FLOOR_Y,
  WORLD_WIDTH,
  type GameEvent,
  type GameMode,
  type InputEvent,
  type Keystroke,
  type SessionState,
  type UpdateResult,
  type WordEntity,
} from './types';

/**
 * The simulation step (§2): `(state, dt, inputs) → newState`.
 *
 * `ctx` holds the non-serialisable machinery the step needs — the entity pool,
 * the word selector's cached samplers and the arrival-time heap. State itself
 * stays plain data so it can be snapshotted, logged and diffed.
 *
 * The step mutates the state it is handed (and the pooled entities it owns)
 * rather than rebuilding them each frame — that is what pooling buys — but it
 * remains deterministic: same `(state, dt, inputs)` in, same state and events
 * out, with no I/O and no `Math.random()`.
 */

export const POOL_CAPACITY = 32;
/** Modes whose level is driven by the EMA/hysteresis controller (§6.2). */
const ADAPTIVE_MODES: ReadonlySet<GameMode> = new Set<GameMode>(['arcade', 'survival']);
/** Modes that step up on a fixed word count instead. */
const WORDS_PER_LEVEL = 12;
/** How often the weak-key profile is pushed into the word selector. */
const REWEIGHT_EVERY_WORDS = 15;

export interface SimContext {
  pool: WordPool;
  selector: WordSelector;
  /** Min-heap of pending word arrivals, keyed by arrival time (§8). */
  arrivals: MinHeap<string>;
}

export interface SessionOptions {
  mode: GameMode;
  level?: number;
  seed?: number;
  startedAt?: number;
  timeLimitSec?: number | null;
}

export function createContext(): SimContext {
  return { pool: new WordPool(POOL_CAPACITY), selector: new WordSelector(), arrivals: new MinHeap<string>() };
}

export function createSession(options: SessionOptions): SessionState {
  const mode = options.mode;
  const level = clampLevel(options.level ?? 1);
  return {
    mode,
    level,
    score: 0,
    combo: 0,
    bestCombo: 0,
    lives: startingLives(mode),
    activeWords: [],
    keystrokes: [],
    elapsed: 0,
    startedAt: options.startedAt ?? 0,
    spawnCountdown: 0.4,
    lockedWordId: null,
    wordsCompleted: 0,
    wordsMissed: 0,
    rngState: options.seed ?? 0x9e3779b9,
    nextWordSeq: 0,
    emaAccuracy: 1,
    emaWpm: 0,
    wordsSinceAdapt: 0,
    timeLimitSec: options.timeLimitSec ?? (mode === 'speedTest' ? 60 : null),
    over: false,
  };
}

/** Resets a context so a session can be restarted without reallocating. */
export function resetContext(ctx: SimContext): void {
  ctx.pool.releaseAll();
  ctx.arrivals.clear();
}

export function update(
  ctx: SimContext,
  state: SessionState,
  dt: number,
  inputs: readonly InputEvent[],
): UpdateResult {
  const events: GameEvent[] = [];
  if (state.over) return { state, events };

  state.elapsed += dt;

  applyInputs(ctx, state, inputs, events);
  advanceWords(state, dt);
  detectMisses(ctx, state, events);
  maybeSpawn(ctx, state, dt, events);
  checkEnd(state, events);

  return { state, events };
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

function applyInputs(
  ctx: SimContext,
  state: SessionState,
  inputs: readonly InputEvent[],
  events: GameEvent[],
): void {
  for (const input of inputs) {
    if (input.type === 'backspace') {
      applyBackspace(state);
      continue;
    }
    if (input.key.length !== 1) continue; // ignore modifiers, arrows, F-keys…
    applyKey(ctx, state, input.key, events);
  }
}

/**
 * Backspace un-types a character. It is deliberately *not* appended to the
 * keystroke log: metrics measure what the player produced, and letting a
 * correction erase a logged error would make accuracy a lie.
 */
function applyBackspace(state: SessionState): void {
  const word = lockedWord(state);
  if (!word || word.typedIndex === 0) return;
  word.typedIndex--;
  if (word.typedIndex === 0) state.lockedWordId = null;
}

function applyKey(ctx: SimContext, state: SessionState, key: string, events: GameEvent[]): void {
  const target = lockedWord(state) ?? acquireTarget(state, key);
  if (!target) return; // nothing on screen — the keystroke is not attributable

  const expected = target.text[target.typedIndex] ?? '';
  const correct = key === expected;

  state.keystrokes.push(keystroke(key, expected, correct, state.elapsed, target.id));
  events.push({
    type: 'charTyped',
    wordId: target.id,
    key,
    correct,
    charIndex: target.typedIndex,
    x: target.x + target.typedIndex * CHAR_WIDTH,
    y: target.y,
  });

  if (target.firstKeyTime < 0) target.firstKeyTime = state.elapsed;

  if (correct) {
    target.typedIndex++;
    target.correctKeys++;
    state.lockedWordId = target.id;
    if (target.typedIndex >= target.text.length) {
      completeWord(ctx, state, target, events);
    }
    return;
  }

  target.wrongKeys++;
  if (state.combo > 0) {
    state.combo = 0;
    events.push({ type: 'comboBroken', at: state.elapsed });
  }
}

/**
 * With no word locked in, a keystroke claims the most urgent (lowest) word
 * whose next character matches. If nothing matches, the error is still
 * attributed to the most urgent word so it lands in the weak-key stats.
 */
function acquireTarget(state: SessionState, key: string): WordEntity | null {
  let match: WordEntity | null = null;
  let fallback: WordEntity | null = null;
  for (const word of state.activeWords) {
    if (!fallback || word.y > fallback.y) fallback = word;
    if (word.text[word.typedIndex] === key && (!match || word.y > match.y)) match = word;
  }
  return match ?? fallback;
}

function keystroke(
  key: string,
  expected: string,
  correct: boolean,
  elapsedSec: number,
  wordId: string,
): Keystroke {
  return { key, expected, correct, timestamp: Math.round(elapsedSec * 1000), wordId };
}

/* ------------------------------------------------------------------ */
/* Word lifecycle                                                      */
/* ------------------------------------------------------------------ */

function completeWord(ctx: SimContext, state: SessionState, word: WordEntity, events: GameEvent[]): void {
  const startedTyping = word.firstKeyTime >= 0 ? word.firstKeyTime : state.elapsed;
  const completionSeconds = Math.max(0, state.elapsed - startedTyping);

  state.combo++;
  if (state.combo > state.bestCombo) state.bestCombo = state.combo;
  const points = wordScore(word.text.length, completionSeconds, state.combo);
  state.score += points;
  state.wordsCompleted++;

  events.push({
    type: 'wordCompleted',
    wordId: word.id,
    text: word.text,
    points,
    combo: state.combo,
    x: word.x + (word.text.length * CHAR_WIDTH) / 2,
    y: word.y,
  });

  recordWordOutcome(state, word);
  removeWord(ctx, state, word);
  progress(ctx, state, events);
}

function missWord(ctx: SimContext, state: SessionState, word: WordEntity, events: GameEvent[]): void {
  state.wordsMissed++;
  state.lives--;
  if (state.combo > 0) {
    state.combo = 0;
    events.push({ type: 'comboBroken', at: state.elapsed });
  }
  events.push({
    type: 'wordMissed',
    wordId: word.id,
    text: word.text,
    x: word.x + (word.text.length * CHAR_WIDTH) / 2,
    y: word.y,
  });

  recordWordOutcome(state, word);
  removeWord(ctx, state, word);
}

function removeWord(ctx: SimContext, state: SessionState, word: WordEntity): void {
  const i = state.activeWords.indexOf(word);
  if (i >= 0) state.activeWords.splice(i, 1);
  if (state.lockedWordId === word.id) state.lockedWordId = null;
  ctx.pool.release(word);
}

/** Feeds the per-word accuracy sample into the EMA that drives adaptation. */
function recordWordOutcome(state: SessionState, word: WordEntity): void {
  const attempts = word.correctKeys + word.wrongKeys;
  const sample = attempts === 0 ? 0 : word.correctKeys / attempts;
  state.emaAccuracy = ema(state.emaAccuracy, sample);
}

/* ------------------------------------------------------------------ */
/* Progression                                                         */
/* ------------------------------------------------------------------ */

function progress(ctx: SimContext, state: SessionState, events: GameEvent[]): void {
  state.wordsSinceAdapt++;

  if (state.wordsCompleted % REWEIGHT_EVERY_WORDS === 0) {
    ctx.selector.setWeakKeys(weakestKeys(buildErrorMap(state.keystrokes).values()));
  }

  const previous = state.level;
  if (ADAPTIVE_MODES.has(state.mode)) {
    if (state.wordsSinceAdapt < ADAPT_EVERY_WORDS) return;
    state.wordsSinceAdapt = 0;
    const currentWpm = wpm(countCorrectChars(state), state.elapsed * 1000);
    state.level = adaptLevel({
      level: state.level,
      emaAccuracy: state.emaAccuracy,
      emaWpm: state.emaWpm,
      currentWpm,
    });
    state.emaWpm = ema(state.emaWpm, currentWpm);
  } else if (state.mode === 'learning' || state.mode === 'accuracy') {
    state.level = clampLevel(1 + Math.floor(state.wordsCompleted / WORDS_PER_LEVEL));
  }

  if (state.level !== previous) {
    events.push({ type: 'levelChanged', level: state.level, direction: state.level > previous ? 'up' : 'down' });
  }
}

function countCorrectChars(state: SessionState): number {
  let n = 0;
  for (const k of state.keystrokes) if (k.correct) n++;
  return n;
}

/* ------------------------------------------------------------------ */
/* Motion, misses, spawning                                            */
/* ------------------------------------------------------------------ */

/** `y += speed * dt` — frame-rate independent, identical at 60Hz and 144Hz. */
function advanceWords(state: SessionState, dt: number): void {
  for (const word of state.activeWords) {
    word.y += word.speed * dt;
  }
}

/**
 * Miss detection reads off the arrival heap rather than scanning every word
 * with a conditional buried in the render loop (§8). Words removed early
 * (completed) are handled by lazy deletion: their heap entry is popped and
 * discarded when it comes due.
 */
function detectMisses(ctx: SimContext, state: SessionState, events: GameEvent[]): void {
  for (;;) {
    const due = ctx.arrivals.peekKey();
    if (due === undefined || due > state.elapsed) break;
    const id = ctx.arrivals.pop()!;
    const word = state.activeWords.find((w) => w.id === id);
    if (!word) continue; // already completed — stale heap entry
    word.y = FLOOR_Y;
    missWord(ctx, state, word, events);
  }
}

function maybeSpawn(ctx: SimContext, state: SessionState, dt: number, events: GameEvent[]): void {
  // Read the ramped parameters: pressure rises with time in the run, not only
  // when the level changes.
  const params = difficultyAt(state.mode, state.level, state.elapsed);
  state.spawnCountdown -= dt;
  if (state.spawnCountdown > 0) return;
  state.spawnCountdown = params.spawnIntervalMs / 1000;
  if (state.activeWords.length >= params.maxConcurrentWords) return;

  const text = pickText(ctx, state, params.vocabularyTier, params.wordLengthRange);
  const width = text.length * CHAR_WIDTH;
  const x = pickX(state, width);
  const speed = params.fallSpeed;

  const word = ctx.pool.acquire({
    id: `w${state.nextWordSeq++}`,
    text,
    typedIndex: 0,
    x,
    y: 0,
    speed,
    spawnTime: state.elapsed,
    // Precomputed at spawn so miss detection is a heap pop, not a per-frame test.
    arrivalTime: state.elapsed + FLOOR_Y / speed,
    firstKeyTime: -1,
    correctKeys: 0,
    wrongKeys: 0,
  });
  if (!word) return; // pool exhausted — drop the spawn rather than allocate

  state.activeWords.push(word);
  ctx.arrivals.push(word.arrivalTime, word.id);
  events.push({ type: 'wordSpawned', wordId: word.id, text: word.text });
}

/**
 * Draws a word, retrying a few times to avoid two on-screen words starting
 * with the same character — that ambiguity makes targeting feel broken.
 */
function pickText(
  ctx: SimContext,
  state: SessionState,
  tier: number,
  range: readonly [number, number],
): string {
  const taken = new Set<string>();
  for (const w of state.activeWords) {
    taken.add(w.text[0]!);
  }
  let text = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    text = ctx.selector.pick(tier, range, () => draw(state));
    if (!taken.has(text[0]!) && !state.activeWords.some((w) => w.text === text)) return text;
  }
  return text;
}

/** Spreads words horizontally by picking the candidate furthest from the others. */
function pickX(state: SessionState, width: number): number {
  const maxX = Math.max(20, WORLD_WIDTH - width - 20);
  let best = 20;
  let bestGap = -1;
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = 20 + draw(state) * (maxX - 20);
    let gap = Number.POSITIVE_INFINITY;
    for (const w of state.activeWords) {
      gap = Math.min(gap, Math.abs(w.x - candidate));
    }
    if (gap > bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }
  return best;
}

/** Advances the session PRNG and returns the draw in [0, 1). */
function draw(state: SessionState): number {
  const next = nextRandom(state.rngState);
  state.rngState = next.state;
  return next.value;
}

/* ------------------------------------------------------------------ */
/* Termination                                                         */
/* ------------------------------------------------------------------ */

function checkEnd(state: SessionState, events: GameEvent[]): void {
  const outOfLives = state.lives <= 0;
  const outOfTime = state.timeLimitSec !== null && state.elapsed >= state.timeLimitSec;
  if (!outOfLives && !outOfTime) return;
  state.over = true;
  state.lives = Math.max(0, state.lives);
  events.push({ type: 'gameOver', score: state.score });
}

function lockedWord(state: SessionState): WordEntity | null {
  if (!state.lockedWordId) return null;
  return state.activeWords.find((w) => w.id === state.lockedWordId) ?? null;
}

function clampLevel(level: number): number {
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
}
