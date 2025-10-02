/* global apiKey, deviceIden, deviceNickname, debugLogger, performanceMonitor, sessionCache, PUSHES_URL, DEVICES_URL, USER_INFO_URL, chrome */

// API utilities extracted from background.js

async function fetchUserInfo() {
  const startTime = Date.now();
  debugLogger.api('INFO', 'Fetching user info', { url: USER_INFO_URL, hasApiKey: !!apiKey, timestamp: new Date().toISOString() });
  try {
    const response = await fetch(USER_INFO_URL, { headers: { 'Access-Token': apiKey } });
    const duration = Date.now() - startTime;
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      const error = new Error(`Failed to fetch user info: ${response.status} ${response.statusText} - ${errorText}`);
      debugLogger.api('ERROR', 'User info fetch failed', { url: USER_INFO_URL, status: response.status, statusText: response.statusText, duration: `${duration}ms`, errorText }, error);
      throw error;
    }
    const data = await response.json();
    debugLogger.api('INFO', 'User info fetched successfully', { url: USER_INFO_URL, status: response.status, duration: `${duration}ms`, userEmail: data.email ? data.email.substring(0, 3) + '***' : 'unknown', userName: data.name || 'unknown' });
    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    debugLogger.api('ERROR', 'User info fetch error', { url: USER_INFO_URL, duration: `${duration}ms`, error: error.message }, error);
    throw error;
  }
}

async function fetchDevices() {
  const startTime = Date.now();
  debugLogger.api('INFO', 'Fetching devices', { url: DEVICES_URL, hasApiKey: !!apiKey, timestamp: new Date().toISOString() });
  try {
    const response = await fetch(DEVICES_URL, { headers: { 'Access-Token': apiKey } });
    const duration = Date.now() - startTime;
    if (!response.ok) {
      const error = new Error(`Failed to fetch devices: ${response.status} ${response.statusText}`);
      debugLogger.api('ERROR', 'Devices fetch failed', { url: DEVICES_URL, status: response.status, statusText: response.statusText, duration: `${duration}ms` }, error);
      throw error;
    }
    const data = await response.json();
    const activeDevices = data.devices.filter(device => device.active);
    debugLogger.api('INFO', 'Devices fetched successfully', { url: DEVICES_URL, status: response.status, duration: `${duration}ms`, totalDevices: data.devices.length, activeDevices: activeDevices.length });
    return activeDevices;
  } catch (error) {
    const duration = Date.now() - startTime;
    debugLogger.api('ERROR', 'Devices fetch error', { url: DEVICES_URL, duration: `${duration}ms`, error: error.message }, error);
    throw error;
  }
}

async function fetchRecentPushes() {
  const startTime = Date.now();
  const url = `${PUSHES_URL}?limit=20`;
  debugLogger.api('INFO', 'Fetching recent pushes', { url, hasApiKey: !!apiKey, timestamp: new Date().toISOString() });
  try {
    const response = await fetch(url, { headers: { 'Access-Token': apiKey } });
    const duration = Date.now() - startTime;
    if (!response.ok) {
      const error = new Error(`Failed to fetch pushes: ${response.status} ${response.statusText}`);
      debugLogger.api('ERROR', 'Pushes fetch failed', { url, status: response.status, statusText: response.statusText, duration: `${duration}ms` }, error);
      throw error;
    }
    const data = await response.json();
    const filteredPushes = data.pushes.filter(push => {
      const hasContent = push.title || push.body || push.url;
      return hasContent && !push.dismissed;
    });
    debugLogger.api('INFO', 'Pushes fetched successfully', { url, status: response.status, duration: `${duration}ms`, totalPushes: data.pushes.length, filteredPushes: filteredPushes.length, pushTypes: filteredPushes.map(p => p.type).join(', ') });
    return filteredPushes;
  } catch (error) {
    const duration = Date.now() - startTime;
    debugLogger.api('ERROR', 'Pushes fetch error', { url, duration: `${duration}ms`, error: error.message }, error);
    throw error;
  }
}

