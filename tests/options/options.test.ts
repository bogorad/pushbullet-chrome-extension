import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageAction } from '../../src/types/domain';
import optionsHtml from '../../options.html?raw';

declare const chrome: any;

const storageRepositoryMock = {
  getDeviceNickname: vi.fn(),
  getNotificationTimeout: vi.fn(),
  getAutoOpenLinks: vi.fn(),
  getAutoOpenLinksOnReconnect: vi.fn(),
  getOnlyThisDevice: vi.fn(),
  getEncryptionPassword: vi.fn(),
  setDeviceNickname: vi.fn(),
  setNotificationTimeout: vi.fn(),
  setAutoOpenLinks: vi.fn(),
  setAutoOpenLinksOnReconnect: vi.fn(),
  setOnlyThisDevice: vi.fn(),
  setEncryptionPassword: vi.fn(),
  getJevApiKey: vi.fn(),
  setJevApiKey: vi.fn(),
};

vi.mock('../../src/infrastructure/storage/storage.repository', () => ({
  storageRepository: storageRepositoryMock,
}));

function setDocumentReadyState(value: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', {
    configurable: true,
    get: () => value,
  });
}

async function loadOptions(): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = optionsHtml;
  setDocumentReadyState('complete');

  await import('../../src/options/index.ts');

  await vi.waitFor(() => {
    expect(storageRepositoryMock.getDeviceNickname).toHaveBeenCalled();
  });

  chrome.runtime.sendMessage.mockClear();
}

