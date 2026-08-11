import type { DBSchema } from 'idb';
import type { GameMode } from '../sim/types';

/**
 * Client-local persistence schema (§11).
 *
 * This mirrors the SQL schema in the design doc one-for-one, so the desktop
 * (Tauri/SQLite) build can use the same shapes without a migration:
 *
 *   users(id, name, created_at)
 *   sessions(id, user_id, mode, level, duration_ms, wpm, accuracy, score, errors, created_at)
 *   typing_errors(session_id, key_char, attempts, errors)
 *   progress(user_id, xp, best_wpm, best_accuracy, highest_level_unlocked)
 *
 * Deliberately absent: raw keystrokes. Keystroke timing is sensitive
 * telemetry; it lives in memory for the duration of a session and only its
 * per-key aggregate is written down.
 */

export const DB_NAME = 'typerush';
export const DB_VERSION = 1;

export interface UserRow {
  id: string;
  name: string;
  createdAt: number;
}

export interface SessionRow {
  id: string;
  userId: string;
  mode: GameMode;
  level: number;
  durationMs: number;
  wpm: number;
  accuracy: number;
  consistency: number;
  score: number;
  errors: number;
  wordsCompleted: number;
  wordsMissed: number;
  bestCombo: number;
  createdAt: number;
}

export interface TypingErrorRow {
  sessionId: string;
  keyChar: string;
  attempts: number;
  errors: number;
}

export interface ProgressRow {
  userId: string;
  xp: number;
  bestWpm: number;
  bestAccuracy: number;
  bestScore: number;
  highestLevelUnlocked: number;
  sessionsPlayed: number;
  totalWords: number;
}

export interface TypeRushDB extends DBSchema {
  users: {
    key: string;
    value: UserRow;
  };
  sessions: {
    key: string;
    value: SessionRow;
    /** Mirrors idx_sessions_user_created — history reads are a range scan, not a full sweep. */
    indexes: { 'by-user-created': [string, number] };
  };
  typingErrors: {
    key: [string, string];
    value: TypingErrorRow;
    indexes: { 'by-session': string };
  };
  progress: {
    key: string;
    value: ProgressRow;
  };
}
