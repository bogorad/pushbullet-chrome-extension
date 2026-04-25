import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Push } from '../../src/types/domain';

declare const chrome: {
  runtime: {
    getURL: (path: string) => string;
    sendMessage: ReturnType<typeof vi.fn>;
  };
};

let storageCutoff = 100;
let processedMarkers: Record<string, number> = {};
let fetchedPushes: Push[] = [];
let failProcessedCheck = false;

const sessionCache = {
  recentPushes: [] as Push[],
  lastModifiedCutoff: 100,
  lastUpdated: 0,
  userInfo: null,
};

const setLastModifiedCutoffSafe = vi.fn(async (next: number): Promise<void> => {
  if (next > storageCutoff) {
    storageCutoff = next;
    sessionCache.lastModifiedCutoff = next;
  }
});

const fetchIncrementalPushes = vi.fn(
  async (_apiKey: string, cutoff: number | null, _limit: number): Promise<Push[]> =>
    fetchedPushes.filter((push) => typeof push.modified === 'number' && push.modified > (cutoff ?? 0)),
);

const createNotificationWithTimeout = vi.fn(
  async (): Promise<void> => undefined,
);

const storageRepository = {
  getLastModifiedCutoff: vi.fn(async (): Promise<number> => storageCutoff),
  getMaxAutoOpenPerReconnect: vi.fn(async (): Promise<number> => 100),
  wasPushProcessed: vi.fn(async (iden: string, modified: number): Promise<boolean> => {
    if (failProcessedCheck) {
      throw new Error('worker stopped before notification');
    }
    return (processedMarkers[iden] ?? 0) >= modified;
  }),
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
  getApiKey: vi.fn((): string => 'api-key'),
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

describe('refreshPushes cursor replay safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageCutoff = 100;
    processedMarkers = {};
    fetchedPushes = [];
    failProcessedCheck = false;
    sessionCache.recentPushes = [];
    sessionCache.lastModifiedCutoff = 100;
    sessionCache.lastUpdated = 0;
    chrome.runtime.getURL = vi.fn((path: string): string => `chrome-extension://id/${path}`);
    chrome.runtime.sendMessage.mockResolvedValue(undefined);
    createNotificationWithTimeout.mockResolvedValue(undefined);
  });

  it('does not advance the cutoff when refresh fails after fetch and before notification', async () => {
    fetchedPushes = [makePush('push-101', 101)];
    failProcessedCheck = true;
    const { refreshPushes } = await import('../../src/background/utils');

    await refreshPushes();

    expect(createNotificationWithTimeout).not.toHaveBeenCalled();
    expect(storageCutoff).toBe(100);
    expect(processedMarkers).toEqual({});

    failProcessedCheck = false;
    await refreshPushes();

    expect(createNotificationWithTimeout).toHaveBeenCalledTimes(1);
    expect(processedMarkers['push-101']).toBe(101);
    expect(storageCutoff).toBe(101);
  });

  it('replays only remaining pushes when refresh fails after one processed push', async () => {
    fetchedPushes = [
      makePush('push-101', 101),
      makePush('push-102', 102),
    ];
    createNotificationWithTimeout
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('worker stopped after one push'));
    const { refreshPushes } = await import('../../src/background/utils');

    await refreshPushes();

    expect(processedMarkers['push-101']).toBe(101);
    expect(processedMarkers['push-102']).toBeUndefined();
    expect(storageCutoff).toBe(101);

    createNotificationWithTimeout.mockResolvedValue(undefined);
    await refreshPushes();

    expect(createNotificationWithTimeout).toHaveBeenCalledTimes(3);
    expect(processedMarkers['push-102']).toBe(102);
    expect(storageCutoff).toBe(102);
  });
});
