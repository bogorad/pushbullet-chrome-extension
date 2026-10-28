/**
 * Options page
 */

import { getElementById } from '../lib/ui/dom';
import { ensureToastContainer, showToast } from './toast';
import { storageRepository } from '../infrastructure/storage/storage.repository';
import { MessageAction } from '../types/domain';
import { verifyJevApiKey } from '../app/api/jev';

// DOM elements
const deviceNicknameInput = getElementById<HTMLInputElement>('device-nickname');
const notificationTimeoutInput = getElementById<HTMLInputElement>('notification-timeout');
const autoOpenLinksCheckbox = getElementById<HTMLInputElement>('auto-open-links');
const autoOpenLinksOnReconnectCheckbox = getElementById<HTMLInputElement>('auto-open-links-on-reconnect');
const encryptionPasswordInput = getElementById<HTMLInputElement>('encryption-password');
const debugModeCheckbox = getElementById<HTMLInputElement>('debug-mode');
const jevApiKeyInput = getElementById<HTMLInputElement>('jev-api-key');
const jevApiKeyStatus = getElementById<HTMLParagraphElement>('jev-api-key-status');
const jevApiKeyDot = getElementById<HTMLSpanElement>('jev-api-key-dot');
const resetSettingsButton = getElementById<HTMLButtonElement>('reset-settings');
const forceWakeBtn = getElementById<HTMLButtonElement>('force-wake');
const onlyThisDeviceCheckbox = getElementById<HTMLInputElement>('only-this-device');
const versionSpan = getElementById<HTMLSpanElement>('version');

// Default settings
const DEFAULT_SETTINGS = {
  deviceNickname: 'Chrome',
  notificationTimeout: 10000, // 10 seconds in milliseconds
  autoOpenLinks: true,
  autoOpenLinksOnReconnect: false, // Off by default for safety
  encryptionPassword: '', // E2EE password (stored in session storage when supported)
  debugMode: true
};

/**
 * Load settings from storage
 */
async function loadSettings(): Promise<void> {
  try {
    // Load from storage repository
    const deviceNickname = await storageRepository.getDeviceNickname();
    const notificationTimeout = await storageRepository.getNotificationTimeout();
    const autoOpenLinks = await storageRepository.getAutoOpenLinks();
    const autoOpenLinksOnReconnect = await storageRepository.getAutoOpenLinksOnReconnect();
    const onlyThisDevice = await storageRepository.getOnlyThisDevice();
    const encryptionPassword = await storageRepository.getEncryptionPassword();
    const jevApiKey = await storageRepository.getJevApiKey();

    // Set device nickname
    deviceNicknameInput.value = deviceNickname || DEFAULT_SETTINGS.deviceNickname;

    // Set notification timeout (convert from ms to seconds)
    notificationTimeoutInput.value = Math.round(notificationTimeout / 1000).toString();

    // Set auto-open links
    autoOpenLinksCheckbox.checked = autoOpenLinks;
    autoOpenLinksOnReconnectCheckbox.checked = autoOpenLinksOnReconnect;
    onlyThisDeviceCheckbox.checked = onlyThisDevice;

    // Set encryption password
    encryptionPasswordInput.value = encryptionPassword || DEFAULT_SETTINGS.encryptionPassword;
    jevApiKeyInput.value = jevApiKey || '';
    storedJevApiKey = jevApiKey && jevApiKey.trim().length > 0 ? jevApiKey : null;
    if (storedJevApiKey) {
      setJevKeyStatus('neutral', 'Saved Jev API key — verifying…');
      void verifyAndStoreJevApiKey(storedJevApiKey, false);
    } else {
      setJevKeyStatus('neutral', '');
    }

    // Set debug mode (note: debug config is complex, keeping simple for now)
    debugModeCheckbox.checked = DEFAULT_SETTINGS.debugMode;

    // Set version
    const manifest = chrome.runtime.getManifest();
    versionSpan.textContent = manifest.version;

    console.log('Settings loaded successfully');
  } catch (error) {
    console.error('Error loading settings:', error);
    showToast('error', 'Error loading settings');
  }
}

const NICKNAME_DEBOUNCE_MS = 500;
let nicknameTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Save device nickname (auto-save with debounce; empty input rejected)
 */
