import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ADAPT_DOWN_ACCURACY,
  ADAPT_UP_ACCURACY,
  adaptLevel,
  difficultyForLevel,
  difficultyForMode,
  ema,
  MAX_LEVEL,
  TIER_COUNT,
} from './difficulty';

describe('difficultyForLevel', () => {
  it('is monotonic in the directions that matter', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX_LEVEL - 1 }), (level) => {
        const a = difficultyForLevel(level);
        const b = difficultyForLevel(level + 1);
        expect(b.fallSpeed).toBeGreaterThanOrEqual(a.fallSpeed);
        expect(b.spawnIntervalMs).toBeLessThanOrEqual(a.spawnIntervalMs);
        expect(b.maxConcurrentWords).toBeGreaterThanOrEqual(a.maxConcurrentWords);
        expect(b.vocabularyTier).toBeGreaterThanOrEqual(a.vocabularyTier);
      }),
    );
  });

  it('keeps every parameter inside its designed bounds for any input', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 1000 }), (level) => {
        const d = difficultyForLevel(level);
        expect(d.fallSpeed).toBeGreaterThan(0);
        expect(d.spawnIntervalMs).toBeGreaterThanOrEqual(400);
        expect(d.maxConcurrentWords).toBeGreaterThanOrEqual(1);
        expect(d.maxConcurrentWords).toBeLessThanOrEqual(6);
        expect(d.vocabularyTier).toBeGreaterThanOrEqual(0);
        expect(d.vocabularyTier).toBeLessThan(TIER_COUNT);
        expect(d.wordLengthRange[0]).toBeLessThanOrEqual(d.wordLengthRange[1]);
        expect(d.wordLengthRange[0]).toBeGreaterThanOrEqual(2);
      }),
    );
  });

  it('is a pure function of level', () => {
    expect(difficultyForLevel(7)).toEqual(difficultyForLevel(7));
  });
});

describe('difficultyForMode', () => {
  it('makes learning gentler and survival harsher than arcade', () => {
    const arcade = difficultyForMode('arcade', 10);
    expect(difficultyForMode('learning', 10).fallSpeed).toBeLessThan(arcade.fallSpeed);
    expect(difficultyForMode('learning', 10).maxConcurrentWords).toBeLessThanOrEqual(arcade.maxConcurrentWords);
    expect(difficultyForMode('survival', 10).fallSpeed).toBeGreaterThan(arcade.fallSpeed);
  });

  it('caps learning vocabulary to the introductory tiers', () => {
    expect(difficultyForMode('learning', MAX_LEVEL).vocabularyTier).toBeLessThanOrEqual(1);
  });
});

describe('adaptive difficulty', () => {
  it('does nothing inside the hysteresis dead zone', () => {
    for (const acc of [ADAPT_DOWN_ACCURACY, 0.9, ADAPT_UP_ACCURACY - 0.001]) {
      expect(adaptLevel({ level: 5, emaAccuracy: acc, emaWpm: 40, currentWpm: 80 })).toBe(5);
    }
  });

  it('steps up only when accurate and not slowing down', () => {
    expect(adaptLevel({ level: 5, emaAccuracy: 0.99, emaWpm: 40, currentWpm: 45 })).toBe(6);
    expect(adaptLevel({ level: 5, emaAccuracy: 0.99, emaWpm: 40, currentWpm: 30 })).toBe(5);
  });

  it('steps down below the lower threshold', () => {
    expect(adaptLevel({ level: 5, emaAccuracy: 0.7, emaWpm: 40, currentWpm: 40 })).toBe(4);
  });

  it('clamps to the playable range', () => {
    expect(adaptLevel({ level: 1, emaAccuracy: 0.1, emaWpm: 10, currentWpm: 10 })).toBe(1);
    expect(adaptLevel({ level: MAX_LEVEL, emaAccuracy: 1, emaWpm: 10, currentWpm: 99 })).toBe(MAX_LEVEL);
  });

  it('does not oscillate on an alternating good/bad word stream', () => {
    let level = 5;
    let acc = 0.93;
    for (let i = 0; i < 200; i++) {
      acc = ema(acc, i % 2 === 0 ? 1 : 0.86);
      level = adaptLevel({ level, emaAccuracy: acc, emaWpm: 40, currentWpm: 41 });
    }
    // Without the dead zone this walks away from its start every few words.
    expect(Math.abs(level - 5)).toBeLessThanOrEqual(1);
  });
});

describe('ema', () => {
  it('converges toward a constant sample', () => {
    let value = 0;
    for (let i = 0; i < 100; i++) value = ema(value, 1);
    expect(value).toBeCloseTo(1, 5);
  });

  it('stays within the range of its inputs', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1 }), (samples) => {
        let value = samples[0]!;
        for (const s of samples) value = ema(value, s);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }),
    );
  });
});
