'use strict';

// Options page script

// DOM elements
const deviceNicknameInput = document.getElementById('device-nickname');
const updateNicknameButton = document.getElementById('update-nickname');
const notificationTimeoutInput = document.getElementById('notification-timeout');
const autoOpenLinksCheckbox = document.getElementById('auto-open-links');
const debugModeCheckbox = document.getElementById('debug-mode');
const saveSettingsButton = document.getElementById('save-settings');
const resetSettingsButton = document.getElementById('reset-settings');
const statusMessage = document.getElementById('status-message');
const versionSpan = document.getElementById('version');

// Default settings
const DEFAULT_SETTINGS = {
  deviceNickname: 'Chrome',
  notificationTimeout: 10000, // 10 seconds in milliseconds
  autoOpenLinks: true,
  debugMode: true
};

// Load settings on page load
document.addEventListener('DOMContentLoaded', loadSettings);

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
debugModeCheckbox.addEventListener('change', saveDebugMode);

// Load settings from storage
async function loadSettings() {
  try {
    // Load from sync storage
    const syncResult = await new Promise(resolve => {
      chrome.storage.sync.get(['deviceNickname', 'notificationTimeout', 'autoOpenLinks'], resolve);
    });

    // Load debug config from local storage
    const localResult = await new Promise(resolve => {
      chrome.storage.local.get(['debugConfig'], resolve);
    });

    // Set device nickname
    if (syncResult.deviceNickname) {
      deviceNicknameInput.value = syncResult.deviceNickname;
    } else {
      deviceNicknameInput.value = DEFAULT_SETTINGS.deviceNickname;
    }

    // Set notification timeout (convert from ms to seconds)
    if (syncResult.notificationTimeout !== undefined) {
      notificationTimeoutInput.value = Math.round(syncResult.notificationTimeout / 1000);
    } else {
      notificationTimeoutInput.value = Math.round(DEFAULT_SETTINGS.notificationTimeout / 1000);
    }

    // Set auto-open links
    if (syncResult.autoOpenLinks !== undefined) {
      autoOpenLinksCheckbox.checked = syncResult.autoOpenLinks;
    } else {
      autoOpenLinksCheckbox.checked = DEFAULT_SETTINGS.autoOpenLinks;
    }

    // Set debug mode
    if (localResult.debugConfig && localResult.debugConfig.enabled !== undefined) {
      debugModeCheckbox.checked = localResult.debugConfig.enabled;
    } else {
      debugModeCheckbox.checked = DEFAULT_SETTINGS.debugMode;
    }

    // Set version
    const manifest = chrome.runtime.getManifest();
    versionSpan.textContent = manifest.version;

    console.log('Settings loaded successfully');
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('Error loading settings', 'error');
  }
}

// Update device nickname
async function updateNickname() {
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

// Save notification timeout
async function saveNotificationTimeout() {
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

// Save auto-open links setting
async function saveAutoOpenLinks() {
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

// Save debug mode setting
async function saveDebugMode() {
  const enabled = debugModeCheckbox.checked;

  try {
    // Get current debug config
    const result = await new Promise(resolve => {
      chrome.storage.local.get(['debugConfig'], resolve);
    });

    const debugConfig = result.debugConfig || {};
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

// Save all settings
async function saveAllSettings() {
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
    const result = await new Promise(resolve => {
      chrome.storage.local.get(['debugConfig'], resolve);
    });

    const debugConfig = result.debugConfig || {};
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

// Reset to default settings
async function resetToDefaults() {
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

// Show status message
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type} show`;

  setTimeout(() => {
    statusMessage.classList.remove('show');
  }, 3000);
}

