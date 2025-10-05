/**
 * Popup page - Full TypeScript implementation
 */

import type { Push, Device, UserInfo } from "../types/domain";
import {
  getElementById,
} from "../lib/ui/dom";
import { storageRepository } from "../infrastructure/storage/storage.repository";

// API URLs - MOSTLY REMOVED
// ARCHITECTURAL CHANGE: Popup no longer makes direct API calls
// All API communication is centralized in the background script
//
// EXCEPTION: File upload still requires direct API access because:
// - FormData cannot be serialized through chrome.runtime.sendMessage
// - File upload involves two steps: upload-request + S3 upload
// - The final push creation is still delegated to background
//
// Removed URLs (now handled by background):
// - USER_INFO_URL (user info fetched by background)
// - DEVICES_URL (devices fetched by background)
// - PUSHES_URL (pushes sent via background)
// - WEBSOCKET_URL (WebSocket managed by background)

// Type definitions
interface SessionData {
  isAuthenticated: boolean;
  devices: Device[];
  userInfo: UserInfo;
  recentPushes: Push[];
  autoOpenLinks: boolean;
  websocketConnected?: boolean;
  deviceNickname?: string;
}

type PushType = "note" | "link" | "file";

interface PushData {
  type: PushType;
  device_iden?: string;
  source_device_iden?: string;
  title?: string;
  body?: string;
  url?: string;
  file_name?: string;
  file_type?: string;
  file_url?: string;
}

interface UploadRequestResponse {
  file_name: string;
  file_type: string;
  file_url: string;
  upload_url: string;
  data: Record<string, string>;
}

// DOM elements
const loadingSection = getElementById<HTMLDivElement>("loading-section");
const loginSection = getElementById<HTMLDivElement>("login-section");
const mainSection = getElementById<HTMLDivElement>("main-section");
const apiKeyInput = getElementById<HTMLInputElement>("api-key");
const deviceNicknameInput = getElementById<HTMLInputElement>("device-nickname");
const saveApiKeyButton = getElementById<HTMLButtonElement>("save-api-key");
const logoutButton = getElementById<HTMLButtonElement>("logout");
const userImage = getElementById<HTMLImageElement>("user-image");
const userName = getElementById<HTMLSpanElement>("user-name");
// Connection indicator removed - using badge instead
const pushTypeNoteBtn = getElementById<HTMLButtonElement>("push-type-note");
const pushTypeLinkBtn = getElementById<HTMLButtonElement>("push-type-link");
const pushTypeFileBtn = getElementById<HTMLButtonElement>("push-type-file");
const noteForm = getElementById<HTMLDivElement>("note-form");
const linkForm = getElementById<HTMLDivElement>("link-form");
const fileForm = getElementById<HTMLDivElement>("file-form");
const fileInput = getElementById<HTMLInputElement>("file-input");
const fileSelected = getElementById<HTMLDivElement>("file-selected");
const fileName = getElementById<HTMLSpanElement>("file-name");
const fileSize = getElementById<HTMLSpanElement>("file-size");
const noteTitleInput = getElementById<HTMLInputElement>("note-title");
const noteBodyInput = getElementById<HTMLTextAreaElement>("note-body");
const linkTitleInput = getElementById<HTMLInputElement>("link-title");
const linkUrlInput = getElementById<HTMLInputElement>("link-url");
const linkBodyInput = getElementById<HTMLTextAreaElement>("link-body");
const targetDeviceSelect = getElementById<HTMLSelectElement>("target-device");
const sendPushButton = getElementById<HTMLButtonElement>("send-push");
const pushesList = getElementById<HTMLDivElement>("pushes-list");
const statusMessage = getElementById<HTMLDivElement>("status-message");
const openSettingsBtn = getElementById<HTMLButtonElement>("open-settings");
const openDebugDashboardBtn = getElementById<HTMLButtonElement>(
  "open-debug-dashboard",
);

// State variables
let deviceNickname = "Chrome";
const devices: Device[] = [];
let currentPushType: PushType = "note";
// websocket variable removed - background script manages the single WebSocket connection

/**
 * Initialize popup
 */
function init(): void {
  console.log("Popup initializing");
  setupEventListeners();
  checkStorageForApiKey();
}

/**
 * Initialize from session data (from background)
 */
