/**
 * Deterministic PRNG (mulberry32). The simulation must never touch
 * `Math.random()` — every draw threads the seed through state so a session
 * can be replayed exactly from its inputs (§13, golden/replay tests).
 */

export interface RngDraw {
  value: number; // [0, 1)
  state: number;
}

export function nextRandom(state: number): RngDraw {
  let a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: a };
}

/** Integer in [min, max] inclusive. */
export function nextInt(state: number, min: number, max: number): { value: number; state: number } {
  const draw = nextRandom(state);
  return { value: min + Math.floor(draw.value * (max - min + 1)), state: draw.state };
}

/** A stateful adapter for code that samples many values in a row (e.g. the alias sampler). */
export class Rng {
  constructor(private seed: number) {}

  next(): number {
    const draw = nextRandom(this.seed);
    this.seed = draw.state;
    return draw.value;
  }

  get state(): number {
    return this.seed;
  }
}