async function registerDevice() {
  debugLogger.general('INFO', 'Starting device registration process', { hasApiKey: !!apiKey, currentDeviceIden: deviceIden, deviceNickname, timestamp: new Date().toISOString() });
  const result = await new Promise(resolve => { chrome.storage.local.get(['deviceRegistrationInProgress'], resolve); });
  if (result.deviceRegistrationInProgress) {
    debugLogger.general('INFO', 'Device registration already in progress - waiting for completion');
    return new Promise(resolve => {
      const listener = (changes) => { if (changes.deviceRegistrationInProgress && !changes.deviceRegistrationInProgress.newValue) { chrome.storage.onChanged.removeListener(listener); debugLogger.general('INFO', 'Device registration completed by another process'); resolve(); } };
      chrome.storage.onChanged.addListener(listener);
    });
  }
  try {
    await chrome.storage.local.set({ deviceRegistrationInProgress: true });
    const storageResult = await new Promise(resolve => { chrome.storage.local.get(['deviceIden'], resolve); });
    if (storageResult.deviceIden) {
      deviceIden = storageResult.deviceIden;
      debugLogger.general('INFO', 'Device already registered', { deviceIden, deviceNickname });
      try { await updateDeviceNickname(); await chrome.storage.local.set({ deviceRegistrationInProgress: false }); return; }
      catch (error) { debugLogger.general('WARN', 'Failed to update existing device, will re-register', { error: error.message, deviceIden }); deviceIden = null; await chrome.storage.local.remove(['deviceIden']); }
    }
    debugLogger.general('INFO', 'Registering new device with Pushbullet API', { deviceNickname, url: DEVICES_URL });
    const registrationData = { nickname: deviceNickname, model: 'Chrome', manufacturer: 'Google', push_token: '', app_version: 8623, icon: 'browser', has_sms: false, type: 'chrome' };
    debugLogger.api('INFO', 'Sending device registration request', { url: DEVICES_URL, method: 'POST', deviceData: registrationData });
    const startTime = Date.now();
    const response = await fetch(DEVICES_URL, { method: 'POST', headers: { 'Access-Token': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(registrationData) });
    const duration = Date.now() - startTime;
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.error?.message || response.statusText;
      const error = new Error(`Failed to register device: ${errorMessage} (${response.status})`);
      debugLogger.api('ERROR', 'Device registration failed', { url: DEVICES_URL, status: response.status, statusText: response.statusText, duration: `${duration}ms`, errorMessage, errorData }, error);
      throw error;
    }
    const data = await response.json();
    deviceIden = data.iden;
    debugLogger.api('INFO', 'Device registration successful', { url: DEVICES_URL, status: response.status, duration: `${duration}ms`, deviceIden, deviceNickname: data.nickname });
    chrome.storage.local.set({ deviceIden: deviceIden });
    debugLogger.general('INFO', 'Device registration completed successfully', { deviceIden, deviceNickname });
  } catch (error) {
    debugLogger.general('ERROR', 'Error during device registration', { error: error.message, deviceNickname }, error);
    chrome.storage.local.remove(['deviceIden']);
    deviceIden = null;
    throw error;
  } finally {
    await chrome.storage.local.set({ deviceRegistrationInProgress: false });
  }
}

async function updateDeviceNickname() {
  if (!deviceIden || !apiKey) { debugLogger.general('DEBUG', 'Cannot update device nickname: missing deviceIden or apiKey', { hasDeviceIden: !!deviceIden, hasApiKey: !!apiKey }); return; }
  try {
    debugLogger.general('INFO', 'Updating device nickname on server', { deviceIden, deviceNickname, url: `${DEVICES_URL}/${deviceIden}` });
    const response = await fetch(`${DEVICES_URL}/${deviceIden}`, { method: 'POST', headers: { 'Access-Token': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: deviceNickname }) });
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.error?.message || response.statusText;
      debugLogger.general('ERROR', 'Failed to update device nickname on server', { status: response.status, statusText: response.statusText, errorMessage, deviceIden });
      throw new Error(`Failed to update device nickname: ${errorMessage} (${response.status})`);
    }
    debugLogger.general('INFO', 'Device nickname updated successfully on server', { deviceIden, deviceNickname });
    const devices = await fetchDevices();
    sessionCache.devices = devices;
    sessionCache.lastUpdated = Date.now();
    chrome.runtime.sendMessage({ action: 'sessionDataUpdated', isAuthenticated: true, userInfo: sessionCache.userInfo, devices: sessionCache.devices, recentPushes: sessionCache.recentPushes, autoOpenLinks: sessionCache.autoOpenLinks, deviceNickname: sessionCache.deviceNickname }).catch(() => {});
  } catch (error) {
    debugLogger.general('ERROR', 'Error in updateDeviceNickname function', { errorMessage: error.message, errorStack: error.stack });
    throw error;
  }
}

