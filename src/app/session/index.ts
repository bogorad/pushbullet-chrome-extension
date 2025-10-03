import type { SessionCache, InitializationState } from '../../types/domain';
import { debugLogger } from '../../lib/logging';
import { fetchUserInfo, fetchDevices, fetchRecentPushes, registerDevice } from '../api/client';
import { storageRepository } from '../../infrastructure/storage/storage.repository';

// Session cache state
export const sessionCache: SessionCache = {
  userInfo: null,
  devices: [],
  recentPushes: [],
  isAuthenticated: false,
  lastUpdated: 0,
  autoOpenLinks: true,
  deviceNickname: 'Chrome'
};

// Initialization state tracking
export const initializationState: InitializationState = {
  inProgress: false,
  completed: false,
  error: null,
  timestamp: null
};

// Promise singleton for single-flight initialization
// Prevents race conditions when multiple events trigger initialization concurrently
let initPromise: Promise<string | null> | null = null;

/**
 * Get the current initialization promise (if any)
 * This allows callers to await ongoing initialization instead of polling
 */
export function getInitPromise(): Promise<string | null> | null {
  return initPromise;
}

// NO DECRYPTION - API key is stored in plain text in chrome.storage.sync
// The crypto module is ONLY for decrypting E2EE push messages, NOT the API key!

export async function initializeSessionCache(
  source = 'unknown',
  connectWebSocketFn?: () => void,
  stateSetters?: {
    setApiKey: (key: string | null) => void;
    setDeviceIden: (iden: string | null) => void;
    setAutoOpenLinks: (value: boolean) => void;
    setDeviceNickname: (nickname: string) => void;
    setNotificationTimeout: (timeout: number) => void;
  }
): Promise<string | null> {
  // If initialization is already in progress, return the existing promise
  // This allows concurrent callers to await the same initialization
  if (initializationState.inProgress && initPromise) {
    debugLogger.general('INFO', 'Initialization already in progress, returning existing promise', {
      source,
      existingInitialization: true
    });
    return initPromise;
  }

  if (initializationState.completed) {
    debugLogger.general('WARN', 'Already initialized, skipping', {
      source,
      previousTimestamp: initializationState.timestamp
    });
    return null;
  }

  initializationState.inProgress = true;

  // Create and store the initialization promise
  initPromise = (async () => {
    try {
      debugLogger.general('INFO', 'Initializing session cache', {
        source,
        timestamp: new Date().toISOString()
      });

    // Load core settings from sync storage
    debugLogger.storage('DEBUG', 'Loading initial configuration from storage repository');

    // Get API key and device iden from storage repository
    const apiKeyValue = await storageRepository.getApiKey();
    const deviceIdenValue = await storageRepository.getDeviceIden();

    if (stateSetters) {
      stateSetters.setApiKey(apiKeyValue);
      stateSetters.setDeviceIden(deviceIdenValue);
    }

    // Get settings with defaults from storage repository
    const autoOpenLinksValue = await storageRepository.getAutoOpenLinks();
    const notificationTimeoutValue = await storageRepository.getNotificationTimeout();
    const deviceNicknameValue = await storageRepository.getDeviceNickname() || 'Chrome';

    if (stateSetters) {
      stateSetters.setAutoOpenLinks(autoOpenLinksValue);
      stateSetters.setNotificationTimeout(notificationTimeoutValue);
      stateSetters.setDeviceNickname(deviceNicknameValue);
    }

    sessionCache.autoOpenLinks = autoOpenLinksValue;
    sessionCache.deviceNickname = deviceNicknameValue;

    debugLogger.storage('INFO', 'Loaded configuration from storage repository', {
      hasApiKey: !!apiKeyValue,
      hasDeviceIden: !!deviceIdenValue,
      autoOpenLinks: autoOpenLinksValue,
      deviceNickname: deviceNicknameValue,
      notificationTimeout: notificationTimeoutValue
    });

    debugLogger.general('DEBUG', 'API key status', {
      hasApiKey: !!apiKeyValue,
      apiKeyLength: apiKeyValue ? apiKeyValue.length : 0
    });

    if (apiKeyValue) {
      debugLogger.general('INFO', 'API key available - initializing session data');

      // Fetch user info
      const userInfo = await fetchUserInfo(apiKeyValue);
      sessionCache.userInfo = userInfo;

      // Fetch devices
      const devices = await fetchDevices(apiKeyValue);
      sessionCache.devices = devices;

      // Fetch recent pushes
      const pushes = await fetchRecentPushes(apiKeyValue);
      sessionCache.recentPushes = pushes;

      // Update session cache
      sessionCache.isAuthenticated = true;
      sessionCache.lastUpdated = Date.now();

      debugLogger.general('INFO', 'Session cache populated successfully', {
        hasUserInfo: !!sessionCache.userInfo,
        deviceCount: sessionCache.devices.length,
        pushCount: sessionCache.recentPushes.length,
        lastUpdated: new Date(sessionCache.lastUpdated).toISOString()
      });

      // Register device
      await registerDevice(apiKeyValue, deviceIdenValue, deviceNicknameValue);

      // Connect WebSocket if function provided
      if (connectWebSocketFn) {
        connectWebSocketFn();
      }

      // Start periodic health check
      chrome.alarms.create('websocketHealthCheck', { periodInMinutes: 5 });
      debugLogger.general('DEBUG', 'WebSocket health check alarm created', { interval: '5 minutes' });
    } else {
      debugLogger.general('WARN', 'No API key available - session cache not initialized');
    }

      initializationState.completed = true;
      initializationState.timestamp = Date.now();
      debugLogger.general('INFO', 'Initialization completed successfully', {
        source,
        timestamp: new Date(initializationState.timestamp).toISOString()
      });

      return apiKeyValue;
    } catch (error) {
      initializationState.error = error as Error;
      debugLogger.general('ERROR', 'Error initializing session cache', {
        error: (error as Error).message || (error as Error).name || 'Unknown error'
      }, error as Error);
      sessionCache.isAuthenticated = false;
      throw error;
    } finally {
      initializationState.inProgress = false;
      // Clear the promise reference to allow retry on failure
      initPromise = null;
    }
  })();

  return initPromise;
}

