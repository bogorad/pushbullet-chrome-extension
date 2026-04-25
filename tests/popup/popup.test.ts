import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat, Device, Push, SessionDataResponse } from '../../src/types/domain';
import { MessageAction } from '../../src/types/domain';
import popupHtml from '../../popup.html?raw';

declare const chrome: any;

const storageRepositoryMock = {
  setApiKey: vi.fn(),
  setDeviceNickname: vi.fn(),
  setDeviceIden: vi.fn(),
  getApiKey: vi.fn().mockResolvedValue('test-api-key'),
  getScrollToRecentPushes: vi.fn().mockResolvedValue(false),
  removeScrollToRecentPushes: vi.fn(),
};

vi.mock('../../src/infrastructure/storage/storage.repository', () => ({
  storageRepository: storageRepositoryMock,
}));

const sampleDevices: Device[] = [
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
  {
    active: false,
    created: 1,
    modified: 1,
    icon: 'system',
    iden: 'device-2',
    manufacturer: 'Google',
    model: 'Pixel 8',
    type: 'android',
    kind: 'android',
  },
];

const sampleChats: Chat[] = [
  {
    iden: 'chat-1',
    active: true,
    created: 1,
    modified: 1,
    with: {
      email: 'alice@example.com',
      email_normalized: 'alice@example.com',
      name: 'Alice',
      type: 'user',
    },
  },
  {
    iden: 'chat-2',
    active: true,
    created: 1,
    modified: 1,
    with: {
      email: 'bob@example.com',
      email_normalized: 'bob@example.com',
      type: 'email',
    },
  },
];

function createSessionData(overrides: Partial<SessionDataResponse> = {}): SessionDataResponse & { state?: string } {
  return {
    isAuthenticated: true,
    userInfo: { email: 'test@example.com', name: 'Test User', iden: 'user-1' },
    devices: sampleDevices,
    recentPushes: [],
    chats: sampleChats,
    autoOpenLinks: true,
    deviceNickname: 'Chrome',
    websocketConnected: true,
    ...overrides,
  };
}

function setDocumentReadyState(value: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', {
    configurable: true,
    get: () => value,
  });
}

async function loadPopup(): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = popupHtml;
  setDocumentReadyState('loading');
  const popupModule = await import('../../src/popup/index.ts');
  setDocumentReadyState('complete');
  popupModule.init();
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createUploadTestFile(): File {
  const file = new File(['hello'], 'report.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: vi.fn().mockResolvedValue(new ArrayBuffer(5)),
  });
  return file;
}

