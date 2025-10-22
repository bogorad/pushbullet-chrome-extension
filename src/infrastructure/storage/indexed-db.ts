// src/infrastructure/storage/indexed-db.ts

import type { SessionCache } from "../../types/domain";
import { debugLogger } from "../../lib/logging";

const DB_NAME = "PushbulletState";
const DB_VERSION = 1;
const STORE_NAME = "session";
const CACHE_KEY = "main";

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Opens the IndexedDB database and creates the object store if needed.
 */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      debugLogger.storage("ERROR", "IndexedDB error", { error: request.error });
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
        debugLogger.storage("INFO", "IndexedDB object store created");
      }
    };
  });

  return dbPromise;
}

/**
 * Saves the entire session cache to IndexedDB.
 * @param session The session cache object to save.
 */
export async function saveSessionCache(session: SessionCache): Promise<void> {
  try {
    const db = await openDb();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    // *** ADD THESE 2 LINES BEFORE store.put ***
    const timestampedSession = { ...session, cachedAt: Date.now() };
    store.put(timestampedSession, CACHE_KEY);

    await new Promise((resolve) => (transaction.oncomplete = resolve));
    debugLogger.storage("DEBUG", "Session cache saved to IndexedDB");
  } catch (error) {
    debugLogger.storage(
      "ERROR",
      "Failed to save session to IndexedDB",
      null,
      error as Error,
    );
  }
}

/**
 * Loads the session cache from IndexedDB.
 * @returns The saved session cache, or null if not found.
 */
export async function loadSessionCache(): Promise<SessionCache | null> {
  try {
    const db = await openDb();
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(CACHE_KEY);

    return new Promise((resolve) => {
      request.onsuccess = () => {
        debugLogger.storage("DEBUG", "Session cache loaded from IndexedDB", {
          found: !!request.result,
        });
        resolve(request.result || null);
      };
      request.onerror = () => {
        debugLogger.storage("ERROR", "Failed to load session from IndexedDB", {
          error: request.error,
        });
        resolve(null);
      };
    });
  } catch (error) {
    debugLogger.storage(
      "ERROR",
      "Failed to open IndexedDB for loading",
      null,
      error as Error,
    );
    return null;
  }
}

/**
 * Clears the session cache from IndexedDB.
 */
export async function clearSessionCache(): Promise<void> {
  try {
    const db = await openDb();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    await new Promise((resolve) => (transaction.oncomplete = resolve));
    debugLogger.storage("INFO", "IndexedDB session cache cleared");
  } catch (error) {
    debugLogger.storage(
      "ERROR",
      "Failed to clear IndexedDB session",
      null,
      error as Error,
    );
  }
}