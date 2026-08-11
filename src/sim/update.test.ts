import { describe, expect, it } from 'vitest';
import { difficultyAt, difficultyForMode, startingLives } from './difficulty';
import { advance, keys, runBot, runFrames } from './headless';
import { computeMetrics } from './metrics';
import { FLOOR_Y, WORLD_WIDTH, type SessionState } from './types';
import { createContext, createSession, POOL_CAPACITY, update } from './update';

function newGame(overrides: Partial<Parameters<typeof createSession>[0]> = {}) {
  const ctx = createContext();
  const state = createSession({ mode: 'arcade', level: 1, seed: 1234, ...overrides });
  return { ctx, state };
}

/** Runs frames until at least one word is on screen. */
function spawnOne(ctx: ReturnType<typeof createContext>, state: SessionState) {
  const result = advance(ctx, state, 2);
  expect(result.state.activeWords.length).toBeGreaterThan(0);
  return result.state;
}

describe('spawning', () => {
  it('spawns words and reports them as events', () => {
    const { ctx, state } = newGame();
    const { state: next, events } = advance(ctx, state, 3);
    expect(next.activeWords.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'wordSpawned')).toBe(true);
  });

  it('never exceeds the concurrency cap for the level and elapsed time', () => {
    const { ctx, state } = newGame({ level: 12 });
    let current = state;
    for (let i = 0; i < 3000; i++) {
      current = update(ctx, current, 1 / 60, []).state;
      expect(current.activeWords.length).toBeLessThanOrEqual(
        difficultyAt('arcade', current.level, current.elapsed).maxConcurrentWords,
      );
      if (current.over) break;
    }
  });

  it('fills the screen with several words rather than one at a time', () => {
    const { ctx, state } = newGame({ level: 1 });
    const { state: next } = advance(ctx, state, 6);
    expect(next.activeWords.length).toBeGreaterThan(1);
  });

  it('spawns faster words the longer the run lasts', () => {
    const ctx = createContext();
    // A bot that keeps up, so words are cleared and the run reaches the ramp.
    const early = runBot(ctx, createSession({ mode: 'arcade', level: 2, seed: 5 }), { cps: 14, seconds: 10 });
    const earlySpeed = Math.max(...early.state.activeWords.map((w) => w.speed));

    const late = runBot(ctx, early.state, { cps: 14, seconds: 120 });
    const lateSpeed = Math.max(...late.state.activeWords.map((w) => w.speed));
    expect(lateSpeed).toBeGreaterThan(earlySpeed);
  });

  it('leaves words already in the air at the speed they were spawned with', () => {
    const { ctx, state } = newGame({ level: 3 });
    const seeded = spawnOne(ctx, state);
    const word = seeded.activeWords[0]!;
    const speedAtSpawn = word.speed;
    const arrivalAtSpawn = word.arrivalTime;
    advance(ctx, seeded, 3);
    // A mid-flight speed change would invalidate the precomputed arrival time.
    expect(word.speed).toBe(speedAtSpawn);
    expect(word.arrivalTime).toBe(arrivalAtSpawn);
  });

  it('keeps words inside the play field', () => {
    const { ctx, state } = newGame({ level: 8 });
    const { state: next } = advance(ctx, state, 20);
    for (const w of next.activeWords) {
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.x).toBeLessThanOrEqual(WORLD_WIDTH);
    }
  });

  it('respects the word-length range of the current level', () => {
    const { ctx, state } = newGame({ level: 3 });
    const [min, max] = difficultyForMode('arcade', 3).wordLengthRange;
    const { events } = advance(ctx, state, 30);
    const spawned = events.filter((e) => e.type === 'wordSpawned');
    expect(spawned.length).toBeGreaterThan(0);
    for (const e of spawned) {
      expect(e.text.length).toBeGreaterThanOrEqual(min);
      expect(e.text.length).toBeLessThanOrEqual(max);
    }
  });

  it('does not put two words with the same first letter on screen at once', () => {
    const { ctx, state } = newGame({ level: 15 });
    let current = state;
    for (let i = 0; i < 2000 && !current.over; i++) {
      current = update(ctx, current, 1 / 60, []).state;
      const firsts = current.activeWords.map((w) => w.text[0]);
      expect(new Set(firsts).size).toBe(firsts.length);
    }
  });
});

