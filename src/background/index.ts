/**
 * Background Service Worker - Main Entry Point
 * Pushbullet Chrome Extension (Manifest V3)
 */

import { debugLogger, debugConfigManager, globalErrorTracker } from '../lib/logging';
import { performanceMonitor } from '../lib/perf';
import { initTracker, wsStateMonitor } from '../lib/monitoring';
import { WebSocketClient } from '../app/ws/client';
import { sessionCache, initializeSessionCache, refreshSessionCache, initializationState, getInitPromise } from '../app/session';
import { fetchDevices, updateDeviceNickname } from '../app/api/client';
import { ensureConfigLoaded } from '../app/reconnect';
import { PushbulletCrypto } from '../lib/crypto';
import { storageRepository } from '../infrastructure/storage/storage.repository';
import { globalEventBus } from '../lib/events/event-bus';
import { ServiceWorkerStateMachine, ServiceWorkerState } from './state-machine';
import {
  getApiKey,
  setApiKey,
  getDeviceIden,
  setDeviceIden,
  getDeviceNickname,
  setDeviceNickname,
  getAutoOpenLinks,
  setAutoOpenLinks,
  getNotificationTimeout,
  setNotificationTimeout,
  setWebSocketClient,
  WEBSOCKET_URL
} from './state';
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
  updateExtensionTooltip
} from './utils';
import { validatePrivilegedMessage } from '../lib/security/message-validation';
import type { Push } from '../types/domain';
import { isLinkPush } from '../types/domain';

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
async function getApiKeyWithRetries(attempts = 3, delay = 100): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const apiKey = await storageRepository.getApiKey();
      if (apiKey) {
        debugLogger.storage('INFO', `API key found on attempt ${i + 1}/${attempts}`);
        return apiKey;
      }
      // API key is null - could be genuinely missing or storage not ready yet
      debugLogger.storage('DEBUG', `API key not found on attempt ${i + 1}/${attempts}, will retry`);
    } catch (error) {
      debugLogger.storage('WARN', `Error getting API key on attempt ${i + 1}/${attempts}`, null, error as Error);
    }

    // Wait before the next attempt (but not after the last attempt)
    if (i < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  debugLogger.storage('WARN', `API key not found after ${attempts} retry attempts - assuming no key configured`);
  return null;
}

// Initialize WebSocket client
let websocketClient: WebSocketClient | null = null;

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
      await initializeSessionCache('state-machine', connectWebSocket, {
        setApiKey,
        setDeviceIden,
        setAutoOpenLinks,
        setNotificationTimeout,
        setDeviceNickname
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
    debugLogger.general('ERROR', '[StateMachine] Error state', { error });
    updateConnectionIcon('disconnected');
  },
  onClearData: async () => {
    // Clear session cache
    sessionCache.userInfo = null;
    sessionCache.devices = [];
    sessionCache.recentPushes = [];
    sessionCache.lastUpdated = null;
  },
  onDisconnectWebSocket: () => {
    disconnectWebSocket();
  }
};

// Create a promise that resolves when the state machine is ready
// This ensures startup listeners wait for hydration to complete before attempting transitions
const stateMachineReady = ServiceWorkerStateMachine.create(stateMachineCallbacks).then(sm => {
  stateMachine = sm;
  debugLogger.general('INFO', '[Background] State machine initialized and ready', {
    currentState: stateMachine.getCurrentState()
  });
});

/**
 * ICON PERSISTENCE FIX: Restore visual state from storage
 *
 * Reads the last known state from storage and updates the icon badge
 * and tooltip to match. This ensures UI state persists across restarts.
 *
 * This function should be called at the very beginning of onInstalled
 * and onStartup listeners to restore the visual state before any other
 * initialization occurs.
 */
