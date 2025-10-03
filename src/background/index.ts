/**
 * Background Service Worker - Main Entry Point
 * Pushbullet Chrome Extension (Manifest V3)
 */

import { debugLogger, debugConfigManager } from '../lib/logging';
import { performanceMonitor } from '../lib/perf';
import { initTracker, wsStateMonitor } from '../lib/monitoring';
import { WebSocketClient } from '../app/ws/client';
import { sessionCache, initializeSessionCache, refreshSessionCache, initializationState } from '../app/session';
import { fetchDevices, updateDeviceNickname } from '../app/api/client';
import { ensureConfigLoaded } from '../app/reconnect';
import { PushbulletCrypto } from '../lib/crypto';
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
  updateConnectionIcon
} from './utils';
import { validatePrivilegedMessage } from '../lib/security/message-validation';
import type { Push } from '../types/domain';

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

// Initialize WebSocket client
let websocketClient: WebSocketClient | null = null;

/**
 * Connect to WebSocket
 */
function connectWebSocket(): void {
  // Set connecting status
  updateConnectionIcon('connecting');

  // SECURITY FIX (H-02): Dispose existing socket before creating new one
  if (websocketClient) {
    debugLogger.websocket('INFO', 'Disposing existing WebSocket before reconnecting');
    websocketClient.disconnect();
    websocketClient = null;
  }

  websocketClient = new WebSocketClient(WEBSOCKET_URL, getApiKey);
  setWebSocketClient(websocketClient);

  // Set up handlers
  websocketClient.setHandlers({
      onTicklePush: async () => {
        await refreshPushes(notificationDataStore);
      },
      onTickleDevice: async () => {
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
      },
      onPush: async (push: Push) => {
        let decryptedPush = push;

        // Check if push is encrypted
        if ('encrypted' in push && push.encrypted && 'ciphertext' in push) {
          try {
            // Get encryption password from local storage
            const result = await chrome.storage.local.get(['encryptionPassword']);
            const password = result.encryptionPassword;

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
        });
      },
      onConnected: () => {
        stopPollingMode();
        updateConnectionIcon('connected');
      },
      onDisconnected: () => {
        updateConnectionIcon('disconnected');
      },
      checkPollingMode: () => {
        checkPollingMode();
      },
      stopPollingMode: () => {
        stopPollingMode();
      },
      updatePopupConnectionState: (state: string) => {
        updatePopupConnectionState(state);
      }
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
chrome.runtime.onInstalled.addListener(() => {
  debugLogger.general('INFO', 'Pushbullet extension installed/updated', {
    reason: 'onInstalled',
    timestamp: new Date().toISOString()
  });

  // Set initial icon to disconnected (with small delay to ensure Chrome is ready)
  setTimeout(() => updateConnectionIcon('disconnected'), 100);

  initTracker.recordInitialization('onInstalled');
  setupContextMenu();
  initializeSessionCache('onInstalled', connectWebSocket, {
    setApiKey,
    setDeviceIden,
    setAutoOpenLinks,
    setDeviceNickname,
    setNotificationTimeout
  });
});

/**
 * Browser startup
 */
chrome.runtime.onStartup.addListener(() => {
  debugLogger.general('INFO', 'Browser started - reinitializing Pushbullet extension', {
    reason: 'onStartup',
    timestamp: new Date().toISOString()
  });

  // Set initial icon to disconnected (with small delay to ensure Chrome is ready)
  setTimeout(() => updateConnectionIcon('disconnected'), 100);

  initTracker.recordInitialization('onStartup');
  setupContextMenu();
  initializeSessionCache('onStartup', connectWebSocket, {
    setApiKey,
    setDeviceIden,
    setAutoOpenLinks,
    setDeviceNickname,
    setNotificationTimeout
  });
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
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'websocketReconnect' && getApiKey()) {
    debugLogger.websocket('INFO', 'Reconnection alarm triggered', {
      alarmName: alarm.name,
      hasApiKey: !!getApiKey(),
      scheduledTime: alarm.scheduledTime ? new Date(alarm.scheduledTime).toISOString() : 'unknown'
    });
    connectWebSocket();
  } else if (alarm.name === 'websocketReconnect') {
    debugLogger.websocket('WARN', 'Reconnection alarm triggered but no API key available');
  } else if (alarm.name === 'websocketHealthCheck') {
    performWebSocketHealthCheck(websocketClient, connectWebSocket);
  } else if (alarm.name === 'pollingFallback') {
    performPollingFetch();
  }
});

/**
 * Context menu click handler
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
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

/**
 * Message listener for popup communication
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLogger.general('DEBUG', 'Message received from popup', {
    action: message.action,
    hasApiKey: !!message.apiKey,
    timestamp: new Date().toISOString()
  });

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
  }

  if (message.action === 'getSessionData') {
    // Detect service worker wake-up: if we have an API key but session cache is not initialized
    const apiKey = getApiKey();
    if (apiKey && !sessionCache.isAuthenticated && sessionCache.lastUpdated === 0) {
      // Check if initialization is already in progress
      if (initializationState.inProgress) {
        debugLogger.general('DEBUG', 'Initialization already in progress - waiting for completion');

        // Wait for initialization to complete (max 10 seconds)
        const maxWait = 10000;
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
          if (initializationState.completed || Date.now() - startTime > maxWait) {
            clearInterval(checkInterval);
            sendResponse({
              isAuthenticated: sessionCache.isAuthenticated,
              userInfo: sessionCache.userInfo,
              devices: sessionCache.devices,
              recentPushes: sessionCache.recentPushes,
              autoOpenLinks: sessionCache.autoOpenLinks,
              deviceNickname: sessionCache.deviceNickname,
              websocketConnected: websocketClient ? websocketClient.isConnected() : false
            });
          }
        }, 100);
        return true; // Keep message channel open
      }

      debugLogger.general('WARN', 'Service worker wake-up detected - session cache not initialized', {
        hasApiKey: !!apiKey,
        isAuthenticated: sessionCache.isAuthenticated,
        lastUpdated: sessionCache.lastUpdated
      });

      // Ensure config is loaded
      ensureConfigLoaded(
        { setApiKey, setDeviceIden, setAutoOpenLinks, setDeviceNickname, setNotificationTimeout },
        { getApiKey, getDeviceIden, getAutoOpenLinks, getDeviceNickname, getNotificationTimeout }
      ).then(() => {
        // Re-initialize session cache
        initializeSessionCache('onMessage', connectWebSocket, {
          setApiKey,
          setDeviceIden,
          setAutoOpenLinks,
          setDeviceNickname,
          setNotificationTimeout
        }).then(() => {
          sendResponse({
            isAuthenticated: true,
            userInfo: sessionCache.userInfo,
            devices: sessionCache.devices,
            recentPushes: sessionCache.recentPushes,
            autoOpenLinks: sessionCache.autoOpenLinks,
            deviceNickname: sessionCache.deviceNickname,
            websocketConnected: websocketClient ? websocketClient.isConnected() : false
          });
        }).catch((error) => {
          debugLogger.general('ERROR', 'Error re-initializing session cache', null, error);
          sendResponse({ isAuthenticated: false });
        });
      });

      return true; // Async response
    }

    // Check if session cache is stale (older than 5 minutes)
    const isStale = sessionCache.lastUpdated > 0 && (Date.now() - sessionCache.lastUpdated) > 300000;

    if (sessionCache.isAuthenticated && !isStale) {
      // Return cached session data
      sendResponse({
        isAuthenticated: true,
        userInfo: sessionCache.userInfo,
        devices: sessionCache.devices,
        recentPushes: sessionCache.recentPushes,
        autoOpenLinks: sessionCache.autoOpenLinks,
        deviceNickname: sessionCache.deviceNickname,
        websocketConnected: websocketClient ? websocketClient.isConnected() : false
      });
    } else if (sessionCache.isAuthenticated && isStale) {
      // Refresh session cache in the background
      const apiKey = getApiKey();
      if (apiKey) {
        refreshSessionCache(apiKey).then(() => {
          sendResponse({
            isAuthenticated: true,
            userInfo: sessionCache.userInfo,
            devices: sessionCache.devices,
            recentPushes: sessionCache.recentPushes,
            autoOpenLinks: sessionCache.autoOpenLinks,
            deviceNickname: sessionCache.deviceNickname,
            websocketConnected: websocketClient ? websocketClient.isConnected() : false
          });
        }).catch((error) => {
          debugLogger.general('ERROR', 'Error refreshing session cache', null, error);
          sendResponse({ isAuthenticated: false });
        });

        return true; // Async response
      }
    } else {
      // Not authenticated
      sendResponse({ isAuthenticated: false });
    }
  } else if (message.action === 'apiKeyChanged') {
    // Update API key
    setApiKey(message.apiKey);

    // Save API key to storage (plain text)
    chrome.storage.sync.set({ apiKey: message.apiKey });

    // Update device nickname if provided
    if (message.deviceNickname) {
      setDeviceNickname(message.deviceNickname);
      sessionCache.deviceNickname = message.deviceNickname;
      chrome.storage.local.set({ deviceNickname: message.deviceNickname });
    }

    // Refresh session cache
    refreshSessionCache(message.apiKey).then(() => {
      // Notify popup that session data has been updated
      chrome.runtime.sendMessage({
        action: 'sessionDataUpdated',
        isAuthenticated: true,
        userInfo: sessionCache.userInfo,
        devices: sessionCache.devices,
        recentPushes: sessionCache.recentPushes,
        autoOpenLinks: sessionCache.autoOpenLinks,
        deviceNickname: sessionCache.deviceNickname
      });
    }).catch((error) => {
      debugLogger.general('ERROR', 'Error refreshing session cache after API key change', null, error);
    });

    // Connect WebSocket
    connectWebSocket();

    sendResponse({ success: true });
  } else if (message.action === 'logout') {
    // Clear API key and session data
    setApiKey(null);
    setDeviceIden(null);
    sessionCache.isAuthenticated = false;
    sessionCache.userInfo = null;
    sessionCache.devices = [];
    sessionCache.recentPushes = [];

    // Clear storage
    chrome.storage.sync.remove(['apiKey']);
    chrome.storage.local.remove(['deviceIden']);

    // Disconnect WebSocket
    disconnectWebSocket();

    sendResponse({ success: true });
  } else if (message.action === 'refreshSession') {
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

      return true; // Async response
    } else {
      sendResponse({ isAuthenticated: false });
    }
  } else if (message.action === 'settingsChanged') {
    if (message.autoOpenLinks !== undefined) {
      setAutoOpenLinks(message.autoOpenLinks);
      sessionCache.autoOpenLinks = message.autoOpenLinks;
      chrome.storage.sync.set({ autoOpenLinks: message.autoOpenLinks });
    }

    if (message.notificationTimeout !== undefined) {
      setNotificationTimeout(message.notificationTimeout);
      chrome.storage.sync.set({ notificationTimeout: message.notificationTimeout });
    }

    sendResponse({ success: true });
  } else if (message.action === 'updateDeviceNickname') {
    const apiKey = getApiKey();
    const deviceIden = getDeviceIden();

    if (apiKey && deviceIden && message.nickname) {
      updateDeviceNickname(apiKey, deviceIden, message.nickname).then(() => {
        setDeviceNickname(message.nickname);
        sessionCache.deviceNickname = message.nickname;
        chrome.storage.sync.set({ deviceNickname: message.nickname });

        sendResponse({ success: true });
      }).catch((error) => {
        debugLogger.general('ERROR', 'Error updating device nickname', null, error);
        sendResponse({ success: false, error: error.message });
      });

      return true; // Async response
    } else {
      sendResponse({ success: false, error: 'Missing required parameters' });
    }
  } else if (message.action === 'getDebugSummary') {
    // Return debug summary for debug dashboard
    const logData = debugLogger.exportLogs();
    const wsState = wsStateMonitor.getStateReport();

    // Format websocket state for dashboard compatibility
    const websocketState = {
      current: {
        stateText: websocketClient ? (websocketClient.isConnected() ? 'Connected' : 'Disconnected') : 'Not initialized',
        readyState: wsState.currentState
      },
      lastCheck: wsState.lastCheck,
      historyLength: wsState.historyLength
    };

    const summary = {
      config: debugConfigManager.getConfig(),
      logs: logData.logs, // Array of log entries
      totalLogs: logData.summary.totalLogs,
      performance: performanceMonitor.exportPerformanceData(),
      websocketState: websocketState,
      initializationStats: initTracker.exportData(),
      errors: {
        total: logData.summary.errors,
        last24h: logData.summary.errors, // Add last24h for dashboard
        critical: []
      }
    };

    debugLogger.general('DEBUG', 'Sending debug summary', {
      totalLogs: summary.totalLogs,
      hasConfig: !!summary.config,
      hasPerformance: !!summary.performance,
      websocketStateText: websocketState.current.stateText
    });

    sendResponse({ success: true, summary });
    return false; // Synchronous response
  } else if (message.action === 'getNotificationData') {
    // Return notification data for detail view
    const pushData = notificationDataStore.get(message.notificationId);
    if (pushData) {
      sendResponse({ success: true, push: pushData });
    } else {
      sendResponse({ success: false, error: 'Notification not found' });
    }
    return false; // Synchronous response
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

