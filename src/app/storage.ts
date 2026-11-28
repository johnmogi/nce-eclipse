import type { Command, GamePhase, Ruleset } from '../engine/types.js';

export interface PersistedSession {
  readonly id: string;
  readonly label: string;
  readonly kind: 'manual' | 'auto';
  readonly seed: string;
  readonly ruleset: Ruleset;
  readonly commands: readonly Command[];
  readonly round: number;
  readonly turn: number;
  readonly phase: GamePhase;
  readonly stateHash: string;
  readonly updatedAt: string;
}

const DB_NAME = 'nce-eclipse-local-db';
const DB_VERSION = 2;
const STORE_NAME = 'sessions';
const LEGACY_ACTIVE_KEY = 'active-session';
const FALLBACK_LIST_KEY = 'nce-eclipse-saved-sessions-v2';

export function createSessionId(prefix: 'save' | 'auto' = 'auto'): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${ts}-${rand}`;
}

function isValidPersistedSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<PersistedSession>;
  return (
    typeof v.id === 'string' &&
    v.id !== LEGACY_ACTIVE_KEY &&
    typeof v.seed === 'string' &&
    Boolean(v.ruleset) &&
    Array.isArray(v.commands) &&
    typeof v.updatedAt === 'string'
  );
}

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

function readFallbackList(): PersistedSession[] {
  try {
    const raw = localStorage.getItem(FALLBACK_LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPersistedSession);
  } catch {
    return [];
  }
}

function writeFallbackList(sessions: readonly PersistedSession[]): void {
  try {
    localStorage.setItem(FALLBACK_LIST_KEY, JSON.stringify(sessions));
  } catch {
    // Ignore storage quota errors in private browsing
  }
}

export async function saveSessionRecord(
  session: PersistedSession
): Promise<'indexeddb' | 'localstorage'> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(session);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
    db.close();
    return 'indexeddb';
  } catch {
    const existing = readFallbackList().filter((s) => s.id !== session.id);
    writeFallbackList([session, ...existing]);
    return 'localstorage';
  }
}

export async function listSavedSessions(): Promise<PersistedSession[]> {
  try {
    const db = await openDatabase();
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
    db.close();
    const valid = records.filter(isValidPersistedSession);
    return valid.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return readFallbackList().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

export async function deleteSavedSession(sessionId: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    });
    db.close();
  } catch {
    const remaining = readFallbackList().filter((s) => s.id !== sessionId);
    writeFallbackList(remaining);
  }
}