describe('motion', () => {
  it('is frame-rate independent', () => {
    const a = newGame();
    const b = newGame();
    // 1 second of simulation at 60Hz vs 144Hz must land in the same place.
    const at60 = advance(a.ctx, a.state, 1, 1 / 60).state;
    const at144 = advance(b.ctx, b.state, 1, 1 / 144).state;
    const yA = at60.activeWords[0]!.y;
    const yB = at144.activeWords[0]!.y;
    expect(Math.abs(yA - yB)).toBeLessThan(2);
  });

  it('moves words downward at the level fall speed', () => {
    const { ctx, state } = newGame();
    const seeded = spawnOne(ctx, state);
    const word = seeded.activeWords[0]!;
    const before = word.y;
    update(ctx, seeded, 0.5, []);
    expect(word.y).toBeCloseTo(before + word.speed * 0.5, 5);
  });
});

describe('typing', () => {
  it('completes a word typed correctly and awards points', () => {
    const { ctx, state } = newGame();
    const seeded = spawnOne(ctx, state);
    const word = seeded.activeWords[0]!;
    const { state: next, events } = runFrames(ctx, seeded, [{ dt: 0.01, inputs: keys(word.text) }]);

    expect(next.wordsCompleted).toBe(1);
    expect(next.score).toBeGreaterThan(0);
    expect(next.combo).toBe(1);
    expect(next.activeWords.some((w) => w.id === word.id)).toBe(false);
    const completed = events.find((e) => e.type === 'wordCompleted');
    expect(completed?.text).toBe(word.text);
  });

  it('logs a keystroke per key with the expected character', () => {
    const { ctx, state } = newGame();
    const seeded = spawnOne(ctx, state);
    const word = seeded.activeWords[0]!;
    const { state: next } = runFrames(ctx, seeded, [{ dt: 0.01, inputs: keys(word.text) }]);
    expect(next.keystrokes).toHaveLength(word.text.length);
    expect(next.keystrokes.every((k) => k.correct)).toBe(true);
    expect(next.keystrokes.map((k) => k.expected).join('')).toBe(word.text);
  });

  it('records an error and breaks the combo on a wrong key', () => {
    const { ctx, state } = newGame();
    const seeded = spawnOne(ctx, state);
    const word = seeded.activeWords[0]!;
    const wrong = word.text[0] === 'z' ? 'q' : 'z';
    seeded.combo = 5;

    const { state: next, events } = runFrames(ctx, seeded, [{ dt: 0.01, inputs: [{ type: 'key', key: wrong }] }]);
    expect(next.combo).toBe(0);
    expect(next.keystrokes[0]!.correct).toBe(false);
    expect(next.keystrokes[0]!.expected).toBe(word.text[0]);
    expect(events.some((e) => e.type === 'comboBroken')).toBe(true);
  });

  it('locks input to the word in progress once it is started', () => {
    const { ctx, state } = newGame({ level: 10 });
    let current = advance(ctx, state, 6).state;
    expect(current.activeWords.length).toBeGreaterThan(1);
    const target = current.activeWords[0]!;
    current = runFrames(ctx, current, [{ dt: 0.01, inputs: [{ type: 'key', key: target.text[0]! }] }]).state;
    expect(current.lockedWordId).toBe(target.id);

    // A key that matches another word's first letter must not switch targets.
    const other = current.activeWords.find((w) => w.id !== target.id)!;
    current = runFrames(ctx, current, [{ dt: 0.01, inputs: [{ type: 'key', key: other.text[0]! }] }]).state;
    expect(current.lockedWordId).toBe(target.id);
    expect(other.typedIndex).toBe(0);
  });

  it('ignores keystrokes when nothing is on screen', () => {
    const { ctx, state } = newGame();
    const { state: next } = runFrames(ctx, state, [{ dt: 0.001, inputs: keys('abc') }]);
    expect(next.keystrokes).toHaveLength(0);
  });

  it('ignores non-character keys', () => {
    const { ctx, state } = newGame();
    const seeded = spawnOne(ctx, state);
    const { state: next } = runFrames(ctx, seeded, [
      { dt: 0.01, inputs: [{ type: 'key', key: 'Shift' }, { type: 'key', key: 'ArrowLeft' }] },
    ]);
    expect(next.keystrokes).toHaveLength(0);
  });

  it('un-types with backspace without rewriting history', () => {
    const { ctx, state } = newGame();
    const seeded = spawnOne(ctx, state);
    const word = seeded.activeWords[0]!;
    let current = runFrames(ctx, seeded, [{ dt: 0.01, inputs: keys(word.text.slice(0, 2)) }]).state;
    expect(word.typedIndex).toBe(2);

    current = runFrames(ctx, current, [{ dt: 0.01, inputs: [{ type: 'backspace' }] }]).state;
    expect(word.typedIndex).toBe(1);
    expect(current.keystrokes).toHaveLength(2); // the correction is not a keystroke

    current = runFrames(ctx, current, [{ dt: 0.01, inputs: [{ type: 'backspace' }, { type: 'backspace' }] }]).state;
    expect(word.typedIndex).toBe(0);
    expect(current.lockedWordId).toBeNull();
  });
});