async function initializeFromSessionData(response: SessionData): Promise<void> {
  if (!response.isAuthenticated) {
    showSection("login");
    return;
  }

  // Update device nickname
  if (response.deviceNickname) {
    deviceNickname = response.deviceNickname;
    console.log("Device nickname:", deviceNickname);
  }

  // Update user info
  if (response.userInfo) {
    updateUserInfo(response.userInfo);
  }

  // Populate device dropdown
  populateDeviceDropdown(response.devices);

  // Display pushes
  displayPushes(response.recentPushes);

  // Show main section
  showSection("main");

  // Connection status is now shown via badge icon (no UI indicator needed)
  // WebSocket connection is managed by background script - popup receives updates via chrome.runtime.onMessage

  hasInitialized = true;
}

/**
 * Check storage for API key and get session data from background
 * ARCHITECTURAL CHANGE: Popup no longer makes direct API calls.
 * All data is fetched from background script's session cache.
 */
function checkStorageForApiKey(): void {
  console.log("Requesting session data from background");
  showSection("loading");

  // Request session data from background script (single source of truth)
  chrome.runtime.sendMessage(
    { action: "getSessionData" },
    async (response: SessionData) => {
      if (chrome.runtime.lastError) {
        console.error("Error getting session data:", chrome.runtime.lastError);
        showSection("login");
        return;
      }

      if (response.isAuthenticated) {
        // Initialize from background's cached data
        await initializeFromSessionData(response);

        // Check if we should scroll to recent pushes
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
    },
  );
}

/**
 * Show section
 */
function showSection(section: "loading" | "login" | "main"): void {
  console.log("Showing section:", section);
  loadingSection.style.display = section === "loading" ? "flex" : "none";
  loginSection.style.display = section === "login" ? "block" : "none";
  mainSection.style.display = section === "main" ? "block" : "none";
}

/**
 * Set up event listeners
 */
function setupEventListeners(): void {
  // Save API key button
  saveApiKeyButton.addEventListener("click", saveApiKey);

  // API key input - save on Enter
  apiKeyInput.addEventListener("keyup", (event) => {
    if (event.key === "Enter") {
      saveApiKey();
    }
  });

  // Device nickname input - save on Enter
  deviceNicknameInput.addEventListener("keyup", (event) => {
    if (event.key === "Enter") {
      saveApiKey();
    }
  });

  // Logout button
  logoutButton.addEventListener("click", logout);

  // Push type buttons
  pushTypeNoteBtn.addEventListener("click", () => togglePushType("note"));
  pushTypeLinkBtn.addEventListener("click", () => togglePushType("link"));
  pushTypeFileBtn.addEventListener("click", () => togglePushType("file"));

  // File input
  fileInput.addEventListener("change", handleFileSelect);

  // Send push button
  sendPushButton.addEventListener("click", sendPush);

  // Open settings
  openSettingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Open debug dashboard
  openDebugDashboardBtn.addEventListener("click", () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL("debug-dashboard.html"),
    });
  });
}

/**
 * Save API key
 * ARCHITECTURAL CHANGE: Delegates API key validation to background script
 */
async function saveApiKey(): Promise<void> {
  const newApiKey = apiKeyInput.value.trim();
  const newNickname = deviceNicknameInput.value.trim() || "Chrome";

  if (!newApiKey) {
    showStatus("Please enter an Access Token.", "error");
    return;
  }

  showSection("loading");

  try {
    // Save to storage repository
    await storageRepository.setApiKey(newApiKey);
    await storageRepository.setDeviceNickname(newNickname);

    apiKey = newApiKey;
    deviceNickname = newNickname;

    // Notify background to validate and initialize
    // Background will respond AFTER initialization is complete (no setTimeout needed!)
    chrome.runtime.sendMessage(
      {
        action: "apiKeyChanged",
        apiKey: newApiKey,
        deviceNickname: newNickname,
      },
      (response: SessionData) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error notifying background:",
            chrome.runtime.lastError,
          );
          showStatus("Error: Could not connect to background script", "error");
          showSection("login");
          return;
        }

        // Response contains session data after background has completed initialization
        if (response.success === false) {
          showStatus(
            `Error: ${response.error || "Invalid Access Token"}`,
            "error",
          );
          showSection("login");
          return;
        }

        if (response.isAuthenticated) {
          initializeFromSessionData(response);
          hasInitialized = true;
        } else {
          showStatus("Invalid Access Token", "error");
          showSection("login");
        }
      },
    );
  } catch (error) {
    showStatus(`Error: ${(error as Error).message}`, "error");
    showSection("login");
  }
}

/**
 * Logout
 */