describe('Popup friend targets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = popupHtml;

    chrome.runtime.getURL.mockImplementation((path = '') => `chrome-extension://test/${path}`);
    storageRepositoryMock.getScrollToRecentPushes.mockResolvedValue(false);
    storageRepositoryMock.getApiKey.mockResolvedValue('test-api-key');
  });

  afterAll(() => {
    document.body.innerHTML = '';
  });

  it('renders device and friend targets from session data', async () => {
    const session = createSessionData();

    chrome.runtime.sendMessage.mockImplementation((message: { action?: string }, callback?: (response: unknown) => void) => {
      if (message.action === MessageAction.GET_SESSION_DATA && callback) {
        callback(session);
      }
      return Promise.resolve(undefined);
    });

    await loadPopup();

    const loginSection = document.getElementById('login-section');
    const mainSection = document.getElementById('main-section');
    const targetDeviceSelect = document.getElementById('target-device') as HTMLSelectElement;

    expect(mainSection?.style.display).toBe('block');
    expect(loginSection?.style.display).toBe('none');

    const options = Array.from(targetDeviceSelect.options).map((option) => ({
      value: option.value,
      text: option.textContent,
      disabled: option.disabled,
    }));

    expect(options).toEqual([
      { value: 'all', text: 'All Devices', disabled: false },
      { value: 'device-1', text: 'Work Laptop', disabled: false },
      { value: 'device-2', text: 'Google Pixel 8 (offline)', disabled: false },
      { value: '--- Friends ---', text: '--- Friends ---', disabled: true },
      { value: 'friend:alice@example.com', text: 'F: Alice', disabled: false },
      { value: 'friend:bob@example.com', text: 'F: bob@example.com', disabled: false },
    ]);
  });

  it('renders the send push heading with text nodes and a version span', async () => {
    chrome.runtime.getManifest.mockReturnValue({ version: '9.8.7' });
    chrome.runtime.sendMessage.mockImplementation((message: { action?: string }, callback?: (response: unknown) => void) => {
      if (message.action === MessageAction.GET_SESSION_DATA && callback) {
        callback(createSessionData());
      }
      return Promise.resolve(undefined);
    });

    await loadPopup();

    const heading = document.getElementById('send-push-heading') as HTMLHeadingElement;
    const versionText = heading.querySelector('.version-text');

    expect(heading.childNodes[0]?.textContent).toBe('Send a Push ');
    expect(versionText?.textContent).toBe('(v.9.8.7)');
    expect(versionText?.tagName).toBe('SPAN');
    expect(heading.textContent).toBe('Send a Push (v.9.8.7)');
  });

  it('renders dynamic push links with safe new-tab attributes', async () => {
    const recentPushes: Push[] = [
      {
        type: 'link',
        iden: 'push-1',
        active: true,
        dismissed: false,
        created: 1,
        modified: 1,
        title: 'Example',
        body: 'Read this',
        url: 'https://example.com/article',
      },
    ];

    chrome.runtime.sendMessage.mockImplementation((message: { action?: string }, callback?: (response: unknown) => void) => {
      if (message.action === MessageAction.GET_SESSION_DATA && callback) {
        callback(createSessionData({ recentPushes }));
      }
      return Promise.resolve(undefined);
    });

    await loadPopup();

    const pushLink = document.querySelector<HTMLAnchorElement>('.push-url');

    expect(pushLink).not.toBeNull();
    expect(pushLink?.textContent).toBe('https://example.com/article');
    expect(pushLink?.target).toBe('_blank');
    expect(pushLink?.rel).toBe('noopener noreferrer');
  });

  it('sends friend targets as email pushes', async () => {
    const session = createSessionData();

    chrome.runtime.sendMessage.mockImplementation((message: { action?: string; pushData?: Record<string, string> }, callback?: (response: unknown) => void) => {
      if (message.action === MessageAction.GET_SESSION_DATA && callback) {
        callback(session);
      }

      if (message.action === MessageAction.SEND_PUSH && callback) {
        callback({ success: true });
      }

      return Promise.resolve(undefined);
    });

    await loadPopup();

    const targetDeviceSelect = document.getElementById('target-device') as HTMLSelectElement;
    const noteBodyInput = document.getElementById('note-body') as HTMLTextAreaElement;
    const sendPushButton = document.getElementById('send-push') as HTMLButtonElement;

    targetDeviceSelect.value = 'friend:alice@example.com';
    noteBodyInput.value = 'Hello Alice';
    sendPushButton.click();

    const sendPushCall = chrome.runtime.sendMessage.mock.calls.find(
      ([message]: [{ action?: string }]) => message.action === MessageAction.SEND_PUSH,
    );

    expect(sendPushCall).toBeDefined();
    expect(sendPushCall?.[0]).toMatchObject({
      action: MessageAction.SEND_PUSH,
      pushData: {
        type: 'note',
        body: 'Hello Alice',
        email: 'alice@example.com',
      },
    });
    expect(sendPushCall?.[0].pushData.device_iden).toBeUndefined();
  });

  it('sends file uploads to the background without reading the API key', async () => {
    const session = createSessionData();

    chrome.runtime.sendMessage.mockImplementation((message: { action?: string }, callback?: (response: unknown) => void) => {
      if (message.action === MessageAction.GET_SESSION_DATA && callback) {
        callback(session);
      }

      if (message.action === MessageAction.UPLOAD_AND_SEND_FILE && callback) {
        callback({ success: true });
      }

      return Promise.resolve(undefined);
    });

    await loadPopup();

    const targetDeviceSelect = document.getElementById('target-device') as HTMLSelectElement;
    const fileTypeButton = document.getElementById('push-type-file') as HTMLButtonElement;
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    const fileBody = document.getElementById('file-body') as HTMLTextAreaElement;
    const sendPushButton = document.getElementById('send-push') as HTMLButtonElement;
    const file = createUploadTestFile();

    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file],
    });
    targetDeviceSelect.value = 'friend:alice@example.com';
    fileBody.value = 'Quarterly report';
    fileTypeButton.click();
    sendPushButton.click();
    await flushAsyncWork();

    const uploadCall = chrome.runtime.sendMessage.mock.calls.find(
      ([message]: [{ action?: string }]) => message.action === MessageAction.UPLOAD_AND_SEND_FILE,
    );

    expect(uploadCall).toBeDefined();
    expect(uploadCall?.[0]).toMatchObject({
      action: MessageAction.UPLOAD_AND_SEND_FILE,
      fileName: 'report.txt',
      fileType: 'text/plain',
      fileSize: 5,
      body: 'Quarterly report',
      email: 'alice@example.com',
    });
    expect(uploadCall?.[0].fileBase64).toEqual(expect.any(String));
    expect(uploadCall?.[0].fileBase64).not.toHaveLength(0);
    expect(storageRepositoryMock.getApiKey).not.toHaveBeenCalled();
  });

  it('shows structured file upload errors returned by the background', async () => {
    const session = createSessionData();

    chrome.runtime.sendMessage.mockImplementation((message: { action?: string }, callback?: (response: unknown) => void) => {
      if (message.action === MessageAction.GET_SESSION_DATA && callback) {
        callback(session);
      }

      if (message.action === MessageAction.UPLOAD_AND_SEND_FILE && callback) {
        callback({
          success: false,
          error: {
            code: 'upload_request_failed',
            stage: 'upload-request',
            message: 'Upload request rejected',
          },
        });
      }

      return Promise.resolve(undefined);
    });

    await loadPopup();

    const fileTypeButton = document.getElementById('push-type-file') as HTMLButtonElement;
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    const sendPushButton = document.getElementById('send-push') as HTMLButtonElement;
    const statusMessage = document.getElementById('status-message') as HTMLDivElement;
    const file = createUploadTestFile();

    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file],
    });
    fileTypeButton.click();
    sendPushButton.click();
    await flushAsyncWork();

    expect(statusMessage.textContent).toBe('Error: Upload request rejected');
  });

  it('repopulates targets when the background sends session data updates', async () => {
    const initialSession = createSessionData({ devices: [], chats: [] });
    const updatedSession = {
      action: MessageAction.SESSION_DATA_UPDATED,
      isAuthenticated: true,
      devices: sampleDevices,
      chats: sampleChats,
      recentPushes: [],
      userInfo: { email: 'test@example.com', name: 'Test User', iden: 'user-1' },
      autoOpenLinks: true,
      deviceNickname: 'Chrome',
    };

    chrome.runtime.sendMessage.mockImplementation((message: { action?: string }, callback?: (response: unknown) => void) => {
      if (message.action === MessageAction.GET_SESSION_DATA && callback) {
        callback(initialSession);
      }
      return Promise.resolve(undefined);
    });

    await loadPopup();

    const targetDeviceSelect = document.getElementById('target-device') as HTMLSelectElement;
    expect(Array.from(targetDeviceSelect.options)).toHaveLength(1);

    chrome.runtime.onMessage.callListeners(updatedSession, {}, vi.fn());

    const optionValues = Array.from(targetDeviceSelect.options).map((option) => option.value);
    expect(optionValues).toContain('device-1');
    expect(optionValues).toContain('friend:alice@example.com');
  });
});
