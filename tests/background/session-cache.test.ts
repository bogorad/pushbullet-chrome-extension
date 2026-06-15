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
    fetchSmsThread: vi.fn(),
    fetchSmsThreads: vi.fn(),
    requestFileUpload: vi.fn(),
    sendFilePush: vi.fn(),
    sendPush: vi.fn(),
    uploadFileToServer: vi.fn(),
    createNotificationWithTimeout: vi.fn().mockResolvedValue(undefined),
    saveSessionCache: vi.fn().mockResolvedValue(undefined),
    showPushNotification: vi.fn().mockResolvedValue(undefined),
    eventBusOn: vi.fn(),
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
    bootstrap: vi.fn().mockResolvedValue(undefined),
    reconcileWake: vi.fn().mockResolvedValue(undefined),
    serviceWorkerCreate: vi.fn(),
    webSocketClients: [] as Array<{
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      getReadyState: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      isConnectionHealthy: ReturnType<typeof vi.fn>;
    }>,
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
  WebSocketClient: vi.fn().mockImplementation(function MockWebSocketClient() {
    const client = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      getReadyState: vi.fn(() => 0),
      isConnected: vi.fn(() => false),
      isConnectionHealthy: vi.fn(() => false),
    };
    mocks.webSocketClients.push(client);
    return client;
  }),
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
  fetchSmsThread: mocks.fetchSmsThread,
  fetchSmsThreads: mocks.fetchSmsThreads,
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
    bootstrap: mocks.bootstrap,
    reconcileWake: mocks.reconcileWake,
  })),
}));

vi.mock('../../src/app/push-types', () => ({
  SUPPORTED_PUSH_TYPES: ['note'],
  checkPushTypeSupport: vi.fn(() => ({ supported: true, category: 'supported' })),
}));

vi.mock('../../src/lib/crypto', () => ({
  PushbulletCrypto: { decryptPush: vi.fn() },
}));

vi.mock('../../src/app/notifications', () => ({
  createNotificationWithTimeout: mocks.createNotificationWithTimeout,
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
    create: mocks.serviceWorkerCreate,
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
  getPushVerificationCode: vi.fn((push: Push) => {
    const sms = push.type === 'sms_changed' ? push.notifications?.[0] : null;
    const text = `${sms?.title ?? ''} ${sms?.body ?? ''}`;
    return text.toLowerCase().includes('code')
      ? text.match(/\b(\d{6})\b/)?.[1] ?? null
      : null;
  }),
  pushLink: vi.fn(),
  pushNote: vi.fn(),
  refreshPushes: vi.fn().mockResolvedValue(undefined),
  showPushNotification: mocks.showPushNotification,
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
  saveSessionCache: mocks.saveSessionCache,
}));

vi.mock('../../src/lib/events/event-bus', () => ({
  globalEventBus: { on: mocks.eventBusOn },
}));

