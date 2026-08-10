import { update, type SimContext } from './update';
import type { GameEvent, InputEvent, SessionState } from './types';

/**
 * Headless driving of the simulation (§13). Because the core never touches the
 * DOM, a whole session can be run at arbitrary speed with synthetic frames —
 * used by the integration tests and by balance-tuning experiments.
 */

export interface Frame {
  dt: number;
  inputs?: readonly InputEvent[];
}

export function runFrames(
  ctx: SimContext,
  state: SessionState,
  frames: readonly Frame[],
): { state: SessionState; events: GameEvent[] } {
  const collected: GameEvent[] = [];
  let current = state;
  for (const frame of frames) {
    const result = update(ctx, current, frame.dt, frame.inputs ?? []);
    current = result.state;
    collected.push(...result.events);
  }
  return { state: current, events: collected };
}

/** Runs `seconds` of simulation at a fixed step, with no input. */
export function advance(
  ctx: SimContext,
  state: SessionState,
  seconds: number,
  step = 1 / 60,
): { state: SessionState; events: GameEvent[] } {
  const frames: Frame[] = [];
  for (let t = 0; t < seconds; t += step) frames.push({ dt: step });
  return runFrames(ctx, state, frames);
}

export function keys(text: string): InputEvent[] {
  return [...text].map((key) => ({ type: 'key', key }) as const);
}

/**
 * A synthetic player that types the lowest word on screen at a fixed rate with
 * a fixed error probability. Deterministic given the session seed.
 */
export interface BotOptions {
  /** Characters per second the bot can sustain. */
  cps: number;
  /** Probability of hitting the wrong key on any given character. */
  errorRate?: number;
  /** Seconds of simulation to run. */
  seconds: number;
  step?: number;
}

export function runBot(
  ctx: SimContext,
  state: SessionState,
  options: BotOptions,
): { state: SessionState; events: GameEvent[] } {
  const step = options.step ?? 1 / 60;
  const errorRate = options.errorRate ?? 0;
  const interval = 1 / options.cps;
  let sinceLastKey = 0;
  let botSeed = 0x2545f491;
  const collected: GameEvent[] = [];
  let current = state;

  const rand = () => {
    botSeed = (Math.imul(botSeed ^ (botSeed >>> 15), 1 | botSeed) + 0x6d2b79f5) | 0;
    return ((botSeed >>> 0) % 100000) / 100000;
  };

  for (let t = 0; t < options.seconds && !current.over; t += step) {
    const inputs: InputEvent[] = [];
    sinceLastKey += step;
    if (sinceLastKey >= interval) {
      sinceLastKey = 0;
      const target =
        current.activeWords.find((w) => w.id === current.lockedWordId) ??
        current.activeWords.reduce<null | (typeof current.activeWords)[number]>(
          (best, w) => (!best || w.y > best.y ? w : best),
          null,
        );
      if (target) {
        const expected = target.text[target.typedIndex] ?? '';
        inputs.push({ type: 'key', key: rand() < errorRate ? wrongKeyFor(expected) : expected });
      }
    }
    const result = update(ctx, current, step, inputs);
    current = result.state;
    collected.push(...result.events);
  }
  return { state: current, events: collected };
}

function wrongKeyFor(expected: string): string {
  return expected === 'x' ? 'q' : 'x';
}
