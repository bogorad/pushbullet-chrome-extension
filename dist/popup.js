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

  // src/popup/index.ts
  var USER_INFO_URL = "https://api.pushbullet.com/v2/users/me";
  var DEVICES_URL = "https://api.pushbullet.com/v2/devices";
  var PUSHES_URL = "https://api.pushbullet.com/v2/pushes";
  var WEBSOCKET_URL = "wss://stream.pushbullet.com/websocket/";
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
  var openDebugDashboardBtn = getElementById("open-debug-dashboard");
  var apiKey = null;
  var deviceNickname = "Chrome";
  var devices = [];
  var hasInitialized = false;
  var currentPushType = "note";
  var websocket = null;
  function init() {
    console.log("Popup initializing");
    setupEventListeners();
    checkStorageForApiKey();
  }
  function checkStorageForApiKey() {
    console.log("Checking storage for API key");
    showSection("loading");
    const syncPromise = chrome.storage.sync.get(["apiKey", "autoOpenLinks", "deviceNickname"]);
    const localPromise = chrome.storage.local.get(["scrollToRecentPushes"]);
    Promise.all([syncPromise, localPromise]).then(
      async ([syncResult, localResult]) => {
        const result = { ...syncResult, ...localResult };
        if (result.apiKey) {
          apiKey = result.apiKey;
          if (result.autoOpenLinks !== void 0) {
            console.log("Auto-open links setting:", result.autoOpenLinks);
          }
          if (result.deviceNickname) {
            deviceNickname = result.deviceNickname;
            console.log("Device nickname:", deviceNickname);
          }
          try {
            await initializeAuthenticated();
            showSection("main");
            hasInitialized = true;
            if (result.scrollToRecentPushes) {
              chrome.storage.local.remove(["scrollToRecentPushes"]);
              setTimeout(() => {
                scrollToRecentPushes();
              }, 100);
            }
          } catch (error) {
            console.error("Error initializing:", error);
            showSection("login");
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
      const response = await fetch(USER_INFO_URL, {
        headers: {
          "Access-Token": newApiKey
        }
      });
      if (!response.ok) {
        throw new Error("Invalid Access Token");
      }
      await chrome.storage.sync.set({
        apiKey: newApiKey,
        deviceNickname: newNickname
      });
      apiKey = newApiKey;
      deviceNickname = newNickname;
      chrome.runtime.sendMessage({
        action: "apiKeyChanged",
        apiKey: newApiKey,
        deviceNickname: newNickname
      });
      await initializeAuthenticated();
      showSection("main");
      hasInitialized = true;
    } catch (error) {
      showStatus(`Error: ${error.message}`, "error");
      showSection("login");
    }
  }
  function logout() {
    disconnectWebSocket();
    chrome.storage.sync.remove(["apiKey"]);
    chrome.storage.local.remove(["deviceIden"]);
    apiKey = null;
    hasInitialized = false;
    showSection("login");
    apiKeyInput.value = "";
    deviceNicknameInput.value = "";
  }
  async function initializeAuthenticated() {
    try {
      const userInfo = await fetchUserInfo();
      devices = await fetchDevices();
      populateDeviceDropdown(devices);
      const pushes = await fetchRecentPushes();
      displayPushes(pushes);
      updateUserInfo(userInfo);
      connectWebSocket();
      return true;
    } catch (error) {
      console.error("Error in initializeAuthenticated:", error);
      throw error;
    }
  }
  async function fetchUserInfo() {
    if (!apiKey) throw new Error("No API key");
    const response = await fetch(USER_INFO_URL, {
      headers: {
        "Access-Token": apiKey
      }
    });
    if (!response.ok) {
      throw new Error("Failed to fetch user info");
    }
    return response.json();
  }
  async function fetchDevices() {
    if (!apiKey) throw new Error("No API key");
    const response = await fetch(DEVICES_URL, {
      headers: {
        "Access-Token": apiKey
      }
    });
    if (!response.ok) {
      throw new Error("Failed to fetch devices");
    }
    const data = await response.json();
    return data.devices.filter((device) => device.active);
  }
  async function fetchRecentPushes() {
    if (!apiKey) throw new Error("No API key");
    const response = await fetch(`${PUSHES_URL}?limit=20`, {
      headers: {
        "Access-Token": apiKey
      }
    });
    if (!response.ok) {
      throw new Error("Failed to fetch pushes");
    }
    const data = await response.json();
    let deviceIden = null;
    try {
      const deviceResult = await chrome.storage.local.get(["deviceIden"]);
      deviceIden = deviceResult.deviceIden;
    } catch (error) {
      console.error("Error getting device iden:", error);
    }
    return data.pushes.filter((push) => {
      const hasContent = push.title || push.body || push.url;
      return hasContent && !push.dismissed;
    });
  }
  function connectWebSocket() {
    disconnectWebSocket();
    if (!apiKey) return;
    try {
      const wsUrl = WEBSOCKET_URL + apiKey;
      websocket = new WebSocket(wsUrl);
      websocket.onopen = () => {
        console.log("Connected to Pushbullet WebSocket from popup");
      };
      websocket.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log("WebSocket message received in popup:", data);
        switch (data.type) {
          case "tickle":
            if (data.subtype === "push") {
              console.log("Push tickle received in popup, fetching latest pushes");
              const pushes = await fetchRecentPushes();
              displayPushes(pushes);
            }
            break;
          case "push":
            if (data.push) {
              console.log("Push message received directly in popup:", data.push);
              const pushes = await fetchRecentPushes();
              displayPushes(pushes);
            }
            break;
        }
      };
      websocket.onerror = (error) => {
        console.error("WebSocket error in popup:", error);
      };
      websocket.onclose = () => {
        console.log("Disconnected from Pushbullet WebSocket in popup");
        setTimeout(() => {
          if (apiKey && hasInitialized) {
            connectWebSocket();
          }
        }, 5e3);
      };
    } catch (error) {
      console.error("Error connecting to WebSocket from popup:", error);
    }
  }
  function disconnectWebSocket() {
    if (websocket) {
      websocket.close();
      websocket = null;
    }
  }
  function updateUserInfo(userInfo) {
    userName.textContent = userInfo.name || userInfo.email;
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
      let title = push.title;
      let body = push.body;
      let url = push.url;
      if (push.type === "sms_changed" && push.notifications && push.notifications.length > 0) {
        const sms = push.notifications[0];
        title = sms.title || "SMS";
        body = sms.body || "";
      }
      if (!title && !body && !url) {
        return;
      }
      const pushItem = document.createElement("div");
      pushItem.className = "push-item";
      if (push.type === "sms_changed") {
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
        titleEl.textContent = title;
        pushItem.appendChild(titleEl);
      }
      if (url) {
        const urlEl = document.createElement("a");
        urlEl.href = url;
        urlEl.target = "_blank";
        urlEl.className = "push-url";
        urlEl.textContent = url;
        pushItem.appendChild(urlEl);
      }
      if (body) {
        const bodyEl = document.createElement("div");
        bodyEl.className = "push-body";
        bodyEl.textContent = body;
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
          linkUrlInput.value = tabs[0].url || "";
          linkTitleInput.value = tabs[0].title || "";
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
    if (!apiKey) return;
    try {
      const pushType = currentPushType;
      const targetDevice = targetDeviceSelect.value;
      const pushData = {
        type: pushType
      };
      if (targetDevice !== "all") {
        pushData.device_iden = targetDevice;
      }
      try {
        const deviceResult = await chrome.storage.local.get(["deviceIden"]);
        if (deviceResult.deviceIden) {
          pushData.source_device_iden = deviceResult.deviceIden;
        }
      } catch (error) {
        console.error("Error getting device iden:", error);
      }
      if (pushType === "note") {
        pushData.title = noteTitleInput.value.trim();
        pushData.body = noteBodyInput.value.trim();
        if (!pushData.title && !pushData.body) {
          showStatus("Please enter a title or body for the note.", "error");
          return;
        }
      } else if (pushType === "link") {
        pushData.title = linkTitleInput.value.trim();
        pushData.url = linkUrlInput.value.trim();
        pushData.body = linkBodyInput.value.trim();
        if (!pushData.url) {
          showStatus("Please enter a URL for the link.", "error");
          return;
        }
      } else if (pushType === "file") {
        const file = fileInput.files?.[0];
        if (!file) {
          showStatus("Please select a file to attach.", "error");
          return;
        }
        showStatus("Uploading file...", "info");
        try {
          const uploadRequestResponse = await fetch("https://api.pushbullet.com/v2/upload-request", {
            method: "POST",
            headers: {
              "Access-Token": apiKey,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              file_name: file.name,
              file_type: file.type || "application/octet-stream"
            })
          });
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
          console.error("File upload error:", uploadError);
          showStatus("Failed to upload file: " + uploadError.message, "error");
          return;
        }
      }
      console.log("Sending push:", pushData);
      const response = await fetch(PUSHES_URL, {
        method: "POST",
        headers: {
          "Access-Token": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(pushData)
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Push failed:", response.status, errorText);
        let errorMessage = "Failed to send push";
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch {
        }
        throw new Error(errorMessage);
      }
      clearPushForm();
      showStatus("Push sent successfully!", "success");
      const pushes = await fetchRecentPushes();
      displayPushes(pushes);
    } catch (error) {
      showStatus(`Error: ${error.message}`, "error");
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
  function scrollToRecentPushes() {
    const recentPushesSection = document.querySelector(".recent-pushes");
    if (recentPushesSection) {
      console.log("Scrolling to recent pushes section");
      recentPushesSection.scrollIntoView({
        behavior: "smooth"
      });
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "connectionStateChanged") {
      console.log("Connection state changed:", message.state);
    } else if (message.action === "pushesUpdated") {
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
