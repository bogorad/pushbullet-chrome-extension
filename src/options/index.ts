/**
 * Options page
 */

import { getElementById, showStatus as showStatusUI } from '../lib/ui/dom';

// DOM elements
const deviceNicknameInput = getElementById<HTMLInputElement>('device-nickname');
const updateNicknameButton = getElementById<HTMLButtonElement>('update-nickname');
const notificationTimeoutInput = getElementById<HTMLInputElement>('notification-timeout');
const autoOpenLinksCheckbox = getElementById<HTMLInputElement>('auto-open-links');
const encryptionPasswordInput = getElementById<HTMLInputElement>('encryption-password');
const debugModeCheckbox = getElementById<HTMLInputElement>('debug-mode');
const saveSettingsButton = getElementById<HTMLButtonElement>('save-settings');
const resetSettingsButton = getElementById<HTMLButtonElement>('reset-settings');
const statusMessage = getElementById<HTMLDivElement>('status-message');
const versionSpan = getElementById<HTMLSpanElement>('version');

// Default settings
const DEFAULT_SETTINGS = {
  deviceNickname: 'Chrome',
  notificationTimeout: 10000, // 10 seconds in milliseconds
  autoOpenLinks: true,
  encryptionPassword: '', // E2EE password (stored in local storage only)
  debugMode: true
};

/**
 * Show status message
 */
function showStatus(message: string, type: 'success' | 'error' | 'info'): void {
  showStatusUI(statusMessage, message, type);
}

/**
 * Load settings from storage
 */
async function loadSettings(): Promise<void> {
  try {
    // Load from sync storage
    const syncResult = await chrome.storage.sync.get(['deviceNickname', 'notificationTimeout', 'autoOpenLinks']);

    // Load encryption password and debug config from LOCAL storage (not synced!)
    const localResult = await chrome.storage.local.get(['encryptionPassword', 'debugConfig']);

    // Set device nickname
    deviceNicknameInput.value = syncResult.deviceNickname || DEFAULT_SETTINGS.deviceNickname;

    // Set notification timeout (convert from ms to seconds)
    const timeoutMs = syncResult.notificationTimeout !== undefined ? syncResult.notificationTimeout : DEFAULT_SETTINGS.notificationTimeout;
    notificationTimeoutInput.value = Math.round(timeoutMs / 1000).toString();

    // Set auto-open links
    autoOpenLinksCheckbox.checked = syncResult.autoOpenLinks !== undefined ? syncResult.autoOpenLinks : DEFAULT_SETTINGS.autoOpenLinks;

    // Set encryption password (from local storage)
    encryptionPasswordInput.value = localResult.encryptionPassword || DEFAULT_SETTINGS.encryptionPassword;

    // Set debug mode
    const debugConfig = localResult.debugConfig as { enabled?: boolean } | undefined;
    debugModeCheckbox.checked = debugConfig?.enabled !== undefined ? debugConfig.enabled : DEFAULT_SETTINGS.debugMode;

    // Set version
    const manifest = chrome.runtime.getManifest();
    versionSpan.textContent = manifest.version;

    console.log('Settings loaded successfully');
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('Error loading settings', 'error');
  }
}

/**
 * Update device nickname
 */
async function updateNickname(): Promise<void> {
  const nickname = deviceNicknameInput.value.trim();
  
  if (!nickname) {
    showStatus('Please enter a device nickname', 'error');
    return;
  }

  try {
    await chrome.storage.sync.set({ deviceNickname: nickname });
    
    // Notify background script
    chrome.runtime.sendMessage({
      action: 'deviceNicknameChanged',
      deviceNickname: nickname
    });

    showStatus('Device nickname updated successfully', 'success');
  } catch (error) {
    console.error('Error updating nickname:', error);
    showStatus('Error updating device nickname', 'error');
  }
}

/**
 * Save notification timeout
 */
async function saveNotificationTimeout(): Promise<void> {
  const seconds = parseInt(notificationTimeoutInput.value, 10);
  
  if (isNaN(seconds) || seconds < 0 || seconds > 60) {
    showStatus('Timeout must be between 0 and 60 seconds', 'error');
    return;
  }

  const milliseconds = seconds * 1000;

  try {
    await chrome.storage.sync.set({ notificationTimeout: milliseconds });
    showStatus('Notification timeout updated', 'success');
  } catch (error) {
    console.error('Error saving notification timeout:', error);
    showStatus('Error saving notification timeout', 'error');
  }
}

/**
 * Save auto-open links setting
 */
