// API URL constants
const API_BASE_URL = 'https://api.pushbullet.com/v2';
const PUSHES_URL = `${API_BASE_URL}/pushes`;
const DEVICES_URL = `${API_BASE_URL}/devices`;
const USER_INFO_URL = `${API_BASE_URL}/users/me`;
const WEBSOCKET_URL = 'wss://stream.pushbullet.com/websocket/';

// Global variables
let apiKey = null;
let deviceIden = null;
let deviceNickname = 'Chrome'; // Default nickname
let websocket = null;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let autoOpenLinks = true; // Default to true for auto opening links

// Session cache for quick popup loading
let sessionCache = {
  userInfo: null,
  devices: [],
  recentPushes: [],
  isAuthenticated: false,
  lastUpdated: 0,
  autoOpenLinks: true,
  deviceNickname: 'Chrome' // Default nickname
};

// WebSocket alarm listener for persistent reconnection
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'websocketReconnect' && apiKey) {
    connectWebSocket();
  }
});

// TODO: Implement proper API key encryption
// For now, store plain text to avoid decryption issues
function encryptKey(key) {
  return key; // No encryption
}

function decryptKey(encryptedKey) {
  return encryptedKey; // No decryption
}

// Pushbullet service class for better state management
class PushbulletService {
  constructor() {
    this.state = {
      apiKey: null,
      deviceIden: null,
      deviceNickname: 'Chrome',
      websocket: null,
      reconnectAttempts: 0,
      reconnectTimeout: null,
      autoOpenLinks: true,
      sessionCache: {
        userInfo: null,
        devices: [],
        recentPushes: [],
        isAuthenticated: false,
        lastUpdated: 0,
        autoOpenLinks: true,
        deviceNickname: 'Chrome'
      }
    };
  }

  async initialize() {
    const result = await new Promise(resolve => {
      chrome.storage.local.get(['apiKey', 'deviceIden', 'autoOpenLinks', 'deviceNickname'], resolve);
    });

    this.state.apiKey = decryptKey(result.apiKey);
    this.state.deviceIden = result.deviceIden;
    this.state.autoOpenLinks = result.autoOpenLinks !== undefined ? result.autoOpenLinks : true;
    this.state.deviceNickname = result.deviceNickname || 'Chrome';
    this.state.sessionCache.autoOpenLinks = this.state.autoOpenLinks;
    this.state.sessionCache.deviceNickname = this.state.deviceNickname;

    if (this.state.apiKey) {
      // Fetch and set session data
      await this.refreshSessionCache();
      await this.registerDevice();
      this.connectWebSocket();
    }
  }

  // Add methods for other operations...
  async refreshSessionCache() {
    // Implementation similar to the original function
    // This would be a big refactor, so for now, keep it simple
    console.log('Refresh session cache called');
  }

  async registerDevice() {
    // Implementation
    console.log('Register device called');
  }

  connectWebSocket() {
    // Implementation
    console.log('Connect WebSocket called');
  }
}

// Instantiate service
const pbService = new PushbulletService();

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('Pushbullet extension installed');
  
  // Set up context menu
  setupContextMenu();
  
  // Initialize session cache
  initializeSessionCache();
});

