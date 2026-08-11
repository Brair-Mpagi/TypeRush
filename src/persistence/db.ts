import { openDB, type IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, type TypeRushDB } from './schema';

/**
 * IndexedDB bootstrap. Schema changes go in the version switch below — each
 * case falls through from the version the user is on to the current one.
 */
export function openDatabase(): Promise<IDBPDatabase<TypeRushDB>> {
  return openDB<TypeRushDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('users', { keyPath: 'id' });

        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('by-user-created', ['userId', 'createdAt']);

        const errors = db.createObjectStore('typingErrors', { keyPath: ['sessionId', 'keyChar'] });
        errors.createIndex('by-session', 'sessionId');

        db.createObjectStore('progress', { keyPath: 'userId' });
      }
    },
  });
}

/** True when the environment can persist at all (private modes, SSR, old browsers). */
export function isPersistenceAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}