async function saveAutoOpenLinks(): Promise<void> {
  const enabled = autoOpenLinksCheckbox.checked;

  try {
    await chrome.storage.sync.set({ autoOpenLinks: enabled });
    
    // Notify background script
    chrome.runtime.sendMessage({
      action: 'autoOpenLinksChanged',
      autoOpenLinks: enabled
    });

    showStatus('Auto-open links setting updated', 'success');
  } catch (error) {
    console.error('Error saving auto-open links:', error);
    showStatus('Error saving auto-open links setting', 'error');
  }
}

/**
 * Save encryption password (to LOCAL storage only, not synced!)
 */
async function saveEncryptionPassword(): Promise<void> {
  const password = encryptionPasswordInput.value.trim();

  try {
    await chrome.storage.local.set({
      encryptionPassword: password
    });

    // Notify background script that encryption password changed
    chrome.runtime.sendMessage({
      action: 'encryptionPasswordChanged',
      hasPassword: password.length > 0
    });

    if (password.length > 0) {
      showStatus('Encryption password saved (stored locally only)', 'success');
    } else {
      showStatus('Encryption password cleared', 'success');
    }
  } catch (error) {
    console.error('Error saving encryption password:', error);
    showStatus('Error saving encryption password', 'error');
  }
}

/**
 * Save debug mode setting
 */
async function saveDebugMode(): Promise<void> {
  const enabled = debugModeCheckbox.checked;

  try {
    // Get current debug config
    const result = await chrome.storage.local.get(['debugConfig']);

    const debugConfig = (result.debugConfig as Record<string, unknown>) || {};
    debugConfig.enabled = enabled;

    await chrome.storage.local.set({ debugConfig });

    // Notify background script
    chrome.runtime.sendMessage({
      action: 'debugModeChanged',
      enabled: enabled
    });

    showStatus('Debug mode updated', 'success');
  } catch (error) {
    console.error('Error saving debug mode:', error);
    showStatus('Error saving debug mode', 'error');
  }
}

/**
 * Save all settings
 */
async function saveAllSettings(): Promise<void> {
  try {
    const nickname = deviceNicknameInput.value.trim();
    const seconds = parseInt(notificationTimeoutInput.value, 10);
    const autoOpen = autoOpenLinksCheckbox.checked;
    const debug = debugModeCheckbox.checked;

    // Validate
    if (!nickname) {
      showStatus('Please enter a device nickname', 'error');
      return;
    }

    if (isNaN(seconds) || seconds < 0 || seconds > 60) {
      showStatus('Timeout must be between 0 and 60 seconds', 'error');
      return;
    }

    // Save to sync storage
    await chrome.storage.sync.set({
      deviceNickname: nickname,
      notificationTimeout: seconds * 1000,
      autoOpenLinks: autoOpen
    });

    // Save debug config to local storage
    const result = await chrome.storage.local.get(['debugConfig']);

    const debugConfig = (result.debugConfig as Record<string, unknown>) || {};
    debugConfig.enabled = debug;
    await chrome.storage.local.set({ debugConfig });

    // Notify background script
    chrome.runtime.sendMessage({
      action: 'settingsChanged',
      settings: {
        deviceNickname: nickname,
        notificationTimeout: seconds * 1000,
        autoOpenLinks: autoOpen,
        debugMode: debug
      }
    });

    showStatus('All settings saved successfully!', 'success');
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Error saving settings', 'error');
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
    // Reset sync storage
    await chrome.storage.sync.set({
      deviceNickname: DEFAULT_SETTINGS.deviceNickname,
      notificationTimeout: DEFAULT_SETTINGS.notificationTimeout,
      autoOpenLinks: DEFAULT_SETTINGS.autoOpenLinks
    });

    // Reset debug config
    const debugConfig = {
      enabled: DEFAULT_SETTINGS.debugMode
    };
    await chrome.storage.local.set({ debugConfig });

    // Reload settings
    await loadSettings();

    showStatus('Settings reset to defaults', 'success');
  } catch (error) {
    console.error('Error resetting settings:', error);
    showStatus('Error resetting settings', 'error');
  }
}

/**
 * Initialize page
 */
function init(): void {
  // Event listeners
  updateNicknameButton.addEventListener('click', updateNickname);
  saveSettingsButton.addEventListener('click', saveAllSettings);
  resetSettingsButton.addEventListener('click', resetToDefaults);

  // Auto-save on change
  notificationTimeoutInput.addEventListener('change', () => {
    const seconds = parseInt(notificationTimeoutInput.value, 10);
    if (!isNaN(seconds) && seconds >= 0 && seconds <= 60) {
      saveNotificationTimeout();
    }
  });

  autoOpenLinksCheckbox.addEventListener('change', saveAutoOpenLinks);
  encryptionPasswordInput.addEventListener('change', saveEncryptionPassword);
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

