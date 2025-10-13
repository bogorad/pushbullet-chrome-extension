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
} from "../app/session";
import { fetchDevices, updateDeviceNickname } from "../app/api/client";
import { ensureConfigLoaded } from "../app/reconnect";
import {
  checkPushTypeSupport,
  SUPPORTED_PUSH_TYPES,
} from "../app/push-types";
import { PushbulletCrypto } from "../lib/crypto";
import { storageRepository } from "../infrastructure/storage/storage.repository";
import { MessageAction } from "../types/domain";
import { globalEventBus } from "../lib/events/event-bus";
import { ServiceWorkerStateMachine, ServiceWorkerState } from "./state-machine";
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
  setupContextMenu,
  pushLink,
  pushNote,
  updateConnectionIcon,
} from "./utils";
import { autoOpenOfflineLinks } from "./links";
import { orchestrateInitialization } from "./startup";
import { runPostConnect } from "../realtime/postConnectQueue";
import { validatePrivilegedMessage } from "../lib/security/message-validation";
import { handleKeepaliveAlarm } from "./keepalive";
import type { Push } from "../types/domain";
import { isLinkPush } from "../types/domain";
import {
  saveSessionCache,
  clearSessionCache,
} from "../infrastructure/storage/indexed-db";

// Load debug configuration
debugConfigManager.loadConfig();

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
async function getApiKeyWithRetries(
  attempts = 3,
  delay = 100,
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const apiKey = await storageRepository.getApiKey();
      if (apiKey) {
        debugLogger.storage(
          "INFO",
          `API key found on attempt ${i + 1}/${attempts}`,
        );
        return apiKey;
      }
      // API key is null - could be genuinely missing or storage not ready yet
      debugLogger.storage(
        "DEBUG",
        `API key not found on attempt ${i + 1}/${attempts}, will retry`,
      );
    } catch (error) {
      debugLogger.storage(
        "WARN",
        `Error getting API key on attempt ${i + 1}/${attempts}`,
        null,
        error as Error,
      );
    }

    // Wait before the next attempt (but not after the last attempt)
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  debugLogger.storage(
    "WARN",
    `API key not found after ${attempts} retry attempts - assuming no key configured`,
  );
  return null;
}

// Initialize WebSocket client
let websocketClient: WebSocketClient | null = null;

// Register WebSocket event listeners ONCE at module load
// These should NOT be removed/re-registered on each connect
globalEventBus.on("websocket:tickle:push", async () => {
  try {
    await refreshPushes(notificationDataStore);
  } catch (error) {
    // NEW: Check if it's an invalid cursor error
    if ((error as Error).name === 'InvalidCursorError') {
      debugLogger.general('WARN', 'Caught invalid cursor error - triggering recovery');
      const apiKey = getApiKey();
      if (apiKey) {
        await handleInvalidCursorRecovery(apiKey, connectWebSocket);
      }
    } else {
      // Re-throw other errors
      debugLogger.general('ERROR', 'Error refreshing pushes', null, error as Error);
    }
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
        devices: devices,
        userInfo: sessionCache.userInfo,
        recentPushes: sessionCache.recentPushes,
        autoOpenLinks: sessionCache.autoOpenLinks,
        deviceNickname: sessionCache.deviceNickname,
      })
      .catch(() => {});
  }
});

