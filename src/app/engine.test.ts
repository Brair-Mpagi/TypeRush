// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEngine, type SessionSummary } from './engine';

/**
 * Drives the engine with a hand-cranked rAF clock so loop behaviour (delta
 * clamping, pause, HUD publication, game-over hand-off) is testable without a
 * real browser or real time.
 */

let frameCallbacks: FrameRequestCallback[] = [];
let now = 0;

function stubCanvasContext(): void {
  const context = {
    canvas: null,
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    roundRect: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1000,
    height: 700,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 700,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

/** Runs `seconds` of animation frames at a fixed step. */
function runFrames(seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds; t += step) {
    now += step * 1000;
    const callbacks = frameCallbacks;
    frameCallbacks = [];
    for (const cb of callbacks) cb(now);
  }
}

function press(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

beforeEach(() => {
  now = 0;
  frameCallbacks = [];
  stubCanvasContext();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameCallbacks.push(cb);
    return frameCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function newEngine() {
  const engine = new GameEngine();
  engine.attach(document.createElement('canvas'));
  return engine;
}

describe('GameEngine', () => {
  it('publishes HUD snapshots once the session is running', () => {
    const engine = newEngine();
    engine.start({ mode: 'arcade', level: 1, seed: 42 });
    runFrames(2);

    const hud = engine.hud.get();
    expect(hud.running).toBe(true);
    expect(hud.elapsed).toBeGreaterThan(1);
    expect(hud.urgentWord).toBeTruthy();
    engine.stop();
  });

  it('scores a word typed through the keyboard handler', () => {
    const engine = newEngine();
    engine.start({ mode: 'arcade', level: 1, seed: 42 });
    runFrames(2);

    const word = engine.hud.get().urgentWord!;
    for (const char of word) {
      expect(engine.handleKeyDown(new KeyboardEvent('keydown', { key: char }))).toBe(true);
      runFrames(1 / 60);
    }
    runFrames(0.1);

    const hud = engine.hud.get();
    expect(hud.wordsCompleted).toBe(1);
    expect(hud.score).toBeGreaterThan(0);
    expect(hud.wpm).toBeGreaterThan(0);
    engine.stop();
  });

  it('ignores shortcut keystrokes so browser chords still work', () => {
    const engine = newEngine();
    engine.start({ mode: 'arcade', level: 1, seed: 42 });
    runFrames(2);
    expect(engine.handleKeyDown(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }))).toBe(false);
    expect(engine.handleKeyDown(new KeyboardEvent('keydown', { key: 'Tab' }))).toBe(false);
    engine.stop();
  });

  it('clamps a huge delta so a backgrounded tab cannot drop every word at once', () => {
    const engine = newEngine();
    engine.start({ mode: 'arcade', level: 1, seed: 42 });
    runFrames(2);
    const livesBefore = engine.hud.get().lives;

    // One frame ten seconds late — long enough for every word to cross the floor.
    now += 10_000;
    const callbacks = frameCallbacks;
    frameCallbacks = [];
    for (const cb of callbacks) cb(now);

    expect(engine.hud.get().lives).toBe(livesBefore);
    expect(engine.hud.get().elapsed).toBeLessThan(2.2);
    engine.stop();
  });

  it('freezes the simulation while paused and does not bank the paused time', () => {
    const engine = newEngine();
    engine.start({ mode: 'arcade', level: 1, seed: 42 });
    runFrames(1);

    engine.pause();
    const atPause = engine.hud.get().elapsed;
    runFrames(3);
    expect(engine.hud.get().elapsed).toBe(atPause);
    expect(engine.hud.get().paused).toBe(true);

    engine.resume();
    runFrames(0.5);
    const afterResume = engine.hud.get().elapsed;
    expect(afterResume).toBeGreaterThan(atPause);
    expect(afterResume).toBeLessThan(atPause + 1);
    engine.stop();
  });

  it('drops keystrokes received while paused', () => {
    const engine = newEngine();
    engine.start({ mode: 'arcade', level: 1, seed: 42 });
    runFrames(2);
    const word = engine.hud.get().urgentWord!;
    engine.pause();
    expect(engine.handleKeyDown(new KeyboardEvent('keydown', { key: word[0]! }))).toBe(false);
    engine.resume();
    runFrames(0.2);
    expect(engine.hud.get().targetWord).toBeNull();
    engine.stop();
  });

  it('reports a summary when the run ends and stops the loop', () => {
    const engine = newEngine();
    const summaries: SessionSummary[] = [];
    engine.onGameOver = (summary) => summaries.push(summary);
    engine.start({ mode: 'survival', level: 1, seed: 7 });
    runFrames(40);

    expect(summaries).toHaveLength(1);
    const summary = summaries[0]!;
    expect(summary.mode).toBe('survival');
    expect(summary.metrics.accuracy).toBeGreaterThanOrEqual(0);
    expect(summary.metrics.accuracy).toBeLessThanOrEqual(1);
    expect(summary.finishedAt).toBeGreaterThan(0);

    runFrames(10);
    expect(summaries).toHaveLength(1); // fires once, not once per frame
    engine.stop();
  });

  it('emits gameplay events for the UI to react to', () => {
    const engine = newEngine();
    const kinds = new Set<string>();
    engine.onEvents = (events) => events.forEach((e) => kinds.add(e.type));
    engine.start({ mode: 'arcade', level: 1, seed: 42 });
    runFrames(2);
    const word = engine.hud.get().urgentWord!;
    for (const char of word) {
      engine.handleKeyDown(new KeyboardEvent('keydown', { key: char }));
      runFrames(1 / 60);
    }

    expect(kinds.has('wordSpawned')).toBe(true);
    expect(kinds.has('charTyped')).toBe(true);
    expect(kinds.has('wordCompleted')).toBe(true);
    engine.stop();
  });

  it('resets the HUD on stop', () => {
    const engine = newEngine();
    engine.start({ mode: 'arcade', level: 1, seed: 42 });
    runFrames(2);
    engine.stop();
    expect(engine.hud.get().running).toBe(false);
    expect(engine.hud.get().score).toBe(0);
  });

  it('starts a fresh session without leaking the previous one', () => {
    const engine = newEngine();
    engine.start({ mode: 'arcade', level: 1, seed: 42 });
    runFrames(3);
    const word = engine.hud.get().urgentWord!;
    for (const char of word) {
      engine.handleKeyDown(new KeyboardEvent('keydown', { key: char }));
      runFrames(1 / 60);
    }
    expect(engine.hud.get().score).toBeGreaterThan(0);

    engine.start({ mode: 'arcade', level: 1, seed: 42 });
    expect(engine.hud.get().score).toBe(0);
    expect(engine.hud.get().wordsCompleted).toBe(0);
    engine.stop();
  });
});

describe('window key handling contract', () => {
  it('only consumes printable keys and backspace', () => {
    const engine = newEngine();
    engine.start({ mode: 'arcade', level: 1, seed: 42 });
    runFrames(2);
    window.addEventListener('keydown', (event) => engine.handleKeyDown(event));

    press('Backspace');
    press('F5');
    press('a');
    runFrames(0.1);
    expect(engine.hud.get().running).toBe(true);
    engine.stop();
  });
});
