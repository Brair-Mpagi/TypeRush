import { describe, expect, it } from 'vitest';
import { difficultyForMode } from './difficulty';
import { advance } from './headless';
import { createContext, createSession, update } from './update';
import type { InputEvent } from './types';

/**
 * Frame-budget guard (§13).
 *
 * The simulation gets a small slice of the 16.6ms frame: rendering, the
 * browser's own work and React's occasional HUD re-render use the rest. The
 * thresholds here are deliberately loose — this is a regression tripwire for
 * an accidental O(n²) or a per-frame allocation storm, not a benchmark. Timing
 * on shared CI hardware is noisy, so a tight bound would only produce flakes.
 */

const FRAME_BUDGET_MS = 16.6;
/** The simulation's share of a frame; the rest belongs to render and the browser. */
const SIM_BUDGET_MS = FRAME_BUDGET_MS / 8;

function measureUpdateCost(level: number, frames: number): number {
  const ctx = createContext();
  let state = createSession({ mode: 'arcade', level, seed: 4242 });
  // Fill the screen to the concurrency cap before measuring.
  state = advance(ctx, state, 25).state;
  expect(state.activeWords.length).toBeGreaterThan(0);

  const start = performance.now();
  for (let i = 0; i < frames; i++) {
    if (state.over) state = createSession({ mode: 'arcade', level, seed: 4242 });
    const word = state.activeWords[0];
    const inputs: InputEvent[] =
      word && i % 4 === 0 ? [{ type: 'key', key: word.text[word.typedIndex] ?? 'a' }] : [];
    state = update(ctx, state, 1 / 60, inputs).state;
  }
  return (performance.now() - start) / frames;
}

describe('performance budget', () => {
  it('keeps a full-concurrency update well inside a frame', () => {
    const level = 20;
    expect(difficultyForMode('arcade', level).maxConcurrentWords).toBe(6);
    const perFrame = measureUpdateCost(level, 20000);
    expect(perFrame).toBeLessThan(SIM_BUDGET_MS);
  });

  it('does not get materially more expensive as difficulty rises', () => {
    const easy = measureUpdateCost(1, 10000);
    const hard = measureUpdateCost(30, 10000);
    // Six words instead of one should not cost an order of magnitude more.
    expect(hard).toBeLessThan(Math.max(easy * 10, SIM_BUDGET_MS));
  });

  it('spawns without unbounded allocation over a long run', () => {
    const ctx = createContext();
    const { state } = advance(ctx, createSession({ mode: 'learning', level: 5, seed: 9 }), 600);
    // The pool is fixed-size: everything that left the screen came back to it.
    expect(ctx.pool.available + state.activeWords.length).toBe(ctx.pool.capacity);
  });
});