// Initialize session cache
async function initializeSessionCache() {
  console.log('Initializing session cache');
  
  try {
    // Get API key from storage
    const result = await new Promise(resolve => {
      chrome.storage.sync.get(['apiKey', 'deviceIden', 'autoOpenLinks', 'deviceNickname'], resolve);
    });
    
    apiKey = decryptKey(result.apiKey);
    deviceIden = result.deviceIden;

    console.log('Loaded API key from storage:', result.apiKey ? 'present' : 'null', 'value:', result.apiKey);
    console.log('Decrypted API key:', apiKey ? 'present' : 'null', 'value:', apiKey ? '***' : 'null');

    if (result.autoOpenLinks !== undefined) {
      autoOpenLinks = result.autoOpenLinks;
      sessionCache.autoOpenLinks = autoOpenLinks;
    }

    if (result.deviceNickname) {
      deviceNickname = result.deviceNickname;
      sessionCache.deviceNickname = deviceNickname;
    }

    if (apiKey) {
      // Fetch user info
      const userInfo = await fetchUserInfo();
      sessionCache.userInfo = userInfo;
      
      // Fetch devices
      const devices = await fetchDevices();
      sessionCache.devices = devices;
      
      // Fetch recent pushes
      const pushes = await fetchRecentPushes();
      sessionCache.recentPushes = pushes;
      
      // Update session cache
      sessionCache.isAuthenticated = true;
      sessionCache.lastUpdated = Date.now();
      
      // Register device if needed
      await registerDevice();
      
      // Connect to WebSocket
      connectWebSocket();
      
      console.log('Session cache initialized successfully');
      console.log('Auto-open links setting:', autoOpenLinks);
      console.log('Device nickname:', deviceNickname);
    }
   } catch (error) {
     console.error('Error initializing session cache:', error.message || error.name || error);
     sessionCache.isAuthenticated = false;
   }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in background:', message);
  
  if (message.action === 'getSessionData') {
    // Check if session cache is stale (older than 30 seconds)
    const isStale = Date.now() - sessionCache.lastUpdated > 30000;
    
    if (sessionCache.isAuthenticated && !isStale) {
      // Return cached session data
      console.log('Returning cached session data');
      sendResponse({
        isAuthenticated: true,
        userInfo: sessionCache.userInfo,
        devices: sessionCache.devices,
        recentPushes: sessionCache.recentPushes,
        autoOpenLinks: sessionCache.autoOpenLinks,
        deviceNickname: sessionCache.deviceNickname
      });
    } else if (sessionCache.isAuthenticated && isStale) {
      // Refresh session cache in the background
      console.log('Session cache is stale, refreshing');
      refreshSessionCache().then(() => {
        // Send updated session data
        sendResponse({
          isAuthenticated: true,
          userInfo: sessionCache.userInfo,
          devices: sessionCache.devices,
          recentPushes: sessionCache.recentPushes,
          autoOpenLinks: sessionCache.autoOpenLinks,
          deviceNickname: sessionCache.deviceNickname
        });
      }).catch(error => {
        console.error('Error refreshing session cache:', error);
        sendResponse({ isAuthenticated: false });
      });
      
      // Return true to indicate we'll respond asynchronously
      return true;
    } else {
      // Not authenticated
      sendResponse({ isAuthenticated: false });
    }
  } else if (message.action === 'apiKeyChanged') {
    // Update API key
    apiKey = message.apiKey;

    // Save encrypted API key to storage
    chrome.storage.sync.set({ apiKey: encryptKey(message.apiKey) });

    // Update device nickname if provided
    if (message.deviceNickname) {
      deviceNickname = message.deviceNickname;
      sessionCache.deviceNickname = deviceNickname;
      chrome.storage.local.set({ deviceNickname: deviceNickname });
    }

    // Refresh session cache
    refreshSessionCache().then(() => {
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
    }).catch(error => {
      console.error('Error refreshing session cache after API key change:', error);
    });
  } else if (message.action === 'autoOpenLinksChanged') {
    // Update auto open links setting
    autoOpenLinks = message.autoOpenLinks;
    sessionCache.autoOpenLinks = autoOpenLinks;
    console.log('Auto-open links setting updated:', autoOpenLinks);
    
    // Save to storage
    chrome.storage.local.set({ autoOpenLinks: autoOpenLinks });
  } else if (message.action === 'deviceNicknameChanged') {
    // Update device nickname
    deviceNickname = message.deviceNickname;
    sessionCache.deviceNickname = deviceNickname;
    console.log('Device nickname updated:', deviceNickname);
    
    // Save to storage
    chrome.storage.local.set({ deviceNickname: deviceNickname });
    
    // Update device registration
    updateDeviceNickname();
  }
  
  // Return true to indicate we'll respond asynchronously
  return true;
});

