import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat, Device, Push, User } from '../../src/types/domain';
import { MessageAction } from '../../src/types/domain';

declare const chrome: any;

const cachedDevice = {
  active: true,
  created: 1,
  icon: 'system',
  iden: 'cached-device',
  modified: 1,
  nickname: 'Cached Device',
  type: 'chrome',
  kind: 'chrome',
} satisfies Device;

const refreshedDevice = {
  active: true,
  created: 2,
  icon: 'system',
  iden: 'refreshed-device',
  modified: 2,
  nickname: 'Refreshed Device',
  type: 'chrome',
  kind: 'chrome',
} satisfies Device;

const cachedChat = {
  active: true,
  created: 1,
  iden: 'cached-chat',
  modified: 1,
  with: {
    email: 'cached@example.com',
    email_normalized: 'cached@example.com',
    name: 'Cached Friend',
    type: 'user',
  },
} satisfies Chat;

const refreshedChat = {
  active: true,
  created: 2,
  iden: 'refreshed-chat',
  modified: 2,
  with: {
    email: 'refreshed@example.com',
    email_normalized: 'refreshed@example.com',
    name: 'Refreshed Friend',
    type: 'user',
  },
} satisfies Chat;

const cachedPush = {
  active: true,
  created: 1,
  dismissed: false,
  direction: 'self',
  iden: 'push-1',
  modified: 1,
  target_device_iden: 'cached-device',
  title: 'Cached Push',
  type: 'note',
} satisfies Push;

const cachedUser = {
  email: 'test@example.com',
  iden: 'user-1',
  name: 'Test User',
} satisfies User;

const mocks = vi.hoisted(() => {
  const sessionCache = {
    userInfo: null as User | null,
    devices: [] as Device[],
    recentPushes: [] as Push[],
    chats: [] as Chat[],
    isAuthenticated: true,
    lastUpdated: 0,
    autoOpenLinks: true,
    deviceNickname: 'Chrome',
    lastModifiedCutoff: 0,
    cachedAt: 0,
  };

  const stateMachine = {
    getCurrentState: vi.fn(() => 'ready'),
    isInState: vi.fn(() => false),
    transition: vi.fn().mockResolvedValue(undefined),
  };

  return {
    sessionCache,
    stateMachine,
    debugLogger: {
      general: vi.fn(),
      storage: vi.fn(),
      api: vi.fn(),
      websocket: vi.fn(),
      notifications: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      exportLogs: vi.fn(() => []),
    },
    fetchChats: vi.fn(),
    fetchDevices: vi.fn(),
    fetchRecentPushes: vi.fn(),
    requestFileUpload: vi.fn(),
    sendFilePush: vi.fn(),
    sendPush: vi.fn(),
    uploadFileToServer: vi.fn(),
    getApiKey: vi.fn(),
    getAutoOpenLinks: vi.fn(() => true),
    getDeviceNickname: vi.fn(() => 'Chrome'),
    getDeviceIdenState: vi.fn(() => 'cached-device'),
    getInitPromise: vi.fn(() => null),
    hydrateBackgroundConfig: vi.fn().mockResolvedValue(undefined),
    initializeSessionCache: vi.fn().mockResolvedValue(null),
    orchestrateInitialization: vi.fn().mockResolvedValue(null),
    storageRepository: {
      getOnlyThisDevice: vi.fn().mockResolvedValue(false),
      getDeviceIden: vi.fn().mockResolvedValue('cached-device'),
      getLastModifiedCutoff: vi.fn().mockResolvedValue(0),
      getEncryptionPassword: vi.fn().mockResolvedValue(null),
      setApiKey: vi.fn().mockResolvedValue(undefined),
      setDeviceIden: vi.fn().mockResolvedValue(undefined),
      setDeviceNickname: vi.fn().mockResolvedValue(undefined),
      setOnlyThisDevice: vi.fn().mockResolvedValue(undefined),
      setAutoOpenLinks: vi.fn().mockResolvedValue(undefined),
    },
    performanceMonitor: {
      exportPerformanceData: vi.fn(() => ({})),
      getQualityMetrics: vi.fn(() => ({ consecutiveFailures: 0 })),
      recordNotificationFailed: vi.fn(),
      recordPushReceived: vi.fn(),
      reset: vi.fn(),
    },
    clearSessionCache: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../src/lib/logging', () => ({
  debugConfigManager: { loadConfig: vi.fn().mockResolvedValue(undefined) },
  debugLogger: mocks.debugLogger,
  globalErrorTracker: {},
}));