async function restoreVisualState(): Promise<void> {
  try {
    const { lastKnownState, lastKnownStateDescription } = await chrome.storage.local.get([
      'lastKnownState',
      'lastKnownStateDescription'
    ]);

    if (lastKnownState) {
      debugLogger.general('INFO', 'Restoring visual state from storage', { state: lastKnownState });

      // Restore tooltip
      if (lastKnownStateDescription) {
        updateExtensionTooltip(lastKnownStateDescription);
      }

      // Restore icon badge color based on state
      switch (lastKnownState as ServiceWorkerState) {
      case ServiceWorkerState.READY:
        updateConnectionIcon('connected');
        break;
      case ServiceWorkerState.INITIALIZING:
        updateConnectionIcon('connecting');
        break;
      case ServiceWorkerState.ERROR:
      case ServiceWorkerState.DEGRADED:
      case ServiceWorkerState.IDLE:
        updateConnectionIcon('disconnected'); // This will set the badge to red
        break;
      default:
        updateConnectionIcon('disconnected');
      }
    }
  } catch (error) {
    debugLogger.general('ERROR', 'Failed to restore visual state', null, error as Error);
  }
}

/**
 * Connect to WebSocket
 */
function connectWebSocket(): void {
  // MV3 LIFECYCLE TRACKING: Start recovery timer
  recoveryTimerStart = Date.now();

  // Set connecting status
  updateConnectionIcon('connecting');

  // SECURITY FIX (H-02): Dispose existing socket before creating new one
  if (websocketClient) {
    debugLogger.websocket('INFO', 'Disposing existing WebSocket before reconnecting');
    websocketClient.disconnect();
    websocketClient = null;
  }

  // RACE CONDITION FIX: Remove all previous event listeners to prevent listener leaks
  // When connectWebSocket is called multiple times (during reconnection attempts),
  // old listeners accumulate, causing duplicate event handling and multiple notifications
  // for the same push. This cleanup ensures only one set of listeners is active.
  debugLogger.websocket('DEBUG', 'Cleaning up old event listeners before reconnecting');
  globalEventBus.removeAllListeners('websocket:tickle:push');
  globalEventBus.removeAllListeners('websocket:tickle:device');
  globalEventBus.removeAllListeners('websocket:push');
  globalEventBus.removeAllListeners('websocket:connected');
  globalEventBus.removeAllListeners('websocket:disconnected');
  globalEventBus.removeAllListeners('websocket:polling:check');
  globalEventBus.removeAllListeners('websocket:polling:stop');
  globalEventBus.removeAllListeners('websocket:state');

  websocketClient = new WebSocketClient(WEBSOCKET_URL, getApiKey);
  setWebSocketClient(websocketClient);

  // Set up event listeners using event bus
  // ARCHITECTURAL CHANGE: Using event-driven architecture instead of direct handler calls
  // This decouples the WebSocketClient from the background script

  globalEventBus.on('websocket:tickle:push', async () => {
    await refreshPushes(notificationDataStore);
  });

  globalEventBus.on('websocket:tickle:device', async () => {
    const apiKey = getApiKey();
    if (apiKey) {
      const devices = await fetchDevices(apiKey);
      sessionCache.devices = devices;
      sessionCache.lastUpdated = Date.now();

      chrome.runtime.sendMessage({
        action: 'sessionDataUpdated',
        devices: devices,
        userInfo: sessionCache.userInfo,
        recentPushes: sessionCache.recentPushes,
        autoOpenLinks: sessionCache.autoOpenLinks,
        deviceNickname: sessionCache.deviceNickname
      }).catch(() => {});
    }
  });

  globalEventBus.on('websocket:push', async (push: Push) => {
    // RACE CONDITION FIX: Ensure configuration is loaded before processing push
    await ensureConfigLoaded();

    // Track push received
    performanceMonitor.recordPushReceived();

    let decryptedPush = push;

    // Check if push is encrypted
    if ('encrypted' in push && push.encrypted && 'ciphertext' in push) {
      try {
        // Get encryption password from storage repository
        const password = await storageRepository.getEncryptionPassword();

        if (password && sessionCache.userInfo) {
          debugLogger.general('INFO', 'Decrypting encrypted push', {
            pushIden: push.iden
          });

          const decrypted = await PushbulletCrypto.decryptPush(
                push as any,
                password,
                sessionCache.userInfo.iden
          );

          decryptedPush = decrypted as Push;
          debugLogger.general('INFO', 'Push decrypted successfully', {
            pushType: decryptedPush.type
          });
        } else {
          debugLogger.general('WARN', 'Cannot decrypt push - no encryption password set');
        }
      } catch (error) {
        debugLogger.general('ERROR', 'Failed to decrypt push', {
          error: (error as Error).message
        }, error as Error);
      }
    }

    // --- FILTERING LOGIC: Only process displayable push types ---
    const displayableTypes = ['mirror', 'note', 'link'];
    
    if (!displayableTypes.includes(decryptedPush.type)) {
      // Log for debugging purposes and ignore the push
      debugLogger.general('INFO', 'Ignoring non-displayable push of type', {
        pushType: decryptedPush.type,
        pushIden: decryptedPush.iden
      });
      return;
    }

    // Log that we're processing a displayable push
    debugLogger.general('INFO', 'Processing displayable push of type', {
      pushType: decryptedPush.type,
      pushIden: decryptedPush.iden
    });

    // Update cache (prepend)
    if (sessionCache.recentPushes) {
      sessionCache.recentPushes.unshift(decryptedPush);
      sessionCache.lastUpdated = Date.now();

      chrome.runtime.sendMessage({
        action: 'pushesUpdated',
        pushes: sessionCache.recentPushes
      }).catch(() => {});
    }

    // FIX: Don't await - let notifications show immediately without blocking
    // This allows multiple notifications to appear concurrently
    showPushNotification(decryptedPush, notificationDataStore).catch((error) => {
      debugLogger.general('ERROR', 'Failed to show notification', null, error);
      performanceMonitor.recordNotificationFailed();
    });

    // Auto-open links if setting is enabled
    const autoOpenLinks = getAutoOpenLinks();
    if (autoOpenLinks && isLinkPush(decryptedPush)) {
      debugLogger.general('INFO', 'Auto-opening link push', {
        pushIden: decryptedPush.iden,
        url: decryptedPush.url
      });

      chrome.tabs.create({
        url: decryptedPush.url,
        active: false // Open in background to avoid disrupting user
      }).catch((error) => {
        debugLogger.general('ERROR', 'Failed to auto-open link', {
          url: decryptedPush.url
        }, error);
      });
    }
  });

  globalEventBus.on('websocket:connected', async () => {
    // MV3 LIFECYCLE TRACKING: Calculate and store recovery time
    const recoveryTime = Date.now() - recoveryTimerStart;
    debugLogger.performance('INFO', 'WebSocket recovery time', { duration: recoveryTime });
    const { recoveryTimings = [] } = await chrome.storage.local.get('recoveryTimings');
    recoveryTimings.push(recoveryTime);
    // Keep only the last 20 timings for averaging
    await chrome.storage.local.set({ recoveryTimings: recoveryTimings.slice(-20) });

    // Trigger state machine transition
    stateMachine.transition('WS_CONNECTED');
    updateConnectionIcon('connected');
  });

  globalEventBus.on('websocket:disconnected', () => {
    // Trigger state machine transition
    stateMachine.transition('WS_DISCONNECTED');
    updateConnectionIcon('disconnected');
  });

  globalEventBus.on('websocket:polling:check', () => {
    checkPollingMode();
  });

  globalEventBus.on('websocket:polling:stop', () => {
    stopPollingMode();
  });

  globalEventBus.on('websocket:state', (state: string) => {
    updatePopupConnectionState(state);
  });

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
 * Extension installed/updated
 */
chrome.runtime.onInstalled.addListener(async () => {
  // MV3 LIFECYCLE TRACKING: Increment restart counter
  const { restarts = 0 } = await chrome.storage.local.get('restarts');
  await chrome.storage.local.set({ restarts: restarts + 1 });

  // ICON PERSISTENCE FIX: Restore visual state FIRST before any other initialization
  await restoreVisualState();

  debugLogger.general('INFO', 'Pushbullet extension installed/updated', {
    reason: 'onInstalled',
    timestamp: new Date().toISOString()
  });

  // Set initial icon to disconnected (with small delay to ensure Chrome is ready)
  setTimeout(() => updateConnectionIcon('disconnected'), 100);

  initTracker.recordInitialization('onInstalled');
  setupContextMenu();

  // Create periodic log flush alarm
  chrome.alarms.create('logFlush', { periodInMinutes: 1 });

  // STATE MACHINE HYDRATION: Wait for state machine to be ready before attempting transitions
  // This ensures the state machine has loaded its persisted state from storage
  await stateMachineReady;

  // STARTUP AMNESIA FIX + STORAGE RACE CONDITION FIX:
  // Read API key from storage with retry logic to handle chrome.storage being unavailable
  // immediately after service worker restart. This ensures both the state machine transition
  // and onInitialize callback work correctly even when storage is transiently unavailable.
  try {
    const apiKey = await getApiKeyWithRetries();
    if (apiKey) {
      setApiKey(apiKey);
    }
    await stateMachine.transition('STARTUP', { hasApiKey: !!apiKey });
  } catch (error) {
    debugLogger.storage('ERROR', 'Failed to read API key on startup', null, error as Error);
    await stateMachine.transition('STARTUP', { hasApiKey: false });
  }
});

/**
 * Browser startup
 */
chrome.runtime.onStartup.addListener(async () => {
  // MV3 LIFECYCLE TRACKING: Increment restart counter
  const { restarts = 0 } = await chrome.storage.local.get('restarts');
  await chrome.storage.local.set({ restarts: restarts + 1 });

  // ICON PERSISTENCE FIX: Restore visual state FIRST before any other initialization
  await restoreVisualState();

  debugLogger.general('INFO', 'Browser started - reinitializing Pushbullet extension', {
    reason: 'onStartup',
    timestamp: new Date().toISOString()
  });

  // Set initial icon to disconnected (with small delay to ensure Chrome is ready)
  setTimeout(() => updateConnectionIcon('disconnected'), 100);

  initTracker.recordInitialization('onStartup');
  setupContextMenu();

  // Create periodic log flush alarm
  chrome.alarms.create('logFlush', { periodInMinutes: 1 });

  // STATE MACHINE HYDRATION: Wait for state machine to be ready before attempting transitions
  // This ensures the state machine has loaded its persisted state from storage
  await stateMachineReady;

  // STARTUP AMNESIA FIX + STORAGE RACE CONDITION FIX:
  // Read API key from storage with retry logic to handle chrome.storage being unavailable
  // immediately after service worker restart. This ensures both the state machine transition
  // and onInitialize callback work correctly even when storage is transiently unavailable.
  try {
    const apiKey = await getApiKeyWithRetries();
    if (apiKey) {
      setApiKey(apiKey);
    }
    await stateMachine.transition('STARTUP', { hasApiKey: !!apiKey });
  } catch (error) {
    debugLogger.storage('ERROR', 'Failed to read API key on startup', null, error as Error);
    await stateMachine.transition('STARTUP', { hasApiKey: false });
  }
});

/**
 * Notification click listener
 */
chrome.notifications.onClicked.addListener((notificationId) => {
  debugLogger.notifications('INFO', 'Notification clicked', { notificationId });

  // Get push data from store
  const pushData = notificationDataStore.get(notificationId);

  if (pushData) {
    // Open notification detail page in a new window
    chrome.windows.create({
      url: `notification-detail.html?id=${encodeURIComponent(notificationId)}`,
      type: 'popup',
      width: 600,
      height: 500,
      focused: true
    });
  }

  // Clear the notification
  chrome.notifications.clear(notificationId);
});

/**
 * Alarm listener
 */
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'logFlush') {
      // Flush logs to persistent storage
      debugLogger.flush().then(() => {
        console.log('[Logger] Log buffer flushed to persistent storage.');
      });
    } else if (alarm.name === 'websocketReconnect' && getApiKey()) {
      debugLogger.websocket('INFO', 'Reconnection alarm triggered', {
        alarmName: alarm.name,
        hasApiKey: !!getApiKey(),
        scheduledTime: alarm.scheduledTime ? new Date(alarm.scheduledTime).toISOString() : 'unknown'
      });
      connectWebSocket();
    } else if (alarm.name === 'websocketReconnect') {
      debugLogger.websocket('WARN', 'Reconnection alarm triggered but no API key available');
    } else if (alarm.name === 'websocketHealthCheck') {
      // SERVICE WORKER AMNESIA FIX: Ensure config is loaded before performing health check
      await ensureConfigLoaded();
      performWebSocketHealthCheck(websocketClient, connectWebSocket);
      // MV3 LIFECYCLE TRACKING: Record last seen alive timestamp
      chrome.storage.local.set({ lastSeenAlive: Date.now() });
    } else if (alarm.name === 'pollingFallback') {
      performPollingFetch();
    }
  });