export async function refreshSessionCache(apiKeyParam: string): Promise<void> {
  debugLogger.general('INFO', 'Refreshing session cache', { 
    hasApiKey: !!apiKeyParam, 
    timestamp: new Date().toISOString() 
  });

  try {
    if (apiKeyParam) {
      debugLogger.general('DEBUG', 'API key available - refreshing session data');

      // Fetch user info
      debugLogger.general('DEBUG', 'Refreshing user info');
      const userInfo = await fetchUserInfo(apiKeyParam);
      sessionCache.userInfo = userInfo;

      // Fetch devices
      debugLogger.general('DEBUG', 'Refreshing devices');
      const devices = await fetchDevices(apiKeyParam);
      sessionCache.devices = devices;

      // Fetch recent pushes
      debugLogger.general('DEBUG', 'Refreshing recent pushes');
      const pushes = await fetchRecentPushes(apiKeyParam);
      sessionCache.recentPushes = pushes;

      // Update session cache
      sessionCache.isAuthenticated = true;
      sessionCache.lastUpdated = Date.now();

      debugLogger.general('INFO', 'Session cache refreshed successfully', { 
        hasUserInfo: !!sessionCache.userInfo, 
        deviceCount: sessionCache.devices.length, 
        pushCount: sessionCache.recentPushes.length, 
        lastUpdated: new Date(sessionCache.lastUpdated).toISOString() 
      });
    } else {
      debugLogger.general('WARN', 'No API key available - cannot refresh session cache');
      sessionCache.isAuthenticated = false;
    }
  } catch (error) {
    debugLogger.general('ERROR', 'Error refreshing session cache', { 
      error: (error as Error).message 
    }, error as Error);
    throw error;
  }
}

