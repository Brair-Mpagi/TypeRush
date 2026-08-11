// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionSummary } from '../app/engine';
import { computeMetrics } from '../sim/metrics';
import type { Keystroke } from '../sim/types';
import {
  DEFAULT_PROGRESS,
  MIN_WORDS_FOR_RECORD,
  mergeProgress,
  Repository,
  toErrorRows,
  toSessionRow,
  xpFor,
} from './repository';

function log(correct: number, wrong: number): Keystroke[] {
  const keystrokes: Keystroke[] = [];
  for (let i = 0; i < correct; i++) {
    keystrokes.push({ key: 'a', expected: 'a', correct: true, timestamp: i * 100, wordId: 'w' });
  }
  for (let i = 0; i < wrong; i++) {
    keystrokes.push({ key: 'x', expected: 'q', correct: false, timestamp: (correct + i) * 100, wordId: 'w' });
  }
  return keystrokes;
}

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  const keystrokes = log(90, 10);
  return {
    mode: 'arcade',
    level: 5,
    score: 4200,
    bestCombo: 22,
    wordsCompleted: 20,
    wordsMissed: 2,
    metrics: computeMetrics(keystrokes, 60000),
    keyStats: [
      { char: 'a', attempts: 90, errors: 0 },
      { char: 'q', attempts: 10, errors: 10 },
    ],
    weakKeys: [{ char: 'q', attempts: 10, errors: 10 }],
    finishedAt: Date.now(),
    ...overrides,
  };
}

describe('row mapping', () => {
  it('flattens a summary into the session row shape', () => {
    const row = toSessionRow(summary(), 'session-1');
    expect(row).toMatchObject({
      id: 'session-1',
      userId: 'local',
      mode: 'arcade',
      level: 5,
      score: 4200,
      wordsCompleted: 20,
      wordsMissed: 2,
      bestCombo: 22,
      durationMs: 60000,
    });
    expect(row.accuracy).toBeCloseTo(0.9);
  });

  it('writes per-key aggregates and nothing keystroke-level', () => {
    const rows = toErrorRows('session-1', summary().keyStats);
    expect(rows).toEqual([
      { sessionId: 'session-1', keyChar: 'a', attempts: 90, errors: 0 },
      { sessionId: 'session-1', keyChar: 'q', attempts: 10, errors: 10 },
    ]);
    // No timestamps: raw keystroke timing is never persisted (§11).
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['attempts', 'errors', 'keyChar', 'sessionId']);
  });

  it('skips keys with no attempts', () => {
    expect(toErrorRows('s', [{ char: 'z', attempts: 0, errors: 0 }])).toEqual([]);
  });
});

describe('mergeProgress', () => {
  it('accumulates xp, sessions and words', () => {
    const session = toSessionRow(summary(), 's1');
    const next = mergeProgress(DEFAULT_PROGRESS, session);
    expect(next.sessionsPlayed).toBe(1);
    expect(next.totalWords).toBe(20);
    expect(next.xp).toBe(xpFor(session));
  });

  it('records personal bests only for substantial runs', () => {
    const short = toSessionRow(summary({ wordsCompleted: MIN_WORDS_FOR_RECORD - 1 }), 's-short');
    const afterShort = mergeProgress(DEFAULT_PROGRESS, short);
    expect(afterShort.bestWpm).toBe(0);
    expect(afterShort.xp).toBeGreaterThan(0); // still earns xp

    const long = toSessionRow(summary(), 's-long');
    const afterLong = mergeProgress(afterShort, long);
    expect(afterLong.bestWpm).toBeCloseTo(long.wpm);
  });

  it('tracks the high score regardless of run length', () => {
    const short = toSessionRow(summary({ wordsCompleted: 2, score: 999 }), 's-short');
    expect(mergeProgress(DEFAULT_PROGRESS, short).bestScore).toBe(999);
  });

  it('never lowers a best or re-locks a level', () => {
    const previous = { ...DEFAULT_PROGRESS, bestWpm: 120, bestAccuracy: 0.99, bestScore: 9999, highestLevelUnlocked: 12 };
    const weaker = toSessionRow(summary({ level: 3 }), 's2');
    const next = mergeProgress(previous, weaker);
    expect(next.bestWpm).toBe(120);
    expect(next.bestAccuracy).toBe(0.99);
    expect(next.bestScore).toBe(9999);
    expect(next.highestLevelUnlocked).toBe(12);
  });

  it('unlocks the level the player actually reached', () => {
    const next = mergeProgress(DEFAULT_PROGRESS, toSessionRow(summary({ level: 9 }), 's3'));
    expect(next.highestLevelUnlocked).toBe(9);
  });
});

describe('Repository', () => {
  let repo: Repository;

  beforeEach(async () => {
    indexedDB = new IDBFactory();
    repo = await Repository.open();
  });

  it('creates the local user once', async () => {
    const first = await repo.ensureUser();
    const second = await repo.ensureUser('Renamed');
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('round-trips a session and its progress', async () => {
    const { session, progress } = await repo.saveSession(summary());
    expect(await repo.getProgress()).toEqual(progress);
    const history = await repo.recentSessions();
    expect(history).toHaveLength(1);
    expect(history[0]!.id).toBe(session.id);
  });

  it('returns history newest first and honours the limit', async () => {
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      await repo.saveSession(summary({ score: i * 100, finishedAt: base + i * 1000 }));
    }
    const recent = await repo.recentSessions(3);
    expect(recent).toHaveLength(3);
    expect(recent.map((s) => s.createdAt)).toEqual([base + 4000, base + 3000, base + 2000]);
  });

  it('starts from defaults when nothing has been played', async () => {
    expect(await repo.getProgress()).toEqual(DEFAULT_PROGRESS);
    expect(await repo.recentSessions()).toEqual([]);
    expect(await repo.aggregateKeyStats()).toEqual([]);
  });

  it('sums key stats across sessions for the personalisation profile', async () => {
    await repo.saveSession(summary());
    await repo.saveSession(
      summary({
        keyStats: [
          { char: 'q', attempts: 5, errors: 2 },
          { char: 'z', attempts: 8, errors: 3 },
        ],
      }),
    );

    const stats = await repo.aggregateKeyStats();
    const byChar = new Map(stats.map((s) => [s.char, s]));
    expect(byChar.get('q')).toEqual({ char: 'q', attempts: 15, errors: 12 });
    expect(byChar.get('z')).toEqual({ char: 'z', attempts: 8, errors: 3 });
    expect(byChar.get('a')).toEqual({ char: 'a', attempts: 90, errors: 0 });
  });

  it('only aggregates over the requested number of recent sessions', async () => {
    const base = Date.now();
    await repo.saveSession(summary({ finishedAt: base, keyStats: [{ char: 'j', attempts: 4, errors: 4 }] }));
    await repo.saveSession(summary({ finishedAt: base + 1000, keyStats: [{ char: 'k', attempts: 4, errors: 1 }] }));

    const stats = await repo.aggregateKeyStats(1);
    expect(stats.map((s) => s.char)).toEqual(['k']);
  });

  it('clears history and progress but keeps the user', async () => {
    await repo.saveSession(summary());
    await repo.clear();
    expect(await repo.recentSessions()).toEqual([]);
    expect(await repo.getProgress()).toEqual(DEFAULT_PROGRESS);
    expect((await repo.ensureUser()).id).toBe('local');
  });

  it('survives being reopened', async () => {
    await repo.saveSession(summary());
    repo.close();
    const reopened = await Repository.open();
    expect(await reopened.recentSessions()).toHaveLength(1);
    reopened.close();
  });
});
