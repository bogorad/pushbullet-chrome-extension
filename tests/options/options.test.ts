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
