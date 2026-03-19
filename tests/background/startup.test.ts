import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat, Device, Push, User } from '../../src/types/domain';

declare const chrome: any;

let orchestrateInitialization: typeof import('../../src/background/startup')['orchestrateInitialization'];
let initPromise: Promise<string | null> | null = null;

const sessionCacheMock = {
  userInfo: null as User | null,
  devices: [] as Device[],
  recentPushes: [] as Push[],
  chats: [] as Chat[],
  isAuthenticated: false,
  lastUpdated: 0,
  autoOpenLinks: true,
  deviceNickname: 'Chrome',
  onlyThisDevice: false,
  lastModifiedCutoff: 0,
  cachedAt: 0,
};

const storageRepositoryMock = {
  getApiKey: vi.fn(),
  getUserInfoCache: vi.fn(),
  setUserInfoCache: vi.fn(),
};

const apiClientMock = {
  getUserInfoWithTimeoutRetry: vi.fn(),
  fetchDevices: vi.fn(),
  fetchDisplayPushes: vi.fn(),
  fetchChats: vi.fn(),
};

const indexedDbMock = {
  loadSessionCache: vi.fn(),
  saveSessionCache: vi.fn(),
};

const sessionModuleMock = {
  sessionCache: sessionCacheMock,
  hydrateCutoff: vi.fn(),
  isCacheFresh: vi.fn(),
  refreshSessionInBackground: vi.fn(),
  getInitPromise: vi.fn(() => initPromise),
  setInitPromise: vi.fn((value: Promise<string | null>) => {
    initPromise = value;
  }),
  clearInitPromise: vi.fn(() => {
    initPromise = null;
  }),
};

vi.mock('../../src/infrastructure/storage/storage.repository', () => ({
  storageRepository: storageRepositoryMock,
}));

vi.mock('../../src/app/api/client', () => apiClientMock);

vi.mock('../../src/infrastructure/storage/indexed-db', () => indexedDbMock);

vi.mock('../../src/app/session', () => sessionModuleMock);

vi.mock('../../src/background/keepalive', () => ({
  startCriticalKeepalive: vi.fn(),
  stopCriticalKeepalive: vi.fn(),
}));

vi.mock('../../src/background/state', () => ({
  setApiKey: vi.fn(),
}));

vi.mock('../../src/background/index', () => ({
  ensureDebugConfigLoadedOnce: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/logging', () => ({
  debugLogger: {
    general: vi.fn(),
    api: vi.fn(),
    storage: vi.fn(),
  },
}));

describe('orchestrateInitialization', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    initPromise = null;

    sessionCacheMock.userInfo = null;
    sessionCacheMock.devices = [];
    sessionCacheMock.recentPushes = [];
    sessionCacheMock.chats = [];
    sessionCacheMock.isAuthenticated = false;
    sessionCacheMock.lastUpdated = 0;
    sessionCacheMock.cachedAt = 0;

    storageRepositoryMock.getApiKey.mockResolvedValue('test-api-key');
    storageRepositoryMock.getUserInfoCache.mockResolvedValue(null);
    storageRepositoryMock.setUserInfoCache.mockResolvedValue(undefined);

    apiClientMock.getUserInfoWithTimeoutRetry.mockResolvedValue({
      email: 'test@example.com',
      iden: 'user-1',
      name: 'Test User',
    } satisfies User);
    apiClientMock.fetchDevices.mockResolvedValue([
      {
        active: true,
        created: 1,
        modified: 1,
        icon: 'system',
        iden: 'device-1',
        nickname: 'Work Laptop',
        type: 'chrome',
        kind: 'chrome',
      },
    ] satisfies Device[]);
    apiClientMock.fetchDisplayPushes.mockResolvedValue([
      {
        active: true,
        created: 1,
        modified: 1,
        dismissed: false,
        direction: 'self',
        iden: 'push-1',
        title: 'Title',
        body: 'Body',
        type: 'note',
      },
    ] satisfies Push[]);
    apiClientMock.fetchChats.mockResolvedValue([
      {
        active: true,
        created: 1,
        modified: 1,
        iden: 'chat-1',
        with: {
          email: 'alice@example.com',
          email_normalized: 'alice@example.com',
          name: 'Alice',
          type: 'user',
        },
      },
    ] satisfies Chat[]);

    indexedDbMock.loadSessionCache.mockResolvedValue(null);
    indexedDbMock.saveSessionCache.mockResolvedValue(undefined);

    sessionModuleMock.hydrateCutoff.mockResolvedValue(undefined);
    sessionModuleMock.isCacheFresh.mockReturnValue(false);
    sessionModuleMock.refreshSessionInBackground.mockResolvedValue(undefined);

    ({ orchestrateInitialization } = await import('../../src/background/startup'));
  });

  it('hydrates chats and display pushes during popup-open network initialization', async () => {
    const connectWs = vi.fn();

    await orchestrateInitialization('popup-open', connectWs);

    expect(connectWs).toHaveBeenCalledTimes(1);
    expect(apiClientMock.fetchDevices).toHaveBeenCalledWith('test-api-key');
    expect(apiClientMock.fetchDisplayPushes).toHaveBeenCalledWith('test-api-key', 50);
    expect(apiClientMock.fetchChats).toHaveBeenCalledWith('test-api-key');
    expect(sessionCacheMock.recentPushes).toEqual(apiClientMock.fetchDisplayPushes.mock.results[0]?.value ? await apiClientMock.fetchDisplayPushes.mock.results[0].value : []);
    expect(sessionCacheMock.chats).toEqual(apiClientMock.fetchChats.mock.results[0]?.value ? await apiClientMock.fetchChats.mock.results[0].value : []);
    expect(indexedDbMock.saveSessionCache).toHaveBeenCalledWith(
      expect.objectContaining({
        recentPushes: expect.arrayContaining([
          expect.objectContaining({ iden: 'push-1' }),
        ]),
        chats: expect.arrayContaining([
          expect.objectContaining({ iden: 'chat-1' }),
        ]),
      }),
    );
  });
});