async function saveNickname(): Promise<void> {
  const nickname = deviceNicknameInput.value.trim();

  if (!nickname) {
    showToast('error', 'Please enter a device nickname');
    return;
  }

  try {
    await storageRepository.setDeviceNickname(nickname);

    // Notify background script and await its response
    const response = await chrome.runtime.sendMessage({
      action: MessageAction.UPDATE_DEVICE_NICKNAME,
      nickname: nickname
    }) as { success?: boolean; error?: string } | undefined;

    if (response?.success === false) {
      throw new Error(response.error || 'Failed to update device nickname');
    }

    showToast('success', 'Device nickname updated');
  } catch (error) {
    console.error('Error updating nickname:', error);
    showToast('error', 'Error updating device nickname');
  }
}

/**
 * Schedule a debounced nickname save for raw text input
 */
function scheduleNicknameSave(): void {
  if (nicknameTimer !== null) {
    clearTimeout(nicknameTimer);
  }
  nicknameTimer = setTimeout(() => {
    nicknameTimer = null;
    void saveNickname();
  }, NICKNAME_DEBOUNCE_MS);
}

/**
 * Commit a pending nickname save immediately (change/blur)
 */
function commitNicknameNow(): void {
  if (nicknameTimer !== null) {
    clearTimeout(nicknameTimer);
    nicknameTimer = null;
  }
  void saveNickname();
}

/**
 * Save notification timeout
 */
async function saveNotificationTimeout(): Promise<void> {
  const seconds = parseInt(notificationTimeoutInput.value, 10);
  
  if (isNaN(seconds) || seconds < 0 || seconds > 60) {
    showToast('error', 'Timeout must be between 0 and 60 seconds');
    return;
  }

  const milliseconds = seconds * 1000;

  try {
    await storageRepository.setNotificationTimeout(milliseconds);
    showToast('success', 'Notification timeout updated');
  } catch (error) {
    console.error('Error saving notification timeout:', error);
    showToast('error', 'Error saving notification timeout');
  }
}

/**
 * Save auto-open links setting
 */
async function saveAutoOpenLinks(): Promise<void> {
  const enabled = autoOpenLinksCheckbox.checked;

  try {
    await storageRepository.setAutoOpenLinks(enabled);
  } catch (error) {
    console.error('Error saving auto-open links:', error);
    showToast('error', 'Error saving auto-open links setting');
    return;
  }

  try {
    // Notify background script and await its response
    const response = await chrome.runtime.sendMessage({
      action: MessageAction.SETTINGS_CHANGED,
      settings: {
        autoOpenLinks: enabled
      }
    }) as { success?: boolean; error?: string } | undefined;

    if (response?.success === false) {
      throw new Error(response.error || 'Failed to sync auto-open links setting');
    }

    showToast('success', 'Auto-open links setting updated');
  } catch (error) {
    console.error('Error syncing auto-open links:', error);
    showToast('error', 'Auto-open links saved locally but background sync failed');
  }
}

/**
 * Save auto-open links on reconnect setting
 */
async function saveAutoOpenLinksOnReconnect(): Promise<void> {
  const enabled = autoOpenLinksOnReconnectCheckbox.checked;

  try {
    await storageRepository.setAutoOpenLinksOnReconnect(enabled);
    showToast('success', 'Auto-open links on reconnect setting updated');
  } catch (error) {
    console.error('Error saving auto-open links on reconnect:', error);
    showToast('error', 'Error saving auto-open links on reconnect setting');
  }
}

async function saveOnlyThisDevice(): Promise<void> {
  const enabled = onlyThisDeviceCheckbox.checked;

  try {
    await storageRepository.setOnlyThisDevice(enabled);
  } catch (error) {
    console.error('Error saving only this device filter:', error);
    showToast('error', 'Error saving filter setting');
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: MessageAction.SETTINGS_CHANGED,
      onlyThisDevice: enabled
    }) as { success?: boolean; error?: string } | undefined;

    if (response?.success === false) {
      throw new Error(response.error || 'Failed to sync filter setting');
    }

    showToast('success', 'Only this device filter updated');
  } catch (error) {
    console.error('Error syncing only this device filter:', error);
    showToast('error', 'Filter saved locally but background sync failed');
  }
}

