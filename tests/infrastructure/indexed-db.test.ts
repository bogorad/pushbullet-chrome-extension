import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SessionCache } from '../../src/types/domain';

const debugLoggerMock = {
  storage: vi.fn(),
};

vi.mock('../../src/lib/logging', () => ({
  debugLogger: debugLoggerMock,
}));

function createSession(): SessionCache {
  return {
    userInfo: null,
    devices: [],
    recentPushes: [],
    chats: [],
    isAuthenticated: true,
    lastUpdated: 1,
    autoOpenLinks: true,
    deviceNickname: 'Chrome',
    onlyThisDevice: false,
    lastModifiedCutoff: 0,
    cachedAt: 0,
  };
}

describe('saveSessionCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  });

  it('rejects when IndexedDB open fails', async () => {
    const openError = new Error('open failed');
    const request = {
      error: openError,
      onerror: null as ((event: Event) => void) | null,
      onsuccess: null as (() => void) | null,
      onupgradeneeded: null as (() => void) | null,
    };

    (globalThis as { indexedDB: Pick<IDBFactory, 'open'> }).indexedDB = {
      open: vi.fn(() => {
        queueMicrotask(() => request.onerror?.(new Event('error')));
        return request as unknown as IDBOpenDBRequest;
      }),
    };

    const { saveSessionCache } = await import('../../src/infrastructure/storage/indexed-db');

    await expect(saveSessionCache(createSession())).rejects.toThrow('open failed');
    expect(debugLoggerMock.storage).toHaveBeenCalledWith(
      'ERROR',
      'Failed to save session to IndexedDB',
      null,
      openError,
    );
  });

  it('rejects when the IndexedDB write fails', async () => {
    const writeError = new Error('write failed');
    const transaction = {
      error: null as Error | null,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      objectStore: vi.fn(() => ({
        put: vi.fn(() => {
          throw writeError;
        }),
      })),
    };
    const db = {
      transaction: vi.fn(() => transaction),
    };
    const request = {
      error: null,
      result: db,
      onerror: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onupgradeneeded: null as (() => void) | null,
    };

    (globalThis as { indexedDB: Pick<IDBFactory, 'open'> }).indexedDB = {
      open: vi.fn(() => {
        queueMicrotask(() => request.onsuccess?.());
        return request as unknown as IDBOpenDBRequest;
      }),
    };

    const { saveSessionCache } = await import('../../src/infrastructure/storage/indexed-db');

    await expect(saveSessionCache(createSession())).rejects.toThrow('write failed');
    expect(debugLoggerMock.storage).toHaveBeenCalledWith(
      'ERROR',
      'Failed to save session to IndexedDB',
      null,
      writeError,
    );
  });

  it('rejects when the IndexedDB transaction fails', async () => {
    const transactionError = new Error('transaction failed');
    const transaction = {
      error: transactionError,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      objectStore: vi.fn(() => ({
        put: vi.fn(() => {
          queueMicrotask(() => transaction.onerror?.());
        }),
      })),
    };
    const db = {
      transaction: vi.fn(() => transaction),
    };
    const request = {
      error: null,
      result: db,
      onerror: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onupgradeneeded: null as (() => void) | null,
    };

    (globalThis as { indexedDB: Pick<IDBFactory, 'open'> }).indexedDB = {
      open: vi.fn(() => {
        queueMicrotask(() => request.onsuccess?.());
        return request as unknown as IDBOpenDBRequest;
      }),
    };

    const { saveSessionCache } = await import('../../src/infrastructure/storage/indexed-db');

    await expect(saveSessionCache(createSession())).rejects.toThrow('transaction failed');
    expect(debugLoggerMock.storage).toHaveBeenCalledWith(
      'ERROR',
      'Failed to save session to IndexedDB',
      null,
      transactionError,
    );
  });
});
