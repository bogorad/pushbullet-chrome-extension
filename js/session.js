/* global chrome, debugLogger, decryptKey, fetchUserInfo, fetchDevices, fetchRecentPushes, registerDevice, connectWebSocket, performanceMonitor, WS_READY_STATE, initializationState, apiKey, deviceIden, autoOpenLinks, deviceNickname, notificationTimeout, sessionCache */

// Session state and initialization extracted from background.js

let sessionCache = {
  userInfo: null,
  devices: [],
  recentPushes: [],
  isAuthenticated: false,
  lastUpdated: 0,
  autoOpenLinks: undefined,
  deviceNickname: undefined
};

async function initializeSessionCache(source = 'unknown') {
  if (initializationState.inProgress) { throw new Error('Initialization already in progress'); }
  if (initializationState.completed) {
    debugLogger.general('WARN', 'Already initialized, skipping', { source, previousTimestamp: initializationState.timestamp });
    return;
  }
  initializationState.inProgress = true;
  try {
    debugLogger.general('INFO', 'Initializing session cache', { source, timestamp: new Date().toISOString() });
    // Load core settings from sync
    debugLogger.storage('DEBUG', 'Loading initial configuration from sync storage');
    const result = await new Promise(resolve => { chrome.storage.sync.get(['apiKey','deviceIden','autoOpenLinks','deviceNickname','notificationTimeout'], resolve); });
    apiKey = decryptKey(result.apiKey);
    deviceIden = result.deviceIden;
    if (result.autoOpenLinks === undefined) { autoOpenLinks = true; await chrome.storage.sync.set({ autoOpenLinks: true }); } else { autoOpenLinks = result.autoOpenLinks; }
    if (result.notificationTimeout === undefined) { notificationTimeout = 10000; await chrome.storage.sync.set({ notificationTimeout: 10000 }); } else { notificationTimeout = result.notificationTimeout; }
    if (result.deviceNickname === undefined || result.deviceNickname === null) { deviceNickname = 'Chrome'; await chrome.storage.sync.set({ deviceNickname: 'Chrome' }); } else { deviceNickname = result.deviceNickname; }
    debugLogger.storage('INFO', 'Loaded configuration from sync storage', { hasApiKey: !!result.apiKey, hasDeviceIden: !!result.deviceIden, autoOpenLinks, deviceNickname, notificationTimeout });
    debugLogger.general('DEBUG', 'Decrypted API key status', { hasDecryptedKey: !!apiKey, decryptedKeyLength: apiKey ? apiKey.length : 0 });
    debugLogger.general('DEBUG', 'Auto-open links setting loaded', { autoOpenLinks });
    debugLogger.general('DEBUG', 'Notification timeout loaded', { notificationTimeout });
    debugLogger.general('DEBUG', 'Device nickname loaded', { deviceNickname });
    if (apiKey) {
      debugLogger.general('INFO', 'API key available - initializing session data');
      const userInfo = await fetchUserInfo();
      sessionCache.userInfo = userInfo;
      const devices = await fetchDevices();
      sessionCache.devices = devices;
      const pushes = await fetchRecentPushes();
      sessionCache.recentPushes = pushes;
      sessionCache.isAuthenticated = true;
      sessionCache.lastUpdated = Date.now();
      sessionCache.autoOpenLinks = autoOpenLinks;
      sessionCache.deviceNickname = deviceNickname;
      debugLogger.general('INFO', 'Session cache populated successfully', { hasUserInfo: !!sessionCache.userInfo, deviceCount: sessionCache.devices.length, pushCount: sessionCache.recentPushes.length, lastUpdated: new Date(sessionCache.lastUpdated).toISOString() });
      await registerDevice();
      connectWebSocket();
      chrome.alarms.create('websocketHealthCheck', { periodInMinutes: 5 });
      debugLogger.general('DEBUG', 'WebSocket health check alarm created', { interval: '5 minutes' });
    } else {
      debugLogger.general('WARN', 'No API key available - session cache not initialized');
    }
    initializationState.completed = true;
    initializationState.timestamp = Date.now();
    debugLogger.general('INFO', 'Initialization completed successfully', { source, timestamp: new Date(initializationState.timestamp).toISOString() });
  } catch (error) {
    initializationState.error = error;
    debugLogger.general('ERROR', 'Error initializing session cache', { error: error.message || error.name || 'Unknown error' }, error);
    sessionCache.isAuthenticated = false;
    throw error;
  } finally {
    initializationState.inProgress = false;
  }
}