/**
 * Save encryption password.
 * Uses Chrome local storage so the raw password survives extension reloads.
 */
async function saveEncryptionPassword(): Promise<void> {
  const password = encryptionPasswordInput.value.trim();

  try {
    await storageRepository.setEncryptionPassword(password);

    if (password.length > 0) {
      showToast('success', 'Encryption password saved locally');
    } else {
      showToast('success', 'Encryption password cleared');
    }
  } catch (error) {
    console.error('Error saving encryption password:', error);
    showToast('error', 'Error saving encryption password');
  }
}

type JevKeyStatusState = 'neutral' | 'verifying' | 'valid' | 'invalid' | 'error';

const JEV_VERIFY_DEBOUNCE_MS = 500;
let jevVerifyTimer: ReturnType<typeof setTimeout> | null = null;
let jevVerifySeq = 0;
let storedJevApiKey: string | null = null;
let lastVerifiedJevApiKey: string | null = null;

function setJevKeyStatus(state: JevKeyStatusState, message: string): void {
  jevApiKeyStatus.textContent = message;
  const dotState =
    state === 'valid'
      ? 'valid'
      : state === 'invalid' || state === 'error'
        ? 'invalid'
        : state === 'verifying'
          ? 'pending'
          : 'neutral';
  jevApiKeyDot.className = `jev-key-dot jev-key-dot--${dotState}`;
  const label =
    state === 'valid'
      ? 'Jev API key status: verified valid'
      : state === 'invalid'
        ? 'Jev API key status: invalid'
        : state === 'error'
          ? 'Jev API key status: verification failed'
          : state === 'verifying'
            ? 'Jev API key status: verifying'
            : 'Jev API key status: not verified';
  jevApiKeyDot.title = label;
  jevApiKeyDot.setAttribute('aria-label', label);
}

async function verifyAndStoreJevApiKey(candidate: string, announce = true): Promise<boolean> {
  const seq = ++jevVerifySeq;
  setJevKeyStatus('verifying', 'Verifying Jev API key…');
  const result = await verifyJevApiKey(candidate);
  if (seq !== jevVerifySeq) {
    return false;
  }
  if (result.kind === 'valid') {
    try {
      await storageRepository.setJevApiKey(candidate);
    } catch {
      setJevKeyStatus('error', 'Jev API key verified but could not be saved locally.');
      if (announce) {
        showToast('error', 'Jev API key verified but could not be saved locally.');
      }
      return false;
    }
    storedJevApiKey = candidate;
    lastVerifiedJevApiKey = candidate;
    setJevKeyStatus('valid', 'Jev API key verified and saved locally.');
    if (announce) {
      showToast('success', 'Jev API key verified and saved locally.');
    }
    return true;
  }
  const unchanged = storedJevApiKey ? ' Previously saved key unchanged.' : ' Key not saved.';
  if (result.kind === 'invalid') {
    setJevKeyStatus('invalid', `Invalid Jev API key (HTTP ${result.status}).${unchanged}`);
    if (announce) {
      showToast('error', `Invalid Jev API key (HTTP ${result.status}).${unchanged}`);
    }
  } else if (result.kind === 'timeout') {
    setJevKeyStatus('error', `Jev API key verification timed out.${unchanged}`);
    if (announce) {
      showToast('error', `Jev API key verification timed out.${unchanged}`);
    }
  } else {
    setJevKeyStatus('error', `Jev API key verification failed (network error).${unchanged}`);
    if (announce) {
      showToast('error', `Jev API key verification failed (network error).${unchanged}`);
    }
  }
  return false;
}

