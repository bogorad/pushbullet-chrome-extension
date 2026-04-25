/**
 * Background Service Worker - Main Entry Point
 * Pushbullet Chrome Extension (Manifest V3)
 */

import {
  debugLogger,
  debugConfigManager,
  globalErrorTracker,
} from "../lib/logging";
import { performanceMonitor } from "../lib/perf";
import { initTracker, wsStateMonitor } from "../lib/monitoring";
import { WebSocketClient } from "../app/ws/client";
import {
  sessionCache,
  initializeSessionCache,
  refreshSessionCache,
  resetSessionCache,
  handleInvalidCursorRecovery,
  getInitPromise,
} from "../app/session";
import {
  fetchChats,
  fetchDevices,
  updateDeviceNickname,
  fetchRecentPushes,
  requestFileUpload,
  uploadFileToServer,
  sendFilePush,
  sendPush,
  PushbulletUploadError,
} from "../app/api/client";
import type { SendPushRequest } from "../app/api/client";
import { installDiagnosticsMessageHandler } from "./diagnostics";
import {
  ensureDebugConfigLoadedOnce,
  hydrateBackgroundConfig,
} from "./config";
import { createLifecycleCoordinator } from "./lifecycle";
import { checkPushTypeSupport, SUPPORTED_PUSH_TYPES } from "../app/push-types";
import { PushbulletCrypto } from "../lib/crypto";
import { storageRepository } from "../infrastructure/storage/storage.repository";
import { MessageAction } from "../types/domain";
import { globalEventBus } from "../lib/events/event-bus";
import {
  ServiceWorkerStateMachine,
  ServiceWorkerState,
  type InitializationTransitionPayload,
} from "./state-machine";
import {
  getApiKey,
  setApiKey,
  getDeviceIden,
  setDeviceIden,
  getDeviceNickname,
  setDeviceNickname,
  getAutoOpenLinks,
  setAutoOpenLinks,
  setNotificationTimeout,
  setWebSocketClient,
  WEBSOCKET_URL,
} from "./state";
import {
  refreshPushes,
  showPushNotification,
  checkPollingMode,
  stopPollingMode,
  performPollingFetch,
  performWebSocketHealthCheck,
  updatePopupConnectionState,
  pushLink,
  pushNote,
} from "./utils";
import { autoOpenOfflineLinks } from "./links";
import { orchestrateInitialization } from "./startup";
import { maybeAutoOpenLinkWithDismiss } from "./processing";
import { runPostConnect } from "../realtime/postConnectQueue";
import { validatePrivilegedMessage } from "../lib/security/message-validation";
import { handleKeepaliveAlarm } from "./keepalive";
import type {
  Push,
  PushBase,
  SessionDataResponse,
  StructuredUploadError,
  UploadAndSendFileMessage,
  UploadStage,
} from "../types/domain";
import { isLinkPush } from "../types/domain";
import {
  saveSessionCache,
  clearSessionCache,
} from "../infrastructure/storage/indexed-db";
import { summarizePushForLog } from "../app/push-summary";

const DEFAULT_FILE_TYPE = "application/octet-stream";
const MAX_FILE_NAME_LENGTH = 255;
const MAX_FILE_TYPE_LENGTH = 255;
const LONG_SLEEP_RECOVERY_ALARM = "longSleepRecovery";
const LONG_SLEEP_RECOVERY_PERIOD_MINUTES = 5;

function buildUploadError(
  code: string,
  stage: UploadStage,
  message: string,
  status?: number
): StructuredUploadError {
  return {
    code,
    stage,
    message,
    ...(status === undefined ? {} : { status }),
  };
}

function validateUploadMetadata(
  message: UploadAndSendFileMessage,
  maxUploadSize?: number
): { fileName: string; fileType: string; fileBytes: Uint8Array } {
  const fileName = typeof message.fileName === "string" ? message.fileName.trim() : "";
  const fileType = typeof message.fileType === "string" && message.fileType.trim()
    ? message.fileType.trim()
    : DEFAULT_FILE_TYPE;
  const fileSize = typeof message.fileSize === "number" ? message.fileSize : 0;

  if (!fileName) {
    throw buildUploadError(
      "invalid_file_name",
      "metadata",
      "File name is required.",
    );
  }

  if (fileName.length > MAX_FILE_NAME_LENGTH) {
    throw buildUploadError(
      "invalid_file_name",
      "metadata",
      "File name is too long.",
    );
  }

  if (fileType.length > MAX_FILE_TYPE_LENGTH) {
    throw buildUploadError(
      "invalid_file_type",
      "metadata",
      "File type is too long.",
    );
  }

  if (fileSize <= 0) {
    throw buildUploadError(
      "invalid_file",
      "metadata",
      "File data is required.",
    );
  }

  if (
    typeof maxUploadSize === "number" &&
    maxUploadSize > 0 &&
    fileSize > maxUploadSize
  ) {
    throw buildUploadError(
      "file_too_large",
      "metadata",
      "File exceeds the account upload limit.",
    );
  }

  if (typeof message.fileBase64 !== "string" || !message.fileBase64) {
    throw buildUploadError(
      "invalid_file",
      "metadata",
      "File data is required.",
    );
  }

  const fileBytes = decodeBase64File(message.fileBase64);
  if (fileBytes.byteLength !== fileSize) {
    throw buildUploadError(
      "invalid_file",
      "metadata",
      "File data did not match the declared size.",
    );
  }

  return {
    fileName,
    fileType,
    fileBytes,
  };
}

