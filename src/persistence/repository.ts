import type { IDBPDatabase } from 'idb';
import type { SessionSummary } from '../app/engine';
import type { KeyStat } from '../sim/metrics';
import { openDatabase } from './db';
import type { ProgressRow, SessionRow, TypeRushDB, TypingErrorRow, UserRow } from './schema';

/**
 * Session history and progress (§11). v1 is single-user and entirely local —
 * no accounts, no network — but every row already carries a userId so a sync
 * layer can be added later without a migration.
 */

export const LOCAL_USER_ID = 'local';

/**
 * A run has to be long enough to mean something before it can set a personal
 * best; otherwise one lucky three-letter word becomes an unbeatable record.
 */
export const MIN_WORDS_FOR_RECORD = 10;

export const DEFAULT_PROGRESS: ProgressRow = {
  userId: LOCAL_USER_ID,
  xp: 0,
  bestWpm: 0,
  bestAccuracy: 0,
  bestScore: 0,
  highestLevelUnlocked: 1,
  sessionsPlayed: 0,
  totalWords: 0,
};

export class Repository {
  private constructor(private readonly db: IDBPDatabase<TypeRushDB>) {}

  static async open(): Promise<Repository> {
    return new Repository(await openDatabase());
  }

  close(): void {
    this.db.close();
  }

  async ensureUser(name = 'Player'): Promise<UserRow> {
    const existing = await this.db.get('users', LOCAL_USER_ID);
    if (existing) return existing;
    const user: UserRow = { id: LOCAL_USER_ID, name, createdAt: Date.now() };
    await this.db.put('users', user);
    return user;
  }

  /**
   * Writes the session row, its per-key error aggregate and the updated
   * progress row. Raw keystrokes are never written (§11).
   */
  async saveSession(summary: SessionSummary): Promise<{ session: SessionRow; progress: ProgressRow }> {
    await this.ensureUser();
    const session = toSessionRow(summary);
    const errorRows = toErrorRows(session.id, summary.keyStats);
    const previous = (await this.db.get('progress', LOCAL_USER_ID)) ?? DEFAULT_PROGRESS;
    const progress = mergeProgress(previous, session);

    // One transaction: history and progress can never disagree about a run.
    const tx = this.db.transaction(['sessions', 'typingErrors', 'progress'], 'readwrite');
    await Promise.all([
      tx.objectStore('sessions').put(session),
      ...errorRows.map((row) => tx.objectStore('typingErrors').put(row)),
      tx.objectStore('progress').put(progress),
      tx.done,
    ]);

    return { session, progress };
  }

  /** Most recent sessions first, read through the (userId, createdAt) index. */
  async recentSessions(limit = 20): Promise<SessionRow[]> {
    const range = IDBKeyRange.bound([LOCAL_USER_ID, -Infinity], [LOCAL_USER_ID, Infinity]);
    const rows: SessionRow[] = [];
    let cursor = await this.db.transaction('sessions').store.index('by-user-created').openCursor(range, 'prev');
    while (cursor && rows.length < limit) {
      rows.push(cursor.value);
      cursor = await cursor.continue();
    }
    return rows;
  }

  async getProgress(): Promise<ProgressRow> {
    return (await this.db.get('progress', LOCAL_USER_ID)) ?? DEFAULT_PROGRESS;
  }

  /**
   * Weak-key profile across recent sessions rather than just the last one —
   * this is what seeds personalised word selection at the start of a run (§10).
   */
  async aggregateKeyStats(sessionLimit = 10): Promise<KeyStat[]> {
    const sessions = await this.recentSessions(sessionLimit);
    const totals = new Map<string, KeyStat>();
    const tx = this.db.transaction('typingErrors');
    const index = tx.store.index('by-session');
    for (const session of sessions) {
      for (const row of await index.getAll(session.id)) {
        const stat = totals.get(row.keyChar) ?? { char: row.keyChar, attempts: 0, errors: 0 };
        stat.attempts += row.attempts;
        stat.errors += row.errors;
        totals.set(row.keyChar, stat);
      }
    }
    await tx.done;
    return [...totals.values()];
  }

  /** Wipes local history — the only data-deletion path a local-first app owes the user. */
  async clear(): Promise<void> {
    const tx = this.db.transaction(['sessions', 'typingErrors', 'progress'], 'readwrite');
    await Promise.all([
      tx.objectStore('sessions').clear(),
      tx.objectStore('typingErrors').clear(),
      tx.objectStore('progress').clear(),
      tx.done,
    ]);
  }
}

/* ------------------------------------------------------------------ */
/* Pure mapping helpers — unit-testable without a database             */
/* ------------------------------------------------------------------ */

export function toSessionRow(summary: SessionSummary, id = newId()): SessionRow {
  return {
    id,
    userId: LOCAL_USER_ID,
    mode: summary.mode,
    level: summary.level,
    durationMs: Math.round(summary.metrics.durationMs),
    wpm: summary.metrics.wpm,
    accuracy: summary.metrics.accuracy,
    consistency: summary.metrics.consistency,
    score: summary.score,
    errors: summary.metrics.errors,
    wordsCompleted: summary.wordsCompleted,
    wordsMissed: summary.wordsMissed,
    bestCombo: summary.bestCombo,
    createdAt: summary.finishedAt,
  };
}

export function toErrorRows(sessionId: string, stats: readonly KeyStat[]): TypingErrorRow[] {
  return stats
    .filter((stat) => stat.attempts > 0)
    .map((stat) => ({ sessionId, keyChar: stat.char, attempts: stat.attempts, errors: stat.errors }));
}

export function mergeProgress(previous: ProgressRow, session: SessionRow): ProgressRow {
  const qualifies = session.wordsCompleted >= MIN_WORDS_FOR_RECORD;
  return {
    userId: previous.userId,
    xp: previous.xp + xpFor(session),
    bestWpm: qualifies ? Math.max(previous.bestWpm, session.wpm) : previous.bestWpm,
    bestAccuracy: qualifies ? Math.max(previous.bestAccuracy, session.accuracy) : previous.bestAccuracy,
    // Score is a total, not a rate — a short run cannot inflate it, so it counts unconditionally.
    bestScore: Math.max(previous.bestScore, session.score),
    highestLevelUnlocked: Math.max(previous.highestLevelUnlocked, session.level),
    sessionsPlayed: previous.sessionsPlayed + 1,
    totalWords: previous.totalWords + session.wordsCompleted,
  };
}

export function xpFor(session: SessionRow): number {
  return Math.floor(session.score / 10) + session.wordsCompleted;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
