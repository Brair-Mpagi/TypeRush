import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { baseScore, comboMultiplier, MAX_COMBO_MULTIPLIER, speedBonus, wordScore } from './scoring';

describe('comboMultiplier', () => {
  it('steps once per ten-word streak and caps at x5', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(9)).toBe(1);
    expect(comboMultiplier(10)).toBe(2);
    expect(comboMultiplier(39)).toBe(4);
    expect(comboMultiplier(40)).toBe(5);
    expect(comboMultiplier(1000)).toBe(MAX_COMBO_MULTIPLIER);
  });

  it('never exceeds the maximum tier or drops below x1', () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 100000 }), (streak) => {
        const m = comboMultiplier(streak);
        expect(m).toBeGreaterThanOrEqual(1);
        expect(m).toBeLessThanOrEqual(MAX_COMBO_MULTIPLIER);
      }),
    );
  });

  it('is non-decreasing in streak', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), (s) => {
        expect(comboMultiplier(s + 1)).toBeGreaterThanOrEqual(comboMultiplier(s));
      }),
    );
  });
});

describe('speedBonus', () => {
  it('rewards beating the target pace and is zero for slow completions', () => {
    expect(speedBonus(10, 0.5)).toBeGreaterThan(0);
    expect(speedBonus(10, 60)).toBe(0);
  });

  it('is never negative and never dominates the base score', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.double({ min: 0, max: 120, noNaN: true }),
        (len, seconds) => {
          const bonus = speedBonus(len, seconds);
          expect(bonus).toBeGreaterThanOrEqual(0);
          expect(bonus).toBeLessThanOrEqual(100);
        },
      ),
    );
  });
});

describe('wordScore', () => {
  it('is the multiplied sum of base and bonus', () => {
    expect(wordScore(5, 1, 20)).toBe((baseScore(5) + speedBonus(5, 1)) * comboMultiplier(20));
  });

  it('is non-negative and finite for any plausible input', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.double({ min: 0, max: 600, noNaN: true }),
        fc.integer({ min: 0, max: 1000 }),
        (len, seconds, streak) => {
          const score = wordScore(len, seconds, streak);
          expect(Number.isFinite(score)).toBe(true);
          expect(score).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('grows with the streak for a fixed word', () => {
    expect(wordScore(6, 1, 40)).toBeGreaterThan(wordScore(6, 1, 0));
  });
});