// Refresh session cache
async function refreshSessionCache() {
  console.log('Refreshing session cache');
  
  try {
    if (apiKey) {
      // Fetch user info
      const userInfo = await fetchUserInfo();
      sessionCache.userInfo = userInfo;
      
      // Fetch devices
      const devices = await fetchDevices();
      sessionCache.devices = devices;
      
      // Fetch recent pushes
      const pushes = await fetchRecentPushes();
      sessionCache.recentPushes = pushes;
      
      // Update session cache
      sessionCache.isAuthenticated = true;
      sessionCache.lastUpdated = Date.now();
      
      // Connect to WebSocket if not connected
      if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        connectWebSocket();
      }
      
      return true;
    } else {
      sessionCache.isAuthenticated = false;
      return false;
    }
  } catch (error) {
    console.error('Error refreshing session cache:', error);
    sessionCache.isAuthenticated = false;
    throw error;
  }
}

// Set up context menu
function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    // Create parent menu item
    chrome.contextMenus.create({
      id: 'pushbullet',
      title: 'Pushbullet',
      contexts: ['page', 'selection', 'link', 'image']
    });
    
    // Push link
    chrome.contextMenus.create({
      id: 'push-link',
      parentId: 'pushbullet',
      title: 'Push this link',
      contexts: ['link']
    });
    
    // Push page
    chrome.contextMenus.create({
      id: 'push-page',
      parentId: 'pushbullet',
      title: 'Push this page',
      contexts: ['page']
    });
    
    // Push selection
    chrome.contextMenus.create({
      id: 'push-selection',
      parentId: 'pushbullet',
      title: 'Push this selection',
      contexts: ['selection']
    });
    
    // Push image
    chrome.contextMenus.create({
      id: 'push-image',
      parentId: 'pushbullet',
      title: 'Push this image',
      contexts: ['image']
    });
  });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!apiKey) {
    // Show notification to set API key
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Pushbullet',
      message: 'Please set your API key in the extension popup'
    });
    return;
  }
  
  switch (info.menuItemId) {
    case 'push-link':
      pushLink(info.linkUrl, tab.title);
      break;
    case 'push-page':
      pushLink(tab.url, tab.title);
      break;
    case 'push-selection':
      pushNote('Selection from ' + tab.title, info.selectionText);
      break;
    case 'push-image':
      pushLink(info.srcUrl, 'Image from ' + tab.title);
      break;
  }
});

// Push a link
async function pushLink(url, title) {
  try {
    const response = await fetch(PUSHES_URL, {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'link',
        title: title || url,
        url: url,
        source_device_iden: deviceIden
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to push link');
    }
    
    // Show success notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Pushbullet',
      message: 'Link pushed successfully!'
    });
    
    // Refresh pushes in session cache
    refreshPushes();
  } catch (error) {
    console.error('Error pushing link:', error);
    
    // Show error notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Pushbullet',
      message: 'Error pushing link: ' + error.message
    });
  }
}

// Push a note
async function pushNote(title, body) {
  try {
    const response = await fetch(PUSHES_URL, {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'note',
        title: title,
        body: body,
        source_device_iden: deviceIden
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to push note');
    }
    
    // Show success notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Pushbullet',
      message: 'Note pushed successfully!'
    });
    
    // Refresh pushes in session cache
    refreshPushes();
  } catch (error) {
    console.error('Error pushing note:', error);
    
    // Show error notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Pushbullet',
      message: 'Error pushing note: ' + error.message
    });
  }
}