vi.mock('../../src/lib/perf', () => ({
  performanceMonitor: mocks.performanceMonitor,
}));

vi.mock('../../src/lib/monitoring', () => ({
  initTracker: { exportData: vi.fn(() => ({})) },
  wsStateMonitor: { getStateReport: vi.fn(() => ({})) },
}));

vi.mock('../../src/app/ws/client', () => ({
  WebSocketClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    getReadyState: vi.fn(() => 0),
    isConnected: vi.fn(() => false),
    isConnectionHealthy: vi.fn(() => false),
  })),
}));

vi.mock('../../src/app/session', () => ({
  getInitPromise: mocks.getInitPromise,
  handleInvalidCursorRecovery: vi.fn(),
  initializeSessionCache: mocks.initializeSessionCache,
  refreshSessionCache: vi.fn(),
  resetSessionCache: vi.fn(),
  sessionCache: mocks.sessionCache,
}));

vi.mock('../../src/app/api/client', () => ({
  PushbulletUploadError: class PushbulletUploadError extends Error {
    code = 'upload_failed';
    stage = 'unknown';
    status: number | undefined;
  },
  fetchChats: mocks.fetchChats,
  fetchDevices: mocks.fetchDevices,
  fetchRecentPushes: mocks.fetchRecentPushes,
  requestFileUpload: mocks.requestFileUpload,
  sendFilePush: mocks.sendFilePush,
  sendPush: mocks.sendPush,
  uploadFileToServer: mocks.uploadFileToServer,
  updateDeviceNickname: vi.fn(),
}));

vi.mock('../../src/background/diagnostics', () => ({
  installDiagnosticsMessageHandler: vi.fn(),
}));

vi.mock('../../src/background/config', () => ({
  ensureDebugConfigLoadedOnce: vi.fn().mockResolvedValue(undefined),
  hydrateBackgroundConfig: mocks.hydrateBackgroundConfig,
}));