function scheduleJevApiKeyVerification(delayMs: number): void {
  if (jevVerifyTimer !== null) {
    clearTimeout(jevVerifyTimer);
    jevVerifyTimer = null;
  }
  const current = jevApiKeyInput.value.trim();
  if (current.length > 0 && current !== lastVerifiedJevApiKey) {
    setJevKeyStatus('verifying', 'Verifying Jev API key…');
  }
  jevVerifyTimer = setTimeout(() => {
    jevVerifyTimer = null;
    const candidate = jevApiKeyInput.value.trim();
    if (candidate.length === 0) {
      jevVerifySeq += 1;
      void (async () => {
        try {
          await storageRepository.setJevApiKey(null);
          storedJevApiKey = null;
          lastVerifiedJevApiKey = null;
          setJevKeyStatus('neutral', 'Jev API key cleared.');
          showToast('success', 'Jev API key cleared.');
        } catch {
          setJevKeyStatus('error', 'Error clearing Jev API key.');
          showToast('error', 'Error clearing Jev API key.');
        }
      })();
      return;
    }
    if (candidate === lastVerifiedJevApiKey && candidate === storedJevApiKey) {
      setJevKeyStatus('valid', 'Jev API key verified and saved locally.');
      return;
    }
    void verifyAndStoreJevApiKey(candidate);
  }, delayMs);
}

/**
 * Save debug mode setting
 */
async function saveDebugMode(): Promise<void> {
  const enabled = debugModeCheckbox.checked;

  try {
    // Notify background script
    const response = await chrome.runtime.sendMessage({
      action: MessageAction.UPDATE_DEBUG_CONFIG,
      config: { enabled }
    }) as { success?: boolean; error?: string } | undefined;

    if (response?.success === false) {
      throw new Error(response.error || 'Failed to update debug config');
    }

    showToast('success', 'Debug mode updated');
  } catch (error) {
    console.error('Error saving debug mode:', error);
    showToast('error', 'Error saving debug mode');
  }
}

/**
 * Reset to default settings
 */
async function resetToDefaults(): Promise<void> {
  if (!confirm('Are you sure you want to reset all settings to defaults?')) {
    return;
  }

  try {
    // Reset settings via storage repository
    await storageRepository.setDeviceNickname(DEFAULT_SETTINGS.deviceNickname);
    await storageRepository.setNotificationTimeout(DEFAULT_SETTINGS.notificationTimeout);
    await storageRepository.setAutoOpenLinks(DEFAULT_SETTINGS.autoOpenLinks);
    await storageRepository.setAutoOpenLinksOnReconnect(DEFAULT_SETTINGS.autoOpenLinksOnReconnect);

    // Note: Debug config reset skipped for now (complex local storage structure)

    // Reload settings
    await loadSettings();

    showToast('success', 'Settings reset to defaults');
  } catch (error) {
    console.error('Error resetting settings:', error);
    showToast('error', 'Error resetting settings');
  }
}

/**
 * Initialize page
 */
function init(): void {
  // Event listeners
  ensureToastContainer();
  resetSettingsButton.addEventListener('click', resetToDefaults);
  forceWakeBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: MessageAction.ATTEMPT_RECONNECT }).then(() => {
      showToast('success', 'Force wake sent, check extension popup for status');
    }).catch(() => {
      showToast('error', 'Failed to send force wake');
    });
  });

  // Nickname auto-save: debounced on raw input, committed on change/blur
  deviceNicknameInput.addEventListener('input', scheduleNicknameSave);
  deviceNicknameInput.addEventListener('change', commitNicknameNow);
  deviceNicknameInput.addEventListener('blur', () => {
    if (nicknameTimer !== null) {
      commitNicknameNow();
    }
  });

  // Auto-save on change
  notificationTimeoutInput.addEventListener('change', () => {
    const seconds = parseInt(notificationTimeoutInput.value, 10);
    if (!isNaN(seconds) && seconds >= 0 && seconds <= 60) {
      saveNotificationTimeout();
    }
  });

  autoOpenLinksCheckbox.addEventListener('change', saveAutoOpenLinks);
  autoOpenLinksOnReconnectCheckbox.addEventListener('change', saveAutoOpenLinksOnReconnect);
  onlyThisDeviceCheckbox.addEventListener('change', saveOnlyThisDevice);
  encryptionPasswordInput.addEventListener('change', saveEncryptionPassword);
  jevApiKeyInput.addEventListener('paste', () => scheduleJevApiKeyVerification(0));
  jevApiKeyInput.addEventListener('input', () =>
    scheduleJevApiKeyVerification(JEV_VERIFY_DEBOUNCE_MS),
  );
  jevApiKeyInput.addEventListener('change', () => scheduleJevApiKeyVerification(0));
  debugModeCheckbox.addEventListener('change', saveDebugMode);

  // Load settings
  loadSettings();
}

// Initialize on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
