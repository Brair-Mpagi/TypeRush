import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  accuracy,
  buildErrorMap,
  computeMetrics,
  consistency,
  errorRate,
  weakestKeys,
  wpm,
} from './metrics';
import type { Keystroke } from './types';

function ks(spec: { key: string; expected?: string; correct?: boolean; t: number }): Keystroke {
  const expected = spec.expected ?? spec.key;
  return {
    key: spec.key,
    expected,
    correct: spec.correct ?? spec.key === expected,
    timestamp: spec.t,
    wordId: 'w0',
  };
}

const arbKeystroke = fc.record({
  key: fc.constantFrom('a', 'b', 'c', 'd'),
  expected: fc.constantFrom('a', 'b', 'c', 'd'),
  timestamp: fc.integer({ min: 0, max: 60000 }),
}).map(
  (r): Keystroke => ({ ...r, correct: r.key === r.expected, wordId: 'w0' }),
);

describe('wpm', () => {
  it('uses the 5-characters-per-word convention', () => {
    // 50 correct chars in 60s = 10 words/minute.
    expect(wpm(50, 60000)).toBeCloseTo(10);
    expect(wpm(250, 60000)).toBeCloseTo(50);
  });

  it('is zero for a zero or negative duration rather than infinite', () => {
    expect(wpm(100, 0)).toBe(0);
    expect(wpm(100, -5)).toBe(0);
  });

  it('is never negative and always finite', () => {
    fc.assert(
      fc.property(fc.nat({ max: 10000 }), fc.nat({ max: 600000 }), (chars, ms) => {
        const value = wpm(chars, ms);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe('accuracy and error rate', () => {
  it('is 1 for an empty log — nothing typed, nothing wrong', () => {
    expect(accuracy([])).toBe(1);
    expect(errorRate([])).toBe(0);
  });

  it('counts correct keystrokes over total', () => {
    const log = [ks({ key: 'a', t: 0 }), ks({ key: 'x', expected: 'b', t: 100 })];
    expect(accuracy(log)).toBe(0.5);
    expect(errorRate(log)).toBe(0.5);
  });

  it('stays in [0,1] and complements the error rate for any log', () => {
    fc.assert(
      fc.property(fc.array(arbKeystroke), (log) => {
        const a = accuracy(log);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        expect(a + errorRate(log)).toBeCloseTo(1, 10);
      }),
    );
  });
});

describe('consistency', () => {
  it('is 1 for a perfectly even rhythm', () => {
    const log = [0, 100, 200, 300, 400].map((t) => ks({ key: 'a', t }));
    expect(consistency(log)).toBeCloseTo(1, 10);
  });

  it('drops when the rhythm is erratic', () => {
    const log = [0, 10, 900, 920, 2000].map((t) => ks({ key: 'a', t }));
    expect(consistency(log)).toBeLessThan(0.6);
  });

  it('ignores the gap between words, which measures spawn timing, not rhythm', () => {
    const steady = (t: number, wordId: string): Keystroke => ({ ...ks({ key: 'a', t }), wordId });
    // Even 100ms typing inside each word, with a three-second wait in between.
    const log = [
      steady(0, 'w1'),
      steady(100, 'w1'),
      steady(200, 'w1'),
      steady(3200, 'w2'),
      steady(3300, 'w2'),
      steady(3400, 'w2'),
    ];
    expect(consistency(log)).toBeCloseTo(1, 10);
  });

  it('still drops when the rhythm inside a word is erratic', () => {
    const log = [0, 10, 900, 920, 2000].map((t) => ks({ key: 'a', t }));
    expect(consistency(log)).toBeLessThan(0.6);
  });

  it('stays in [0,1] for any log', () => {
    fc.assert(
      fc.property(fc.array(arbKeystroke), (log) => {
        const sorted = [...log].sort((a, b) => a.timestamp - b.timestamp);
        const c = consistency(sorted);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe('computeMetrics', () => {
  it('agrees with the individual folds', () => {
    const log = [
      ks({ key: 't', t: 0 }),
      ks({ key: 'h', t: 120 }),
      ks({ key: 'x', expected: 'e', t: 240 }),
      ks({ key: 'e', t: 360 }),
    ];
    const m = computeMetrics(log, 1000);
    expect(m.correctChars).toBe(3);
    expect(m.totalChars).toBe(4);
    expect(m.errors).toBe(1);
    expect(m.accuracy).toBe(0.75);
    expect(m.wpm).toBeCloseTo(wpm(3, 1000));
    expect(m.rawWpm).toBeCloseTo(wpm(4, 1000));
  });

  it('holds its invariants over fuzzed logs', () => {
    fc.assert(
      fc.property(fc.array(arbKeystroke), fc.nat({ max: 600000 }), (log, ms) => {
        const m = computeMetrics(log, ms);
        expect(m.wpm).toBeGreaterThanOrEqual(0);
        expect(m.wpm).toBeLessThanOrEqual(m.rawWpm + 1e-9);
        expect(m.accuracy).toBeGreaterThanOrEqual(0);
        expect(m.accuracy).toBeLessThanOrEqual(1);
        expect(m.correctChars + m.errors).toBe(m.totalChars);
      }),
    );
  });
});

describe('weak-key analysis', () => {
  it('aggregates attempts and errors per expected character', () => {
    const log = [
      ks({ key: 'a', t: 0 }),
      ks({ key: 's', expected: 'a', t: 10 }),
      ks({ key: 'b', t: 20 }),
    ];
    const map = buildErrorMap(log);
    expect(map.get('a')).toEqual({ char: 'a', attempts: 2, errors: 1 });
    expect(map.get('b')).toEqual({ char: 'b', attempts: 1, errors: 0 });
  });

  it('ranks the worst keys first and ignores thin samples', () => {
    const stats = [
      { char: 'q', attempts: 10, errors: 6 },
      { char: 'z', attempts: 10, errors: 3 },
      { char: 'p', attempts: 2, errors: 2 }, // too few attempts to trust
      { char: 'e', attempts: 50, errors: 0 }, // no errors at all
    ];
    expect(weakestKeys(stats, 2).map((s) => s.char)).toEqual(['q', 'z']);
  });

  it('returns at most k keys', () => {
    const stats = 'abcdefgh'.split('').map((char) => ({ char, attempts: 10, errors: 5 }));
    expect(weakestKeys(stats, 3)).toHaveLength(3);
  });
});
