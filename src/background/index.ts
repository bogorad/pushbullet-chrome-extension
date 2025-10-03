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

// Initialize State Machine
// ARCHITECTURAL CHANGE: Centralized lifecycle management
// All service worker state is now managed by the state machine
const stateMachine = new ServiceWorkerStateMachine({
  onInitialize: async (data) => {
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
  onConnectWebSocket: () => {
    connectWebSocket();
  },
  onStartPolling: () => {
    checkPollingMode();
  },
  onStopPolling: () => {
    stopPollingMode();
  },
  onShowError: (error) => {
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
});

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
  });

  globalEventBus.on('websocket:connected', () => {
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

  // Load API key from storage first
  await ensureConfigLoaded(
    { setApiKey, setDeviceIden, setAutoOpenLinks, setDeviceNickname, setNotificationTimeout },
    { getApiKey, getDeviceIden, getAutoOpenLinks, getDeviceNickname, getNotificationTimeout }
  );

  // ARCHITECTURAL CHANGE: Use state machine instead of direct initialization
  const apiKey = getApiKey();
  await stateMachine.transition('STARTUP', { hasApiKey: !!apiKey });
});

/**
 * Browser startup
 */
chrome.runtime.onStartup.addListener(async () => {
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

  // Load API key from storage first
  await ensureConfigLoaded(
    { setApiKey, setDeviceIden, setAutoOpenLinks, setDeviceNickname, setNotificationTimeout },
    { getApiKey, getDeviceIden, getAutoOpenLinks, getDeviceNickname, getNotificationTimeout }
  );

  // ARCHITECTURAL CHANGE: Use state machine instead of direct initialization
  const apiKey = getApiKey();
  await stateMachine.transition('STARTUP', { hasApiKey: !!apiKey });
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

        // Await the existing initialization promise directly (no polling needed)
        const initPromise = getInitPromise();
        if (initPromise) {
          initPromise.then(() => {
            sendResponse({
              isAuthenticated: sessionCache.isAuthenticated,
              userInfo: sessionCache.userInfo,
              devices: sessionCache.devices,
              recentPushes: sessionCache.recentPushes,
              autoOpenLinks: sessionCache.autoOpenLinks,
              deviceNickname: sessionCache.deviceNickname,
              websocketConnected: websocketClient ? websocketClient.isConnected() : false
            });
          }).catch((error) => {
            debugLogger.general('ERROR', 'Initialization failed while waiting', null, error);
            sendResponse({ isAuthenticated: false });
          });
          return true; // Keep message channel open for async response
        }
      }

      debugLogger.general('WARN', 'Service worker wake-up detected - session cache not initialized', {
        hasApiKey: !!apiKey,
        isAuthenticated: sessionCache.isAuthenticated,
        lastUpdated: sessionCache.lastUpdated
      });

      // API KEY PERSISTENCE FIX: Properly await ensureConfigLoaded to ensure API key
      // is loaded from storage BEFORE initializing session cache. Using async/await
      // instead of promise chains ensures proper sequencing and error handling.
      (async () => {
        try {
          debugLogger.general('DEBUG', 'Loading config from storage before session cache initialization');

          // Ensure config is loaded (MUST complete before session cache init)
          await ensureConfigLoaded(
            { setApiKey, setDeviceIden, setAutoOpenLinks, setDeviceNickname, setNotificationTimeout },
            { getApiKey, getDeviceIden, getAutoOpenLinks, getDeviceNickname, getNotificationTimeout }
          );

          debugLogger.general('DEBUG', 'Config loaded, initializing session cache', {
            hasApiKey: !!getApiKey()
          });

          // Re-initialize session cache (MUST complete before sending response)
          await initializeSessionCache('onMessage', connectWebSocket, {
            setApiKey,
            setDeviceIden,
            setAutoOpenLinks,
            setDeviceNickname,
            setNotificationTimeout
          });

          sendResponse({
            isAuthenticated: true,
            userInfo: sessionCache.userInfo,
            devices: sessionCache.devices,
            recentPushes: sessionCache.recentPushes,
            autoOpenLinks: sessionCache.autoOpenLinks,
            deviceNickname: sessionCache.deviceNickname,
            websocketConnected: websocketClient ? websocketClient.isConnected() : false
          });
        } catch (error) {
          debugLogger.general('ERROR', 'Error during service worker wake-up recovery', null, error as Error);
          sendResponse({ isAuthenticated: false });
        }
      })();

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
    savePromise.then(() => {
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
    stateMachine.transition('LOGOUT').then(() => {
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
    const promises: Promise<void>[] = [];

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

      return true; // Async response
    } else {
      sendResponse({ success: false, error: 'Missing required parameters' });
    }
  } else if (message.action === 'getDebugSummary') {
    // Return debug summary for debug dashboard
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

    const summary = {
      config: debugConfigManager.getConfig(),
      logs: logData.logs, // Array of log entries
      totalLogs: logData.summary.totalLogs,
      performance: performanceForDashboard,
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
      websocketStateText: websocketState.current.stateText,
      stateMachineState: stateMachine.getCurrentState()
    });

    sendResponse({ success: true, summary });
    return false; // Synchronous response
  } else if (message.action === 'exportDebugData') {
    // This handler gathers all debug data for exporting
    debugLogger.general('INFO', 'Exporting full debug data');

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
  } else if (message.action === 'sendPush') {
    // Handle push sending from popup
    const apiKey = getApiKey();
    if (!apiKey) {
      sendResponse({ success: false, error: 'No API key' });
      return false;
    }

    const pushData = message.pushData;
    if (!pushData || !pushData.type) {
      sendResponse({ success: false, error: 'Invalid push data' });
      return false;
    }

    // Send push via API
    fetch('https://api.pushbullet.com/v2/pushes', {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(pushData)
    }).then(async (response) => {
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
    }).catch((error) => {
      debugLogger.general('ERROR', 'Failed to send push', { pushType: pushData.type }, error);
      sendResponse({ success: false, error: error.message });
    });

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

