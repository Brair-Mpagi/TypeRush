/**
 * Domain model for the simulation core (§3 of docs/plan.md).
 *
 * Nothing in `src/sim` may import from the DOM, Canvas, React or the
 * persistence layer. The core is a deterministic function of
 * `(state, dt, inputs)` so it can be unit-tested and replayed headlessly.
 */

export type GameMode = 'learning' | 'arcade' | 'speedTest' | 'accuracy' | 'survival';

export interface WordEntity {
  id: string;
  text: string;
  /** Chars matched so far — O(1) progress check, no string slicing. */
  typedIndex: number;
  x: number;
  y: number;
  /** World units per second. */
  speed: number;
  /** Simulation time (seconds) at which the word was spawned. */
  spawnTime: number;
  /** Precomputed simulation time (seconds) at which the word reaches the floor. */
  arrivalTime: number;
  /** Simulation time of the first keystroke aimed at this word; -1 until typed. */
  firstKeyTime: number;
  /** Per-word tallies — avoids re-scanning the keystroke log to score a word. */
  correctKeys: number;
  wrongKeys: number;
  /** Pool bookkeeping: false once returned to the pool. */
  alive: boolean;
}

export interface Keystroke {
  key: string;
  expected: string;
  correct: boolean;
  /** Milliseconds since session start. */
  timestamp: number;
  wordId: string;
}

export interface DifficultyParams {
  /** World units per second. */
  fallSpeed: number;
  spawnIntervalMs: number;
  wordLengthRange: [number, number];
  maxConcurrentWords: number;
  /** Index into the word-bank tiers. */
  vocabularyTier: number;
}

export interface SessionState {
  mode: GameMode;
  level: number;
  score: number;
  combo: number;
  bestCombo: number;
  lives: number;
  activeWords: WordEntity[];
  /** Append-only log — the single source of truth for every derived metric. */
  keystrokes: Keystroke[];
  /** Simulation seconds elapsed since the session started. */
  elapsed: number;
  startedAt: number;
  /** Countdown (seconds) until the next spawn. */
  spawnCountdown: number;
  /** The word currently being typed, if any — keystrokes are locked to it. */
  lockedWordId: string | null;
  wordsCompleted: number;
  wordsMissed: number;
  /** Deterministic PRNG state; advanced by every random draw. */
  rngState: number;
  /** Monotonic counter used to mint word ids without a global. */
  nextWordSeq: number;
  /** Exponentially-weighted moving averages driving adaptive difficulty (§6.2). */
  emaAccuracy: number;
  emaWpm: number;
  /** Words completed since the last adaptive-difficulty evaluation. */
  wordsSinceAdapt: number;
  /** Seconds after which the session ends by itself (speed tests); null = endless. */
  timeLimitSec: number | null;
  over: boolean;
}

export type InputEvent =
  | { type: 'key'; key: string }
  | { type: 'backspace' };

/**
 * Events carry the world position where they happened. The renderer consumes
 * them a frame later, by which point a completed word is already back in the
 * pool — without the coordinates it would have to guess where to draw the
 * explosion.
 */
export type GameEvent =
  | { type: 'wordSpawned'; wordId: string; text: string }
  | { type: 'charTyped'; wordId: string; key: string; correct: boolean; charIndex: number; x: number; y: number }
  | { type: 'wordCompleted'; wordId: string; text: string; points: number; combo: number; x: number; y: number }
  | { type: 'wordMissed'; wordId: string; text: string; x: number; y: number }
  | { type: 'comboBroken'; at: number }
  | { type: 'levelChanged'; level: number; direction: 'up' | 'down' }
  | { type: 'gameOver'; score: number };

export interface UpdateResult {
  state: SessionState;
  events: GameEvent[];
}

/** Logical play-field size; the renderer scales this to the canvas. */
export const WORLD_WIDTH = 1000;
export const WORLD_HEIGHT = 700;
/** Y coordinate that counts as "reached the bottom". */
export const FLOOR_Y = WORLD_HEIGHT - 40;
/** Approximate advance width of one character in world units (monospace render). */
export const CHAR_WIDTH = 16;
