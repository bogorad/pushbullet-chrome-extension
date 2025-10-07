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
     * Get Device Registration In Progress flag from local storage
     */
    async getDeviceRegistrationInProgress() {
      const result = await chrome.storage.local.get(["deviceRegistrationInProgress"]);
      return result.deviceRegistrationInProgress || false;
    }
    /**
     * Set Device Registration In Progress flag in local storage
     */
    async setDeviceRegistrationInProgress(inProgress) {
      await chrome.storage.local.set({ deviceRegistrationInProgress: inProgress });
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

  // src/popup/index.ts
  var loadingSection = getElementById("loading-section");
  var loginSection = getElementById("login-section");
  var mainSection = getElementById("main-section");
  var apiKeyInput = getElementById("api-key");
  var deviceNicknameInput = getElementById("device-nickname");
  var saveApiKeyButton = getElementById("save-api-key");
  var logoutButton = getElementById("logout");
  var userImage = getElementById("user-image");
  var userName = getElementById("user-name");
  var pushTypeNoteBtn = getElementById("push-type-note");
  var pushTypeLinkBtn = getElementById("push-type-link");
  var pushTypeFileBtn = getElementById("push-type-file");
  var noteForm = getElementById("note-form");
  var linkForm = getElementById("link-form");
  var fileForm = getElementById("file-form");
  var fileInput = getElementById("file-input");
  var fileSelected = getElementById("file-selected");
  var fileName = getElementById("file-name");
  var fileSize = getElementById("file-size");
  var noteTitleInput = getElementById("note-title");
  var noteBodyInput = getElementById("note-body");
  var linkTitleInput = getElementById("link-title");
  var linkUrlInput = getElementById("link-url");
  var linkBodyInput = getElementById("link-body");
  var targetDeviceSelect = getElementById("target-device");
  var sendPushButton = getElementById("send-push");
  var pushesList = getElementById("pushes-list");
  var statusMessage = getElementById("status-message");
  var openSettingsBtn = getElementById("open-settings");
  var openDebugDashboardBtn = getElementById(
    "open-debug-dashboard"
  );
  var deviceNickname = "Chrome";
  var devices = [];
  var currentPushType = "note";
  function init() {
    console.log("Popup initializing");
    setupEventListeners();
    checkStorageForApiKey();
  }
  async function initializeFromSessionData(response) {
    if (!response.isAuthenticated) {
      showSection("login");
      return;
    }
    deviceNickname = response.deviceNickname;
    console.log("Device nickname:", deviceNickname);
    if (response.userInfo) {
      updateUserInfo(response.userInfo);
    }
    populateDeviceDropdown(response.devices);
    displayPushes(response.recentPushes);
    showSection("main");
  }
  function checkStorageForApiKey() {
    console.log("Requesting session data from background");
    showSection("loading");
    chrome.runtime.sendMessage(
      { action: "getSessionData" /* GET_SESSION_DATA */ },
      async (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error getting session data:", chrome.runtime.lastError);
          showSection("login");
          return;
        }
        if (response.isAuthenticated) {
          await initializeFromSessionData(response);
          const shouldScroll = await storageRepository.getScrollToRecentPushes();
          if (shouldScroll) {
            await storageRepository.removeScrollToRecentPushes();
            setTimeout(() => {
              scrollToRecentPushes();
            }, 100);
          }
        } else {
          showSection("login");
        }
      }
    );
  }
  function showSection(section) {
    console.log("Showing section:", section);
    loadingSection.style.display = section === "loading" ? "flex" : "none";
    loginSection.style.display = section === "login" ? "block" : "none";
    mainSection.style.display = section === "main" ? "block" : "none";
  }
  function setupEventListeners() {
    saveApiKeyButton.addEventListener("click", saveApiKey);
    apiKeyInput.addEventListener("keyup", (event) => {
      if (event.key === "Enter") {
        saveApiKey();
      }
    });
    deviceNicknameInput.addEventListener("keyup", (event) => {
      if (event.key === "Enter") {
        saveApiKey();
      }
    });
    logoutButton.addEventListener("click", logout);
    pushTypeNoteBtn.addEventListener("click", () => togglePushType("note"));
    pushTypeLinkBtn.addEventListener("click", () => togglePushType("link"));
    pushTypeFileBtn.addEventListener("click", () => togglePushType("file"));
    fileInput.addEventListener("change", handleFileSelect);
    sendPushButton.addEventListener("click", sendPush);
    openSettingsBtn.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
    openDebugDashboardBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: chrome.runtime.getURL("debug-dashboard.html")
      });
    });
  }
  async function saveApiKey() {
    const newApiKey = apiKeyInput.value.trim();
    const newNickname = deviceNicknameInput.value.trim() || "Chrome";
    if (!newApiKey) {
      showStatus("Please enter an Access Token.", "error");
      return;
    }
    showSection("loading");
    try {
      await storageRepository.setApiKey(newApiKey);
      await storageRepository.setDeviceNickname(newNickname);
      deviceNickname = newNickname;
      chrome.runtime.sendMessage(
        {
          action: "apiKeyChanged" /* API_KEY_CHANGED */,
          apiKey: newApiKey,
          deviceNickname: newNickname
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(
              "Error notifying background:",
              chrome.runtime.lastError
            );
            showStatus("Error: Could not connect to background script", "error");
            showSection("login");
            return;
          }
          if ("isAuthenticated" in response) {
            if (response.isAuthenticated) {
              initializeFromSessionData(response);
            } else {
              showStatus("Invalid Access Token", "error");
              showSection("login");
            }
          } else {
            showStatus(
              `Error: ${response.error || "Invalid Access Token"}`,
              "error"
            );
            showSection("login");
          }
        }
      );
    } catch (error) {
      showStatus(`Error: ${error.message}`, "error");
      showSection("login");
    }
  }
  async function logout() {
    await storageRepository.setApiKey(null);
    await storageRepository.setDeviceIden(null);
    chrome.runtime.sendMessage({ action: "logout" /* LOGOUT */ }).catch((error) => {
      console.warn("Could not notify background of logout:", error.message);
    });
    showSection("login");
    apiKeyInput.value = "";
    deviceNicknameInput.value = "";
  }
  function updateUserInfo(userInfo) {
    userName.textContent = userInfo.name || userInfo.email || "";
    if (userInfo.image_url) {
      userImage.src = userInfo.image_url;
      userImage.style.display = "block";
    } else {
      userImage.style.display = "none";
    }
  }
  function populateDeviceDropdown(devicesList) {
    const devicesToUse = devicesList || devices;
    while (targetDeviceSelect.options.length > 1) {
      targetDeviceSelect.remove(1);
    }
    devicesToUse.forEach((device) => {
      const option = document.createElement("option");
      option.value = device.iden;
      option.textContent = device.nickname || device.model || "Unknown Device";
      targetDeviceSelect.appendChild(option);
    });
  }
  function displayPushes(pushes) {
    pushesList.innerHTML = "";
    if (!pushes || pushes.length === 0) {
      pushesList.innerHTML = "<p>No recent pushes</p>";
      return;
    }
    const recentPushes = pushes.slice(0, 10);
    recentPushes.forEach((push) => {
      let title;
      let body;
      let url;
      if (push.type === "note") {
        title = push.title;
        body = push.body;
      } else if (push.type === "link") {
        title = push.title;
        url = push.url;
        body = push.body;
      } else if (push.type === "mirror") {
        title = `SMS: ${push.title || ""}`;
        body = push.body;
      } else if (push.type === "sms_changed") {
        if (push.notifications && push.notifications.length > 0) {
          const sms = push.notifications[0];
          title = sms.title;
          body = sms.body;
        }
      }
      if (!title && !body && !url) {
        return;
      }
      const pushItem = document.createElement("div");
      pushItem.className = "push-item";
      if (push.type === "mirror" && push.application_name?.toLowerCase().includes("messaging")) {
        pushItem.classList.add("push-sms");
      } else if (push.type === "sms_changed") {
        pushItem.classList.add("push-sms");
      }
      if (push.created) {
        const timestamp = new Date(push.created * 1e3);
        const timeElement = document.createElement("div");
        timeElement.className = "push-time";
        timeElement.textContent = formatTimestamp(timestamp);
        pushItem.appendChild(timeElement);
      }
      if (title) {
        const titleEl = document.createElement("div");
        titleEl.className = "push-title";
        titleEl.textContent = title || "";
        pushItem.appendChild(titleEl);
      }
      if (url) {
        const urlEl = document.createElement("a");
        urlEl.href = url;
        urlEl.target = "_blank";
        urlEl.className = "push-url";
        urlEl.textContent = url || "";
        pushItem.appendChild(urlEl);
      }
      if (body) {
        const bodyEl = document.createElement("div");
        bodyEl.className = "push-body";
        bodyEl.textContent = body || "";
        pushItem.appendChild(bodyEl);
      }
      pushesList.appendChild(pushItem);
    });
  }
  function formatTimestamp(date) {
    const now = /* @__PURE__ */ new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1e3);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay > 0) {
      return `${diffDay}d ago`;
    } else if (diffHour > 0) {
      return `${diffHour}h ago`;
    } else if (diffMin > 0) {
      return `${diffMin}m ago`;
    } else {
      return "just now";
    }
  }
  function handleFileSelect(event) {
    const target = event.target;
    const file = target.files?.[0];
    if (file) {
      fileName.textContent = file.name;
      fileSize.textContent = formatFileSize(file.size);
      fileSelected.style.display = "block";
    } else {
      fileSelected.style.display = "none";
    }
  }
  function formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  }
  async function togglePushType(type) {
    currentPushType = type;
    pushTypeNoteBtn.classList.toggle("active", type === "note");
    pushTypeLinkBtn.classList.toggle("active", type === "link");
    pushTypeFileBtn.classList.toggle("active", type === "file");
    if (type === "note") {
      noteForm.style.display = "block";
      linkForm.style.display = "none";
      fileForm.style.display = "none";
    } else if (type === "link") {
      noteForm.style.display = "none";
      linkForm.style.display = "block";
      fileForm.style.display = "none";
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true
        });
        if (tabs[0]) {
          linkUrlInput.value = tabs[0].url ? tabs[0].url : "";
          linkTitleInput.value = tabs[0].title ? tabs[0].title : "";
        }
      } catch (error) {
        console.error("Error getting current tab info:", error);
      }
    } else if (type === "file") {
      noteForm.style.display = "none";
      linkForm.style.display = "none";
      fileForm.style.display = "block";
    }
  }
  async function sendPush() {
    logToBackground("INFO", "[sendPush] Function initiated.");
    try {
      const pushType = currentPushType;
      const targetDevice = targetDeviceSelect.value;
      logToBackground("INFO", `[sendPush] currentPushType is: '${pushType}'`);
      const pushData = {
        type: pushType
      };
      if (targetDevice !== "all") {
        pushData.device_iden = targetDevice;
      }
      if (pushType === "note") {
        logToBackground("INFO", '[sendPush] Handling "note" type.');
        pushData.title = noteTitleInput.value.trim();
        pushData.body = noteBodyInput.value.trim();
        if (!pushData.title && !pushData.body) {
          logToBackground(
            "WARN",
            "[sendPush] Exiting: Note title and body are empty."
          );
          showStatus("Please enter a title or body for the note.", "error");
          return;
        }
      } else if (pushType === "link") {
        logToBackground("INFO", '[sendPush] Handling "link" type.');
        pushData.title = linkTitleInput.value.trim();
        pushData.url = linkUrlInput.value.trim();
        pushData.body = linkBodyInput.value.trim();
        if (!pushData.url) {
          logToBackground("WARN", "[sendPush] Exiting: Link URL is empty.");
          showStatus("Please enter a URL for the link.", "error");
          return;
        }
      } else if (pushType === "file") {
        logToBackground("INFO", '[sendPush] Handling "file" type.');
        const file = fileInput.files?.[0];
        showStatus("Uploading file...", "info");
        try {
          if (!file) {
            logToBackground(
              "WARN",
              "[sendPush] Exiting: File type selected but no file is attached."
            );
            showStatus("Please select a file to attach.", "error");
            return;
          }
          const uploadApiKey = await storageRepository.getApiKey();
          if (!uploadApiKey) {
            logToBackground(
              "WARN",
              "[sendPush] Exiting: Cannot upload file, user is not logged in."
            );
            showStatus("Not logged in. Please log in first.", "error");
            return;
          }
          const uploadRequestResponse = await fetch(
            "https://api.pushbullet.com/v2/upload-request",
            {
              method: "POST",
              headers: {
                "Access-Token": uploadApiKey,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                file_name: file.name,
                file_type: file.type || "application/octet-stream"
              })
            }
          );
          if (!uploadRequestResponse.ok) {
            throw new Error("Failed to request file upload authorization");
          }
          const uploadData = await uploadRequestResponse.json();
          const formData = new FormData();
          Object.keys(uploadData.data).forEach((key) => {
            formData.append(key, uploadData.data[key]);
          });
          formData.append("file", file);
          const uploadResponse = await fetch(uploadData.upload_url, {
            method: "POST",
            body: formData
          });
          if (!uploadResponse.ok) {
            throw new Error("Failed to upload file to server");
          }
          pushData.type = "file";
          pushData.file_name = uploadData.file_name;
          pushData.file_type = uploadData.file_type;
          pushData.file_url = uploadData.file_url;
          pushData.body = document.getElementById("file-body").value.trim();
          showStatus("File uploaded, sending push...", "info");
        } catch (uploadError) {
          logToBackground("ERROR", "[sendPush] File upload error.", {
            error: uploadError.message
          });
          showStatus(
            "Failed to upload file: " + uploadError.message,
            "error"
          );
          return;
        }
      }
      logToBackground(
        "INFO",
        "[sendPush] Validation passed. Preparing to send message to background script.",
        pushData
      );
      chrome.runtime.sendMessage(
        {
          action: "sendPush" /* SEND_PUSH */,
          pushData
        },
        (response) => {
          if (chrome.runtime.lastError) {
            logToBackground(
              "ERROR",
              "[sendPush] Error sending message to background.",
              { error: chrome.runtime.lastError }
            );
            showStatus("Error: Could not send push", "error");
            return;
          }
          logToBackground(
            "INFO",
            "[sendPush] Received response from background script.",
            response
          );
          if (response.success) {
            clearPushForm();
            showStatus("Push sent successfully!", "success");
            chrome.runtime.sendMessage(
              { action: "getSessionData" /* GET_SESSION_DATA */ },
              (sessionResponse) => {
                if (sessionResponse && sessionResponse.recentPushes) {
                  displayPushes(sessionResponse.recentPushes);
                }
              }
            );
          } else {
            showStatus(
              `Error: ${response.error || "Failed to send push"}`,
              "error"
            );
          }
        }
      );
    } catch (error) {
      logToBackground("ERROR", "[sendPush] An unexpected error occurred.", {
        error: error.message
      });
      showStatus(
        `An unexpected error occurred: ${error.message}`,
        "error"
      );
    }
  }
  function clearPushForm() {
    noteTitleInput.value = "";
    noteBodyInput.value = "";
    linkTitleInput.value = "";
    linkUrlInput.value = "";
    linkBodyInput.value = "";
    fileInput.value = "";
    document.getElementById("file-body").value = "";
    fileSelected.style.display = "none";
  }
  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = type;
    setTimeout(() => {
      statusMessage.textContent = "";
      statusMessage.className = "";
    }, 3e3);
  }
  function logToBackground(level, message, data) {
    try {
      chrome.runtime.sendMessage({
        action: "log",
        payload: {
          level,
          message,
          data
        }
      });
    } catch (error) {
      const fallbackLog = `[FALLBACK] ${message}`;
      if (level === "ERROR") {
        console.error(fallbackLog, data, error);
      } else if (level === "WARN") {
        console.warn(fallbackLog, data);
      } else {
      }
    }
  }
  function scrollToRecentPushes() {
    const recentPushesSection = document.querySelector(".recent-pushes");
    if (recentPushesSection) {
      console.log("Scrolling to recent pushes section");
      recentPushesSection.scrollIntoView({
        behavior: "smooth"
      });
    }
  }
  chrome.runtime.onMessage.addListener((message, _, __) => {
    if (message.action === "connectionStateChanged" /* CONNECTION_STATE_CHANGED */) {
      console.log("Connection state changed:", message.state);
    } else if (message.action === "pushesUpdated" /* PUSHES_UPDATED */) {
      if (message.pushes) {
        displayPushes(message.pushes);
      }
    }
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
//# sourceMappingURL=popup.js.map