async function logout(): Promise<void> {
  // WebSocket disconnection is handled by background script
  await storageRepository.setApiKey(null);
  await storageRepository.setDeviceIden(null);
  apiKey = null;
  hasInitialized = false;

  // Notify background script to disconnect WebSocket
  chrome.runtime.sendMessage({ action: "logout" }).catch((error) => {
    console.warn("Could not notify background of logout:", error.message);
  });

  showSection("login");
  apiKeyInput.value = "";
  deviceNicknameInput.value = "";
}

/**
 * REMOVED: initializeAuthenticated()
 *
 * This function previously made direct API calls to fetch user info, devices, and pushes.
 * It has been removed as part of the architectural refactoring to centralize all API
 * communication in the background script.
 *
 * The popup now uses initializeFromSessionData() which receives data from the background
 * script's session cache via chrome.runtime.sendMessage({ action: 'getSessionData' }).
 */

/**
 * REMOVED: fetchUserInfo(), fetchDevices(), fetchRecentPushes()
 *
 * These functions previously made direct API calls to the Pushbullet API.
 * They have been removed as part of the architectural refactoring to centralize
 * all API communication in the background script.
 *
 * ARCHITECTURAL CHANGE:
 * - The popup is now a "dumb client" that only displays data
 * - All data comes from the background script's session cache
 * - The background script is the single source of truth for API state
 * - This eliminates redundant API calls every time the popup opens
 * - Improves efficiency and prevents state desynchronization
 *
 * Data flow:
 * 1. Popup opens → sends getSessionData message to background
 * 2. Background responds with cached session data
 * 3. Popup displays the data using initializeFromSessionData()
 * 4. Background proactively sends pushesUpdated when new data arrives
 */

/**
 * REMOVED: connectWebSocket() and disconnectWebSocket()
 *
 * The popup no longer maintains its own WebSocket connection.
 * The background service worker manages a single, persistent WebSocket connection
 * and sends push updates to the popup via chrome.runtime.sendMessage with action 'pushesUpdated'.
 *
 * This architectural change:
 * - Eliminates dual state (popup and background having separate connections)
 * - Reduces resource consumption (only one WebSocket connection)
 * - Ensures connection persists when popup is closed
 * - Makes background script the single source of truth for WebSocket state
 */

/**
 * Update user info
 */
function updateUserInfo(userInfo: UserInfo): void {
  userName.textContent = userInfo.name || userInfo.email;

  if (userInfo.image_url) {
    userImage.src = userInfo.image_url;
    userImage.style.display = "block";
  } else {
    userImage.style.display = "none";
  }
}

/**
 * Populate device dropdown
 */
function populateDeviceDropdown(devicesList: Device[]): void {
  const devicesToUse = devicesList || devices;

  // Clear existing options except 'All Devices'
  while (targetDeviceSelect.options.length > 1) {
    targetDeviceSelect.remove(1);
  }

  // Add devices
  devicesToUse.forEach((device) => {
    const option = document.createElement("option");
    option.value = device.iden;
    option.textContent = device.nickname || device.model || "Unknown Device";
    targetDeviceSelect.appendChild(option);
  });
}

/**
 * Display pushes
 */