globalEventBus.on("websocket:push", async (push: Push) => {
  // RACE CONDITION FIX: Ensure configuration is loaded before processing push
  await ensureConfigLoaded();

  // Track push received
  performanceMonitor.recordPushReceived();

  let decryptedPush = push;

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
          push as any,
          password,
          sessionCache.userInfo.iden,
        );

        decryptedPush = decrypted as Push;
        debugLogger.general("INFO", "Push decrypted successfully", {
          pushType: decryptedPush.type,
        });

        // ADD THIS - Full dump of decrypted data
        debugLogger.general("DEBUG", "FULL DECRYPTED PUSH DATA", {
          completeData: decryptedPush,
        });
      } else {
        debugLogger.general(
          "WARN",
          "Cannot decrypt push - no encryption password set",
        );
      }
    } catch (error) {
      debugLogger.general(
        "ERROR",
        "Failed to decrypt push",
        {
          error: (error as Error).message,
        },
        error as Error,
      );
    }
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
        // Include full push data for investigation
        fullPushData: decryptedPush,
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

  // ADD THIS - Dump for Mirror Messages
  if (decryptedPush.type === 'mirror') {
    // Log full mirror message data to see all available fields
    debugLogger.general("DEBUG", "FULL MIRROR MESSAGE DATA", {
      completeMirrorData: decryptedPush,
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
  showPushNotification(decryptedPush, notificationDataStore).catch(
    (error) => {
      debugLogger.general(
        "ERROR",
        "Failed to show notification",
        null,
        error,
      );
      performanceMonitor.recordNotificationFailed();
    },
  );

  // Auto-open links if setting is enabled
  const autoOpenLinks = getAutoOpenLinks();
  if (autoOpenLinks && isLinkPush(decryptedPush)) {
    debugLogger.general("INFO", "Auto-opening link push", {
      pushIden: decryptedPush.iden,
      url: decryptedPush.url,
    });

    chrome.tabs
      .create({
        url: decryptedPush.url,
        active: false, // Open in background to avoid disrupting user
      })
      .catch((error) => {
        debugLogger.general(
          "ERROR",
          "Failed to auto-open link",
          {
            url: decryptedPush.url,
          },
          error,
        );
      });
  }
});

globalEventBus.on("websocket:connected", async () => {
  debugLogger.websocket('INFO', 'WebSocket connected - checking for offline links to open');

  // MV3 LIFECYCLE TRACKING: Calculate and store recovery time
  const recoveryTime = Date.now() - recoveryTimerStart;
  debugLogger.performance("INFO", "WebSocket recovery time", {
    duration: recoveryTime,
  });
  const { recoveryTimings = [] } =
    await chrome.storage.local.get("recoveryTimings");
  recoveryTimings.push(recoveryTime);
  // Keep only the last 20 timings for averaging
  await chrome.storage.local.set({
    recoveryTimings: recoveryTimings.slice(-20),
  });

  // Trigger state machine transition
  stateMachine.transition("WS_CONNECTED");

  // Run post-connect tasks
  void runPostConnect();

  // Auto-open offline links if enabled
  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      debugLogger.general('WARN', 'No API key for auto-open links');
      return;
    }

    const sessionCutoff = sessionCache.lastModifiedCutoff || (await storageRepository.getLastModifiedCutoff()) || 0;
    await autoOpenOfflineLinks(apiKey, sessionCutoff);
  } catch (e) {
    debugLogger.general('ERROR', 'Auto-open on reconnect failed', { error: (e as Error).message });
  }
});