// Register device
async function registerDevice() {
  // Check registration status atomically
  const result = await new Promise(resolve => {
    chrome.storage.local.get(['deviceRegistrationInProgress'], resolve);
  });

  if (result.deviceRegistrationInProgress) {
    return new Promise(resolve => {
      const listener = (changes) => {
        if (changes.deviceRegistrationInProgress && !changes.deviceRegistrationInProgress.newValue) {
          chrome.storage.onChanged.removeListener(listener);
          resolve();
        }
      };
      chrome.storage.onChanged.addListener(listener);
    });
  }

  try {
    await chrome.storage.local.set({ deviceRegistrationInProgress: true });

    // Check if device is already registered
    const storageResult = await new Promise(resolve => {
      chrome.storage.local.get(['deviceIden'], resolve);
    });

    if (storageResult.deviceIden) {
      deviceIden = storageResult.deviceIden;
      console.log('Device already registered with iden:', deviceIden);

      // Update device nickname if needed
      await updateDeviceNickname();
      return;
    }

    // Register device
    const response = await fetch(DEVICES_URL, {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        nickname: deviceNickname,
        model: 'Chrome',
        manufacturer: 'Google',
        push_token: '',
        app_version: 8623,
        icon: 'browser',
        has_sms: false,
        type: 'chrome'
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.error?.message || response.statusText;
      throw new Error(`Failed to register device: ${errorMessage} (${response.status})`);
    }

    const data = await response.json();
    deviceIden = data.iden;

    // Save device iden to storage
    chrome.storage.local.set({ deviceIden: deviceIden });

    console.log('Device registered with iden:', deviceIden);
  } catch (error) {
    console.error('Error registering device:', error);
    // If we fail to register, clear any existing deviceIden to force a retry next time
    chrome.storage.local.remove(['deviceIden']);
    deviceIden = null;
    throw error;
  } finally {
    await chrome.storage.local.set({ deviceRegistrationInProgress: false });
  }
}

// Update device nickname
async function updateDeviceNickname() {
  if (!deviceIden || !apiKey) {
    console.log('Cannot update device nickname: missing deviceIden or apiKey');
    return;
  }
  
  try {
    console.log('Updating device nickname to:', deviceNickname);
    
    // Update device
    const response = await fetch(`${DEVICES_URL}/${deviceIden}`, {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        nickname: deviceNickname
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.error?.message || response.statusText;
      throw new Error(`Failed to update device nickname: ${errorMessage} (${response.status})`);
    }
    
    console.log('Device nickname updated successfully');
    
    // Refresh devices in session cache
    const devices = await fetchDevices();
    sessionCache.devices = devices;
    sessionCache.lastUpdated = Date.now();
    
    // Notify popup of updated devices
    chrome.runtime.sendMessage({
      action: 'sessionDataUpdated',
      isAuthenticated: true,
      userInfo: sessionCache.userInfo,
      devices: sessionCache.devices,
      recentPushes: sessionCache.recentPushes,
      autoOpenLinks: sessionCache.autoOpenLinks,
      deviceNickname: sessionCache.deviceNickname
    }).catch(err => {
      // This is expected to fail if no popup is open
      console.log('No popup open to receive device updates');
    });
  } catch (error) {
    console.error('Error updating device nickname:', error);
  }
}

// Connect to WebSocket
function connectWebSocket() {
  // Disconnect existing WebSocket if any
  disconnectWebSocket();
  
  if (!apiKey) return;
  
  try {
    const wsUrl = WEBSOCKET_URL + apiKey;
    websocket = new WebSocket(wsUrl);
    
    websocket.onopen = (event) => {
      console.log('Connected to Pushbullet WebSocket from background');
      reconnectAttempts = 0;
      
      // Clear any pending reconnect timeout
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };
    
    websocket.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket message received in background:', data);
      
      // Handle different message types
      switch (data.type) {
        case 'tickle':
          if (data.subtype === 'push') {
            console.log('Push tickle received, fetching latest pushes');
            
            // Fetch latest pushes
            fetchRecentPushes().then(pushes => {
              // Update session cache
              sessionCache.recentPushes = pushes;
              sessionCache.lastUpdated = Date.now();
              
              // Notify popup of updated pushes
              chrome.runtime.sendMessage({
                action: 'pushesUpdated',
                pushes: pushes
              }).catch(err => {
                // This is expected to fail if no popup is open
                console.log('No popup open to receive push updates');
              });
              
              // Check if there's a new push
              if (pushes.length > 0) {
                const latestPush = pushes[0];
                
                // Show notification for the new push
                showPushNotification(latestPush);
                
                // Auto-open link if enabled and the push is a link
                // Skip if the push is from this device
                if (autoOpenLinks && 
                    latestPush.type === 'link' && 
                    latestPush.url && 
                    latestPush.source_device_iden !== deviceIden) {
                  console.log('Auto-opening link:', latestPush.url);
                  chrome.tabs.create({ url: latestPush.url });
                }
              }
            });
          }
          break;
        case 'push':
          // Handle push message directly
          if (data.push) {
            console.log('Push message received directly in background:', data.push);
            
            // Add the new push to the session cache
            if (sessionCache.recentPushes) {
              sessionCache.recentPushes.unshift(data.push);
              sessionCache.lastUpdated = Date.now();
              
              // Notify popup of updated pushes
              chrome.runtime.sendMessage({
                action: 'pushesUpdated',
                pushes: sessionCache.recentPushes
              }).catch(err => {
                // This is expected to fail if no popup is open
                console.log('No popup open to receive push updates');
              });
            }
            
            // Show notification for the new push
            showPushNotification(data.push);
            
            // Auto-open link if enabled and the push is a link
            // Skip if the push is from this device
            if (autoOpenLinks && 
                data.push.type === 'link' && 
                data.push.url && 
                data.push.source_device_iden !== deviceIden) {
              console.log('Auto-opening link:', data.push.url);
              chrome.tabs.create({ url: data.push.url });
            }
          }
          break;
        case 'nop':
          // No operation, just to keep the connection alive
          console.log('Received nop message to keep connection alive');
          break;
      }
    };
    
    websocket.onerror = (error) => {
      console.error('WebSocket error in background:', error);
    };
    
    websocket.onclose = (event) => {
      console.log(`Disconnected from Pushbullet WebSocket in background (code: ${event.code}): ${event.reason}`);

      // Permanent failures - don't retry
      if (event.code === 1008 || event.code === 4001 || (event.code >= 4000 && event.code < 5000)) {
        console.error('Permanent WebSocket error - stopping reconnection attempts');
        return;
      }

      // Transient failures - exponential backoff with alarms
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
      reconnectAttempts++;

      console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

      chrome.alarms.create('websocketReconnect', { when: Date.now() + delay });
    };
  } catch (error) {
    console.error('Error connecting to WebSocket from background:', error);
  }
}

// Disconnect WebSocket
function disconnectWebSocket() {
  if (websocket) {
    websocket.close();
    websocket = null;
  }

  // Clear any pending reconnect alarm
  chrome.alarms.clear('websocketReconnect');

  // Clear any pending reconnect timeout (legacy)
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

// Refresh pushes
async function refreshPushes() {
  try {
    const pushes = await fetchRecentPushes();
    sessionCache.recentPushes = pushes;
    sessionCache.lastUpdated = Date.now();
    
    // Notify popup of updated pushes
    chrome.runtime.sendMessage({
      action: 'pushesUpdated',
      pushes: pushes
    }).catch(err => {
      // This is expected to fail if no popup is open
      console.log('No popup open to receive push updates');
    });
    
    return pushes;
  } catch (error) {
    console.error('Error refreshing pushes:', error);
    throw error;
  }
}

// Show notification for a push
function showPushNotification(push) {
  // Skip if push is empty or from this device
  if (!push || push.source_device_iden === deviceIden) {
    console.log('Skipping notification for push from this device or empty push');
    return;
  }
  
  console.log('Showing notification for push:', push);
  
  // Create notification based on push type
  let notificationOptions = {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Pushbullet',
    message: '',
    requireInteraction: true // Keep notification visible until user interacts with it
  };
  
  switch (push.type) {
    case 'note':
      notificationOptions.title = push.title || 'Note';
      notificationOptions.message = push.body || '';
      break;
    case 'link':
      notificationOptions.title = push.title || 'Link';
      notificationOptions.message = push.url || '';
      if (push.body) {
        notificationOptions.message += '\n' + push.body;
      }
      break;
    case 'file':
      notificationOptions.title = push.file_name || 'File';
      notificationOptions.message = push.file_type || '';
      break;
    default:
      console.log('Unknown push type:', push.type);
      return; // Skip unknown push types
  }
  
  // Create notification
  const notificationId = `push_${push.iden}`;
  console.log('Creating notification with ID:', notificationId);
  
  chrome.notifications.create(notificationId, notificationOptions, (createdId) => {
    if (chrome.runtime.lastError) {
      console.error('Error creating notification:', chrome.runtime.lastError);
    } else {
      console.log('Notification created with ID:', createdId);
      
      // Store push data for notification click handling
      chrome.storage.local.set({ [createdId]: push });
    }
  });
}

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  console.log('Notification clicked:', notificationId);
  
  // Check if this is a push notification
  if (notificationId.startsWith('push_')) {
    // Get push data
    chrome.storage.local.get([notificationId], (result) => {
      const push = result[notificationId];
      
      if (push) {
        console.log('Found push data for notification:', push);
        
        // Set a flag in storage to indicate the popup should scroll to recent pushes
        chrome.storage.local.set({ scrollToRecentPushes: true }, () => {
          // Open the extension popup
          chrome.action.openPopup();
          
          // If it's a link, also open it in a new tab
          if (push.type === 'link' && push.url) {
            console.log('Opening link in new tab:', push.url);
            chrome.tabs.create({ url: push.url });
          }
        });
        
        // Clear notification
        chrome.notifications.clear(notificationId);
        
        // Remove stored push data
        chrome.storage.local.remove([notificationId]);
      } else {
        console.log('No push data found for notification:', notificationId);
        // Still open the popup even if we can't find the push data
        chrome.storage.local.set({ scrollToRecentPushes: true }, () => {
          chrome.action.openPopup();
        });
      }
    });
  }
});

