import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionSummary } from '../app/engine';
import type { KeyStat } from '../sim/metrics';
import { isPersistenceAvailable } from '../persistence/db';
import { DEFAULT_PROGRESS, MIN_WORDS_FOR_RECORD, Repository } from '../persistence/repository';
import type { ProgressRow, SessionRow } from '../persistence/schema';

const HISTORY_LIMIT = 10;

export interface Records {
  wpm: boolean;
  score: boolean;
  accuracy: boolean;
}

/**
 * The player's persisted profile (§11): progress, recent history and the
 * cross-session weak-key stats that seed personalised word selection.
 *
 * Persistence is best-effort. If IndexedDB is unavailable — private mode, a
 * blocked origin — the game still plays; it just forgets.
 */
export function useProfile() {
  const repoRef = useRef<Repository | null>(null);
  const [progress, setProgress] = useState<ProgressRow>(DEFAULT_PROGRESS);
  const [history, setHistory] = useState<SessionRow[]>([]);
  const [weakKeys, setWeakKeys] = useState<KeyStat[]>([]);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isPersistenceAvailable()) return;

    void (async () => {
      try {
        const repo = await Repository.open();
        if (cancelled) {
          repo.close();
          return;
        }
        repoRef.current = repo;
        setProgress(await repo.getProgress());
        setHistory(await repo.recentSessions(HISTORY_LIMIT));
        setWeakKeys(await repo.aggregateKeyStats());
        setAvailable(true);
      } catch {
        // Storage denied — carry on without history.
      }
    })();

    return () => {
      cancelled = true;
      repoRef.current?.close();
      repoRef.current = null;
    };
  }, []);

  /** Persists a finished run and reports which personal bests it beat. */
  const saveSession = useCallback(async (summary: SessionSummary): Promise<Records> => {
    const repo = repoRef.current;
    const previous = repo ? await repo.getProgress() : DEFAULT_PROGRESS;
    const qualifies = summary.wordsCompleted >= MIN_WORDS_FOR_RECORD;
    const records: Records = {
      wpm: qualifies && summary.metrics.wpm > previous.bestWpm,
      accuracy: qualifies && summary.metrics.accuracy > previous.bestAccuracy,
      score: summary.score > previous.bestScore,
    };
    if (!repo) return records;

    try {
      const { progress: updated } = await repo.saveSession(summary);
      setProgress(updated);
      setHistory(await repo.recentSessions(HISTORY_LIMIT));
      setWeakKeys(await repo.aggregateKeyStats());
    } catch {
      // A failed write must never cost the player their results screen.
    }
    return records;
  }, []);

  const clear = useCallback(async () => {
    const repo = repoRef.current;
    if (!repo) return;
    await repo.clear();
    setProgress(DEFAULT_PROGRESS);
    setHistory([]);
    setWeakKeys([]);
  }, []);

  return { progress, history, weakKeys, available, saveSession, clear };
}