describe('miss detection', () => {
  it('fires exactly when the word reaches the floor', () => {
    const { ctx, state } = newGame();
    const seeded = spawnOne(ctx, state);
    const word = seeded.activeWords[0]!;
    const timeToFloor = word.arrivalTime - seeded.elapsed;

    const before = advance(ctx, seeded, timeToFloor - 0.1);
    expect(before.events.some((e) => e.type === 'wordMissed')).toBe(false);

    const after = advance(ctx, before.state, 0.3);
    const missed = after.events.find((e) => e.type === 'wordMissed');
    expect(missed?.wordId).toBe(word.id);
    expect(after.state.lives).toBe(startingLives('arcade') - 1);
    expect(after.state.wordsMissed).toBe(1);
  });

  it('does not fire for a word completed before it lands', () => {
    const { ctx, state } = newGame();
    const seeded = spawnOne(ctx, state);
    const word = seeded.activeWords[0]!;
    const typed = runFrames(ctx, seeded, [{ dt: 0.01, inputs: keys(word.text) }]).state;
    const after = advance(ctx, typed, 12);
    expect(after.events.filter((e) => e.type === 'wordMissed').every((e) => e.wordId !== word.id)).toBe(true);
  });

  it('pins the missed word to the floor line', () => {
    const { ctx, state } = newGame();
    const seeded = spawnOne(ctx, state);
    const word = seeded.activeWords[0]!;
    advance(ctx, seeded, word.arrivalTime + 0.5);
    expect(word.y).toBeLessThanOrEqual(FLOOR_Y);
  });
});

describe('game over', () => {
  it('ends when lives run out and stops mutating afterwards', () => {
    const { ctx, state } = newGame();
    const { state: dead, events } = advance(ctx, state, 200);
    expect(dead.over).toBe(true);
    expect(dead.lives).toBe(0);
    expect(events.filter((e) => e.type === 'gameOver')).toHaveLength(1);

    const snapshot = JSON.stringify({ score: dead.score, elapsed: dead.elapsed });
    const after = update(ctx, dead, 1, keys('abc')).state;
    expect(JSON.stringify({ score: after.score, elapsed: after.elapsed })).toBe(snapshot);
  });

  it('ends a speed test on the clock, not on lives', () => {
    const ctx = createContext();
    const state = createSession({ mode: 'speedTest', level: 3, seed: 7, timeLimitSec: 5 });
    const { state: done } = runBot(ctx, state, { cps: 6, seconds: 30 });
    expect(done.over).toBe(true);
    expect(done.elapsed).toBeGreaterThanOrEqual(5);
    expect(done.lives).toBeGreaterThan(0);
  });

  it('gives survival mode a single life', () => {
    const ctx = createContext();
    const state = createSession({ mode: 'survival', seed: 3 });
    expect(state.lives).toBe(1);
    const { state: dead } = advance(ctx, state, 60);
    expect(dead.over).toBe(true);
    expect(dead.wordsMissed).toBe(1);
  });
});

