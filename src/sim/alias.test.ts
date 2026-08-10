import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AliasSampler } from './alias';
import { Rng } from './rng';

describe('AliasSampler', () => {
  it('reproduces the weight distribution within statistical tolerance', () => {
    const weights = [1, 3, 6];
    const sampler = new AliasSampler(weights);
    const rng = new Rng(12345);
    const counts = [0, 0, 0];
    const n = 60000;
    for (let i = 0; i < n; i++) counts[sampler.sample(() => rng.next())]!++;

    const total = weights.reduce((a, b) => a + b, 0);
    weights.forEach((w, i) => {
      expect(counts[i]! / n).toBeCloseTo(w / total, 2);
    });
  });

  it('always returns an in-range index for any weights', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { minLength: 1, maxLength: 25 })
          .filter((ws) => ws.reduce((a, b) => a + b, 0) > 0),
        fc.integer({ min: 0, max: 2 ** 30 }),
        (weights, seed) => {
          const sampler = new AliasSampler(weights);
          const rng = new Rng(seed);
          for (let i = 0; i < 50; i++) {
            const index = sampler.sample(() => rng.next());
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(weights.length);
          }
        },
      ),
    );
  });

  it('never samples a zero-weight entry', () => {
    const sampler = new AliasSampler([0, 5, 0, 5]);
    const rng = new Rng(99);
    for (let i = 0; i < 5000; i++) {
      expect([1, 3]).toContain(sampler.sample(() => rng.next()));
    }
  });

  it('handles the single-entry case', () => {
    const sampler = new AliasSampler([7]);
    expect(sampler.sample(() => 0.999999)).toBe(0);
  });

  it('rejects degenerate weight vectors', () => {
    expect(() => new AliasSampler([])).toThrow();
    expect(() => new AliasSampler([0, 0])).toThrow();
    expect(() => new AliasSampler([1, -1])).toThrow();
    expect(() => new AliasSampler([Number.NaN])).toThrow();
  });
});

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('stays in [0,1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs across seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
});
