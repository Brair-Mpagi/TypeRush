import { CanvasRenderer } from '../render/canvasRenderer';
import { rampFactor } from '../sim/difficulty';
import { buildErrorMap, computeMetrics, weakestKeys, type KeyStat, type SessionMetrics } from '../sim/metrics';
import type { GameEvent, InputEvent, SessionState } from '../sim/types';
import { createContext, createSession, resetContext, update, type SessionOptions } from '../sim/update';
import { Store } from './store';

/**
 * The game loop driver (§4, §16).
 *
 * It owns the requestAnimationFrame loop, input capture and the renderer, and
 * publishes read-only snapshots into a store that React subscribes to. The
 * loop deliberately lives outside React: driving it through re-renders would
 * couple frame timing to React's scheduler.
 */

export interface HudSnapshot {
  score: number;
  combo: number;
  multiplier: number;
  lives: number;
  level: number;
  /** In-run speed ramp, ×1 at the start of a session. */
  ramp: number;
  elapsed: number;
  wordsCompleted: number;
  wordsMissed: number;
  wpm: number;
  accuracy: number;
  /** The word input is currently locked to. */
  targetWord: string | null;
  typedIndex: number;
  /** The word closest to the floor — what the ARIA live region announces (§14). */
  urgentWord: string | null;
  paused: boolean;
  running: boolean;
}

export interface SessionSummary {
  mode: SessionState['mode'];
  level: number;
  score: number;
  bestCombo: number;
  wordsCompleted: number;
  wordsMissed: number;
  metrics: SessionMetrics;
  keyStats: KeyStat[];
  weakKeys: KeyStat[];
  finishedAt: number;
}

const EMPTY_HUD: HudSnapshot = {
  score: 0,
  combo: 0,
  multiplier: 1,
  lives: 0,
  level: 1,
  ramp: 1,
  elapsed: 0,
  wordsCompleted: 0,
  wordsMissed: 0,
  wpm: 0,
  accuracy: 1,
  targetWord: null,
  typedIndex: 0,
  urgentWord: null,
  paused: false,
  running: false,
};

/** Delta-time clamp: stops a backgrounded tab from teleporting words to the floor. */
const MAX_DT = 0.05;

export class GameEngine {
  readonly hud = new Store<HudSnapshot>(EMPTY_HUD);

  private simCtx = createContext();
  private state: SessionState | null = null;
  private renderer: CanvasRenderer | null = null;
  private rafId: number | null = null;
  private lastTime = 0;
  private startWallClock = 0;
  private pending: InputEvent[] = [];
  private paused = false;
  private reducedMotion = false;

  onGameOver: ((summary: SessionSummary) => void) | null = null;
  onEvents: ((events: readonly GameEvent[]) => void) | null = null;

  attach(canvas: HTMLCanvasElement): void {
    this.renderer = new CanvasRenderer(canvas);
  }

  detach(): void {
    this.stop();
    this.renderer = null;
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
  }

  /**
   * Seeds word selection with the player's weak keys from previous sessions
   * (§10) — personalisation starts at the first word of a run, not after the
   * first fifteen. Rebuilds the alias samplers, so call it between sessions.
   */
  setWeakKeyProfile(stats: readonly KeyStat[]): void {
    this.simCtx.selector.setWeakKeys(weakestKeys(stats));
  }

  start(options: SessionOptions): void {
    this.stop();
    resetContext(this.simCtx);
    this.startWallClock = Date.now();
    this.state = createSession({ ...options, startedAt: this.startWallClock });
    this.pending = [];
    this.paused = false;
    this.lastTime = performance.now();
    this.publish();
    this.rafId = requestAnimationFrame(this.frame);
  }

  pause(): void {
    if (!this.state || this.paused || this.state.over) return;
    this.paused = true;
    this.publish();
  }

  resume(): void {
    if (!this.state || !this.paused) return;
    this.paused = false;
    // Discard the time spent paused instead of feeding it to the simulation.
    this.lastTime = performance.now();
    this.publish();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.state = null;
    this.paused = false;
    this.hud.set(EMPTY_HUD);
  }

  resize(): void {
    this.renderer?.resize();
  }

  /** Translates a raw keyboard event into a simulation input. Returns true if consumed. */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.state || this.state.over || this.paused) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === 'Backspace') {
      this.pending.push({ type: 'backspace' });
      return true;
    }
    if (event.key.length !== 1) return false;
    this.pending.push({ type: 'key', key: event.key });
    return true;
  }

  private frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const state = this.state;
    if (!state) return;

    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    if (!this.paused && !state.over) {
      const inputs = this.pending;
      this.pending = [];
      const { events } = update(this.simCtx, state, dt, inputs);
      if (events.length > 0) {
        this.onEvents?.(events);
        if (events.some((e) => e.type === 'gameOver')) this.finish(state);
      }
    }

    this.renderer?.render(state, {
      reducedMotion: this.reducedMotion,
      time: now / 1000,
      paused: this.paused,
    });
    this.publish();
  };

  private finish(state: SessionState): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    const keyStats = [...buildErrorMap(state.keystrokes).values()];
    this.onGameOver?.({
      mode: state.mode,
      level: state.level,
      score: state.score,
      bestCombo: state.bestCombo,
      wordsCompleted: state.wordsCompleted,
      wordsMissed: state.wordsMissed,
      metrics: computeMetrics(state.keystrokes, state.elapsed * 1000),
      keyStats,
      weakKeys: weakestKeys(keyStats),
      finishedAt: Date.now(),
    });
  }

  /**
   * Publishes a HUD snapshot, but only when a displayed value actually
   * changed — otherwise React would re-render every frame for a clock that
   * only shows tenths of a second.
   */
  private publish(): void {
    const state = this.state;
    if (!state) return;
    const locked = state.activeWords.find((w) => w.id === state.lockedWordId) ?? null;
    const metrics = computeMetrics(state.keystrokes, state.elapsed * 1000);
    const next: HudSnapshot = {
      score: state.score,
      combo: state.combo,
      multiplier: Math.min(1 + Math.floor(state.combo / 10), 5),
      lives: state.lives,
      level: state.level,
      ramp: Math.round(rampFactor(state.elapsed) * 10) / 10,
      elapsed: Math.round(state.elapsed * 10) / 10,
      wordsCompleted: state.wordsCompleted,
      wordsMissed: state.wordsMissed,
      wpm: Math.round(metrics.wpm),
      accuracy: Math.round(metrics.accuracy * 1000) / 10,
      targetWord: locked?.text ?? null,
      typedIndex: locked?.typedIndex ?? 0,
      urgentWord: urgentWord(state),
      paused: this.paused,
      running: !state.over,
    };
    const current = this.hud.get();
    if (!shallowEqual(current, next)) this.hud.set(next);
  }
}

function urgentWord(state: SessionState): string | null {
  let lowest: SessionState['activeWords'][number] | null = null;
  for (const word of state.activeWords) {
    if (!lowest || word.y > lowest.y) lowest = word;
  }
  return lowest?.text ?? null;
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  for (const key of Object.keys(a) as (keyof T)[]) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}
