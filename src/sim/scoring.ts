/**
 * Scoring and combo formulas (§9). Pure functions over primitives so they can
 * be unit-tested and property-tested in isolation from the update loop.
 */

export const MAX_COMBO_MULTIPLIER = 5;
/** Chars/second a "fast" completion is measured against for the speed bonus. */
export const TARGET_CPS = 5;

export function baseScore(wordLength: number): number {
  return Math.max(0, Math.floor(wordLength)) * 10;
}

/** Bonus for beating the target pace; never negative, capped so it can't dwarf the base. */
export function speedBonus(wordLength: number, completionSeconds: number): number {
  if (!Number.isFinite(completionSeconds) || completionSeconds <= 0) return 100;
  const expected = wordLength / TARGET_CPS;
  return Math.max(0, Math.min(100, Math.round((expected - completionSeconds) * 30)));
}

/** ×1 → ×5, one step per 10-word streak (matches the spec's combo tiers). */
export function comboMultiplier(streak: number): number {
  const s = Math.max(0, Math.floor(streak));
  return Math.min(1 + Math.floor(s / 10), MAX_COMBO_MULTIPLIER);
}

export function wordScore(wordLength: number, completionSeconds: number, streak: number): number {
  return (baseScore(wordLength) + speedBonus(wordLength, completionSeconds)) * comboMultiplier(streak);
}
