import type { Chat, Device, Push, User } from '../../src/types/domain';
import { MessageAction } from '../../src/types/domain';

declare const chrome: any;

let refreshSessionCache: typeof import('../../src/app/session/index')['refreshSessionCache'];
let refreshSessionInBackground: typeof import('../../src/app/session/index')['refreshSessionInBackground'];
let sessionCache: typeof import('../../src/app/session/index')['sessionCache'];

const primaryPush = {
  active: true,
  body: 'Body',
  created: 1,
  modified: 1,
  dismissed: false,
  direction: 'self',
  iden: 'push-1',
  target_device_iden: 'device-1',
  title: 'Title',
  type: 'note',
} satisfies Push;

const secondaryPush = {
  active: true,
  body: 'Other Body',
  created: 2,
  modified: 2,
  dismissed: false,
  direction: 'self',
  iden: 'push-2',
  target_device_iden: 'device-2',
  title: 'Other Title',
  type: 'note',
} satisfies Push;

const primaryChat = {
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
} satisfies Chat;

const apiClientMock = {
  fetchChats: vi.fn(),
  fetchDevices: vi.fn(),
  fetchDisplayPushes: vi.fn(),
  fetchUserInfo: vi.fn(),
  registerDevice: vi.fn(),
};

const storageRepositoryMock = {
  getLastModifiedCutoff: vi.fn(),
  getOnlyThisDevice: vi.fn(),
  getDeviceIden: vi.fn(),
};

const indexedDbMock = {
  saveSessionCache: vi.fn(),
};

vi.mock('../../src/lib/logging', () => ({
  debugLogger: {
    general: vi.fn(),
    storage: vi.fn(),
    api: vi.fn(),
  },
}));

vi.mock('../../src/lib/perf', () => ({
  performanceMonitor: {},
}));

vi.mock('../../src/app/api/client', () => apiClientMock);

vi.mock('../../src/infrastructure/storage/storage.repository', () => ({
  storageRepository: storageRepositoryMock,
}));

vi.mock('../../src/infrastructure/storage/indexed-db', () => indexedDbMock);

vi.mock('../../src/background/keepalive', () => ({
  startCriticalKeepalive: vi.fn(),
  stopCriticalKeepalive: vi.fn(),
}));

vi.mock('../../src/app/session/pipeline', () => ({
  refreshPushesIncremental: vi.fn().mockResolvedValue({ pushes: [], isSeedRun: false }),
}));

describe('session refresh flows', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    apiClientMock.fetchUserInfo.mockResolvedValue({
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
      primaryPush,
      secondaryPush,
    ] satisfies Push[]);
    apiClientMock.fetchChats.mockResolvedValue([
      primaryChat,
    ] satisfies Chat[]);
    apiClientMock.registerDevice.mockResolvedValue({ iden: 'device-1' });

    storageRepositoryMock.getLastModifiedCutoff.mockResolvedValue(0);
    storageRepositoryMock.getOnlyThisDevice.mockResolvedValue(false);
    storageRepositoryMock.getDeviceIden.mockResolvedValue('device-1');
    indexedDbMock.saveSessionCache.mockResolvedValue(undefined);
    chrome.runtime.sendMessage.mockResolvedValue(undefined);

    const sessionModule = await import('../../src/app/session/index');
    refreshSessionCache = sessionModule.refreshSessionCache;
    refreshSessionInBackground = sessionModule.refreshSessionInBackground;
    sessionCache = sessionModule.sessionCache;

    sessionCache.userInfo = null;
    sessionCache.devices = [];
    sessionCache.recentPushes = [];
    sessionCache.chats = [];
    sessionCache.isAuthenticated = true;
    sessionCache.lastUpdated = 0;
  });

  it('sends enum-based session updates with chats after background refresh', async () => {
    await refreshSessionInBackground('test-api-key');

    expect(indexedDbMock.saveSessionCache).toHaveBeenCalledWith(
      expect.objectContaining({
        chats: expect.arrayContaining([
          expect.objectContaining({ iden: 'chat-1' }),
        ]),
      }),
    );
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: MessageAction.SESSION_DATA_UPDATED,
        chats: expect.arrayContaining([
          expect.objectContaining({ iden: 'chat-1' }),
        ]),
      }),
    );
  });

  it('filters live session updates when only-this-device is enabled', async () => {
    storageRepositoryMock.getOnlyThisDevice.mockResolvedValue(true);
    storageRepositoryMock.getDeviceIden.mockResolvedValue('device-1');

    await refreshSessionInBackground('test-api-key');

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        recentPushes: [expect.objectContaining({ iden: 'push-1' })],
      }),
    );
  });

  it('does not refresh the persisted cache timestamp after a partial background refresh failure', async () => {
    apiClientMock.fetchChats.mockRejectedValue(new Error('chat fetch failed'));
    sessionCache.chats = [primaryChat];

    await refreshSessionInBackground('test-api-key');

    expect(sessionCache.chats).toEqual([primaryChat]);
    expect(indexedDbMock.saveSessionCache).not.toHaveBeenCalled();
  });

  it('persists refreshed chats after a full session refresh', async () => {
    await refreshSessionCache('test-api-key');

    expect(sessionCache.chats).toEqual([
      expect.objectContaining({ iden: 'chat-1' }),
    ]);
    expect(indexedDbMock.saveSessionCache).toHaveBeenCalledWith(
      expect.objectContaining({
        chats: expect.arrayContaining([
          expect.objectContaining({ iden: 'chat-1' }),
        ]),
        recentPushes: expect.arrayContaining([
          expect.objectContaining({ iden: 'push-1' }),
        ]),
      }),
    );
  });
});