function installChromeMock(): void {
  const messageListeners: any[] = [];
  const installedListeners: any[] = [];
  const startupListeners: any[] = [];
  const idleStateListeners: any[] = [];

  (globalThis as any).chrome = {
    alarms: {
      create: vi.fn(),
      getAll: vi.fn((callback: (alarms: chrome.alarms.Alarm[]) => void) => {
        callback([]);
      }),
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
      onButtonClicked: { addListener: vi.fn() },
    },
    idle: {
      setDetectionInterval: vi.fn(),
      onStateChanged: {
        addListener: vi.fn((callback: any) => {
          idleStateListeners.push(callback);
        }),
        callListeners: (...args: any[]) => {
          idleStateListeners.forEach((callback) => callback(...args));
        },
      },
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
    mocks.fetchSmsThreads.mockResolvedValue([]);
    mocks.fetchSmsThread.mockResolvedValue([]);
    mocks.createNotificationWithTimeout.mockResolvedValue(undefined);
    mocks.saveSessionCache.mockResolvedValue(undefined);
    mocks.showPushNotification.mockResolvedValue(undefined);
    mocks.eventBusOn.mockReset();
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
    mocks.bootstrap.mockResolvedValue(undefined);
    mocks.reconcileWake.mockResolvedValue(undefined);
    mocks.webSocketClients.length = 0;
    mocks.serviceWorkerCreate.mockResolvedValue(mocks.stateMachine);
  });

  it('copies a detected SMS verification code from notification button clicks', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: { writeText },
    });

    await loadBackgroundRegistrations();
    const background = await import('../../src/background/index');
    background.addToNotificationStore('sms-notification', {
      created: 100,
      iden: 'sms-code',
      notifications: [
        {
          title: 'SMS',
          body: 'the code it 527176.',
        },
      ],
      type: 'sms_changed',
    } satisfies Push);

    const buttonHandler = chrome.notifications.onButtonClicked.addListener.mock
      .calls[0]?.[0];
    if (!buttonHandler) {
      throw new Error('Expected notification button handler registration');
    }

    buttonHandler('sms-notification', 0);
    await flushBackgroundRefresh();

    expect(writeText).toHaveBeenCalledWith('527176');
    expect(mocks.createNotificationWithTimeout).toHaveBeenCalledWith(
      expect.stringMatching(/^pushbullet-code-copied-/),
      expect.objectContaining({
        title: 'Code copied',
        message: 'Code 527176 copied to clipboard',
      }),
      undefined,
      3000,
    );
    expect(chrome.notifications.clear).toHaveBeenCalledWith('sms-notification');
    expect(chrome.windows.create).not.toHaveBeenCalled();
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

  it('ensures recovery alarms exist on startup and install', async () => {
    await loadBackgroundRegistrations();

    chrome.runtime.onStartup.callListeners();
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.alarms.getAll).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(chrome.alarms.create).toHaveBeenCalledWith('longSleepRecovery', {
      periodInMinutes: 5,
    });
    expect(chrome.alarms.create).toHaveBeenCalledWith('websocketHealthCheck', {
      periodInMinutes: 1,
    });

    vi.clearAllMocks();

    chrome.runtime.onInstalled.callListeners();
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.alarms.getAll).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(chrome.alarms.create).toHaveBeenCalledWith('longSleepRecovery', {
      periodInMinutes: 5,
    });
    expect(chrome.alarms.create).toHaveBeenCalledWith('websocketHealthCheck', {
      periodInMinutes: 1,
    });

    vi.clearAllMocks();
    chrome.alarms.getAll.mockImplementation(
      (callback: (alarms: chrome.alarms.Alarm[]) => void) => {
        callback([
          {
            name: 'longSleepRecovery',
            scheduledTime: Date.now(),
            periodInMinutes: 5,
          },
          {
            name: 'websocketHealthCheck',
            scheduledTime: Date.now(),
            periodInMinutes: 1,
          },
        ]);
      },
    );

    chrome.runtime.onInstalled.callListeners();
    await Promise.resolve();
    await Promise.resolve();

    expect(chrome.alarms.getAll).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  it('reconciles wake when chrome.idle reports active', async () => {
    await loadBackgroundRegistrations();

    expect(chrome.idle.setDetectionInterval).toHaveBeenCalledWith(60);

    chrome.idle.onStateChanged.callListeners('idle');
    chrome.idle.onStateChanged.callListeners('locked');
    expect(mocks.reconcileWake).not.toHaveBeenCalled();

    chrome.idle.onStateChanged.callListeners('active');

    expect(mocks.reconcileWake).toHaveBeenCalledWith('idle-active');
  });

  it('replaces an open but unhealthy WebSocket on reconnect', async () => {
    await loadBackgroundRegistrations();
    const callbacks = mocks.serviceWorkerCreate.mock.calls[0]?.[0];

    if (!callbacks?.onConnectWebSocket) {
      throw new Error('Expected state machine onConnectWebSocket callback');
    }

    callbacks.onConnectWebSocket();
    expect(mocks.webSocketClients).toHaveLength(1);
    const firstClient = mocks.webSocketClients[0]!;
    firstClient.isConnected.mockReturnValue(true);
    firstClient.isConnectionHealthy.mockReturnValue(false);
    firstClient.getReadyState.mockReturnValue(1);

    callbacks.onConnectWebSocket();

    expect(firstClient.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.webSocketClients).toHaveLength(2);
    expect(mocks.webSocketClients[1]!.connect).toHaveBeenCalledTimes(1);
  });

  it('surfaces encrypted SMS when no E2EE password is configured', async () => {
    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      ciphertext: 'encrypted-payload',
      encrypted: true,
      iden: 'encrypted-sms',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.createNotificationWithTimeout).toHaveBeenCalledWith(
      'pushbullet-need-e2e-password',
      expect.objectContaining({
        title: 'Encrypted message received',
        priority: 2,
      }),
      undefined,
      0,
    );
    expect(mocks.showPushNotification).not.toHaveBeenCalled();
  });

  it('resolves empty sms_changed pushes from SMS history before notifying', async () => {
    mocks.sessionCache.devices = [
      {
        active: true,
        has_sms: true,
        iden: 'phone-1',
        nickname: 'Phone',
      } satisfies Device,
    ];
    mocks.fetchSmsThreads.mockResolvedValue([
      {
        id: 'thread-1',
        recipients: [{ name: 'Alice' }],
        latest: { body: 'old body', timestamp: 20 },
      },
    ]);
    mocks.fetchSmsThread.mockResolvedValue([
      { id: 'message-1', type: 'incoming', body: 'fresh body', timestamp: 20 },
    ]);

    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      created: 20,
      iden: 'sms-tickle',
      notifications: [],
      source_device_iden: 'phone-1',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.fetchSmsThreads).toHaveBeenCalledWith('test-api-key', 'phone-1');
    expect(mocks.fetchSmsThread).toHaveBeenCalledWith('test-api-key', 'phone-1', 'thread-1');
    expect(mocks.showPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: [
          expect.objectContaining({
            title: 'Alice',
            body: 'fresh body',
          }),
        ],
      }),
      expect.any(Map),
    );
    expect(mocks.saveSessionCache).toHaveBeenCalledWith(
      expect.objectContaining({
        recentPushes: expect.arrayContaining([
          expect.objectContaining({
            notifications: [
              expect.objectContaining({ body: 'fresh body' }),
            ],
          }),
        ]),
      }),
    );
  });

  it('ignores stale empty sms_changed pushes instead of replaying old SMS history', async () => {
    mocks.sessionCache.devices = [
      {
        active: true,
        has_sms: true,
        iden: 'phone-1',
        nickname: 'Phone',
      } satisfies Device,
    ];
    mocks.fetchSmsThreads.mockResolvedValue([
      {
        id: 'thread-1',
        recipients: [{ name: 'Alice' }],
        latest: { body: 'old body', timestamp: 10 },
      },
    ]);

    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      created: 1_000,
      iden: 'sms-delete-or-read-tickle',
      notifications: [],
      source_device_iden: 'phone-1',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.fetchSmsThreads).toHaveBeenCalledWith('test-api-key', 'phone-1');
    expect(mocks.fetchSmsThread).not.toHaveBeenCalled();
    expect(mocks.showPushNotification).not.toHaveBeenCalled();
  });

  it('uses the source SMS device when multiple SMS-capable devices exist', async () => {
    mocks.sessionCache.devices = [
      {
        active: true,
        has_sms: true,
        iden: 'phone-1',
        nickname: 'Old Phone',
      } satisfies Device,
      {
        active: true,
        has_sms: true,
        iden: 'phone-2',
        nickname: 'New Phone',
      } satisfies Device,
    ];
    mocks.fetchSmsThreads.mockResolvedValue([
      {
        id: 'thread-2',
        recipients: [{ name: 'Bob' }],
        latest: { body: 'fresh body', timestamp: 50 },
      },
    ]);
    mocks.fetchSmsThread.mockResolvedValue([
      { id: 'message-2', type: 'incoming', body: 'fresh body', timestamp: 50 },
    ]);

    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      created: 50,
      iden: 'sms-tickle',
      notifications: [],
      source_device_iden: 'phone-2',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.fetchSmsThreads).toHaveBeenCalledWith('test-api-key', 'phone-2');
    expect(mocks.fetchSmsThread).toHaveBeenCalledWith('test-api-key', 'phone-2', 'thread-2');
    expect(mocks.showPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: [
          expect.objectContaining({
            title: 'Bob',
            body: 'fresh body',
          }),
        ],
      }),
      expect.any(Map),
    );
  });

  it('ignores SMS history updates a few seconds after the tickle', async () => {
    mocks.sessionCache.devices = [
      {
        active: true,
        has_sms: true,
        iden: 'phone-1',
        nickname: 'Phone',
      } satisfies Device,
    ];
    mocks.fetchSmsThreads.mockResolvedValue([
      {
        id: 'thread-newer-unrelated',
        recipients: [{ name: 'Mallory' }],
        latest: { body: 'newer unrelated body', timestamp: 105 },
      },
    ]);
    mocks.fetchSmsThread.mockResolvedValue([
      {
        id: 'message-newer-unrelated',
        type: 'incoming',
        body: 'newer unrelated body',
        timestamp: 105,
      },
    ]);

    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      created: 100,
      iden: 'sms-tickle',
      notifications: [],
      source_device_iden: 'phone-1',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.fetchSmsThreads).toHaveBeenCalledWith('test-api-key', 'phone-1');
    expect(mocks.fetchSmsThread).toHaveBeenCalledWith(
      'test-api-key',
      'phone-1',
      'thread-newer-unrelated',
    );
    expect(mocks.showPushNotification).not.toHaveBeenCalled();
  });

  it('uses an earlier matching SMS when the thread latest is newer than the tickle', async () => {
    mocks.sessionCache.devices = [
      {
        active: true,
        has_sms: true,
        iden: 'phone-1',
        nickname: 'Phone',
      } satisfies Device,
    ];
    mocks.fetchSmsThreads.mockResolvedValue([
      {
        id: 'thread-active',
        recipients: [{ name: 'Alice' }],
        latest: { body: 'newer unrelated body', timestamp: 105 },
      },
    ]);
    mocks.fetchSmsThread.mockResolvedValue([
      {
        id: 'message-newer-unrelated',
        type: 'incoming',
        body: 'newer unrelated body',
        timestamp: 105,
      },
      {
        id: 'message-correct',
        type: 'incoming',
        body: 'correct body',
        timestamp: 100,
      },
    ]);

    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      created: 100,
      iden: 'sms-tickle',
      notifications: [],
      source_device_iden: 'phone-1',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.fetchSmsThreads).toHaveBeenCalledWith('test-api-key', 'phone-1');
    expect(mocks.fetchSmsThread).toHaveBeenCalledWith(
      'test-api-key',
      'phone-1',
      'thread-active',
    );
    expect(mocks.showPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        created: 100,
        notifications: [
          expect.objectContaining({
            title: 'Alice',
            body: 'correct body',
            timestamp: 100,
          }),
        ],
      }),
      expect.any(Map),
    );
  });

  it('chooses the newest correlated SMS across competing active threads', async () => {
    mocks.sessionCache.devices = [
      {
        active: true,
        has_sms: true,
        iden: 'phone-1',
        nickname: 'Phone',
      } satisfies Device,
    ];
    mocks.fetchSmsThreads.mockResolvedValue([
      {
        id: 'thread-unrelated',
        recipients: [{ name: 'Mallory' }],
        latest: { body: 'newer unrelated body', timestamp: 105 },
      },
      {
        id: 'thread-real',
        recipients: [{ name: 'Alice' }],
        latest: { body: 'correct body', timestamp: 100 },
      },
    ]);
    mocks.fetchSmsThread.mockImplementation(
      async (_apiKey: string, _deviceIden: string, threadId: string) => {
        if (threadId === 'thread-unrelated') {
          return [
            {
              id: 'message-newer-unrelated',
              type: 'incoming',
              body: 'newer unrelated body',
              timestamp: 105,
            },
            {
              id: 'message-older-unrelated',
              type: 'incoming',
              body: 'older unrelated body',
              timestamp: 99,
            },
          ];
        }

        return [
          {
            id: 'message-correct',
            type: 'incoming',
            body: 'correct body',
            timestamp: 100,
          },
        ];
      },
    );

    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      created: 100,
      iden: 'sms-tickle',
      notifications: [],
      source_device_iden: 'phone-1',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.fetchSmsThread).toHaveBeenCalledWith(
      'test-api-key',
      'phone-1',
      'thread-unrelated',
    );
    expect(mocks.fetchSmsThread).toHaveBeenCalledWith(
      'test-api-key',
      'phone-1',
      'thread-real',
    );
    expect(mocks.showPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        created: 100,
        notifications: [
          expect.objectContaining({
            title: 'Alice',
            body: 'correct body',
            timestamp: 100,
          }),
        ],
      }),
      expect.any(Map),
    );
  });

  it('keeps a resolved SMS when a later active thread lookup fails', async () => {
    mocks.sessionCache.devices = [
      {
        active: true,
        has_sms: true,
        iden: 'phone-1',
        nickname: 'Phone',
      } satisfies Device,
    ];
    mocks.fetchSmsThreads.mockResolvedValue([
      {
        id: 'thread-real',
        recipients: [{ name: 'Alice' }],
        latest: { body: 'correct body', timestamp: 100 },
      },
      {
        id: 'thread-broken',
        recipients: [{ name: 'Mallory' }],
        latest: { body: 'older body', timestamp: 99 },
      },
    ]);
    mocks.fetchSmsThread.mockImplementation(
      async (_apiKey: string, _deviceIden: string, threadId: string) => {
        if (threadId === 'thread-broken') {
          throw new Error('thread fetch failed');
        }

        return [
          {
            id: 'message-correct',
            type: 'incoming',
            body: 'correct body',
            timestamp: 100,
          },
        ];
      },
    );

    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      created: 100,
      iden: 'sms-tickle',
      notifications: [],
      source_device_iden: 'phone-1',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.fetchSmsThread).toHaveBeenCalledWith(
      'test-api-key',
      'phone-1',
      'thread-real',
    );
    expect(mocks.fetchSmsThread).toHaveBeenCalledWith(
      'test-api-key',
      'phone-1',
      'thread-broken',
    );
    expect(mocks.showPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: [
          expect.objectContaining({
            title: 'Alice',
            body: 'correct body',
          }),
        ],
      }),
      expect.any(Map),
    );
  });

  it('uses millisecond precision to break same-second SMS history ties', async () => {
    const pushTimestampMs = 1_700_000_000_900;

    mocks.sessionCache.devices = [
      {
        active: true,
        has_sms: true,
        iden: 'phone-1',
        nickname: 'Phone',
      } satisfies Device,
    ];
    mocks.fetchSmsThreads.mockResolvedValue([
      {
        id: 'thread-older-same-second',
        recipients: [{ name: 'Mallory' }],
        latest: { body: 'older same second body', timestamp: 1_700_000_000_500 },
      },
      {
        id: 'thread-newer-same-second',
        recipients: [{ name: 'Alice' }],
        latest: { body: 'newer same second body', timestamp: 1_700_000_000_900 },
      },
    ]);
    mocks.fetchSmsThread.mockImplementation(
      async (_apiKey: string, _deviceIden: string, threadId: string) => {
        if (threadId === 'thread-older-same-second') {
          return [
            {
              id: 'message-older-same-second',
              type: 'incoming',
              body: 'older same second body',
              timestamp: 1_700_000_000_500,
            },
          ];
        }

        return [
          {
            id: 'message-newer-same-second',
            type: 'incoming',
            body: 'newer same second body',
            timestamp: 1_700_000_000_900,
          },
        ];
      },
    );

    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      created: pushTimestampMs,
      iden: 'sms-tickle',
      notifications: [],
      source_device_iden: 'phone-1',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.showPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        created: 1_700_000_000,
        notifications: [
          expect.objectContaining({
            title: 'Alice',
            body: 'newer same second body',
            timestamp: 1_700_000_000,
          }),
        ],
      }),
      expect.any(Map),
    );
  });

  it('uses millisecond precision within one SMS history thread', async () => {
    const pushTimestampMs = 1_700_000_000_900;

    mocks.sessionCache.devices = [
      {
        active: true,
        has_sms: true,
        iden: 'phone-1',
        nickname: 'Phone',
      } satisfies Device,
    ];
    mocks.fetchSmsThreads.mockResolvedValue([
      {
        id: 'thread-same-second',
        recipients: [{ name: 'Alice' }],
        latest: { body: 'newer same second body', timestamp: 1_700_000_000_900 },
      },
    ]);
    mocks.fetchSmsThread.mockResolvedValue([
      {
        id: 'message-older-same-second',
        type: 'incoming',
        body: 'older same second body',
        timestamp: 1_700_000_000_500,
      },
      {
        id: 'message-newer-same-second',
        type: 'incoming',
        body: 'newer same second body',
        timestamp: 1_700_000_000_900,
      },
    ]);

    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      created: pushTimestampMs,
      iden: 'sms-tickle',
      notifications: [],
      source_device_iden: 'phone-1',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.showPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        created: 1_700_000_000,
        notifications: [
          expect.objectContaining({
            title: 'Alice',
            body: 'newer same second body',
            timestamp: 1_700_000_000,
          }),
        ],
      }),
      expect.any(Map),
    );
  });

  it('rejects same-second SMS history messages after the raw tickle timestamp', async () => {
    const pushTimestampMs = 1_700_000_000_600;

    mocks.sessionCache.devices = [
      {
        active: true,
        has_sms: true,
        iden: 'phone-1',
        nickname: 'Phone',
      } satisfies Device,
    ];
    mocks.fetchSmsThreads.mockResolvedValue([
      {
        id: 'thread-same-second',
        recipients: [{ name: 'Alice' }],
        latest: { body: 'after tickle body', timestamp: 1_700_000_000_700 },
      },
    ]);
    mocks.fetchSmsThread.mockResolvedValue([
      {
        id: 'message-before-tickle',
        type: 'incoming',
        body: 'before tickle body',
        timestamp: 1_700_000_000_500,
      },
      {
        id: 'message-after-tickle',
        type: 'incoming',
        body: 'after tickle body',
        timestamp: 1_700_000_000_700,
      },
    ]);

    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      created: pushTimestampMs,
      iden: 'sms-tickle',
      notifications: [],
      source_device_iden: 'phone-1',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.showPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        created: 1_700_000_000,
        notifications: [
          expect.objectContaining({
            title: 'Alice',
            body: 'before tickle body',
            timestamp: 1_700_000_000,
          }),
        ],
      }),
      expect.any(Map),
    );
  });

  it('allows same-second millisecond SMS when the tickle has second precision', async () => {
    const pushTimestampSeconds = 1_700_000_000;

    mocks.sessionCache.devices = [
      {
        active: true,
        has_sms: true,
        iden: 'phone-1',
        nickname: 'Phone',
      } satisfies Device,
    ];
    mocks.fetchSmsThreads.mockResolvedValue([
      {
        id: 'thread-second-precision',
        recipients: [{ name: 'Alice' }],
        latest: { body: 'same second body', timestamp: 1_700_000_000_700 },
      },
    ]);
    mocks.fetchSmsThread.mockResolvedValue([
      {
        id: 'message-same-second',
        type: 'incoming',
        body: 'same second body',
        timestamp: 1_700_000_000_700,
      },
    ]);

    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      created: pushTimestampSeconds,
      iden: 'sms-tickle',
      notifications: [],
      source_device_iden: 'phone-1',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.showPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        created: pushTimestampSeconds,
        notifications: [
          expect.objectContaining({
            title: 'Alice',
            body: 'same second body',
            timestamp: pushTimestampSeconds,
          }),
        ],
      }),
      expect.any(Map),
    );
  });

  it('allows same-second SMS when created is coarse and modified is sub-second', async () => {
    const pushTimestampSeconds = 1_700_000_000;

    mocks.sessionCache.devices = [
      {
        active: true,
        has_sms: true,
        iden: 'phone-1',
        nickname: 'Phone',
      } satisfies Device,
    ];
    mocks.fetchSmsThreads.mockResolvedValue([
      {
        id: 'thread-mixed-precision',
        recipients: [{ name: 'Alice' }],
        latest: { body: 'same second body', timestamp: 1_700_000_000_700 },
      },
    ]);
    mocks.fetchSmsThread.mockResolvedValue([
      {
        id: 'message-same-second',
        type: 'incoming',
        body: 'same second body',
        timestamp: 1_700_000_000_700,
      },
    ]);

    await loadBackgroundRegistrations();
    const pushHandler = mocks.eventBusOn.mock.calls.find(
      ([eventName]) => eventName === 'websocket:push',
    )?.[1];

    if (!pushHandler) {
      throw new Error('Expected websocket:push handler registration');
    }

    await pushHandler({
      created: pushTimestampSeconds,
      iden: 'sms-tickle',
      modified: 1_700_000_000.2,
      notifications: [],
      source_device_iden: 'phone-1',
      type: 'sms_changed',
    } satisfies Push);

    expect(mocks.showPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        created: pushTimestampSeconds,
        notifications: [
          expect.objectContaining({
            title: 'Alice',
            body: 'same second body',
            timestamp: pushTimestampSeconds,
          }),
        ],
      }),
      expect.any(Map),
    );
  });
});