globalEventBus.on("websocket:disconnected", () => {
  // Trigger state machine transition
  stateMachine.transition("WS_DISCONNECTED");
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

// MV3 LIFECYCLE TRACKING: Recovery timer for measuring WebSocket reconnection time
let recoveryTimerStart: number = 0;

// Initialize State Machine
// ARCHITECTURAL CHANGE: Centralized lifecycle management
// All service worker state is now managed by the state machine
// STATE MACHINE HYDRATION: The state machine is created asynchronously to allow
// it to hydrate its state from storage, ensuring continuity across service worker restarts
let stateMachine: ServiceWorkerStateMachine;

// Define the callbacks once for reuse
const stateMachineCallbacks = {
  onInitialize: async (data: any) => {
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

  onStartPolling: () => {
    checkPollingMode();
  },
  onStopPolling: () => {
    stopPollingMode();
  },
  onShowError: (error: string) => {
    debugLogger.general("ERROR", "[StateMachine] Error state", { error });
    updateConnectionIcon("disconnected");
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

/**
 * Connect to WebSocket
 */
function connectWebSocket(): void {
  // Guard: Don't reconnect if already connected or connecting
  if (websocketClient) {
    const isConnected = websocketClient.isConnected();
    const isConnecting = websocketClient.getReadyState() === WebSocket.CONNECTING;

    if (isConnected || isConnecting) {
      debugLogger.websocket('DEBUG', 'WebSocket already connected/connecting, skipping duplicate call', {
        isConnected,
        isConnecting,
        readyState: websocketClient.getReadyState()
      });
      return; // EXIT EARLY - do not proceed
    }
  }

  // MV3 LIFECYCLE TRACKING: Start recovery timer
  recoveryTimerStart = Date.now();

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
    debugLogger.general("DEBUG", "Keepalive heartbeat");

    // Verify critical state integrity
    const apiKey = getApiKey();
    if (!apiKey) {
      debugLogger.general("WARN", "Keepalive: API key missing, reloading");
      await ensureConfigLoaded();
    }
    return;
  }

  if (alarm.name === "logFlush") {
    await debugLogger.flush();
    return;
  }

  // Ensure state machine is ready
  await stateMachineReady;

  // Handle our two main periodic alarms.
  if (alarm.name === "websocketHealthCheck") {
    // ADD THIS CHECK AT THE TOP
    if (stateMachine.isInState(ServiceWorkerState.ERROR)) {
      debugLogger.general("INFO", "In ERROR state, ignoring health check.");
      return;
    }

    await ensureConfigLoaded();
    // Check the current state first.
    if (stateMachine.isInState(ServiceWorkerState.DEGRADED)) {
      // Perform polling as fallback
      await performPollingFetch();

      // Check for escalation to ERROR state
      const failures =
        performanceMonitor.getQualityMetrics().consecutiveFailures;
      const FAILURE_THRESHOLD = 5; // Escalate after 5 consecutive failures (approx. 5 minutes)

      if (failures >= FAILURE_THRESHOLD) {
        // If we've failed too many times, escalate to ERROR and STOP.
        debugLogger.general(
          "ERROR",
          `Exceeded failure threshold (${failures} consecutive failures). Escalating to ERROR state.`,
        );
        await stateMachine.transition("WS_PERMANENT_ERROR");
      } else {
        // Only if we are NOT escalating to error, do we try to reconnect.
        debugLogger.general(
          "INFO",
          "Health check found us in DEGRADED state. Attempting to reconnect.",
        );
        // Tell the state machine to start the reconnect process.
        await stateMachine.transition("ATTEMPT_RECONNECT");
      }
    } else {
      // If we are not in DEGRADED, do the normal health check.
      performWebSocketHealthCheck(websocketClient, connectWebSocket);
    }
  }
});

/**
 * Context menu click handler
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // RACE CONDITION FIX: Ensure configuration is loaded before processing context menu action
  await ensureConfigLoaded();

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

  if (message.type === "GET_PUSH_DATA") {
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
    // SERVICE WORKER AMNESIA FIX: Check storage directly, not the in-memory variable
    // After service worker restart, in-memory variables are null, but storage persists.
    // This ensures we detect wake-ups reliably by using storage as the source of truth.
    (async () => {
      try {
        // RACE CONDITION FIX: Ensure configuration is loaded before processing
        await ensureConfigLoaded();

        // Check storage directly, not the in-memory variable
        const storedApiKey = await storageRepository.getApiKey();

        // Detect wake-up: if we have a key in storage but the session is not loaded in memory
        if (storedApiKey && !sessionCache.isAuthenticated) {
          debugLogger.general(
            "WARN",
            "Service worker wake-up detected - reloading session from storage.",
          );

          // Await the full initialization process
          await initializeSessionCache("onMessageWakeup", connectWebSocket, {
            setApiKey,
            setDeviceIden,
            setAutoOpenLinks,
            setNotificationTimeout,
            setDeviceNickname,
          });
        }

        // Now, respond with the (potentially restored) session data
        sendResponse({
          isAuthenticated: sessionCache.isAuthenticated,
          userInfo: sessionCache.userInfo,
          devices: sessionCache.devices,
          recentPushes: sessionCache.recentPushes,
          chats: sessionCache.chats || [], // ← ADD THIS
          autoOpenLinks: getAutoOpenLinks(),
          deviceNickname: getDeviceNickname(),
          websocketConnected: websocketClient
            ? websocketClient.isConnected()
            : false,
        });
      } catch (error) {
        debugLogger.general(
          "ERROR",
          "Error handling getSessionData after wake-up",
          null,
          error as Error,
        );
        sendResponse({
          isAuthenticated: false,
          error: (error as Error).message,
        });
      }
    })();

    return true; // Return true to indicate an asynchronous response.
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
          chats: sessionCache.chats || [], // ← ADD THIS
          autoOpenLinks: sessionCache.autoOpenLinks,
          deviceNickname: sessionCache.deviceNickname,
          websocketConnected: websocketClient
            ? websocketClient.isConnected()
            : false,
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
      await ensureConfigLoaded();

      const apiKey = getApiKey();
      if (apiKey) {
        refreshSessionCache(apiKey)
          .then(() => {
            sendResponse({
              isAuthenticated: true,
              userInfo: sessionCache.userInfo,
              devices: sessionCache.devices,
              recentPushes: sessionCache.recentPushes,
              chats: sessionCache.chats || [], // ← ADD THIS
              autoOpenLinks: sessionCache.autoOpenLinks,
              deviceNickname: sessionCache.deviceNickname,
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

    // BONUS FIX: Handle device nickname updates from "Save All Settings" button
    if (message.settings?.deviceNickname) {
      const newNickname = message.settings.deviceNickname;
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

    if (message.autoOpenLinks !== undefined) {
      setAutoOpenLinks(message.autoOpenLinks);
      sessionCache.autoOpenLinks = message.autoOpenLinks;
      promises.push(storageRepository.setAutoOpenLinks(message.autoOpenLinks));
    }

    if (message.notificationTimeout !== undefined) {
      setNotificationTimeout(message.notificationTimeout);
      promises.push(
        storageRepository.setNotificationTimeout(message.notificationTimeout),
      );
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
      await ensureConfigLoaded();

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
      const { restarts = 0, recoveryTimings = [] } =
        await chrome.storage.local.get(["restarts", "recoveryTimings"]);
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
        .catch((error: any) => {
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
  } else if (message.action === MessageAction.SEND_PUSH) {
    // Handle push sending from popup
    // SERVICE WORKER AMNESIA FIX: Ensure configuration is loaded before attempting to send push
    (async () => {
      try {
        // Ensure core configuration is loaded from storage if service worker just woke up
        await ensureConfigLoaded();

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

        // Send push via API
        const response = await fetch("https://api.pushbullet.com/v2/pushes", {
          method: "POST",
          headers: {
            "Access-Token": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(pushData),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = "Failed to send push";
          try {
            const errorData = JSON.parse(errorText) as {
              error?: { message?: string };
            };
            if (errorData.error?.message) {
              errorMessage = errorData.error.message;
            }
          } catch {
            // Use default
          }
          throw new Error(errorMessage);
        }

        // Refresh pushes after sending
        try {
          await refreshPushes(notificationDataStore);
        } catch (error) {
          // Check if it's an invalid cursor error
          if ((error as Error).name === 'InvalidCursorError') {
            debugLogger.general('WARN', 'Caught invalid cursor error during push send - triggering recovery');
            const apiKey = getApiKey();
            if (apiKey) {
              await handleInvalidCursorRecovery(apiKey, connectWebSocket);
            }
          } else {
            // Re-throw other errors
            debugLogger.general('ERROR', 'Error refreshing pushes after send', null, error as Error);
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
      type: 'popup',
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
        debugLogger.notifications("INFO", "Notification detail opened in popup", {
          notificationId,
          windowId: window?.id,
        });
      }
    },
  );

  // Clear the notification after opening
  chrome.notifications.clear(notificationId);
});

// Export debug info function for console access
(globalThis as any).exportDebugInfo = function () {
  return {
    debugLogs: debugLogger.exportLogs(),
    performanceData: performanceMonitor.exportPerformanceData(),
    websocketState: wsStateMonitor.getStateReport(),
    initializationData: initTracker.exportData(),
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
    websocketConnected: websocketClient ? websocketClient.isConnected() : false,
  };
};

debugLogger.general("INFO", "Background service worker initialized", {
  timestamp: new Date().toISOString(),
});

// Bootstrap initialization immediately on startup/install
async function bootstrap(trigger: 'startup' | 'install' | 'wakeup'): Promise<void> {
  debugLogger.general('INFO', 'Bootstrap start', { trigger });
  // Start session initialization right away
  void orchestrateInitialization({ trigger, connectWs: connectWebSocket });
}

chrome.runtime.onStartup.addListener(() => { void bootstrap('startup'); });
chrome.runtime.onInstalled.addListener(() => { void bootstrap('install'); });

// Optional: if you also track other wake-ups, funnel them here too
// chrome.alarms.onAlarm.addListener(a => {
//   if (a.name === 'keepAlive' || a.name === 'recovery') { void bootstrap('wakeup'); }
// });
