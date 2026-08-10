/**
 * Vose's alias method (§6.3): O(n) setup, O(1) sampling.
 *
 * Weighted word selection by linear scan is fine while weights are uniform,
 * but once weights are re-derived from the player's weak-key profile the
 * sampler is rebuilt on every level-up over a multi-thousand-entry word bank.
 * Constant-time sampling keeps that off the frame budget.
 */
export class AliasSampler {
  private readonly prob: number[];
  private readonly alias: number[];
  readonly length: number;

  constructor(weights: readonly number[]) {
    const n = weights.length;
    if (n === 0) throw new Error('AliasSampler requires at least one weight');
    let total = 0;
    for (const w of weights) {
      if (!(w >= 0) || !Number.isFinite(w)) throw new Error('Weights must be finite and non-negative');
      total += w;
    }
    if (total <= 0) throw new Error('Weights must sum to a positive value');

    this.length = n;
    this.prob = new Array<number>(n);
    this.alias = new Array<number>(n);

    // Scale so the average bucket has probability 1.
    const scaled = weights.map((w) => (w * n) / total);
    const small: number[] = [];
    const large: number[] = [];
    for (let i = 0; i < n; i++) {
      (scaled[i]! < 1 ? small : large).push(i);
    }

    while (small.length > 0 && large.length > 0) {
      const l = small.pop()!;
      const g = large.pop()!;
      this.prob[l] = scaled[l]!;
      this.alias[l] = g;
      scaled[g] = scaled[g]! + scaled[l]! - 1;
      (scaled[g]! < 1 ? small : large).push(g);
    }
    while (large.length > 0) this.prob[large.pop()!] = 1;
    while (small.length > 0) this.prob[small.pop()!] = 1;
  }

  /** `random` must yield values in [0, 1). Returns an index into the original weights. */
  sample(random: () => number): number {
    const i = Math.floor(random() * this.length) % this.length;
    return random() < this.prob[i]! ? i : this.alias[i]!;
  }
}