describe('progression', () => {
  it('raises the level for an accurate fast player in arcade mode', () => {
    const ctx = createContext();
    const state = createSession({ mode: 'arcade', level: 1, seed: 99 });
    const { state: done } = runBot(ctx, state, { cps: 12, seconds: 90 });
    expect(done.level).toBeGreaterThan(1);
    expect(done.wordsCompleted).toBeGreaterThan(10);
  });

  it('lowers the level for a sloppy player', () => {
    const ctx = createContext();
    const state = createSession({ mode: 'arcade', level: 8, seed: 5 });
    const { state: done } = runBot(ctx, state, { cps: 10, errorRate: 0.45, seconds: 60 });
    expect(done.level).toBeLessThanOrEqual(8);
  });

  it('steps learning mode up on word count', () => {
    const ctx = createContext();
    const state = createSession({ mode: 'learning', seed: 11 });
    const { state: done, events } = runBot(ctx, state, { cps: 14, seconds: 120 });
    expect(done.wordsCompleted).toBeGreaterThan(12);
    expect(events.some((e) => e.type === 'levelChanged' && e.direction === 'up')).toBe(true);
  });
});

describe('determinism', () => {
  it('produces identical sessions from identical seeds and inputs (replay)', () => {
    const a = createContext();
    const b = createContext();
    const run = (ctx: ReturnType<typeof createContext>) =>
      runBot(ctx, createSession({ mode: 'arcade', level: 2, seed: 2024 }), {
        cps: 7,
        errorRate: 0.1,
        seconds: 45,
      });

    const first = run(a);
    const second = run(b);
    expect(second.state.score).toBe(first.state.score);
    expect(second.state.wordsCompleted).toBe(first.state.wordsCompleted);
    expect(second.state.keystrokes).toEqual(first.state.keystrokes);
    expect(second.events).toEqual(first.events);
  });

  it('diverges for different seeds', () => {
    const words = (seed: number) => {
      const ctx = createContext();
      const { events } = advance(ctx, createSession({ mode: 'arcade', seed }), 20);
      return events.filter((e) => e.type === 'wordSpawned').map((e) => e.text);
    };
    expect(words(1)).not.toEqual(words(2));
  });
});

describe('invariants over a long session', () => {
  it('holds score, lives, pool and metric invariants throughout', () => {
    const ctx = createContext();
    let current = createSession({ mode: 'arcade', level: 4, seed: 31337 });
    let lastScore = 0;
    for (let i = 0; i < 6000 && !current.over; i++) {
      const key = current.activeWords[0]?.text[current.activeWords[0]!.typedIndex];
      current = update(ctx, current, 1 / 60, i % 7 === 0 && key ? [{ type: 'key', key }] : []).state;

      expect(current.score).toBeGreaterThanOrEqual(lastScore); // score never decreases
      lastScore = current.score;
      expect(current.lives).toBeGreaterThanOrEqual(0);
      expect(current.activeWords.length).toBeLessThanOrEqual(POOL_CAPACITY);
      expect(current.activeWords.every((w) => w.alive)).toBe(true);
      expect(new Set(current.activeWords.map((w) => w.id)).size).toBe(current.activeWords.length);
    }

    const metrics = computeMetrics(current.keystrokes, current.elapsed * 1000);
    expect(metrics.accuracy).toBeGreaterThanOrEqual(0);
    expect(metrics.accuracy).toBeLessThanOrEqual(1);
    expect(metrics.wpm).toBeGreaterThanOrEqual(0);
  });

  it('returns every word to the pool as it leaves the screen', () => {
    const ctx = createContext();
    const { state: done } = runBot(ctx, createSession({ mode: 'arcade', seed: 8 }), {
      cps: 8,
      errorRate: 0.05,
      seconds: 120,
    });
    // Completed + missed + still-falling must account for every word ever spawned.
    expect(ctx.pool.available).toBe(POOL_CAPACITY - done.activeWords.length);
  });
});
