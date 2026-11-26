import type { Command, Ruleset } from '../engine/types.js';

export interface PersistedSession {
  readonly id: string;
  readonly seed: string;
  readonly ruleset: Ruleset;
  readonly commands: readonly Command[];
  readonly updatedAt: string;
}

const DB_NAME = 'nce-eclipse-local-db';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const ACTIVE_KEY = 'active-session';
const FALLBACK_KEY = 'nce-eclipse-active-session-v1';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function saveActiveSession(session: Omit<PersistedSession, 'id'>): Promise<'indexeddb' | 'localstorage'> {
  const record: PersistedSession = { ...session, id: ACTIVE_KEY };
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
    db.close();
    return 'indexeddb';
  } catch {
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(record));
    } catch {
      // Ignore storage quota errors in private browsing
    }
    return 'localstorage';
  }
}

export async function loadActiveSession(): Promise<PersistedSession | null> {
  try {
    const db = await openDatabase();
    const record = await new Promise<PersistedSession | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(ACTIVE_KEY);
      req.onsuccess = () => resolve(req.result as PersistedSession | undefined);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
    db.close();
    if (record) return record;
  } catch {
    // Fall back to localStorage below
  }

  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}