function displayPushes(pushes: Push[]): void {
  pushesList.innerHTML = "";

  if (!pushes || pushes.length === 0) {
    pushesList.innerHTML = "<p>No recent pushes</p>";
    return;
  }

  // Show 10 most recent
  const recentPushes = pushes.slice(0, 10);

  recentPushes.forEach((push) => {
    let title = push.title;
    let body = push.body;
    const url = push.url;

    // Handle mirrored SMS notifications (check before generic sms_changed)
    // The application_name might vary between Android phones, so we check if it includes 'messaging'
    if (
      push.type === "mirror" &&
      push.application_name?.toLowerCase().includes("messaging")
    ) {
      title = `SMS: ${push.title}`;
      body = push.body || "";
      const pushItem = document.createElement("div");
      pushItem.className = "push-item";
      pushItem.classList.add("push-sms"); // Add visual indicator

      // Timestamp
      if (push.created) {
        const timestamp = new Date(push.created * 1000);
        const timeElement = document.createElement("div");
        timeElement.className = "push-time";
        timeElement.textContent = formatTimestamp(timestamp);
        pushItem.appendChild(timeElement);
      }

      // Title
      if (title) {
        const titleEl = document.createElement("div");
        titleEl.className = "push-title";
        titleEl.textContent = title;
        pushItem.appendChild(titleEl);
      }

      // Body
      if (body) {
        const bodyEl = document.createElement("div");
        bodyEl.className = "push-body";
        bodyEl.textContent = body;
        pushItem.appendChild(bodyEl);
      }

      pushesList.appendChild(pushItem);
      return; // Early return to avoid duplicate processing
    }

    // Handle legacy SMS pushes (fallback)
    if (
      push.type === "sms_changed" &&
      push.notifications &&
      push.notifications.length > 0
    ) {
      const sms = push.notifications[0];
      title = sms.title || "SMS";
      body = sms.body || "";
    }

    // Skip empty
    if (!title && !body && !url) {
      return;
    }

    const pushItem = document.createElement("div");
    pushItem.className = "push-item";

    // Add SMS badge
    if (push.type === "sms_changed") {
      pushItem.classList.add("push-sms");
    }

    // Timestamp
    if (push.created) {
      const timestamp = new Date(push.created * 1000);
      const timeElement = document.createElement("div");
      timeElement.className = "push-time";
      timeElement.textContent = formatTimestamp(timestamp);
      pushItem.appendChild(timeElement);
    }

    // Title
    if (title) {
      const titleEl = document.createElement("div");
      titleEl.className = "push-title";
      titleEl.textContent = title;
      pushItem.appendChild(titleEl);
    }

    // URL
    if (url) {
      const urlEl = document.createElement("a");
      urlEl.href = url;
      urlEl.target = "_blank";
      urlEl.className = "push-url";
      urlEl.textContent = url;
      pushItem.appendChild(urlEl);
    }

    // Body
    if (body) {
      const bodyEl = document.createElement("div");
      bodyEl.className = "push-body";
      bodyEl.textContent = body;
      pushItem.appendChild(bodyEl);
    }

    pushesList.appendChild(pushItem);
  });
}

/**
 * Format timestamp
 */
function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
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

/**
 * Handle file selection
 */
function handleFileSelect(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    fileSelected.style.display = "block";
  } else {
    fileSelected.style.display = "none";
  }
}

/**
 * Format file size
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

/**
 * Toggle push type
 */
