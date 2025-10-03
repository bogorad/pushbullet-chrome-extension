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
      const syncResult = await chrome.storage.sync.get(["deviceNickname", "notificationTimeout", "autoOpenLinks"]);
      const localResult = await chrome.storage.local.get(["encryptionPassword", "debugConfig"]);
      deviceNicknameInput.value = syncResult.deviceNickname || DEFAULT_SETTINGS.deviceNickname;
      const timeoutMs = syncResult.notificationTimeout !== void 0 ? syncResult.notificationTimeout : DEFAULT_SETTINGS.notificationTimeout;
      notificationTimeoutInput.value = Math.round(timeoutMs / 1e3).toString();
      autoOpenLinksCheckbox.checked = syncResult.autoOpenLinks !== void 0 ? syncResult.autoOpenLinks : DEFAULT_SETTINGS.autoOpenLinks;
      encryptionPasswordInput.value = localResult.encryptionPassword || DEFAULT_SETTINGS.encryptionPassword;
      const debugConfig = localResult.debugConfig;
      debugModeCheckbox.checked = debugConfig?.enabled !== void 0 ? debugConfig.enabled : DEFAULT_SETTINGS.debugMode;
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
      await chrome.storage.sync.set({ deviceNickname: nickname });
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
      await chrome.storage.sync.set({ notificationTimeout: milliseconds });
      showStatus2("Notification timeout updated", "success");
    } catch (error) {
      console.error("Error saving notification timeout:", error);
      showStatus2("Error saving notification timeout", "error");
    }
  }
  async function saveAutoOpenLinks() {
    const enabled = autoOpenLinksCheckbox.checked;
    try {
      await chrome.storage.sync.set({ autoOpenLinks: enabled });
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
      await chrome.storage.local.set({
        encryptionPassword: password
      });
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
      await chrome.storage.sync.set({
        deviceNickname: nickname,
        notificationTimeout: seconds * 1e3,
        autoOpenLinks: autoOpen
      });
      const result = await chrome.storage.local.get(["debugConfig"]);
      const debugConfig = result.debugConfig || {};
      debugConfig.enabled = debug;
      await chrome.storage.local.set({ debugConfig });
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
      await chrome.storage.sync.set({
        deviceNickname: DEFAULT_SETTINGS.deviceNickname,
        notificationTimeout: DEFAULT_SETTINGS.notificationTimeout,
        autoOpenLinks: DEFAULT_SETTINGS.autoOpenLinks
      });
      const debugConfig = {
        enabled: DEFAULT_SETTINGS.debugMode
      };
      await chrome.storage.local.set({ debugConfig });
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