function decodeBase64File(fileBase64: string): Uint8Array {
  try {
    const binary = atob(fileBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw buildUploadError(
      "invalid_file",
      "metadata",
      "File data is not valid base64.",
    );
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function getAlarm(name: string): Promise<chrome.alarms.Alarm | undefined> {
  return new Promise((resolve) => {
    chrome.alarms.get(name, (alarm) => {
      resolve(alarm);
    });
  });
}

async function ensureLongSleepRecoveryAlarm(): Promise<void> {
  const alarm = await getAlarm(LONG_SLEEP_RECOVERY_ALARM);
  if (alarm) {
    return;
  }

  chrome.alarms.create(LONG_SLEEP_RECOVERY_ALARM, {
    periodInMinutes: LONG_SLEEP_RECOVERY_PERIOD_MINUTES,
  });
}

function isStructuredUploadError(error: unknown): error is StructuredUploadError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "stage" in error &&
    "message" in error
  );
}

function toStructuredUploadError(error: unknown): StructuredUploadError {
  if (isStructuredUploadError(error)) {
    return error;
  }

  if (error instanceof PushbulletUploadError) {
    return buildUploadError(
      error.code,
      error.stage,
      error.message,
      error.status,
    );
  }

  return buildUploadError(
    "upload_failed",
    "unknown",
    error instanceof Error ? error.message : "File upload failed.",
  );
}

// Store notification data for detail view
// SECURITY FIX (M-06): Limit store size to prevent memory leak
const notificationDataStore = new Map<string, Push>();
const MAX_NOTIFICATION_STORE_SIZE = 100;

/**
 * Add notification to store with size limit
 */
export function addToNotificationStore(id: string, push: Push): void {
  // Remove oldest entries if at capacity
  if (notificationDataStore.size >= MAX_NOTIFICATION_STORE_SIZE) {
    const firstKey = notificationDataStore.keys().next().value;
    if (firstKey) {
      notificationDataStore.delete(firstKey);
    }
  }
  notificationDataStore.set(id, push);
}

/**
 * Get notification store (for passing to utils)
 */
export function getNotificationStore(): Map<string, Push> {
  return notificationDataStore;
}

/**
 * Attempts to get the API key from storage with retries.
 *
 * RACE CONDITION FIX: The chrome.storage API can be transiently unavailable
 * immediately after a service worker restart, returning empty results even when
 * data exists. This function implements a retry mechanism to handle this MV3
 * lifecycle issue.
 *
 * @param attempts - Number of retry attempts (default: 3)
 * @param delay - Delay in milliseconds between attempts (default: 100)
 * @returns The API key string, or null if not found after all retries
 */

// Initialize WebSocket client
let websocketClient: WebSocketClient | null = null;

// READY promotion safety-net guard
let ranReconnectAutoOpen = false; // guard per reconnect [file:9]

async function promoteToReadyIfConnected() {
  if (!websocketClient?.isConnectionHealthy?.()) return;
  await stateMachineReady;
  const inRecovery =
    stateMachine.isInState(ServiceWorkerState.RECONNECTING) ||
    stateMachine.isInState(ServiceWorkerState.DEGRADED);
  if (inRecovery) {
    stateMachine.transition("WS_CONNECTED");
    void runPostConnect();
    void maybeRunReconnectAutoOpen();
  }
}

async function maybeRunReconnectAutoOpen() {
  if (ranReconnectAutoOpen) return; // idempotent per reconnect [file:9]
  ranReconnectAutoOpen = true; // set guard [file:9]
  const apiKey = getApiKey(); // must exist now [file:9]
  if (!apiKey) return; // safety [file:9]
  const storedCutoff = (await storageRepository.getLastModifiedCutoff()) ?? 0; // fetch persisted cutoff [file:9]
  const sessionCutoff = sessionCache.lastModifiedCutoff ?? storedCutoff; // choose best cutoff [file:9]
  try {
    await autoOpenOfflineLinks(apiKey, sessionCutoff); // open missed link pushes up to cap [file:9]
  } catch (e) {
    debugLogger.general("ERROR", "Auto-open on reconnect failed", {
      error: String(e),
    }); // log errors [file:9]
  }
}

// Register WebSocket event listeners ONCE at module load
// These should NOT be removed/re-registered on each connect
globalEventBus.on("websocket:tickle:push", async () => {
  try {
    await refreshPushes(notificationDataStore);
  } finally {
    await promoteToReadyIfConnected();
  }
});

globalEventBus.on("websocket:tickle:device", async () => {
  const apiKey = getApiKey();
  if (apiKey) {
    const devices = await fetchDevices(apiKey);
    sessionCache.devices = devices;
    sessionCache.lastUpdated = Date.now();

    chrome.runtime
      .sendMessage({
        action: MessageAction.SESSION_DATA_UPDATED,
        isAuthenticated: sessionCache.isAuthenticated,
        devices: devices,
        chats: sessionCache.chats,
        userInfo: sessionCache.userInfo,
        autoOpenLinks: sessionCache.autoOpenLinks,
        deviceNickname: sessionCache.deviceNickname,
      })
      .catch(() => {});
  }
});

globalEventBus.on("websocket:push", async (push: Push) => {
  // RACE CONDITION FIX: Ensure configuration is loaded before processing push
  await hydrateBackgroundConfig();

  // Track push received
  performanceMonitor.recordPushReceived();

  let decryptedPush: Push = push;
  let decryptionFailed = false;

  // Check if push is encrypted
  if ("encrypted" in push && push.encrypted && "ciphertext" in push) {
    try {
      // Get encryption password from storage repository
      const password = await storageRepository.getEncryptionPassword();

      if (password && sessionCache.userInfo) {
        debugLogger.general("INFO", "Decrypting encrypted push", {
          pushIden: push.iden,
        });

        const decrypted = await PushbulletCrypto.decryptPush(
          push,
          password,
          sessionCache.userInfo.iden,
        );

        decryptedPush = decrypted as Push;

        debugLogger.general("INFO", "Push decrypted successfully", {
          pushType: decryptedPush.type,
        });

        debugLogger.general("DEBUG", "Decrypted push summary", {
          push: summarizePushForLog(decryptedPush),
        });
      } else {
        debugLogger.general(
          "WARN",
          "Cannot decrypt push - no encryption password set",
        );
        decryptionFailed = true;
      }
    } catch (error) {
      debugLogger.general(
        "ERROR",
        "Failed to decrypt push",
        { error: (error as Error).message },
        error as Error,
      );
      decryptionFailed = true;
    }
  }

  // ✅ FIX: Skip type checking if decryption failed
  // For encrypted pushes, we can't check type until after decryption
  if (decryptionFailed) {
    debugLogger.general(
      "WARN",
      "Skipping encrypted push due to decryption failure",
      {
        pushIden: push.iden,
        hasEncryptionPassword:
          !!(await storageRepository.getEncryptionPassword()),
      },
    );
    return; // Exit early - can't process without decrypting
  }

  // ✅ FIX: Verify type field exists after decryption
  const pushWithOptionalType = decryptedPush as PushBase & { type?: Push['type'] };
  if (!pushWithOptionalType.type) {
    debugLogger.general("ERROR", "Push has no type field after decryption", {
      pushIden: pushWithOptionalType.iden,
      pushSummary: summarizePushForLog(decryptedPush),
    });
    return;
  }

  // --- FILTERING LOGIC: Only process supported push types ---
  const typeCheck = checkPushTypeSupport(decryptedPush.type);

  if (!typeCheck.supported) {
    // Log unsupported push types as WARNING for visibility
    if (typeCheck.category === "known-unsupported") {
      debugLogger.general("WARN", "Received known unsupported push type", {
        pushType: decryptedPush.type,
        pushIden: decryptedPush.iden,
        category: typeCheck.category,
        reason: "This push type is not supported by the extension",
        supportedTypes: SUPPORTED_PUSH_TYPES,
      });
    } else if (typeCheck.category === "unknown") {
      debugLogger.general("WARN", "Received unknown push type", {
        pushType: decryptedPush.type,
        pushIden: decryptedPush.iden,
        category: typeCheck.category,
        reason: "This is a new or unrecognized push type",
        supportedTypes: SUPPORTED_PUSH_TYPES,
        pushSummary: summarizePushForLog(decryptedPush),
      });
    }

    // Exit early - don't process unsupported pushes
    return;
  }

  // If we reach here, the push is supported and should be processed
  debugLogger.general("INFO", "Processing supported push type", {
    pushType: decryptedPush.type,
    pushIden: decryptedPush.iden,
  });

  if (decryptedPush.type === "mirror") {
    debugLogger.general("DEBUG", "Mirror push summary", {
      push: summarizePushForLog(decryptedPush),
    });
  }

  // Update cache (prepend)
  if (sessionCache.recentPushes) {
    sessionCache.recentPushes.unshift(decryptedPush);
    // Save the updated cache (with the new push) to our database.
    saveSessionCache(sessionCache);
    sessionCache.lastUpdated = Date.now();

    chrome.runtime
      .sendMessage({
        action: MessageAction.PUSHES_UPDATED,
        pushes: sessionCache.recentPushes,
      })
      .catch(() => {});
  }

  // FIX: Don't await - let notifications show immediately without blocking
  // This allows multiple notifications to appear concurrently
  showPushNotification(decryptedPush, notificationDataStore).catch((error) => {
    debugLogger.general("ERROR", "Failed to show notification", null, error);
    performanceMonitor.recordNotificationFailed();
  });

  // Auto-open links if setting is enabled
  const autoOpenLinks = getAutoOpenLinks();
  if (autoOpenLinks && isLinkPush(decryptedPush)) {
    await maybeAutoOpenLinkWithDismiss({
      iden: decryptedPush.iden,
      type: decryptedPush.type,
      url: decryptedPush.url,
      created: decryptedPush.created,
    });
  }

  await promoteToReadyIfConnected();
});

// If you already emit a generic event for all WS messages, use it:
globalEventBus.on("websocket:message", async () => {
  await promoteToReadyIfConnected(); // READY promotion safety-net [file:9]
});

globalEventBus.on("websocket:connected", async () => {
  debugLogger.websocket(
    "INFO",
    "WebSocket connected - post-connect tasks starting",
  );
  await stateMachineReady;
  stateMachine.transition("WS_CONNECTED");
  void runPostConnect();
  void maybeRunReconnectAutoOpen();
});

globalEventBus.on("websocket:disconnected", async () => {
  await stateMachineReady;
  stateMachine.transition("WS_DISCONNECTED");
});

globalEventBus.on("websocket:permanent-error", async () => {
  await stateMachineReady;
  stateMachine.transition("WS_PERMANENT_ERROR");
});

globalEventBus.on("websocket:polling:check", () => {
  checkPollingMode();
});

globalEventBus.on("websocket:polling:stop", () => {
  stopPollingMode();
});

globalEventBus.on("websocket:state", (state: string) => {
  updatePopupConnectionState(state);
});

globalEventBus.on("state:enter:reconnecting", () => {
  ranReconnectAutoOpen = false;
});

// Initialize State Machine
// ARCHITECTURAL CHANGE: Centralized lifecycle management
// All service worker state is now managed by the state machine
// STATE MACHINE HYDRATION: The state machine is created asynchronously to allow
// it to hydrate its state from storage, ensuring continuity across service worker restarts
let stateMachine: ServiceWorkerStateMachine;

// Define the callbacks once for reuse
const stateMachineCallbacks = {
  onInitialize: async (data?: InitializationTransitionPayload) => {
    // Initialize session cache
    const apiKey = data?.apiKey || getApiKey();
    if (apiKey) {
      // Pass connectWebSocket so it can be called upon successful initialization
      await initializeSessionCache("state-machine", connectWebSocket, {
        setApiKey,
        setDeviceIden,
        setAutoOpenLinks,
        setNotificationTimeout,
        setDeviceNickname,
      });
    }
  },

  onConnectWebSocket: () => {
    connectWebSocket();
  },

  onStartPolling: () => {
    checkPollingMode();
  },
  onStopPolling: () => {
    stopPollingMode();
  },
  onShowError: (error: string) => {
    debugLogger.general("ERROR", "[StateMachine] Error state", { error });
  },
  onClearData: async () => {
    // Clear session cache to initial state
    resetSessionCache();
  },
  onDisconnectWebSocket: () => {
    disconnectWebSocket();
  },
};

// Create a promise that resolves when the state machine is ready
// This ensures startup listeners wait for hydration to complete before attempting transitions
const stateMachineReady = ServiceWorkerStateMachine.create(
  stateMachineCallbacks,
).then((sm) => {
  stateMachine = sm;
  debugLogger.general(
    "INFO",
    "[Background] State machine initialized and ready",
    {
      currentState: stateMachine.getCurrentState(),
    },
  );
});

const { bootstrap, reconcileWake } = createLifecycleCoordinator({
  hydrateConfig: hydrateBackgroundConfig,
  stateMachineReady,
  getStateMachine: () => stateMachine,
  getApiKey,
  getDeviceIden,
  getAutoOpenLinks,
  getDeviceNickname,
  isSocketHealthy: () =>
    !!websocketClient?.isConnected?.() &&
    !!websocketClient?.isConnectionHealthy?.(),
});

type PopupSessionDataResponse = SessionDataResponse & { state: string };

async function getPopupRecentPushes(): Promise<Push[]> {
  const onlyThisDevice = await storageRepository.getOnlyThisDevice() || false;
  const deviceIden = await storageRepository.getDeviceIden();

  if (!onlyThisDevice || !deviceIden) {
    return sessionCache.recentPushes ?? [];
  }

  return (sessionCache.recentPushes ?? []).filter(
    (push) => push.target_device_iden === deviceIden,
  );
}

async function buildSessionDataResponse(
  apiKey: string | null,
): Promise<PopupSessionDataResponse> {
  const filteredPushes = await getPopupRecentPushes();

  debugLogger.general('INFO', 'Recent pushes filtered for display', {
    total: sessionCache.recentPushes?.length ?? 0,
    filtered: filteredPushes.length,
  });

  return {
    isAuthenticated: !!apiKey,
    userInfo: sessionCache.userInfo,
    devices: sessionCache.devices,
    recentPushes: filteredPushes,
    chats: sessionCache.chats,
    autoOpenLinks: getAutoOpenLinks(),
    deviceNickname: getDeviceNickname(),
    websocketConnected: websocketClient
      ? websocketClient.isConnected()
      : false,
    state: stateMachine.getCurrentState(),
  };
}

async function refreshPopupTargetsInBackground(apiKey: string): Promise<void> {
  debugLogger.general("INFO", "Refreshing popup targets in background");

  const [devicesResult, chatsResult] = await Promise.allSettled([
    fetchDevices(apiKey),
    fetchChats(apiKey),
  ]);
  let refreshed = false;

  if (devicesResult.status === "fulfilled") {
    sessionCache.devices = devicesResult.value;
    refreshed = true;
  } else {
    debugLogger.general("WARN", "Failed to refresh devices for popup", {
      error: (devicesResult.reason as Error).message,
    });
  }

  if (chatsResult.status === "fulfilled") {
    sessionCache.chats = chatsResult.value;
    refreshed = true;
  } else {
    debugLogger.general("WARN", "Failed to refresh chats for popup", {
      error: (chatsResult.reason as Error).message,
    });
  }

  if (!refreshed) {
    return;
  }

  sessionCache.lastUpdated = Date.now();

  chrome.runtime
    .sendMessage({
      action: MessageAction.SESSION_DATA_UPDATED,
      ...(await buildSessionDataResponse(apiKey)),
    })
    .catch(() => {
      debugLogger.general(
        "DEBUG",
        "Popup not available for background target refresh",
      );
    });
}

// Install diagnostics message handler
installDiagnosticsMessageHandler();

/**
 * Connect to WebSocket
 */
function connectWebSocket(): void {
  // Guard: Don't reconnect if already connected or connecting
  if (websocketClient) {
    const isConnected = websocketClient.isConnected();
    const isConnecting =
      websocketClient.getReadyState() === WebSocket.CONNECTING;

    if (isConnected || isConnecting) {
      debugLogger.websocket(
        "DEBUG",
        "WebSocket already connected/connecting, skipping duplicate call",
        {
          isConnected,
          isConnecting,
          readyState: websocketClient.getReadyState(),
        },
      );
      return; // EXIT EARLY - do not proceed
    }
  }

  // SECURITY FIX (H-02): Dispose existing socket before creating new one
  if (websocketClient) {
    debugLogger.websocket(
      "INFO",
      "Disposing existing WebSocket before reconnecting",
    );
    websocketClient.disconnect();
    websocketClient = null;
  }

  websocketClient = new WebSocketClient(WEBSOCKET_URL, getApiKey);
  setWebSocketClient(websocketClient);

  websocketClient.connect();
}

/**
 * Disconnect WebSocket
 */
function disconnectWebSocket(): void {
  if (websocketClient) {
    websocketClient.disconnect();
  }
}

// ============================================================================
// Chrome Event Listeners
// ============================================================================

/**
 * Alarm listener
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Handle critical keepalive FIRST
  if (handleKeepaliveAlarm(alarm)) {
    return; // Handled by keepalive utility
  }

  if (alarm.name === "keepalive") {
    // Minimal work to prevent termination
    debugLogger.general("DEBUG", "Keepalive heartbeat"); // existing [file:9]
    if (websocketClient?.isConnectionHealthy?.()) {
      await stateMachineReady;
      const notReady = !stateMachine.isInState(ServiceWorkerState.READY);
      if (notReady) {
        stateMachine.transition("WS_CONNECTED");
        void runPostConnect();
        void maybeRunReconnectAutoOpen();
      }
    }

    // Verify critical state integrity
    const apiKey = getApiKey();
    if (!apiKey) {
      debugLogger.general("WARN", "Keepalive: API key missing, reloading");
      await hydrateBackgroundConfig();
    }
    return;
  }

  if (alarm.name === "logFlush") {
    await debugLogger.flush();
    return;
  }

  // NEW: Handle auto-recovery from ERROR state
  if (alarm.name === "auto-recovery-from-error") {
    debugLogger.general(
      "INFO",
      "[Alarm] Auto-recovery timer fired, attempting to reconnect",
    );

    await reconcileWake("auto-recovery-from-error");
  }

  // Ensure state machine is ready
  await stateMachineReady;

  if (alarm.name === LONG_SLEEP_RECOVERY_ALARM) {
    debugLogger.general("INFO", "[Alarm] Long sleep recovery triggered");
    await reconcileWake(LONG_SLEEP_RECOVERY_ALARM);
    return;
  }

  // Handle our two main periodic alarms.
  if (alarm.name === "websocketHealthCheck") {
    await reconcileWake("websocketHealthCheck");
    const currentState = stateMachine.getCurrentState();

    debugLogger.general(
      "DEBUG",
      "[Alarm] Health check alarm fired",
      {
        currentState,
        hasWebSocketClient: !!websocketClient,
      },
    );

    if (stateMachine.isInState(ServiceWorkerState.DEGRADED)) {
      // Degraded mode: use polling fallback
      await performPollingFetch();

      // Check if we should escalate
      const consecutiveFailures =
        performanceMonitor.getQualityMetrics().consecutiveFailures;
      if (consecutiveFailures >= 3) {
        debugLogger.general(
          "WARN",
          "[Degraded] Too many failures, escalating to ERROR",
        );
        await stateMachine.transition("WS_PERMANENT_ERROR");
      } else {
        // Try to reconnect WebSocket
        await stateMachine.transition("ATTEMPT_RECONNECT");
      }
    } else if (stateMachine.isInState(ServiceWorkerState.IDLE)) {
      // NEW: Handle orphaned IDLE state
      const apiKey = getApiKey();
      if (apiKey) {
        debugLogger.general(
          "WARN",
          "[Alarm] Health check found IDLE state with API key - attempting recovery",
        );
        await stateMachine.transition("ATTEMPT_RECONNECT", {
          hasApiKey: true,
        });
      } else {
        debugLogger.general(
          "DEBUG",
          "[Alarm] IDLE state without API key - nothing to do",
        );
      }
    } else {
      // Normal state: perform health check
      performWebSocketHealthCheck(websocketClient, connectWebSocket, stateMachine);
    }
  }
});

/**
 * Context menu click handler
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // RACE CONDITION FIX: Ensure configuration is loaded before processing context menu action
  await hydrateBackgroundConfig();

  if (!getApiKey()) {
    chrome.notifications.create("pushbullet-no-api-key", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Pushbullet",
      message: "Please set your API key in the extension popup",
    });
    return;
  }

  switch (info.menuItemId) {
  case "push-link":
    if (info.linkUrl && tab) {
      pushLink(info.linkUrl, tab.title);
    }
    break;
  case "push-page":
    if (tab && tab.url) {
      pushLink(tab.url, tab.title);
    }
    break;
  case "push-selection":
    if (info.selectionText && tab) {
      pushNote("Selection from " + (tab.title || "page"), info.selectionText);
    }
    break;
  case "push-image":
    if (info.srcUrl && tab) {
      pushLink(info.srcUrl, "Image from " + (tab.title || "page"));
    }
    break;
  }
});

/**
 * Message listener for popup communication
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // SECURITY FIX (C-04): Validate sender for privileged actions
  // Prevents external extensions/pages from sending privileged messages
  if (!validatePrivilegedMessage(message.action, sender)) {
    debugLogger.general(
      "ERROR",
      "Rejected privileged message from untrusted sender",
      {
        action: message.action,
        senderId: sender?.id,
        senderUrl: sender?.url,
      },
    );
    sendResponse({ success: false, error: "Unauthorized" });
    return false;
  } else if (message.action === MessageAction.LOG) {
    // Handler for centralized logging from other scripts (e.g., popup)
    if (message.payload) {
      const { level, message: logMessage, data } = message.payload;
      const prefix = "[POPUP]"; // Add a prefix to identify the source

      switch (level) {
      case "ERROR":
        debugLogger.general("ERROR", `${prefix} ${logMessage}`, data);
        break;
      case "WARN":
        debugLogger.general("WARN", `${prefix} ${logMessage}`, data);
        break;
      case "INFO":
      default:
        debugLogger.general("INFO", `${prefix} ${logMessage}`, data);
        break;
      }
    }
    // Return false because we are not sending a response asynchronously.
    return false;
  }

  // Log the message (skip debug dashboard auto-refresh spam)
  if (message.action !== MessageAction.GET_DEBUG_SUMMARY) {
    debugLogger.general("DEBUG", "Message received", {
      type: message.type,
      action: message.action,
      sender: sender.id,
    });
  }

  if (message.action === MessageAction.GET_PUSH_DATA) {
    debugLogger.general("DEBUG", "GET_PUSH_DATA request received", {
      notificationId: message.notificationId,
    });

    const push = notificationDataStore.get(message.notificationId);

    if (push) {
      debugLogger.general("DEBUG", "Push data found", {
        notificationId: message.notificationId,
        pushType: push.type,
      });

      sendResponse({ success: true, push });
    } else {
      debugLogger.general("WARN", "Push data not found", {
        notificationId: message.notificationId,
        storeSize: notificationDataStore.size,
      });

      sendResponse({ success: false, error: "Push data not found" });
    }

    return true; // IMPORTANT: Keep channel open
  }

  if (message.action === MessageAction.GET_SESSION_DATA) {
    (async () => {
      try {
        // Ensure debug config is loaded
        await ensureDebugConfigLoadedOnce();
        // STEP 1: Load config from storage (handles service worker restarts)
        await reconcileWake("popup-open");

        // STEP 2: Get API key after config is loaded
        const apiKey = getApiKey();

        // STEP 3: CRITICAL - Detect service worker wake-up
        // If we have an API key in storage but session cache is empty, we need to re-initialize
        const isWakeUp = apiKey && !sessionCache.isAuthenticated;

        if (isWakeUp) {
          debugLogger.general(
            "INFO",
            "Service worker wake-up detected - checking for cached data",
            { timestamp: new Date().toISOString() },
          );

          // *** CRITICAL: Check if an init is already running ***
          const existingInit = getInitPromise();

          if (existingInit) {
            debugLogger.general(
              "INFO",
              "Initialization already in progress (likely from startup), awaiting completion",
              { source: "getSessionData" },
            );

            try {
              await existingInit;
              debugLogger.general(
                "INFO",
                "Awaited startup initialization successfully",
              );
            } catch (error) {
              debugLogger.general(
                "ERROR",
                "Startup initialization failed, popup will retry",
                null,
                error as Error,
              );
              // Fall through to call orchestrateInitialization below
            }
          }

          // *** USE ORCHESTRATE INITIALIZATION (has IndexedDB hydration) ***
          if (!sessionCache.isAuthenticated) {
            await orchestrateInitialization("popup-open", connectWebSocket);
          }
        }

        // STEP 4: Now check if we need to lazy-load recent pushes
        // (This only applies if we didn't just do a full re-initialization)
        const shouldFetchPushes =
          !isWakeUp &&
          apiKey &&
          (!sessionCache.recentPushes ||
            sessionCache.recentPushes.length === 0);

        if (shouldFetchPushes) {
          debugLogger.general(
            "INFO",
            "Popup opened - fetching recent pushes on-demand",
          );

          const pushes = await fetchRecentPushes(apiKey);
          sessionCache.recentPushes = pushes;
          sessionCache.lastUpdated = Date.now();

          debugLogger.general("INFO", "Recent pushes fetched on-demand", {
            count: pushes.length,
          });
        } else if (!isWakeUp) {
          debugLogger.general("DEBUG", "Popup opened - using cached pushes", {
            count: sessionCache.recentPushes?.length ?? 0,
          });
        }

        // STEP 5: Send cached session data before device/chat network refresh.
        sendResponse(await buildSessionDataResponse(apiKey));

        if (apiKey) {
          void refreshPopupTargetsInBackground(apiKey);
        }
      } catch (error) {
        debugLogger.general("ERROR", "Failed to handle GETSESSIONDATA", {
          error: (error as Error).message,
        });

        sendResponse({
          isAuthenticated: false,
          userInfo: null,
          devices: [],
          recentPushes: [],
          chats: [],
          autoOpenLinks: false,
          deviceNickname: "",
          websocketConnected: false,
          state: stateMachine.getCurrentState(),
        });
      }
    })();

    return true; // Keep channel open for async response
  } else if (message.action === MessageAction.API_KEY_CHANGED) {
    // Update API key
    setApiKey(message.apiKey);

    // Build promise chain
    let savePromise = storageRepository.setApiKey(message.apiKey);

    // Update device nickname if provided
    if (message.deviceNickname) {
      savePromise = savePromise.then(() => {
        setDeviceNickname(message.deviceNickname);
        sessionCache.deviceNickname = message.deviceNickname as string;
        return storageRepository.setDeviceNickname(
          message.deviceNickname as string,
        );
      });
    }

    // ARCHITECTURAL CHANGE: Use state machine instead of direct initialization
    // STATE MACHINE HYDRATION: Ensure state machine is ready before using it
    savePromise
      .then(() => stateMachineReady)
      .then(() => {
        return stateMachine.transition("API_KEY_SET", {
          apiKey: message.apiKey,
        });
      })
      .then(() => {
        // Send response with session data after state machine completes
        sendResponse({
          isAuthenticated:
            stateMachine.isInState(ServiceWorkerState.READY) ||
            stateMachine.isInState(ServiceWorkerState.DEGRADED),
          userInfo: sessionCache.userInfo,
          devices: sessionCache.devices,
          recentPushes: sessionCache.recentPushes,
          chats: sessionCache.chats || [],
          autoOpenLinks: sessionCache.autoOpenLinks,
          deviceNickname: sessionCache.deviceNickname,
          websocketConnected: websocketClient
            ? websocketClient.isConnected()
            : false,
          state: stateMachine.getCurrentState(),
        });
      })
      .catch((error) => {
        debugLogger.general("ERROR", "Error saving API key", null, error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // Keep message channel open for async response
  } else if (message.action === MessageAction.LOGOUT) {
    // ARCHITECTURAL CHANGE: Use state machine for logout
    // STATE MACHINE HYDRATION: Ensure state machine is ready before using it
    stateMachineReady
      .then(() => {
        return stateMachine.transition("LOGOUT");
      })
      .then(() => {
        // Clear storage via repository
        return storageRepository.setApiKey(null);
      })
      .then(() => {
        return storageRepository.setDeviceIden(null);
      })
      .then(() => {
        return clearSessionCache();
      })
      .then(() => {
        performanceMonitor.reset();
      })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        debugLogger.general("ERROR", "Error during logout", null, error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // Async response
  } else if (message.action === MessageAction.REFRESH_SESSION) {
    // RACE CONDITION FIX: Ensure configuration is loaded before processing
    (async () => {
      await ensureDebugConfigLoadedOnce();
      await hydrateBackgroundConfig();

      const apiKey = getApiKey();
      if (apiKey) {
        refreshSessionCache(apiKey)
          .then(() => {
            sendResponse({
              isAuthenticated: true,
              userInfo: sessionCache.userInfo,
              devices: sessionCache.devices,
              recentPushes: sessionCache.recentPushes,
              chats: sessionCache.chats || [],
              autoOpenLinks: sessionCache.autoOpenLinks,
              deviceNickname: sessionCache.deviceNickname,
              state: stateMachine.getCurrentState(),
            });
          })
          .catch((error) => {
            debugLogger.general(
              "ERROR",
              "Error refreshing session",
              null,
              error,
            );
            sendResponse({ isAuthenticated: false });
          });
      } else {
        sendResponse({ isAuthenticated: false });
      }
    })();

    return true; // Async response
  } else if (message.action === MessageAction.SETTINGS_CHANGED) {
    const promises: Promise<void>[] = [];
    const settings = message.settings ?? message;

    if (settings.deviceNickname) {
      const newNickname = settings.deviceNickname;
      const apiKey = getApiKey();
      const deviceIden = getDeviceIden();

      // Trigger API update if we have the required credentials
      if (apiKey && deviceIden) {
        promises.push(
          updateDeviceNickname(apiKey, deviceIden, newNickname).then(() => {
            // Only update state and storage after API success
            setDeviceNickname(newNickname);
            sessionCache.deviceNickname = newNickname;
            return storageRepository.setDeviceNickname(newNickname);
          }),
        );
      } else {
        // No API credentials, just update local state and storage
        setDeviceNickname(newNickname);
        sessionCache.deviceNickname = newNickname;
        promises.push(storageRepository.setDeviceNickname(newNickname));
      }
    }

    if (settings.autoOpenLinks !== undefined) {
      setAutoOpenLinks(settings.autoOpenLinks);
      sessionCache.autoOpenLinks = settings.autoOpenLinks;
      promises.push(storageRepository.setAutoOpenLinks(settings.autoOpenLinks));
    }

    if (settings.notificationTimeout !== undefined) {
      setNotificationTimeout(settings.notificationTimeout);
      promises.push(
        storageRepository.setNotificationTimeout(settings.notificationTimeout),
      );
    }

    if (settings.onlyThisDevice !== undefined) {
      sessionCache.onlyThisDevice = settings.onlyThisDevice;
      promises.push(storageRepository.setOnlyThisDevice(settings.onlyThisDevice));
    }

    Promise.all(promises)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        debugLogger.general("ERROR", "Error saving settings", null, error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // Async response
  } else if (message.action === MessageAction.UPDATE_DEVICE_NICKNAME) {
    // RACE CONDITION FIX: Ensure configuration is loaded before processing
    (async () => {
      await ensureDebugConfigLoadedOnce();
      await hydrateBackgroundConfig();

      const apiKey = getApiKey();
      const deviceIden = getDeviceIden();

      if (apiKey && deviceIden && message.nickname) {
        updateDeviceNickname(apiKey, deviceIden, message.nickname)
          .then(async () => {
            setDeviceNickname(message.nickname);
            sessionCache.deviceNickname = message.nickname;
            await storageRepository.setDeviceNickname(message.nickname);

            sendResponse({ success: true });
          })
          .catch((error) => {
            debugLogger.general(
              "ERROR",
              "Error updating device nickname",
              null,
              error,
            );
            sendResponse({ success: false, error: error.message });
          });
      } else {
        sendResponse({ success: false, error: "Missing required parameters" });
      }
    })();

    return true; // Async response
  } else if (message.action === MessageAction.GET_DEBUG_SUMMARY) {
    // Return debug summary for debug dashboard
    (async () => {
      // STATE MACHINE HYDRATION: Ensure state machine is ready before using it
      await stateMachineReady;

      const logData = debugLogger.exportLogs();
      const wsState = wsStateMonitor.getStateReport();
      const perfData = performanceMonitor.exportPerformanceData();
      const perfSummary = perfData.summary;

      // Format websocket state for dashboard compatibility
      const websocketState = {
        current: {
          stateText: websocketClient
            ? websocketClient.isConnected()
              ? "Connected"
              : "Disconnected"
            : "Not initialized",
          readyState: wsState.currentState,
          stateMachineState: stateMachine.getCurrentState(),
          stateMachineDescription: stateMachine.getStateDescription(),
        },
        lastCheck: wsState.lastCheck,
        historyLength: wsState.historyLength,
      };

      // Map performance data to match frontend expectations
      // The frontend expects: { websocket, qualityMetrics, notifications }
      // The backend provides: { summary: { websocket, health, quality, metrics, notifications } }
      const performanceForDashboard = {
        websocket: perfSummary.websocket,
        qualityMetrics: {
          // Map health checks
          healthChecksPassed: perfSummary.health?.success || 0,
          healthChecksFailed: perfSummary.health?.failure || 0,
          // Map quality metrics
          disconnectionCount: perfSummary.quality?.disconnections || 0,
          consecutiveFailures: perfSummary.quality?.consecutiveFailures || 0,
          // These metrics don't exist in the backend yet, so they'll be undefined
          averageLatency: undefined,
          minLatency: undefined,
          maxLatency: undefined,
          connectionUptime: 0,
          currentUptime: 0,
        },
        notifications: perfSummary.notifications,
      };

      // MV3 LIFECYCLE TRACKING: Gather metrics for dashboard
      const lifecycleMetrics = await chrome.storage.local.get([
        "restarts",
        "recoveryTimings",
      ]);
      const restarts =
        typeof lifecycleMetrics.restarts === "number"
          ? lifecycleMetrics.restarts
          : 0;
      const recoveryTimings = Array.isArray(lifecycleMetrics.recoveryTimings)
        ? lifecycleMetrics.recoveryTimings.filter(
          (value): value is number => typeof value === "number",
        )
        : [];
      const avgRecoveryTime =
        recoveryTimings.length > 0
          ? recoveryTimings.reduce((a: number, b: number) => a + b, 0) /
            recoveryTimings.length
          : 0;

      const mv3LifecycleStats = {
        restarts: restarts,
        wakeUpTriggers: initTracker.exportData().stats, // We already track this!
        avgRecoveryTime: avgRecoveryTime.toFixed(0) + " ms",
        // Add more stats like downtime here in the future
      };

      const summary = {
        config: debugConfigManager.getConfig(),
        logs: logData.logs, // Array of log entries
        totalLogs: logData.summary.totalLogs,
        performance: performanceForDashboard,
        websocketState: websocketState,
        initializationStats: initTracker.exportData(),
        mv3LifecycleStats: mv3LifecycleStats, // Add the new data object
        errors: {
          total: logData.summary.errors,
          last24h: logData.summary.errors, // Add last24h for dashboard
          critical: [],
        },
      };

      sendResponse({ success: true, summary });
    })();

    return true; // Async response
  } else if (message.action === MessageAction.CLEAR_ALL_LOGS) {
    // Clear all logs from memory and persistent storage
    debugLogger.clearLogs().then(() => {
      sendResponse({ success: true });
    });
    return true; // Async response
  } else if (message.action === MessageAction.UPDATE_DEBUG_CONFIG) {
    // Update debug configuration
    if (message.config) {
      debugConfigManager
        .updateConfig(message.config)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error: Error) => {
          debugLogger.general(
            "ERROR",
            "Failed to update debug config",
            null,
            error,
          );
          sendResponse({ success: false, error: error.message });
        });
    } else {
      sendResponse({ success: false, error: "No config provided" });
    }
    return true; // Async response
  } else if (message.action === MessageAction.EXPORT_DEBUG_DATA) {
    // This handler gathers all debug data for exporting
    debugLogger.general("INFO", "Exporting full debug data");

    // STATE MACHINE HYDRATION: Ensure state machine is ready before using it
    (async () => {
      await ensureDebugConfigLoadedOnce();
      await stateMachineReady;

      const logData = debugLogger.exportLogs();
      const errorSummary = globalErrorTracker.getErrorSummary();

      const dataToExport = {
        timestamp: new Date().toISOString(),
        version: chrome.runtime.getManifest().version,
        debugLogs: logData,
        performanceData: performanceMonitor.exportPerformanceData(),
        systemInfo: {
          websocketState: wsStateMonitor.getStateReport(),
          initializationData: initTracker.exportData(),
          stateMachine: {
            currentState: stateMachine.getCurrentState(),
            description: stateMachine.getStateDescription(),
          },
        },
        errorData: {
          summary: errorSummary,
          recent: globalErrorTracker.exportErrorData().errors,
        },
        sessionCache: {
          isAuthenticated: sessionCache.isAuthenticated,
          lastUpdated: sessionCache.lastUpdated
            ? new Date(sessionCache.lastUpdated).toISOString()
            : "never",
          userInfo: sessionCache.userInfo
            ? { email: sessionCache.userInfo.email?.substring(0, 3) + "***" }
            : null,
          deviceCount: sessionCache.devices?.length || 0,
          pushCount: sessionCache.recentPushes?.length || 0,
        },
      };

      sendResponse({ success: true, data: dataToExport });
    })();

    return true; // Async response
  } else if (message.action === MessageAction.GET_NOTIFICATION_DATA) {
    // Return notification data for detail view
    const pushData = notificationDataStore.get(message.notificationId);
    if (pushData) {
      sendResponse({ success: true, push: pushData });
    } else {
      sendResponse({ success: false, error: "Notification not found" });
    }
    return false; // Synchronous response
  } else if (message.action === MessageAction.ATTEMPT_RECONNECT) {
    debugLogger.general("INFO", "Manual reconnection requested from popup");

    (async () => {
      await reconcileWake("manual-attemptReconnect");
      sendResponse({ success: true });
    })();

    return true; // Async response
  } else if (message.action === MessageAction.UPLOAD_AND_SEND_FILE) {
    (async () => {
      try {
        await ensureDebugConfigLoadedOnce();
        await hydrateBackgroundConfig();

        const apiKey = getApiKey();
        if (!apiKey) {
          sendResponse({
            success: false,
            error: buildUploadError(
              "not_authenticated",
              "metadata",
              "Not logged in. Please try again.",
            ),
          });
          return;
        }

        const uploadMessage = message as UploadAndSendFileMessage;
        const { fileName, fileType, fileBytes } = validateUploadMetadata(
          uploadMessage,
          sessionCache.userInfo?.max_upload_size,
        );

        const uploadData = await requestFileUpload(apiKey, fileName, fileType);
        await uploadFileToServer(
          uploadData,
          new Blob([toArrayBuffer(fileBytes)], { type: fileType }),
        );
        await sendFilePush(apiKey, {
          file_name: uploadData.file_name,
          file_type: uploadData.file_type,
          file_url: uploadData.file_url,
          body: uploadMessage.body?.trim() || undefined,
          device_iden: uploadMessage.device_iden,
          email: uploadMessage.email,
          source_device_iden: uploadMessage.source_device_iden,
        });

        try {
          await refreshPushes(notificationDataStore);
        } catch (error) {
          if ((error as Error).name === "InvalidCursorError") {
            debugLogger.general(
              "WARN",
              "Caught invalid cursor error during file push send - triggering recovery",
            );
            await handleInvalidCursorRecovery(apiKey, connectWebSocket);
          } else {
            debugLogger.general(
              "ERROR",
              "Error refreshing pushes after file send",
              null,
              error as Error,
            );
          }
        }

        sendResponse({ success: true });
      } catch (error) {
        const structuredError = toStructuredUploadError(error);
        debugLogger.general(
          "ERROR",
          "Failed to upload and send file",
          {
            code: structuredError.code,
            stage: structuredError.stage,
            status: structuredError.status,
          },
          error instanceof Error ? error : undefined,
        );
        sendResponse({ success: false, error: structuredError });
      }
    })();

    return true;
  } else if (message.action === MessageAction.SEND_PUSH) {
    // Handle push sending from popup
    // SERVICE WORKER AMNESIA FIX: Ensure configuration is loaded before attempting to send push
    (async () => {
      try {
        await ensureDebugConfigLoadedOnce();
        // Ensure core configuration is loaded from storage if service worker just woke up
        await hydrateBackgroundConfig();

        const apiKey = getApiKey();
        if (!apiKey) {
          sendResponse({
            success: false,
            error: "Not logged in. Please try again.",
          });
          return;
        }

        const pushData = message.pushData;
        if (!pushData || !pushData.type) {
          sendResponse({ success: false, error: "Invalid push data" });
          return;
        }

        await sendPush(apiKey, pushData as SendPushRequest);

        // Refresh pushes after sending
        try {
          await refreshPushes(notificationDataStore);
        } catch (error) {
          // Check if it's an invalid cursor error
          if ((error as Error).name === "InvalidCursorError") {
            debugLogger.general(
              "WARN",
              "Caught invalid cursor error during push send - triggering recovery",
            );
            const apiKey = getApiKey();
            if (apiKey) {
              await handleInvalidCursorRecovery(apiKey, connectWebSocket);
            }
          } else {
            // Re-throw other errors
            debugLogger.general(
              "ERROR",
              "Error refreshing pushes after send",
              null,
              error as Error,
            );
          }
        }

        sendResponse({ success: true });
      } catch (error) {
        debugLogger.general(
          "ERROR",
          "Failed to send push",
          { pushType: message.pushData?.type },
          error as Error,
        );
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();

    return true; // Async response
  }

  return false;
});

// Notification clicked handler
chrome.notifications.onClicked.addListener((notificationId: string) => {
  debugLogger.notifications("INFO", "Notification clicked", {
    notificationId,
  });

  // Get the push data from the notification store
  const push = notificationDataStore.get(notificationId);

  if (!push) {
    debugLogger.notifications(
      "WARN",
      "No push data found for clicked notification",
      {
        notificationId,
      },
    );
    return;
  }

  // Open notification detail page in a popup window
  const detailUrl = chrome.runtime.getURL(
    `notification-detail.html?id=${encodeURIComponent(notificationId)}`,
  );

  chrome.windows.create(
    {
      url: detailUrl,
      type: "popup",
      width: 500,
      height: 600,
      focused: true,
    },
    (window) => {
      if (chrome.runtime.lastError) {
        debugLogger.notifications(
          "ERROR",
          "Failed to open notification detail",
          {
            notificationId,
            error: chrome.runtime.lastError.message,
          },
        );
      } else {
        debugLogger.notifications(
          "INFO",
          "Notification detail opened in popup",
          {
            notificationId,
            windowId: window?.id,
          },
        );
      }
    },
  );

  // Clear the notification after opening
  chrome.notifications.clear(notificationId);
});

debugLogger.general("INFO", "Background service worker initialized", {
  timestamp: new Date().toISOString(),
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDebugConfigLoadedOnce();
  await ensureLongSleepRecoveryAlarm();
  void bootstrap("startup");
  setTimeout(checkExtensionHealth, 5000); // Wait 5 seconds after startup
});

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDebugConfigLoadedOnce();
  await ensureLongSleepRecoveryAlarm();
  void bootstrap("install");
});

// Diagnostic function to check extension health
async function checkExtensionHealth(): Promise<void> {
  const apiKey = getApiKey();
  const currentState = stateMachine.getCurrentState();
  const isConnected = websocketClient?.isConnected() ?? false;

  debugLogger.general(
    "INFO",
    "[Diagnostic] Extension health check",
    {
      hasApiKey: !!apiKey,
      currentState,
      isConnected,
      hasWebSocketClient: !!websocketClient,
      sessionAuthenticated: sessionCache.isAuthenticated,
      lastUpdated: sessionCache.lastUpdated
        ? new Date(sessionCache.lastUpdated).toISOString()
        : "never",
    },
  );

  // Check for inconsistent state
  if (
    apiKey &&
    currentState === ServiceWorkerState.IDLE &&
    !isConnected
  ) {
    debugLogger.general(
      "ERROR",
      "[Diagnostic] INCONSISTENT STATE DETECTED: Have API key but in IDLE state without connection",
    );
    return;
  }

  if (!apiKey && currentState !== ServiceWorkerState.IDLE) {
    debugLogger.general(
      "ERROR",
      "[Diagnostic] INCONSISTENT STATE DETECTED: No API key but not in IDLE state",
    );
    return;
  }

  debugLogger.general(
    "INFO",
    "[Diagnostic] Extension state is consistent",
  );
}

export { stateMachine };