function changeInput(element: HTMLInputElement): void {
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

const fetchMock = vi.fn();

function mockModelsResponse(status: number): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ data: [] }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('options message actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    chrome.runtime.getManifest.mockReturnValue({ version: '1.4.1' });
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });

    storageRepositoryMock.getDeviceNickname.mockResolvedValue('Chrome');
    storageRepositoryMock.getNotificationTimeout.mockResolvedValue(10000);
    storageRepositoryMock.getAutoOpenLinks.mockResolvedValue(true);
    storageRepositoryMock.getAutoOpenLinksOnReconnect.mockResolvedValue(false);
    storageRepositoryMock.getOnlyThisDevice.mockResolvedValue(false);
    storageRepositoryMock.getEncryptionPassword.mockResolvedValue('');
    storageRepositoryMock.setDeviceNickname.mockResolvedValue(undefined);
    storageRepositoryMock.setNotificationTimeout.mockResolvedValue(undefined);
    storageRepositoryMock.setAutoOpenLinks.mockResolvedValue(undefined);
    storageRepositoryMock.setAutoOpenLinksOnReconnect.mockResolvedValue(undefined);
    storageRepositoryMock.setOnlyThisDevice.mockResolvedValue(undefined);
    storageRepositoryMock.setEncryptionPassword.mockResolvedValue(undefined);
    storageRepositoryMock.getJevApiKey.mockResolvedValue('');
    storageRepositoryMock.setJevApiKey.mockResolvedValue(undefined);
    fetchMock.mockReset();
    mockModelsResponse(200);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterAll(() => {
    document.body.innerHTML = '';
  });

  it('uses SETTINGS_CHANGED when auto-open links changes', async () => {
    await loadOptions();

    const checkbox = document.getElementById('auto-open-links') as HTMLInputElement;
    checkbox.checked = false;
    changeInput(checkbox);

    await vi.waitFor(() => {
      expect(storageRepositoryMock.setAutoOpenLinks).toHaveBeenCalledWith(false);
    });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: MessageAction.SETTINGS_CHANGED,
      settings: {
        autoOpenLinks: false,
      },
    });
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'autoOpenLinksChanged' }),
    );
  });

  it('saves auto-open links on reconnect once per change', async () => {
    await loadOptions();

    const checkbox = document.getElementById('auto-open-links-on-reconnect') as HTMLInputElement;
    checkbox.checked = true;
    changeInput(checkbox);

    await vi.waitFor(() => {
      expect(storageRepositoryMock.setAutoOpenLinksOnReconnect).toHaveBeenCalledWith(true);
    });

    expect(storageRepositoryMock.setAutoOpenLinksOnReconnect).toHaveBeenCalledTimes(1);
  });

  it('saves only-this-device once after settings reload', async () => {
    await loadOptions();

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const resetButton = document.getElementById('reset-settings') as HTMLButtonElement;
    resetButton.click();

    await vi.waitFor(() => {
      expect(storageRepositoryMock.getDeviceNickname).toHaveBeenCalledTimes(2);
    });

    storageRepositoryMock.setOnlyThisDevice.mockClear();

    const checkbox = document.getElementById('only-this-device') as HTMLInputElement;
    checkbox.checked = true;
    changeInput(checkbox);

    await vi.waitFor(() => {
      expect(storageRepositoryMock.setOnlyThisDevice).toHaveBeenCalledWith(true);
    });

    expect(storageRepositoryMock.setOnlyThisDevice).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('does not send a no-op encryption password message', async () => {
    await loadOptions();

    const passwordInput = document.getElementById('encryption-password') as HTMLInputElement;
    passwordInput.value = 'secret';
    changeInput(passwordInput);

    await vi.waitFor(() => {
      expect(storageRepositoryMock.setEncryptionPassword).toHaveBeenCalledWith('secret');
    });

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'encryptionPasswordChanged' }),
    );
  });

  it('loads and saves Jev API key via local storage repository', async () => {
    storageRepositoryMock.getJevApiKey.mockResolvedValue('jev-loaded');
    await loadOptions();
    const input = document.getElementById('jev-api-key') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.value).toBe('jev-loaded');
    input.value = 'jev-new';
    changeInput(input);
    await vi.waitFor(() => {
      expect(storageRepositoryMock.setJevApiKey).toHaveBeenCalledWith('jev-new');
    });
    input.value = '';
    changeInput(input);
    await vi.waitFor(() => {
      expect(storageRepositoryMock.setJevApiKey).toHaveBeenCalledWith(null);
    });
  });

  it('verifies a pasted Jev key once, stores it on 200, and shows a green dot', async () => {
    await loadOptions();
    fetchMock.mockClear();
    storageRepositoryMock.setJevApiKey.mockClear();
    const input = document.getElementById('jev-api-key') as HTMLInputElement;
    input.value = 'fake-pasted-key';
    input.dispatchEvent(new Event('paste', { bubbles: true }));
    await vi.waitFor(() => {
      expect(storageRepositoryMock.setJevApiKey).toHaveBeenCalledWith('fake-pasted-key');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/models');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer fake-pasted-key',
    );
    const dot = document.getElementById('jev-api-key-dot') as HTMLSpanElement;
    expect(dot.className).toContain('jev-key-dot--valid');
    expect(dot.getAttribute('aria-label')).toContain('verified valid');
    expect(document.getElementById('jev-api-key-status')?.textContent).toContain('verified');
  });

  it('shows a red dot and does not store the key on 401', async () => {
    await loadOptions();
    mockModelsResponse(401);
    fetchMock.mockClear();
    storageRepositoryMock.setJevApiKey.mockClear();
    const input = document.getElementById('jev-api-key') as HTMLInputElement;
    input.value = 'fake-bad-key';
    input.dispatchEvent(new Event('paste', { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.getElementById('jev-api-key-status')?.textContent).toContain('Invalid');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storageRepositoryMock.setJevApiKey).not.toHaveBeenCalled();
    const dot = document.getElementById('jev-api-key-dot') as HTMLSpanElement;
    expect(dot.className).toContain('jev-key-dot--invalid');
    expect(dot.getAttribute('aria-label')).toContain('invalid');
  });

  it('shows an error and does not store the key on network failure', async () => {
    await loadOptions();
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    storageRepositoryMock.setJevApiKey.mockClear();
    const input = document.getElementById('jev-api-key') as HTMLInputElement;
    input.value = 'fake-unreachable-key';
    input.dispatchEvent(new Event('paste', { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.getElementById('jev-api-key-status')?.textContent).toContain(
        'network error',
      );
    });
    expect(storageRepositoryMock.setJevApiKey).not.toHaveBeenCalled();
    expect(document.getElementById('jev-api-key-dot')?.className).toContain(
      'jev-key-dot--invalid',
    );
  });

  it('verifies typed input after debounce and does not fetch for empty input', async () => {
    await loadOptions();
    fetchMock.mockClear();
    storageRepositoryMock.setJevApiKey.mockClear();
    const input = document.getElementById('jev-api-key') as HTMLInputElement;
    input.value = 'fake-typed-key';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(
      () => {
        expect(storageRepositoryMock.setJevApiKey).toHaveBeenCalledWith('fake-typed-key');
      },
      { timeout: 3000 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    storageRepositoryMock.setJevApiKey.mockClear();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(
      () => {
        expect(storageRepositoryMock.setJevApiKey).toHaveBeenCalledWith(null);
      },
      { timeout: 3000 },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.getElementById('jev-api-key-dot')?.className).toContain(
      'jev-key-dot--neutral',
    );
  });

  it('verifies a stored key on load and shows a green dot when valid', async () => {
    storageRepositoryMock.getJevApiKey.mockResolvedValue('fake-stored-key');
    await loadOptions();
    await vi.waitFor(() => {
      expect(document.getElementById('jev-api-key-dot')?.className).toContain(
        'jev-key-dot--valid',
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.typesafe.ai/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses UPDATE_DEBUG_CONFIG when debug mode changes', async () => {
    await loadOptions();

    const checkbox = document.getElementById('debug-mode') as HTMLInputElement;
    checkbox.checked = false;
    changeInput(checkbox);

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: MessageAction.UPDATE_DEBUG_CONFIG,
        config: { enabled: false },
      });
    });
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'debugModeChanged' }),
    );
  });

  it('uses handled actions when saving all settings', async () => {
    await loadOptions();

    const nicknameInput = document.getElementById('device-nickname') as HTMLInputElement;
    const timeoutInput = document.getElementById('notification-timeout') as HTMLInputElement;
    const autoOpenCheckbox = document.getElementById('auto-open-links') as HTMLInputElement;
    const autoOpenReconnectCheckbox = document.getElementById('auto-open-links-on-reconnect') as HTMLInputElement;
    const debugCheckbox = document.getElementById('debug-mode') as HTMLInputElement;
    const saveButton = document.getElementById('save-settings') as HTMLButtonElement;

    nicknameInput.value = 'Work Chrome';
    timeoutInput.value = '12';
    autoOpenCheckbox.checked = false;
    autoOpenReconnectCheckbox.checked = true;
    debugCheckbox.checked = false;
    saveButton.click();

    await vi.waitFor(() => {
      expect(storageRepositoryMock.setDeviceNickname).toHaveBeenCalledWith('Work Chrome');
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: MessageAction.UPDATE_DEBUG_CONFIG,
        config: { enabled: false },
      });
    });

    const settingsCall = chrome.runtime.sendMessage.mock.calls.find(
      ([message]: [{ action?: string }]) => message.action === MessageAction.SETTINGS_CHANGED,
    );

    expect(settingsCall?.[0]).toEqual({
      action: MessageAction.SETTINGS_CHANGED,
      settings: {
        deviceNickname: 'Work Chrome',
        notificationTimeout: 12000,
        autoOpenLinks: false,
      },
    });
    expect(settingsCall?.[0].settings).not.toHaveProperty('autoOpenLinksOnReconnect');
    expect(settingsCall?.[0].settings).not.toHaveProperty('debugMode');
  });
});
