import { AliasSampler } from './alias';
import type { KeyStat } from './metrics';
import { candidatesForTier } from './wordbank';

/**
 * Word selection (§6.3 + §10).
 *
 * Candidate lists and their alias samplers are cached per
 * (tier, length-range, weight generation). The sampler is rebuilt only when
 * the weak-key profile changes materially — never per frame.
 */

/** How strongly a weak character biases selection toward words containing it. */
const WEAK_KEY_WEIGHT = 6;

export class WordSelector {
  private cache = new Map<string, { words: readonly string[]; sampler: AliasSampler }>();
  private weakChars = new Map<string, number>();
  private generation = 0;

  constructor(private readonly bank: (tier: number) => readonly string[] = candidatesForTier) {}

  /**
   * Re-weight the bank toward the player's problem keys. Returns true if the
   * profile actually changed (and the samplers were therefore invalidated).
   */
  setWeakKeys(weak: readonly KeyStat[]): boolean {
    const next = new Map<string, number>();
    for (const stat of weak) {
      if (stat.attempts <= 0) continue;
      next.set(stat.char.toLowerCase(), stat.errors / stat.attempts);
    }
    if (sameProfile(this.weakChars, next)) return false;
    this.weakChars = next;
    this.generation++;
    this.cache.clear();
    return true;
  }

  get weakKeyCount(): number {
    return this.weakChars.size;
  }

  pick(tier: number, lengthRange: readonly [number, number], random: () => number): string {
    const entry = this.entryFor(tier, lengthRange);
    return entry.words[entry.sampler.sample(random)]!;
  }

  private entryFor(tier: number, [min, max]: readonly [number, number]) {
    const key = `${tier}:${min}:${max}:${this.generation}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const all = this.bank(tier);
    let words = all.filter((w) => w.length >= min && w.length <= max);
    // Never leave the spawner with nothing to draw from: widen rather than fail.
    if (words.length === 0) words = all.slice();

    const weights = words.map((w) => this.weightFor(w));
    const entry = { words, sampler: new AliasSampler(weights) };
    this.cache.set(key, entry);
    return entry;
  }

  private weightFor(word: string): number {
    if (this.weakChars.size === 0) return 1;
    let weight = 1;
    const seen = new Set<string>();
    for (const ch of word.toLowerCase()) {
      if (seen.has(ch)) continue;
      seen.add(ch);
      const errRate = this.weakChars.get(ch);
      if (errRate !== undefined) weight += WEAK_KEY_WEIGHT * errRate;
    }
    return weight;
  }
}

function sameProfile(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [char, rate] of a) {
    const other = b.get(char);
    // Treat sub-5-point error-rate wobble as noise, not a profile change.
    if (other === undefined || Math.abs(other - rate) > 0.05) return false;
  }
  return true;
}
