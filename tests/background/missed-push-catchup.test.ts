import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Push } from '../../src/types/domain';

declare const chrome: {
  runtime: {
    getURL: (path: string) => string;
    sendMessage: ReturnType<typeof vi.fn>;
  };
};

let storageCutoff: number | null = 100;
let processedMarkers: Record<string, number> = {};
let fetchedPushes: Push[] = [];
let apiKeyValue: string | null = 'api-key';

const sessionCache = {
  recentPushes: [] as Push[],
  lastModifiedCutoff: 100 as number | null,
  lastUpdated: 0,
  userInfo: null,
};

const setLastModifiedCutoffSafe = vi.fn(async (next: number): Promise<void> => {
  if (storageCutoff === null || next > storageCutoff) {
    storageCutoff = next;
    sessionCache.lastModifiedCutoff = next;
  }
});

const fetchIncrementalPushes = vi.fn(
  async (_apiKey: string, cutoff: number | null, _limit: number): Promise<Push[]> =>
    fetchedPushes.filter((push) => typeof push.modified === 'number' && push.modified > (cutoff ?? 0)),
);

const createNotificationWithTimeout = vi.fn(async (): Promise<void> => undefined);

const storageRepository = {
  getLastModifiedCutoff: vi.fn(async (): Promise<number | null> => storageCutoff),
  getMaxAutoOpenPerReconnect: vi.fn(async (): Promise<number> => 100),
  wasPushProcessed: vi.fn(
    async (iden: string, modified: number): Promise<boolean> =>
      (processedMarkers[iden] ?? 0) >= modified,
  ),
  markPushProcessed: vi.fn(async (iden: string, modified: number): Promise<void> => {
    processedMarkers[iden] = Math.max(processedMarkers[iden] ?? 0, modified);
  }),
};

vi.mock('../../src/app/session', () => ({
  sessionCache,
  hydrateCutoff: vi.fn(),
  setLastModifiedCutoffSafe,
}));

vi.mock('../../src/app/api/client', () => ({
  fetchIncrementalPushes,
}));

vi.mock('../../src/app/notifications', () => ({
  createNotificationWithTimeout,
}));

vi.mock('../../src/infrastructure/storage/storage.repository', () => ({
  storageRepository,
}));

vi.mock('../../src/background/config', () => ({
  hydrateBackgroundConfig: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock('../../src/background/state', () => ({
  getApiKey: vi.fn((): string | null => apiKeyValue),
  getNotificationTimeout: vi.fn((): number => 0),
  isPollingMode: vi.fn((): boolean => false),
  setPollingMode: vi.fn(),
}));

vi.mock('../../src/background/processing', () => ({
  maybeAutoOpenLinkWithDismiss: vi.fn(async (): Promise<boolean> => false),
}));

vi.mock('../../src/background/index', () => ({
  stateMachine: {
    getCurrentState: vi.fn((): string => 'ready'),
    transition: vi.fn(async (): Promise<void> => undefined),
  },
}));

vi.mock('../../src/lib/events/event-bus', () => ({
  globalEventBus: {
    emit: vi.fn(),
  },
}));

vi.mock('../../src/lib/logging', () => ({
  debugLogger: {
    api: vi.fn(),
    general: vi.fn(),
    notifications: vi.fn(),
    websocket: vi.fn(),
  },
}));

vi.mock('../../src/lib/perf', () => ({
  performanceMonitor: {
    recordHealthCheckFailure: vi.fn(),
    recordHealthCheckSuccess: vi.fn(),
    recordNotificationCreated: vi.fn(),
    recordNotificationFailed: vi.fn(),
    getQualityMetrics: vi.fn(() => ({ consecutiveFailures: 0 })),
  },
}));

vi.mock('../../src/lib/security/trusted-image-url', () => ({
  isTrustedImageUrl: vi.fn((): boolean => true),
}));

const makePush = (iden: string, modified: number): Push => ({
  active: true,
  body: `Body ${iden}`,
  created: modified,
  dismissed: false,
  direction: 'incoming',
  iden,
  modified,
  title: `Title ${iden}`,
  type: 'note',
});

describe('missed-push catch-up on reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageCutoff = 100;
    processedMarkers = {};
    fetchedPushes = [];
    apiKeyValue = 'api-key';
    sessionCache.recentPushes = [];
    sessionCache.lastModifiedCutoff = 100;
    sessionCache.lastUpdated = 0;
    chrome.runtime.getURL = vi.fn((path: string): string => `chrome-extension://id/${path}`);
    chrome.runtime.sendMessage.mockResolvedValue(undefined);
    createNotificationWithTimeout.mockResolvedValue(undefined);
  });

  it('notifies pushes missed during sleep once and advances cursor, with no duplicates on second run', async () => {
    // Simulated sleep: cursor persisted at 100, socket disconnected,
    // pushes created while asleep (modified 101/102).
    fetchedPushes = [makePush('missed-101', 101), makePush('missed-102', 102)];
    const { runMissedPushCatchUp } = await import('../../src/background/utils');

    // Health-check/reconnect fires the connected-handler catch-up seam.
    await runMissedPushCatchUp();

    expect(createNotificationWithTimeout).toHaveBeenCalledTimes(2);
    expect(processedMarkers).toEqual({ 'missed-101': 101, 'missed-102': 102 });
    expect(storageCutoff).toBe(102);
    expect(sessionCache.lastModifiedCutoff).toBe(102);

    // Second catch-up run: no duplicates, cursor unchanged.
    await runMissedPushCatchUp();

    expect(createNotificationWithTimeout).toHaveBeenCalledTimes(2);
    expect(storageCutoff).toBe(102);
  });

  it('runs only one fetch when catch-up is triggered concurrently', async () => {
    fetchedPushes = [makePush('missed-101', 101)];
    const { runMissedPushCatchUp } = await import('../../src/background/utils');

    await Promise.all([runMissedPushCatchUp(), runMissedPushCatchUp()]);

    expect(fetchIncrementalPushes).toHaveBeenCalledTimes(1);
    expect(createNotificationWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('skips without advancing when there is no persisted cursor', async () => {
    storageCutoff = null;
    sessionCache.lastModifiedCutoff = 0;
    fetchedPushes = [makePush('missed-101', 101)];
    const { runMissedPushCatchUp } = await import('../../src/background/utils');

    await runMissedPushCatchUp();

    expect(fetchIncrementalPushes).not.toHaveBeenCalled();
    expect(createNotificationWithTimeout).not.toHaveBeenCalled();
    expect(storageCutoff).toBeNull();
    expect(processedMarkers).toEqual({});
  });

  it('skips without advancing when there is no API key', async () => {
    apiKeyValue = null;
    fetchedPushes = [makePush('missed-101', 101)];
    const { runMissedPushCatchUp } = await import('../../src/background/utils');

    await runMissedPushCatchUp();

    expect(fetchIncrementalPushes).not.toHaveBeenCalled();
    expect(createNotificationWithTimeout).not.toHaveBeenCalled();
    expect(storageCutoff).toBe(100);
  });
});