vi.mock('../../src/background/lifecycle', () => ({
  createLifecycleCoordinator: vi.fn(() => ({
    bootstrap: vi.fn().mockResolvedValue(undefined),
    reconcileWake: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/app/push-types', () => ({
  SUPPORTED_PUSH_TYPES: ['note'],
  checkPushTypeSupport: vi.fn(() => ({ supported: true, category: 'supported' })),
}));

vi.mock('../../src/lib/crypto', () => ({
  PushbulletCrypto: { decryptPush: vi.fn() },
}));

vi.mock('../../src/infrastructure/storage/storage.repository', () => ({
  storageRepository: mocks.storageRepository,
}));

vi.mock('../../src/background/state-machine', () => ({
  ServiceWorkerState: {
    DEGRADED: 'degraded',
    ERROR: 'error',
    IDLE: 'idle',
    READY: 'ready',
    RECONNECTING: 'reconnecting',
  },
  ServiceWorkerStateMachine: {
    create: vi.fn().mockResolvedValue(mocks.stateMachine),
  },
}));

vi.mock('../../src/background/state', () => ({
  WEBSOCKET_URL: 'wss://example.test',
  getApiKey: mocks.getApiKey,
  getAutoOpenLinks: mocks.getAutoOpenLinks,
  getDeviceIden: mocks.getDeviceIdenState,
  getDeviceNickname: mocks.getDeviceNickname,
  setApiKey: vi.fn(),
  setAutoOpenLinks: vi.fn(),
  setDeviceIden: vi.fn(),
  setDeviceNickname: vi.fn(),
  setNotificationTimeout: vi.fn(),
  setWebSocketClient: vi.fn(),
}));

vi.mock('../../src/background/utils', () => ({
  checkPollingMode: vi.fn(),
  performPollingFetch: vi.fn().mockResolvedValue(undefined),
  performWebSocketHealthCheck: vi.fn(),
  pushLink: vi.fn(),
  pushNote: vi.fn(),
  refreshPushes: vi.fn().mockResolvedValue(undefined),
  showPushNotification: vi.fn().mockResolvedValue(undefined),
  stopPollingMode: vi.fn(),
  updatePopupConnectionState: vi.fn(),
}));

vi.mock('../../src/background/links', () => ({
  autoOpenOfflineLinks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/background/startup', () => ({
  orchestrateInitialization: mocks.orchestrateInitialization,
}));

vi.mock('../../src/background/processing', () => ({
  maybeAutoOpenLinkWithDismiss: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/realtime/postConnectQueue', () => ({
  runPostConnect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/security/message-validation', () => ({
  validatePrivilegedMessage: vi.fn(() => true),
}));

vi.mock('../../src/background/keepalive', () => ({
  handleKeepaliveAlarm: vi.fn(() => false),
}));

vi.mock('../../src/infrastructure/storage/indexed-db', () => ({
  clearSessionCache: mocks.clearSessionCache,
  saveSessionCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/events/event-bus', () => ({
  globalEventBus: { on: vi.fn() },
}));

function installChromeMock(): void {
  const messageListeners: any[] = [];
  const installedListeners: any[] = [];
  const startupListeners: any[] = [];

  (globalThis as any).chrome = {
    alarms: {
      create: vi.fn(),
      get: vi.fn(
        (_name: string, callback: (alarm?: chrome.alarms.Alarm) => void) => {
          callback(undefined);
        },
      ),
      onAlarm: { addListener: vi.fn() },
    },
    contextMenus: {
      create: vi.fn(),
      onClicked: { addListener: vi.fn() },
      removeAll: vi.fn(),
    },
    notifications: {
      clear: vi.fn(),
      create: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    runtime: {
      getManifest: vi.fn(() => ({ version: '1.0.0' })),
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      lastError: undefined,
      onInstalled: {
        addListener: vi.fn((callback: any) => {
          installedListeners.push(callback);
        }),
        callListeners: (...args: any[]) => {
          installedListeners.forEach((callback) => callback(...args));
        },
      },
      onMessage: {
        addListener: vi.fn((callback: any) => {
          messageListeners.push(callback);
        }),
        callListeners: (...args: any[]) => {
          messageListeners.forEach((callback) => callback(...args));
        },
      },
      onStartup: {
        addListener: vi.fn((callback: any) => {
          startupListeners.push(callback);
        }),
        callListeners: (...args: any[]) => {
          startupListeners.forEach((callback) => callback(...args));
        },
      },
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      local: { get: vi.fn().mockResolvedValue({}) },
    },
    windows: {
      create: vi.fn(),
    },
  };

  (globalThis as any).WebSocket = { CONNECTING: 0 };
}

function resetSessionCache(): void {
  mocks.sessionCache.userInfo = cachedUser;
  mocks.sessionCache.devices = [cachedDevice];
  mocks.sessionCache.recentPushes = [cachedPush];
  mocks.sessionCache.chats = [cachedChat];
  mocks.sessionCache.isAuthenticated = true;
  mocks.sessionCache.lastUpdated = 100;
  mocks.sessionCache.autoOpenLinks = true;
  mocks.sessionCache.deviceNickname = 'Chrome';
  mocks.sessionCache.lastModifiedCutoff = 0;
  mocks.sessionCache.cachedAt = 100;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (error: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

async function loadGetSessionDataListener(): Promise<any> {
  vi.resetModules();
  installChromeMock();
  delete (globalThis as any).exportDebugInfo;
  await import('../../src/background/index');
  await Promise.resolve();

  return chrome.runtime.onMessage.addListener.mock.calls.find(
    ([listener]: [unknown]) => typeof listener === 'function',
  )?.[0];
}

async function loadBackgroundRegistrations(): Promise<void> {
  vi.resetModules();
  installChromeMock();
  delete (globalThis as any).exportDebugInfo;
  await import('../../src/background/index');
  await Promise.resolve();
}

async function waitForResponse(sendResponse: ReturnType<typeof vi.fn>): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (sendResponse.mock.calls.length > 0) {
      return;
    }
    await Promise.resolve();
  }

  throw new Error('GET_SESSION_DATA did not respond');
}

async function waitForSendMessage(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    if (chrome.runtime.sendMessage.mock.calls.length > 0) {
      return;
    }
    await Promise.resolve();
  }

  throw new Error('Background session update was not sent');
}

async function flushBackgroundRefresh(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('background GET_SESSION_DATA session cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionCache();

    mocks.getApiKey.mockReturnValue('test-api-key');
    mocks.getAutoOpenLinks.mockReturnValue(true);
    mocks.getDeviceNickname.mockReturnValue('Chrome');
    mocks.getDeviceIdenState.mockReturnValue('cached-device');
    mocks.getInitPromise.mockReturnValue(null);
    mocks.fetchRecentPushes.mockResolvedValue([]);
    mocks.fetchDevices.mockResolvedValue([refreshedDevice]);
    mocks.fetchChats.mockResolvedValue([refreshedChat]);
    mocks.requestFileUpload.mockResolvedValue({
      file_name: 'report.txt',
      file_type: 'text/plain',
      file_url: 'https://files.example/report.txt',
      upload_url: 'https://uploads.example',
      data: {
        key: 'uploads/report.txt',
      },
    });
    mocks.sendFilePush.mockResolvedValue(undefined);
    mocks.sendPush.mockResolvedValue({
      active: true,
      created: 3,
      dismissed: false,
      direction: 'self',
      iden: 'sent-push',
      modified: 3,
      type: 'note',
    } satisfies Push);
    mocks.uploadFileToServer.mockResolvedValue(undefined);
    mocks.hydrateBackgroundConfig.mockResolvedValue(undefined);
    mocks.initializeSessionCache.mockResolvedValue(null);
    mocks.orchestrateInitialization.mockResolvedValue(null);
    mocks.stateMachine.getCurrentState.mockReturnValue('ready');
    mocks.stateMachine.isInState.mockReturnValue(false);
    mocks.stateMachine.transition.mockResolvedValue(undefined);
    mocks.storageRepository.getOnlyThisDevice.mockResolvedValue(false);
    mocks.storageRepository.getDeviceIden.mockResolvedValue('cached-device');
    mocks.clearSessionCache.mockResolvedValue(undefined);
    mocks.performanceMonitor.exportPerformanceData.mockReturnValue({});
    mocks.performanceMonitor.getQualityMetrics.mockReturnValue({ consecutiveFailures: 0 });
  });

  it('responds from populated cache before device and chat refresh completes', async () => {
    const devicesRefresh = createDeferred<Device[]>();
    const chatsRefresh = createDeferred<Chat[]>();
    mocks.fetchDevices.mockReturnValue(devicesRefresh.promise);
    mocks.fetchChats.mockReturnValue(chatsRefresh.promise);

    const listener = await loadGetSessionDataListener();
    const sendResponse = vi.fn();

    listener(
      { action: MessageAction.GET_SESSION_DATA },
      { id: chrome.runtime.id },
      sendResponse,
    );

    await waitForResponse(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      devices: [cachedDevice],
      chats: [cachedChat],
      recentPushes: [cachedPush],
    }));

    expect(mocks.fetchDevices).toHaveBeenCalledWith('test-api-key');
    expect(mocks.fetchChats).toHaveBeenCalledWith('test-api-key');
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

    devicesRefresh.resolve([refreshedDevice]);
    chatsRefresh.resolve([refreshedChat]);
    await waitForSendMessage();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: MessageAction.SESSION_DATA_UPDATED,
      devices: [refreshedDevice],
      chats: [refreshedChat],
    }));
  });

  it('responds from an empty target cache, then sends refreshed session data', async () => {
    mocks.sessionCache.devices = [];
    mocks.sessionCache.chats = [];
    mocks.sessionCache.recentPushes = [];

    const listener = await loadGetSessionDataListener();
    const sendResponse = vi.fn();

    listener(
      { action: MessageAction.GET_SESSION_DATA },
      { id: chrome.runtime.id },
      sendResponse,
    );

    await waitForResponse(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      devices: [],
      chats: [],
      recentPushes: [],
    }));

    await flushBackgroundRefresh();
    await waitForSendMessage();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: MessageAction.SESSION_DATA_UPDATED,
      devices: [refreshedDevice],
      chats: [refreshedChat],
    }));
  });

  it('keeps cached chats when the chat refresh fails', async () => {
    mocks.fetchChats.mockRejectedValue(new Error('chat refresh failed'));

    const listener = await loadGetSessionDataListener();
    const sendResponse = vi.fn();

    listener(
      { action: MessageAction.GET_SESSION_DATA },
      { id: chrome.runtime.id },
      sendResponse,
    );

    await waitForResponse(sendResponse);
    await waitForSendMessage();

    expect(mocks.sessionCache.chats).toEqual([cachedChat]);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: MessageAction.SESSION_DATA_UPDATED,
      devices: [refreshedDevice],
      chats: [cachedChat],
    }));
  });

  it('handles file upload orchestration in the background', async () => {
    const listener = await loadGetSessionDataListener();
    const sendResponse = vi.fn();

    const keepChannelOpen = listener(
      {
        action: MessageAction.UPLOAD_AND_SEND_FILE,
        fileBase64: 'aGVsbG8=',
        fileName: ' report.txt ',
        fileType: ' text/plain ',
        fileSize: 5,
        body: ' Quarterly report ',
        email: 'alice@example.com',
      },
      { id: chrome.runtime.id },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await waitForResponse(sendResponse);

    expect(mocks.requestFileUpload).toHaveBeenCalledWith(
      'test-api-key',
      'report.txt',
      'text/plain',
    );
    expect(mocks.uploadFileToServer).toHaveBeenCalledWith(
      expect.objectContaining({
        file_name: 'report.txt',
        file_type: 'text/plain',
        file_url: 'https://files.example/report.txt',
      }),
      expect.any(Blob),
    );
    expect(mocks.sendFilePush).toHaveBeenCalledWith(
      'test-api-key',
      expect.objectContaining({
        file_name: 'report.txt',
        file_type: 'text/plain',
        file_url: 'https://files.example/report.txt',
        body: 'Quarterly report',
        email: 'alice@example.com',
      }),
    );
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('returns structured file upload errors from the background', async () => {
    mocks.requestFileUpload.mockRejectedValue({
      code: 'upload_request_failed',
      stage: 'upload-request',
      message: 'Upload request rejected',
      status: 400,
    });

    const listener = await loadGetSessionDataListener();
    const sendResponse = vi.fn();

    listener(
      {
        action: MessageAction.UPLOAD_AND_SEND_FILE,
        fileBase64: 'aGVsbG8=',
        fileName: 'report.txt',
        fileType: 'text/plain',
        fileSize: 5,
      },
      { id: chrome.runtime.id },
      sendResponse,
    );

    await waitForResponse(sendResponse);

    expect(mocks.uploadFileToServer).not.toHaveBeenCalled();
    expect(mocks.sendFilePush).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'upload_request_failed',
        stage: 'upload-request',
        message: 'Upload request rejected',
        status: 400,
      },
    });
  });

  it('sends note pushes through the API client helper', async () => {
    const listener = await loadGetSessionDataListener();
    const sendResponse = vi.fn();

    const keepChannelOpen = listener(
      {
        action: MessageAction.SEND_PUSH,
        pushData: {
          type: 'note',
          title: 'Status',
          body: 'Done',
          device_iden: 'cached-device',
        },
      },
      { id: chrome.runtime.id },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await waitForResponse(sendResponse);

    expect(mocks.sendPush).toHaveBeenCalledWith('test-api-key', {
      type: 'note',
      title: 'Status',
      body: 'Done',
      device_iden: 'cached-device',
    });
    expect(mocks.fetchRecentPushes).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('sends link pushes through the API client helper', async () => {
    const listener = await loadGetSessionDataListener();
    const sendResponse = vi.fn();

    listener(
      {
        action: MessageAction.SEND_PUSH,
        pushData: {
          type: 'link',
          title: 'Docs',
          url: 'https://example.com/docs',
          body: 'Reference',
        },
      },
      { id: chrome.runtime.id },
      sendResponse,
    );

    await waitForResponse(sendResponse);

    expect(mocks.sendPush).toHaveBeenCalledWith('test-api-key', {
      type: 'link',
      title: 'Docs',
      url: 'https://example.com/docs',
      body: 'Reference',
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('preserves SEND_PUSH API failure responses for the popup', async () => {
    mocks.sendPush.mockRejectedValue(new Error('API rejected push'));

    const listener = await loadGetSessionDataListener();
    const sendResponse = vi.fn();

    listener(
      {
        action: MessageAction.SEND_PUSH,
        pushData: {
          type: 'note',
          title: 'Status',
        },
      },
      { id: chrome.runtime.id },
      sendResponse,
    );

    await waitForResponse(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'API rejected push',
    });
  });

  it('resets performance metrics after clearing session data on logout', async () => {
    const listener = await loadGetSessionDataListener();
    const sendResponse = vi.fn();

    const keepChannelOpen = listener(
      { action: MessageAction.LOGOUT },
      { id: chrome.runtime.id },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await waitForResponse(sendResponse);

    expect(mocks.stateMachine.transition).toHaveBeenCalledWith('LOGOUT');
    expect(mocks.clearSessionCache).toHaveBeenCalled();
    expect(mocks.performanceMonitor.reset).toHaveBeenCalled();
    const clearSessionOrder = mocks.clearSessionCache.mock.invocationCallOrder[0];
    const resetOrder = mocks.performanceMonitor.reset.mock.invocationCallOrder[0];
    expect(clearSessionOrder).toBeDefined();
    expect(resetOrder).toBeDefined();
    expect(clearSessionOrder!).toBeLessThan(resetOrder!);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('registers one startup listener and no global debug export', async () => {
    await loadBackgroundRegistrations();

    expect(chrome.runtime.onStartup.addListener).toHaveBeenCalledTimes(1);
    expect((globalThis as any).exportDebugInfo).toBeUndefined();
  });

  it('ensures long sleep recovery alarm exists on startup and install', async () => {
    await loadBackgroundRegistrations();

    chrome.runtime.onStartup.callListeners();
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.alarms.get).toHaveBeenCalledWith(
      'longSleepRecovery',
      expect.any(Function),
    );
    expect(chrome.alarms.create).toHaveBeenCalledWith('longSleepRecovery', {
      periodInMinutes: 5,
    });

    vi.clearAllMocks();

    chrome.runtime.onInstalled.callListeners();
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.alarms.get).toHaveBeenCalledWith(
      'longSleepRecovery',
      expect.any(Function),
    );
    expect(chrome.alarms.create).toHaveBeenCalledWith('longSleepRecovery', {
      periodInMinutes: 5,
    });

    vi.clearAllMocks();
    chrome.alarms.get.mockImplementation(
      (_name: string, callback: (alarm?: chrome.alarms.Alarm) => void) => {
        callback({
          name: 'longSleepRecovery',
          scheduledTime: Date.now(),
          periodInMinutes: 5,
        });
      },
    );

    chrome.runtime.onInstalled.callListeners();
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.alarms.get).toHaveBeenCalledWith(
      'longSleepRecovery',
      expect.any(Function),
    );
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });
});
