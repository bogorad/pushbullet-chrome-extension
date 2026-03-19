import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat, Device, SessionDataResponse } from '../../src/types/domain';
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
