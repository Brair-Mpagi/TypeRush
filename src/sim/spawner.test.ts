import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { WordSelector } from './spawner';
import { candidatesForTier, WORD_TIERS } from './wordbank';

describe('word bank', () => {
  it('widens rather than swaps vocabulary as tiers rise', () => {
    for (let tier = 1; tier < WORD_TIERS.length; tier++) {
      const words = candidatesForTier(tier);
      expect(words.length).toBeGreaterThan(WORD_TIERS[tier]!.length);
      expect(words).toEqual(expect.arrayContaining([...WORD_TIERS[tier - 1]!]));
    }
  });

  it('clamps out-of-range tiers', () => {
    expect(candidatesForTier(-5)).toEqual(WORD_TIERS[0]);
    expect(candidatesForTier(99).length).toBeGreaterThan(0);
  });

  it('contains only typeable, single-line entries', () => {
    for (const tier of WORD_TIERS) {
      for (const word of tier) {
        expect(word.length).toBeGreaterThan(0);
        expect(word).not.toMatch(/[\n\r\t]/);
        // Every character must be reachable from a keyboard as a single key press.
        expect(word).toMatch(/^[\x20-\x7e]+$/);
      }
    }
  });
});

describe('WordSelector', () => {
  it('only picks words inside the requested length range', () => {
    const selector = new WordSelector();
    const rng = new Rng(1);
    for (let i = 0; i < 500; i++) {
      const word = selector.pick(2, [4, 6], () => rng.next());
      expect(word.length).toBeGreaterThanOrEqual(4);
      expect(word.length).toBeLessThanOrEqual(6);
    }
  });

  it('falls back to the whole tier when no word fits the range', () => {
    const selector = new WordSelector();
    const rng = new Rng(1);
    expect(selector.pick(0, [40, 50], () => rng.next()).length).toBeGreaterThan(0);
  });

  it('biases selection toward words containing weak keys', () => {
    const rng = new Rng(4242);
    const bank = () => ['aaaa', 'bbbb'];

    const neutral = new WordSelector(bank);
    const biased = new WordSelector(bank);
    biased.setWeakKeys([{ char: 'b', attempts: 20, errors: 12 }]);

    const countB = (selector: WordSelector) => {
      let n = 0;
      for (let i = 0; i < 4000; i++) if (selector.pick(0, [1, 10], () => rng.next()) === 'bbbb') n++;
      return n;
    };

    expect(countB(biased)).toBeGreaterThan(countB(neutral) * 1.5);
  });

  it('rebuilds samplers only when the weak-key profile moves materially', () => {
    const selector = new WordSelector();
    expect(selector.setWeakKeys([{ char: 'q', attempts: 10, errors: 5 }])).toBe(true);
    // Same key, error rate barely moved — noise, not a new profile.
    expect(selector.setWeakKeys([{ char: 'q', attempts: 20, errors: 10.4 }])).toBe(false);
    expect(selector.setWeakKeys([{ char: 'q', attempts: 10, errors: 9 }])).toBe(true);
    expect(selector.setWeakKeys([])).toBe(true);
    expect(selector.weakKeyCount).toBe(0);
  });

  it('is deterministic for a given rng seed', () => {
    const draw = () => {
      const selector = new WordSelector();
      const rng = new Rng(777);
      return Array.from({ length: 20 }, () => selector.pick(3, [4, 12], () => rng.next()));
    };
    expect(draw()).toEqual(draw());
  });
});