/**
 * Context menu click handler
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // RACE CONDITION FIX: Ensure configuration is loaded before processing context menu action
  await ensureConfigLoaded();

  if (!getApiKey()) {
    chrome.notifications.create('pushbullet-no-api-key', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Pushbullet',
      message: 'Please set your API key in the extension popup'
    });
    return;
  }

  switch (info.menuItemId) {
  case 'push-link':
    if (info.linkUrl && tab) {
      pushLink(info.linkUrl, tab.title);
    }
    break;
  case 'push-page':
    if (tab && tab.url) {
      pushLink(tab.url, tab.title);
    }
    break;
  case 'push-selection':
    if (info.selectionText && tab) {
      pushNote('Selection from ' + (tab.title || 'page'), info.selectionText);
    }
    break;
  case 'push-image':
    if (info.srcUrl && tab) {
      pushLink(info.srcUrl, 'Image from ' + (tab.title || 'page'));
    }
    break;
  }
});

// Define actions that require configuration to be loaded
const ACTIONS_REQUIRING_CONFIG = new Set([
  'getSessionData',
  'refreshSession',
  'pushLink',
  'pushNote',
  'updateDeviceNickname'
]);

/**
 * Message listener for popup communication
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // SECURITY FIX (C-04): Validate sender for privileged actions
  // Prevents external extensions/pages from sending privileged messages
  if (!validatePrivilegedMessage(message.action, sender)) {
    debugLogger.general('ERROR', 'Rejected privileged message from untrusted sender', {
      action: message.action,
      senderId: sender?.id,
      senderUrl: sender?.url
    });
    sendResponse({ success: false, error: 'Unauthorized' });
    return false;
  } else if (message.action === 'log') {
    // Handler for centralized logging from other scripts (e.g., popup)
    if (message.payload) {
      const { level, message: logMessage, data } = message.payload;
      const prefix = '[POPUP]'; // Add a prefix to identify the source

      switch (level) {
      case 'ERROR':
        debugLogger.general('ERROR', `${prefix} ${logMessage}`, data);
        break;
      case 'WARN':
        debugLogger.general('WARN', `${prefix} ${logMessage}`, data);
        break;
      case 'INFO':
      default:
        debugLogger.general('INFO', `${prefix} ${logMessage}`, data);
        break;
      }
    }
    // Return false because we are not sending a response asynchronously.
    return false;
  }

  if (message.action === 'getSessionData') {
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
          debugLogger.general('WARN', 'Service worker wake-up detected - reloading session from storage.');

          // Await the full initialization process
          await initializeSessionCache('onMessageWakeup', connectWebSocket, {
            setApiKey,
            setDeviceIden,
            setAutoOpenLinks,
            setNotificationTimeout,
            setDeviceNickname
          });
        }

        // Now, respond with the (potentially restored) session data
        sendResponse({
          isAuthenticated: sessionCache.isAuthenticated,
          userInfo: sessionCache.userInfo,
          devices: sessionCache.devices,
          recentPushes: sessionCache.recentPushes,
          autoOpenLinks: getAutoOpenLinks(),
          deviceNickname: getDeviceNickname(),
          websocketConnected: websocketClient ? websocketClient.isConnected() : false
        });
      } catch (error) {
        debugLogger.general('ERROR', 'Error handling getSessionData after wake-up', null, error as Error);
        sendResponse({ isAuthenticated: false, error: (error as Error).message });
      }
    })();

    return true; // Return true to indicate an asynchronous response.
  } else if (message.action === 'apiKeyChanged') {
    // Update API key
    setApiKey(message.apiKey);

    // Build promise chain
    let savePromise = storageRepository.setApiKey(message.apiKey);

    // Update device nickname if provided
    if (message.deviceNickname) {
      savePromise = savePromise.then(() => {
        setDeviceNickname(message.deviceNickname);
        sessionCache.deviceNickname = message.deviceNickname;
        return storageRepository.setDeviceNickname(message.deviceNickname);
      });
    }

    // ARCHITECTURAL CHANGE: Use state machine instead of direct initialization
    // STATE MACHINE HYDRATION: Ensure state machine is ready before using it
    savePromise.then(() => stateMachineReady).then(() => {
      return stateMachine.transition('API_KEY_SET', { apiKey: message.apiKey });
    }).then(() => {
      // Send response with session data after state machine completes
      sendResponse({
        success: true,
        isAuthenticated: stateMachine.isInState(ServiceWorkerState.READY) || stateMachine.isInState(ServiceWorkerState.DEGRADED),
        userInfo: sessionCache.userInfo,
        devices: sessionCache.devices,
        recentPushes: sessionCache.recentPushes,
        autoOpenLinks: sessionCache.autoOpenLinks,
        deviceNickname: sessionCache.deviceNickname,
        websocketConnected: websocketClient ? websocketClient.isConnected() : false
      });
    }).catch((error) => {
      debugLogger.general('ERROR', 'Error saving API key', null, error);
      sendResponse({ success: false, error: error.message });
    });

    return true; // Keep message channel open for async response
  } else if (message.action === 'logout') {
    // ARCHITECTURAL CHANGE: Use state machine for logout
    // STATE MACHINE HYDRATION: Ensure state machine is ready before using it
    stateMachineReady.then(() => {
      return stateMachine.transition('LOGOUT');
    }).then(() => {
      // Clear storage via repository
      return storageRepository.setApiKey(null);
    }).then(() => {
      return storageRepository.setDeviceIden(null);
    }).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      debugLogger.general('ERROR', 'Error during logout', null, error);
      sendResponse({ success: false, error: error.message });
    });

    return true; // Async response
  } else if (message.action === 'refreshSession') {
    // RACE CONDITION FIX: Ensure configuration is loaded before processing
    (async () => {
      await ensureConfigLoaded();

      const apiKey = getApiKey();
      if (apiKey) {
        refreshSessionCache(apiKey).then(() => {
          sendResponse({
            isAuthenticated: true,
            userInfo: sessionCache.userInfo,
            devices: sessionCache.devices,
            recentPushes: sessionCache.recentPushes,
            autoOpenLinks: sessionCache.autoOpenLinks,
            deviceNickname: sessionCache.deviceNickname
          });
        }).catch((error) => {
          debugLogger.general('ERROR', 'Error refreshing session', null, error);
          sendResponse({ isAuthenticated: false });
        });
      } else {
        sendResponse({ isAuthenticated: false });
      }
    })();

    return true; // Async response
  } else if (message.action === 'settingsChanged') {
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
          })
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
      promises.push(storageRepository.setNotificationTimeout(message.notificationTimeout));
    }

    Promise.all(promises).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      debugLogger.general('ERROR', 'Error saving settings', null, error);
      sendResponse({ success: false, error: error.message });
    });

    return true; // Async response
  } else if (message.action === 'updateDeviceNickname') {
    // RACE CONDITION FIX: Ensure configuration is loaded before processing
    (async () => {
      await ensureConfigLoaded();

      const apiKey = getApiKey();
      const deviceIden = getDeviceIden();

      if (apiKey && deviceIden && message.nickname) {
        updateDeviceNickname(apiKey, deviceIden, message.nickname).then(async () => {
          setDeviceNickname(message.nickname);
          sessionCache.deviceNickname = message.nickname;
          await storageRepository.setDeviceNickname(message.nickname);

          sendResponse({ success: true });
        }).catch((error) => {
          debugLogger.general('ERROR', 'Error updating device nickname', null, error);
          sendResponse({ success: false, error: error.message });
        });
      } else {
        sendResponse({ success: false, error: 'Missing required parameters' });
      }
    })();

    return true; // Async response
  } else if (message.action === 'getDebugSummary') {
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
          stateText: websocketClient ? (websocketClient.isConnected() ? 'Connected' : 'Disconnected') : 'Not initialized',
          readyState: wsState.currentState,
          stateMachineState: stateMachine.getCurrentState(),
          stateMachineDescription: stateMachine.getStateDescription()
        },
        lastCheck: wsState.lastCheck,
        historyLength: wsState.historyLength
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
          currentUptime: 0
        },
        notifications: perfSummary.notifications
      };

      // MV3 LIFECYCLE TRACKING: Gather metrics for dashboard
      const { restarts = 0, recoveryTimings = [] } = await chrome.storage.local.get(['restarts', 'recoveryTimings']);
      const avgRecoveryTime = recoveryTimings.length > 0
        ? recoveryTimings.reduce((a: number, b: number) => a + b, 0) / recoveryTimings.length
        : 0;

      const mv3LifecycleStats = {
        restarts: restarts,
        wakeUpTriggers: initTracker.exportData().stats, // We already track this!
        avgRecoveryTime: avgRecoveryTime.toFixed(0) + ' ms',
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
          critical: []
        }
      };

      sendResponse({ success: true, summary });
    })();

    return true; // Async response
  } else if (message.action === 'clearAllLogs') {
    // Clear all logs from memory and persistent storage
    debugLogger.clearLogs().then(() => {
      sendResponse({ success: true });
    });
    return true; // Async response
  } else if (message.action === 'updateDebugConfig') {
    // Update debug configuration
    if (message.config) {
      debugConfigManager.updateConfig(message.config).then(() => {
        sendResponse({ success: true });
      }).catch((error) => {
        debugLogger.general('ERROR', 'Failed to update debug config', null, error);
        sendResponse({ success: false, error: error.message });
      });
    } else {
      sendResponse({ success: false, error: 'No config provided' });
    }
    return true; // Async response
  } else if (message.action === 'exportDebugData') {
    // This handler gathers all debug data for exporting
    debugLogger.general('INFO', 'Exporting full debug data');

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
          lastUpdated: sessionCache.lastUpdated ? new Date(sessionCache.lastUpdated).toISOString() : 'never',
          userInfo: sessionCache.userInfo ? { email: sessionCache.userInfo.email?.substring(0, 3) + '***' } : null,
          deviceCount: sessionCache.devices?.length || 0,
          pushCount: sessionCache.recentPushes?.length || 0
        }
      };

      sendResponse({ success: true, data: dataToExport });
    })();

    return true; // Async response
  } else if (message.action === 'getNotificationData') {
    // Return notification data for detail view
    const pushData = notificationDataStore.get(message.notificationId);
    if (pushData) {
      sendResponse({ success: true, push: pushData });
    } else {
      sendResponse({ success: false, error: 'Notification not found' });
    }
    return false; // Synchronous response
  } else if (message.action === 'sendPush') {
    // Handle push sending from popup
    // SERVICE WORKER AMNESIA FIX: Ensure configuration is loaded before attempting to send push
    (async () => {
      try {
        // Ensure core configuration is loaded from storage if service worker just woke up
        await ensureConfigLoaded();

        const apiKey = getApiKey();
        if (!apiKey) {
          sendResponse({ success: false, error: 'Not logged in. Please try again.' });
          return;
        }

        const pushData = message.pushData;
        if (!pushData || !pushData.type) {
          sendResponse({ success: false, error: 'Invalid push data' });
          return;
        }

        // Send push via API
        const response = await fetch('https://api.pushbullet.com/v2/pushes', {
          method: 'POST',
          headers: {
            'Access-Token': apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(pushData)
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = 'Failed to send push';
          try {
            const errorData = JSON.parse(errorText) as { error?: { message?: string } };
            if (errorData.error?.message) {
              errorMessage = errorData.error.message;
            }
          } catch {
            // Use default
          }
          throw new Error(errorMessage);
        }

        // Refresh pushes after sending
        await refreshPushes(notificationDataStore);

        sendResponse({ success: true });
      } catch (error) {
        debugLogger.general('ERROR', 'Failed to send push', { pushType: message.pushData?.type }, error as Error);
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();

    return true; // Async response
  }

  return false;
});

// Export debug info function for console access
(globalThis as any).exportDebugInfo = function() {
  return {
    debugLogs: debugLogger.exportLogs(),
    performanceData: performanceMonitor.exportPerformanceData(),
    websocketState: wsStateMonitor.getStateReport(),
    initializationData: initTracker.exportData(),
    sessionCache: {
      isAuthenticated: sessionCache.isAuthenticated,
      lastUpdated: sessionCache.lastUpdated ? new Date(sessionCache.lastUpdated).toISOString() : 'never',
      userInfo: sessionCache.userInfo ? { email: sessionCache.userInfo.email?.substring(0, 3) + '***' } : null,
      deviceCount: sessionCache.devices?.length || 0,
      pushCount: sessionCache.recentPushes?.length || 0
    },
    websocketConnected: websocketClient ? websocketClient.isConnected() : false,
    initializationState: {
      inProgress: initializationState.inProgress,
      completed: initializationState.completed,
      timestamp: initializationState.timestamp ? new Date(initializationState.timestamp).toISOString() : null,
      hasError: !!initializationState.error
    }
  };
};

debugLogger.general('INFO', 'Background service worker initialized', {
  timestamp: new Date().toISOString()
});

