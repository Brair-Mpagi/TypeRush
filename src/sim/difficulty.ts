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
    spawnIntervalMs: Math.max(2000 - l * 120, 400),
    wordLengthRange: [Math.min(2 + Math.floor(l / 2), 4), Math.min(4 + l, 14)],
    maxConcurrentWords: Math.min(1 + Math.floor(l / 3), 6),
    vocabularyTier: Math.min(Math.floor(l / 2), TIER_COUNT - 1),
  };
}

/** Per-mode overrides applied on top of the level curve. */
export function difficultyForMode(mode: GameMode, level: number): DifficultyParams {
  const base = difficultyForLevel(level);
  switch (mode) {
    case 'learning':
      // Gentler: slower fall, one word at a time, short words only.
      return {
        ...base,
        fallSpeed: base.fallSpeed * 0.6,
        spawnIntervalMs: base.spawnIntervalMs + 600,
        maxConcurrentWords: Math.min(base.maxConcurrentWords, 2),
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
