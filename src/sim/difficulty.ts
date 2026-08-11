import type { DifficultyParams, GameMode } from './types';

export const TIER_COUNT = 5;
export const MAX_LEVEL = 30;

/**
 * Difficulty as a pure, monotonic function of level (§6.1) — no per-level
 * branching. Balancing means tuning these constants, and the monotonicity is
 * property-testable.
 */
export function difficultyForLevel(level: number): DifficultyParams {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return {
    fallSpeed: 60 + l * 8,
    spawnIntervalMs: Math.max(1600 - l * 100, 400),
    wordLengthRange: [Math.min(2 + Math.floor(l / 2), 4), Math.min(4 + l, 14)],
    // Two words in the air from the first level: a single falling word reads as
    // a queue, not a rush, and it never forces the player to choose a target.
    maxConcurrentWords: Math.min(2 + Math.floor(l / 2), MAX_CONCURRENT_WORDS - 2),
    vocabularyTier: Math.min(Math.floor(l / 2), TIER_COUNT - 1),
  };
}

/** Hard ceiling on words in the air, ramp included. Below the pool capacity. */
export const MAX_CONCURRENT_WORDS = 8;
/** Fraction of extra fall speed accumulated per minute within a single run. */
export const RAMP_PER_MINUTE = 0.3;
/** The ramp tops out here so a long run gets tense, not impossible. */
export const MAX_RAMP = 1.9;
/** No level/ramp combination may spawn faster than this. */
export const MIN_SPAWN_INTERVAL_MS = 300;

/**
 * In-run intensity ramp: pressure rises with time on the clock, not only on
 * level-up. Level sets where a run starts; the ramp is why staying alive keeps
 * getting harder between level changes.
 *
 * Monotonic and bounded, so it composes with the level curve without either
 * one being able to run away.
 */
export function rampFactor(elapsedSec: number): number {
  const seconds = Math.max(0, elapsedSec);
  return Math.min(1 + (seconds / 60) * RAMP_PER_MINUTE, MAX_RAMP);
}

/**
 * The parameters actually used at a moment in a run: the mode's level curve
 * with the time ramp applied. Words already falling keep the speed they were
 * spawned with — the ramp only affects new spawns, so nothing on screen ever
 * jumps.
 */
export function difficultyAt(mode: GameMode, level: number, elapsedSec: number): DifficultyParams {
  const base = difficultyForMode(mode, level);
  const ramp = rampFactor(elapsedSec);
  return {
    ...base,
    fallSpeed: base.fallSpeed * ramp,
    spawnIntervalMs: Math.max(base.spawnIntervalMs / ramp, MIN_SPAWN_INTERVAL_MS),
    // The screen fills up as the run goes on, up to two extra words.
    maxConcurrentWords: Math.min(
      base.maxConcurrentWords + Math.floor((ramp - 1) / 0.45),
      mode === 'learning' ? LEARNING_MAX_CONCURRENT : MAX_CONCURRENT_WORDS,
    ),
  };
}

/** Learning mode keeps the screen readable; the ramp cannot push it past this. */
export const LEARNING_MAX_CONCURRENT = 3;

/** Per-mode overrides applied on top of the level curve. */
export function difficultyForMode(mode: GameMode, level: number): DifficultyParams {
  const base = difficultyForLevel(level);
  switch (mode) {
    case 'learning':
      // Gentler: slower fall, few words at a time, short words only.
      return {
        ...base,
        fallSpeed: base.fallSpeed * 0.6,
        spawnIntervalMs: base.spawnIntervalMs + 600,
        maxConcurrentWords: Math.min(base.maxConcurrentWords, LEARNING_MAX_CONCURRENT - 1),
        wordLengthRange: [base.wordLengthRange[0], Math.min(base.wordLengthRange[1], 7)],
        vocabularyTier: Math.min(base.vocabularyTier, 1),
      };
    case 'speedTest':
      return { ...base, fallSpeed: base.fallSpeed * 0.8, spawnIntervalMs: base.spawnIntervalMs };
    case 'accuracy':
      return { ...base, fallSpeed: base.fallSpeed * 0.75, spawnIntervalMs: base.spawnIntervalMs + 200 };
    case 'survival':
      return { ...base, fallSpeed: base.fallSpeed * 1.15 };
    case 'arcade':
    default:
      return base;
  }
}

export function startingLives(mode: GameMode): number {
  switch (mode) {
    case 'survival':
      return 1;
    case 'learning':
      return 5;
    default:
      return 3;
  }
}

/** EMA smoothing factor (§6.2) — reacts over roughly the last ~5 words. */
export const EMA_ALPHA = 0.2;
/** Hysteresis dead zone: below this accuracy, ease off. */
export const ADAPT_DOWN_ACCURACY = 0.85;
/** Above this accuracy (and with speed trending up), push harder. */
export const ADAPT_UP_ACCURACY = 0.97;
/** Evaluate adaptation on this cadence, not every word — avoids thrash. */
export const ADAPT_EVERY_WORDS = 5;

export function ema(previous: number, sample: number, alpha = EMA_ALPHA): number {
  return alpha * sample + (1 - alpha) * previous;
}

export interface AdaptInput {
  level: number;
  emaAccuracy: number;
  emaWpm: number;
  currentWpm: number;
}

/**
 * Adaptive difficulty with hysteresis (§6.2). The gap between the two accuracy
 * thresholds is the dead zone that stops the level flip-flopping every few
 * words.
 */
export function adaptLevel({ level, emaAccuracy, emaWpm, currentWpm }: AdaptInput): number {
  if (emaAccuracy >= ADAPT_UP_ACCURACY && currentWpm >= emaWpm) {
    return Math.min(level + 1, MAX_LEVEL);
  }
  if (emaAccuracy < ADAPT_DOWN_ACCURACY) {
    return Math.max(level - 1, 1);
  }
  return level;
}
