"use strict";
(() => {
  // src/lib/ui/dom.ts
  function getElementById(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Element with id "${id}" not found`);
    }
    return element;
  }
  function show(element) {
    element.style.display = "";
  }
  function hide(element) {
    element.style.display = "none";
  }
  function showStatus(element, message, type = "info") {
    element.textContent = message;
    element.className = `status-message status-${type}`;
    show(element);
    setTimeout(() => {
      hide(element);
    }, 3e3);
  }

  // src/infrastructure/storage/storage.repository.ts
  var ChromeStorageRepository = class {
    /**
     * Get API Key from local storage
     * Security: API keys are stored in local storage (not synced) to prevent
     * exposure through Chrome's sync infrastructure
     */
    async getApiKey() {
      const result = await chrome.storage.local.get(["apiKey"]);
      return result.apiKey || null;
    }
    /**
     * Set API Key in local storage
     * Security: API keys are stored in local storage (not synced) to prevent
     * exposure through Chrome's sync infrastructure
     */
    async setApiKey(key) {
      if (key === null) {
        await chrome.storage.local.remove(["apiKey"]);
      } else {
        await chrome.storage.local.set({ apiKey: key });
      }
    }
    /**
     * Get Device Identifier from local storage
     */
    async getDeviceIden() {
      const result = await chrome.storage.local.get(["deviceIden"]);
      return result.deviceIden || null;
    }
    /**
     * Set Device Identifier in local storage
     */
    async setDeviceIden(iden) {
      if (iden === null) {
        await chrome.storage.local.remove(["deviceIden"]);
      } else {
        await chrome.storage.local.set({ deviceIden: iden });
      }
    }
    /**
     * Get Device Nickname from sync storage
     */
    async getDeviceNickname() {
      const result = await chrome.storage.sync.get(["deviceNickname"]);
      return result.deviceNickname || null;
    }
    /**
     * Set Device Nickname in sync storage
     */
    async setDeviceNickname(nickname) {
      await chrome.storage.sync.set({ deviceNickname: nickname });
    }
    /**
     * Get Auto Open Links setting from sync storage
     */
    async getAutoOpenLinks() {
      const result = await chrome.storage.sync.get(["autoOpenLinks"]);
      return result.autoOpenLinks !== void 0 ? result.autoOpenLinks : false;
    }
    /**
     * Set Auto Open Links setting in sync storage
     */
    async setAutoOpenLinks(enabled) {
      await chrome.storage.sync.set({ autoOpenLinks: enabled });
    }
    /**
     * Get Notification Timeout from sync storage
     */
    async getNotificationTimeout() {
      const result = await chrome.storage.sync.get(["notificationTimeout"]);
      return result.notificationTimeout !== void 0 ? result.notificationTimeout : 5e3;
    }
    /**
     * Set Notification Timeout in sync storage
     */
    async setNotificationTimeout(timeout) {
      await chrome.storage.sync.set({ notificationTimeout: timeout });
    }
    /**
     * Get Encryption Password from local storage
     */
    async getEncryptionPassword() {
      const result = await chrome.storage.local.get(["encryptionPassword"]);
      return result.encryptionPassword || null;
    }
    /**
     * Set Encryption Password in local storage
     */
    async setEncryptionPassword(password) {
      if (password === null) {
        await chrome.storage.local.remove(["encryptionPassword"]);
      } else {
        await chrome.storage.local.set({ encryptionPassword: password });
      }
    }
    /**
     * Get Scroll to Recent Pushes flag from local storage
     */
    async getScrollToRecentPushes() {
      const result = await chrome.storage.local.get(["scrollToRecentPushes"]);
      return result.scrollToRecentPushes || false;
    }
    /**
     * Set Scroll to Recent Pushes flag in local storage
     */
    async setScrollToRecentPushes(scroll) {
      await chrome.storage.local.set({ scrollToRecentPushes: scroll });
    }
    /**
     * Remove Scroll to Recent Pushes flag from local storage
     */
    async removeScrollToRecentPushes() {
      await chrome.storage.local.remove(["scrollToRecentPushes"]);
    }
    /**
     * Clear all storage (both sync and local)
     */
    async clear() {
      await Promise.all([
        chrome.storage.sync.clear(),
        chrome.storage.local.clear()
      ]);
    }
    /**
     * Remove specific keys from storage
     * Removes from both sync and local storage
     */
    async remove(keys) {
      await Promise.all([
        chrome.storage.sync.remove(keys),
        chrome.storage.local.remove(keys)
      ]);
    }
  };
  var storageRepository = new ChromeStorageRepository();

  // src/options/index.ts
  var deviceNicknameInput = getElementById("device-nickname");
  var updateNicknameButton = getElementById("update-nickname");
  var notificationTimeoutInput = getElementById("notification-timeout");
  var autoOpenLinksCheckbox = getElementById("auto-open-links");
  var encryptionPasswordInput = getElementById("encryption-password");
  var debugModeCheckbox = getElementById("debug-mode");
  var saveSettingsButton = getElementById("save-settings");
  var resetSettingsButton = getElementById("reset-settings");
  var statusMessage = getElementById("status-message");
  var versionSpan = getElementById("version");
  var DEFAULT_SETTINGS = {
    deviceNickname: "Chrome",
    notificationTimeout: 1e4,
    // 10 seconds in milliseconds
    autoOpenLinks: true,
    encryptionPassword: "",
    // E2EE password (stored in local storage only)
    debugMode: true
  };
  function showStatus2(message, type) {
    showStatus(statusMessage, message, type);
  }
  async function loadSettings() {
    try {
      const deviceNickname = await storageRepository.getDeviceNickname();
      const notificationTimeout = await storageRepository.getNotificationTimeout();
      const autoOpenLinks = await storageRepository.getAutoOpenLinks();
      const encryptionPassword = await storageRepository.getEncryptionPassword();
      deviceNicknameInput.value = deviceNickname || DEFAULT_SETTINGS.deviceNickname;
      notificationTimeoutInput.value = Math.round(notificationTimeout / 1e3).toString();
      autoOpenLinksCheckbox.checked = autoOpenLinks;
      encryptionPasswordInput.value = encryptionPassword || DEFAULT_SETTINGS.encryptionPassword;
      debugModeCheckbox.checked = DEFAULT_SETTINGS.debugMode;
      const manifest = chrome.runtime.getManifest();
      versionSpan.textContent = manifest.version;
      console.log("Settings loaded successfully");
    } catch (error) {
      console.error("Error loading settings:", error);
      showStatus2("Error loading settings", "error");
    }
  }
  async function updateNickname() {
    const nickname = deviceNicknameInput.value.trim();
    if (!nickname) {
      showStatus2("Please enter a device nickname", "error");
      return;
    }
    try {
      await storageRepository.setDeviceNickname(nickname);
      chrome.runtime.sendMessage({
        action: "deviceNicknameChanged",
        deviceNickname: nickname
      });
      showStatus2("Device nickname updated successfully", "success");
    } catch (error) {
      console.error("Error updating nickname:", error);
      showStatus2("Error updating device nickname", "error");
    }
  }
  async function saveNotificationTimeout() {
    const seconds = parseInt(notificationTimeoutInput.value, 10);
    if (isNaN(seconds) || seconds < 0 || seconds > 60) {
      showStatus2("Timeout must be between 0 and 60 seconds", "error");
      return;
    }
    const milliseconds = seconds * 1e3;
    try {
      await storageRepository.setNotificationTimeout(milliseconds);
      showStatus2("Notification timeout updated", "success");
    } catch (error) {
      console.error("Error saving notification timeout:", error);
      showStatus2("Error saving notification timeout", "error");
    }
  }
  async function saveAutoOpenLinks() {
    const enabled = autoOpenLinksCheckbox.checked;
    try {
      await storageRepository.setAutoOpenLinks(enabled);
      chrome.runtime.sendMessage({
        action: "autoOpenLinksChanged",
        autoOpenLinks: enabled
      });
      showStatus2("Auto-open links setting updated", "success");
    } catch (error) {
      console.error("Error saving auto-open links:", error);
      showStatus2("Error saving auto-open links setting", "error");
    }
  }
  async function saveEncryptionPassword() {
    const password = encryptionPasswordInput.value.trim();
    try {
      await storageRepository.setEncryptionPassword(password);
      chrome.runtime.sendMessage({
        action: "encryptionPasswordChanged",
        hasPassword: password.length > 0
      });
      if (password.length > 0) {
        showStatus2("Encryption password saved (stored locally only)", "success");
      } else {
        showStatus2("Encryption password cleared", "success");
      }
    } catch (error) {
      console.error("Error saving encryption password:", error);
      showStatus2("Error saving encryption password", "error");
    }
  }
  async function saveDebugMode() {
    const enabled = debugModeCheckbox.checked;
    try {
      const result = await chrome.storage.local.get(["debugConfig"]);
      const debugConfig = result.debugConfig || {};
      debugConfig.enabled = enabled;
      await chrome.storage.local.set({ debugConfig });
      chrome.runtime.sendMessage({
        action: "debugModeChanged",
        enabled
      });
      showStatus2("Debug mode updated", "success");
    } catch (error) {
      console.error("Error saving debug mode:", error);
      showStatus2("Error saving debug mode", "error");
    }
  }
  async function saveAllSettings() {
    try {
      const nickname = deviceNicknameInput.value.trim();
      const seconds = parseInt(notificationTimeoutInput.value, 10);
      const autoOpen = autoOpenLinksCheckbox.checked;
      const debug = debugModeCheckbox.checked;
      if (!nickname) {
        showStatus2("Please enter a device nickname", "error");
        return;
      }
      if (isNaN(seconds) || seconds < 0 || seconds > 60) {
        showStatus2("Timeout must be between 0 and 60 seconds", "error");
        return;
      }
      await storageRepository.setDeviceNickname(nickname);
      await storageRepository.setNotificationTimeout(seconds * 1e3);
      await storageRepository.setAutoOpenLinks(autoOpen);
      chrome.runtime.sendMessage({
        action: "settingsChanged",
        settings: {
          deviceNickname: nickname,
          notificationTimeout: seconds * 1e3,
          autoOpenLinks: autoOpen,
          debugMode: debug
        }
      });
      showStatus2("All settings saved successfully!", "success");
    } catch (error) {
      console.error("Error saving settings:", error);
      showStatus2("Error saving settings", "error");
    }
  }
  async function resetToDefaults() {
    if (!confirm("Are you sure you want to reset all settings to defaults?")) {
      return;
    }
    try {
      await storageRepository.setDeviceNickname(DEFAULT_SETTINGS.deviceNickname);
      await storageRepository.setNotificationTimeout(DEFAULT_SETTINGS.notificationTimeout);
      await storageRepository.setAutoOpenLinks(DEFAULT_SETTINGS.autoOpenLinks);
      await loadSettings();
      showStatus2("Settings reset to defaults", "success");
    } catch (error) {
      console.error("Error resetting settings:", error);
      showStatus2("Error resetting settings", "error");
    }
  }
  function init() {
    updateNicknameButton.addEventListener("click", updateNickname);
    saveSettingsButton.addEventListener("click", saveAllSettings);
    resetSettingsButton.addEventListener("click", resetToDefaults);
    notificationTimeoutInput.addEventListener("change", () => {
      const seconds = parseInt(notificationTimeoutInput.value, 10);
      if (!isNaN(seconds) && seconds >= 0 && seconds <= 60) {
        saveNotificationTimeout();
      }
    });
    autoOpenLinksCheckbox.addEventListener("change", saveAutoOpenLinks);
    encryptionPasswordInput.addEventListener("change", saveEncryptionPassword);
    debugModeCheckbox.addEventListener("change", saveDebugMode);
    loadSettings();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
//# sourceMappingURL=options.js.map