async function togglePushType(type: PushType): Promise<void> {
  currentPushType = type;

  // Update buttons
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

    // Auto-populate with current tab
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
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

/**
 * Send push
 */
async function sendPush(): Promise<void> {
  logToBackground("INFO", "[sendPush] Function initiated.");

  try {
    const pushType = currentPushType;
    const targetDevice = targetDeviceSelect.value;

    logToBackground("INFO", `[sendPush] currentPushType is: '${pushType}'`);

    const pushData: PushData = {
      type: pushType,
    };

    // Set device target
    if (targetDevice !== "all") {
      pushData.device_iden = targetDevice;
    }

    // Set push data based on type
    if (pushType === "note") {
      logToBackground("INFO", '[sendPush] Handling "note" type.');
      pushData.title = noteTitleInput.value.trim();
      pushData.body = noteBodyInput.value.trim();

      if (!pushData.title && !pushData.body) {
        logToBackground(
          "WARN",
          "[sendPush] Exiting: Note title and body are empty.",
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
      if (!file) {
        logToBackground(
          "WARN",
          "[sendPush] Exiting: File type selected but no file is attached.",
        );
        showStatus("Please select a file to attach.", "error");
        return;
      }

      showStatus("Uploading file...", "info");

      try {
        const uploadApiKey = await storageRepository.getApiKey();
        if (!uploadApiKey) {
          logToBackground(
            "WARN",
            "[sendPush] Exiting: Cannot upload file, user is not logged in.",
          );
          showStatus("Not logged in. Please log in first.", "error");
          return;
        }

        // Request upload authorization
        const uploadRequestResponse = await fetch(
          "https://api.pushbullet.com/v2/upload-request",
          {
            method: "POST",
            headers: {
              "Access-Token": uploadApiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              file_name: file.name,
              file_type: file.type || "application/octet-stream",
            }),
          },
        );

        if (!uploadRequestResponse.ok) {
          throw new Error("Failed to request file upload authorization");
        }

        const uploadData =
          (await uploadRequestResponse.json()) as UploadRequestResponse;

        // Upload to S3
        const formData = new FormData();
        Object.keys(uploadData.data).forEach((key) => {
          formData.append(key, uploadData.data[key]);
        });
        formData.append("file", file);

        const uploadResponse = await fetch(uploadData.upload_url, {
          method: "POST",
          body: formData,
        });

        if (!uploadResponse.ok) {
          throw new Error("Failed to upload file to server");
        }

        // Create file push
        pushData.type = "file";
        pushData.file_name = uploadData.file_name;
        pushData.file_type = uploadData.file_type;
        pushData.file_url = uploadData.file_url;
        pushData.body = (
          document.getElementById("file-body") as HTMLTextAreaElement
        ).value.trim();

        showStatus("File uploaded, sending push...", "info");
      } catch (uploadError) {
        logToBackground("ERROR", "[sendPush] File upload error.", {
          error: (uploadError as Error).message,
        });
        showStatus(
          "Failed to upload file: " + (uploadError as Error).message,
          "error",
        );
        return;
      }
    }

    logToBackground(
      "INFO",
      "[sendPush] Validation passed. Preparing to send message to background script.",
      pushData,
    );

    // Send push via background script
    chrome.runtime.sendMessage(
      {
        action: "sendPush",
        pushData: pushData,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          logToBackground(
            "ERROR",
            "[sendPush] Error sending message to background.",
            { error: chrome.runtime.lastError },
          );
          showStatus("Error: Could not send push", "error");
          return;
        }

        logToBackground(
          "INFO",
          "[sendPush] Received response from background script.",
          response,
        );

        if (response.success) {
          clearPushForm();
          showStatus("Push sent successfully!", "success");
          chrome.runtime.sendMessage(
            { action: "getSessionData" },
            (sessionResponse: SessionData) => {
              if (sessionResponse && sessionResponse.recentPushes) {
                displayPushes(sessionResponse.recentPushes);
              }
            },
          );
        } else {
          showStatus(
            `Error: ${response.error || "Failed to send push"}`,
            "error",
          );
        }
      },
    );
  } catch (error) {
    logToBackground("ERROR", "[sendPush] An unexpected error occurred.", {
      error: (error as Error).message,
    });
    showStatus(
      `An unexpected error occurred: ${(error as Error).message}`,
      "error",
    );
  }
}

/**
 * Clear push form
 */
function clearPushForm(): void {
  noteTitleInput.value = "";
  noteBodyInput.value = "";
  linkTitleInput.value = "";
  linkUrlInput.value = "";
  linkBodyInput.value = "";
  fileInput.value = "";
  (document.getElementById("file-body") as HTMLTextAreaElement).value = "";
  fileSelected.style.display = "none";
}

/**
 * Show status message
 */
function showStatus(message: string, type: "success" | "error" | "info"): void {
  statusMessage.textContent = message;
  statusMessage.className = type;

  setTimeout(() => {
    statusMessage.textContent = "";
    statusMessage.className = "";
  }, 3000);
}

/**
 * Sends a log message to the background script for centralized logging.
 * Falls back to console.log if the background script is unreachable.
 * @param level The severity level of the log.
 * @param message The log message.
 * @param data Optional data to include with the log.
 */
function logToBackground(
  level: "INFO" | "WARN" | "ERROR",
  message: string,
  data?: unknown,
) {
  try {
    chrome.runtime.sendMessage({
      action: "log",
      payload: {
        level,
        message,
        data,
      },
    });
  } catch (error) {
    // Fallback to console if background is unavailable
    const fallbackLog = `[FALLBACK] ${message}`;
    if (level === "ERROR") {
      console.error(fallbackLog, data, error);
    } else if (level === "WARN") {
      console.warn(fallbackLog, data);
    } else {
      // We don't log INFO fallbacks to avoid noise if the background is just waking up.
    }
  }
}

/**
 * Scroll to recent pushes
 */
function scrollToRecentPushes(): void {
  const recentPushesSection = document.querySelector(".recent-pushes");
  if (recentPushesSection) {
    console.log("Scrolling to recent pushes section");
    recentPushesSection.scrollIntoView({
      behavior: "smooth",
    });
  }
}

/**
 * Update connection indicator
 * REMOVED: Connection indicator UI element removed, using badge instead
 */
// function updateConnectionIndicator() - REMOVED

/**
 * Listen for messages from background
 */
chrome.runtime.onMessage.addListener((message, _, __) => {
  if (message.action === "connectionStateChanged") {
    // Connection state changes now shown via badge icon only
    console.log("Connection state changed:", message.state);
  } else if (message.action === "pushesUpdated") {
    if (message.pushes) {
      displayPushes(message.pushes as Push[]);
    }
  }
});

// Initialize on DOM load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