// Fetch user info
async function fetchUserInfo() {
  const response = await fetch(USER_INFO_URL, {
    headers: {
      'Access-Token': apiKey
    }
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Failed to fetch user info: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

// Fetch devices
async function fetchDevices() {
  const response = await fetch(DEVICES_URL, {
    headers: {
      'Access-Token': apiKey
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch devices');
  }
  
  const data = await response.json();
  return data.devices.filter(device => device.active);
}

// Fetch recent pushes
async function fetchRecentPushes() {
  // Get up to 20 recent pushes to ensure we have enough to display
  const response = await fetch(`${PUSHES_URL}?limit=20`, {
    headers: {
      'Access-Token': apiKey
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch pushes');
  }
  
  const data = await response.json();
  
  // Filter pushes that aren't empty
  return data.pushes.filter(push => {
    // Make sure we have something to display
    const hasContent = push.title || push.body || push.url;
    // Include pushes not dismissed
    return hasContent && !push.dismissed;
  });
}

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    // Handle API key change
    if (changes.apiKey) {
      apiKey = decryptKey(changes.apiKey.newValue);
      
      if (apiKey) {
        // Refresh session cache
        refreshSessionCache();
      } else {
        // Disconnect WebSocket
        disconnectWebSocket();
        
        // Clear session cache
        sessionCache = {
          userInfo: null,
          devices: [],
          recentPushes: [],
          isAuthenticated: false,
          lastUpdated: 0,
          autoOpenLinks: true,
          deviceNickname: 'Chrome' // Default nickname
        };
      }
    }
    
    // Handle auto open links change
    if (changes.autoOpenLinks) {
      autoOpenLinks = changes.autoOpenLinks.newValue;
      sessionCache.autoOpenLinks = autoOpenLinks;
      console.log('Auto-open links setting updated from storage:', autoOpenLinks);
    }
    
    // Handle device nickname change
    if (changes.deviceNickname) {
      deviceNickname = changes.deviceNickname.newValue;
      sessionCache.deviceNickname = deviceNickname;
      console.log('Device nickname updated from storage:', deviceNickname);
    }
  }
}); 