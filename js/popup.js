'use strict';

// DOM elements
const loadingSection = document.getElementById('loading-section');
const loginSection = document.getElementById('login-section');
const mainSection = document.getElementById('main-section');
const apiKeyInput = document.getElementById('api-key');
const deviceNicknameInput = document.getElementById('device-nickname');
const saveApiKeyButton = document.getElementById('save-api-key');
const logoutButton = document.getElementById('logout');
const userImage = document.getElementById('user-image');
const userName = document.getElementById('user-name');
const connectionIndicator = document.getElementById('connection-indicator');
const pushTypeNoteBtn = document.getElementById('push-type-note');
const pushTypeLinkBtn = document.getElementById('push-type-link');
const noteForm = document.getElementById('note-form');
const linkForm = document.getElementById('link-form');
const noteTitleInput = document.getElementById('note-title');
const noteBodyInput = document.getElementById('note-body');
const linkTitleInput = document.getElementById('link-title');
const linkUrlInput = document.getElementById('link-url');
const linkBodyInput = document.getElementById('link-body');
const targetDeviceSelect = document.getElementById('target-device');
const sendPushButton = document.getElementById('send-push');
const pushesList = document.getElementById('pushes-list');
const statusMessage = document.getElementById('status-message');
const openSettingsBtn = document.getElementById('open-settings');
const openDebugDashboardBtn = document.getElementById('open-debug-dashboard');

// API URL constants
const API_BASE_URL = 'https://api.pushbullet.com/v2';
const USER_INFO_URL = `${API_BASE_URL}/users/me`;
const DEVICES_URL = `${API_BASE_URL}/devices`;
const PUSHES_URL = `${API_BASE_URL}/pushes`;
const WEBSOCKET_URL = 'wss://stream.pushbullet.com/websocket/';

// State variables
let apiKey = null;
let deviceNickname = 'Chrome'; // Default nickname
let devices = [];
let websocket = null;
let hasInitialized = false;
let currentPushType = 'note'; // Default to note

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Popup DOM loaded');

  // Set up event listeners
  setupEventListeners();

  // Keep all sections hidden initially
  hideAllSections();

  // Listen for messages from the background script
  setupMessageListener();

  // Try to get session data from background script first (for instant loading)
  chrome.runtime.sendMessage(
    {
      action: 'getSessionData',
    },
    (response) => {
      if (response && response.isAuthenticated) {
        console.log('Received session data from background script:', response);
        // We have cached session data, use it
        const syncPromise = new Promise((resolve) => {
          chrome.storage.sync.get(['apiKey'], resolve);
        });
        const localPromise = new Promise((resolve) => {
          chrome.storage.local.get(['scrollToRecentPushes'], resolve);
        });
        Promise.all([syncPromise, localPromise]).then(
          ([syncResult, localResult]) => {
            const result = { ...syncResult, ...localResult };
            if (result.apiKey) {
              apiKey = result.apiKey;

              // Set up the UI with cached data
              setupWithCachedData(response);

              // Check if we should scroll to recent pushes
              if (result.scrollToRecentPushes) {
                // Clear the flag
                chrome.storage.local.remove(['scrollToRecentPushes']);

                // Scroll to recent pushes section after a short delay to ensure the UI is fully rendered
                setTimeout(() => {
                  scrollToRecentPushes();
                }, 100);
              }
            } else {
              showSection('login');
            }
          },
        );
      } else {
        console.log('No session data available, checking storage');
        // No cached session data, check storage
        checkStorageForApiKey();
      }
    },
  );
});

// Set up message listener for real-time updates
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Message received in popup:', message);

    // Handle pushes updated message from background script
    if (message.action === 'pushesUpdated' && message.pushes) {
      console.log('Received updated pushes from background script');
      displayPushes(message.pushes);
    }

    // Handle session data updated message
    if (message.action === 'sessionDataUpdated' && message.isAuthenticated) {
      console.log('Received updated session data from background script');
      setupWithCachedData(message);
    }

    // Always return true to indicate we'll respond asynchronously
    return true;
  });
}

// Hide all sections initially
function hideAllSections() {
  loadingSection.style.display = 'none';
  loginSection.style.display = 'none';
  mainSection.style.display = 'none';
}

// Set up UI with cached data
function setupWithCachedData(response) {
  console.log('Setting up UI with cached data');
  devices = response.devices;

  // Update auto-open links setting (stored in background, no UI in popup)
  if (response.autoOpenLinks !== undefined) {
    // Just store it, no checkbox to update in popup anymore
    console.log('Auto-open links setting:', response.autoOpenLinks);
  }

  // Update device nickname (stored in background, no UI in popup)
  if (response.deviceNickname) {
    deviceNickname = response.deviceNickname;
    console.log('Device nickname:', deviceNickname);
  }

  // Update user info
  if (response.userInfo) {
    updateUserInfo(response.userInfo);
  }

  // Populate device dropdown
  populateDeviceDropdown(response.devices);

  // Display pushes
  displayPushes(response.recentPushes);

  // Show main section immediately
  showSection('main');

  // Update connection indicator based on WebSocket state
  if (response.websocketConnected) {
    updateConnectionIndicator('connected');
  } else {
    updateConnectionIndicator('connecting');
  }

  // Connect to WebSocket for real-time updates
  connectWebSocket();

  hasInitialized = true;
}

// Check storage for API key
function checkStorageForApiKey() {
  console.log('Checking storage for API key');
  // Show loading section while checking storage
  showSection('loading');

  const syncPromise = new Promise((resolve) => {
    chrome.storage.sync.get(
      ['apiKey', 'autoOpenLinks', 'deviceNickname'],
      resolve,
    );
  });
  const localPromise = new Promise((resolve) => {
    chrome.storage.local.get(['scrollToRecentPushes'], resolve);
  });

  Promise.all([syncPromise, localPromise]).then(
    async ([syncResult, localResult]) => {
      const result = { ...syncResult, ...localResult };
      if (result.apiKey) {
        apiKey = result.apiKey;

        if (result.autoOpenLinks !== undefined) {
          // Just log it, no checkbox to update in popup anymore
          console.log('Auto-open links setting:', result.autoOpenLinks);
        }

        if (result.deviceNickname) {
          deviceNickname = result.deviceNickname;
          console.log('Device nickname:', deviceNickname);
        }

        try {
          await initializeAuthenticated();
          showSection('main');
          hasInitialized = true;

          // Check if we should scroll to recent pushes
          if (result.scrollToRecentPushes) {
            // Clear the flag
            chrome.storage.local.remove(['scrollToRecentPushes']);

            // Scroll to recent pushes section after a short delay to ensure the UI is fully rendered
            setTimeout(() => {
              scrollToRecentPushes();
            }, 100);
          }
        } catch (error) {
          console.error('Error initializing:', error);
          showSection('login');
        }
      } else {
        showSection('login');
      }
    },
  );
}

// Show the specified section and hide others
function showSection(section) {
  console.log('Showing section:', section);
  loadingSection.style.display = section === 'loading' ? 'flex' : 'none';
  loginSection.style.display = section === 'login' ? 'block' : 'none';
  mainSection.style.display = section === 'main' ? 'block' : 'none';
}

// Set up event listeners
function setupEventListeners() {
  // Save API key button
  saveApiKeyButton.addEventListener('click', saveApiKey);

  // API key input - save on Enter key
  apiKeyInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
      saveApiKey();
    }
  });

  // Device nickname input - save on Enter key
  deviceNicknameInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
      saveApiKey();
    }
  });

  // Logout button
  logoutButton.addEventListener('click', logout);

  // Push type buttons
  pushTypeNoteBtn.addEventListener('click', () => togglePushType('note'));
  pushTypeLinkBtn.addEventListener('click', () => togglePushType('link'));

  // Send push button
  sendPushButton.addEventListener('click', sendPush);

  // Open settings button
  openSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Open debug dashboard button
  openDebugDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL('debug-dashboard.html')
    });
  });
}

// Save API key
async function saveApiKey() {
  const newApiKey = apiKeyInput.value.trim();
  const newNickname = deviceNicknameInput.value.trim() || 'Chrome'; // Default to 'Chrome' if empty

  if (!newApiKey) {
    showStatus('Please enter an Access Token.', 'error');
    return;
  }

  showSection('loading');

  try {
    // Validate API key by making a request to get user info
    const response = await fetch(USER_INFO_URL, {
      headers: {
        'Access-Token': newApiKey,
      },
    });

    if (!response.ok) {
      throw new Error('Invalid Access Token');
    }

    // Save API key and device nickname to storage
    chrome.storage.sync.set(
      {
        apiKey: newApiKey,
        deviceNickname: newNickname,
      },
      async () => {
        apiKey = newApiKey;
        deviceNickname = newNickname;

        // Notify background script about API key and nickname change
        chrome.runtime.sendMessage({
          action: 'apiKeyChanged',
          apiKey: newApiKey,
          deviceNickname: newNickname,
        });

        try {
          await initializeAuthenticated();
          showSection('main');
          hasInitialized = true;
        } catch (error) {
          showStatus(`Error: ${error.message}`, 'error');
          showSection('login');
        }
      },
    );
  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
    showSection('login');
  }
}

// Logout
function logout() {
  disconnectWebSocket();
  chrome.storage.sync.remove(['apiKey']);
  chrome.storage.local.remove(['deviceIden']);
  apiKey = null;
  hasInitialized = false;
  showSection('login');
  apiKeyInput.value = '';
  deviceNicknameInput.value = '';
}

// Initialize authenticated state
async function initializeAuthenticated() {
  try {
    // Get user info
    const userInfo = await fetchUserInfo();

    // Get devices
    devices = await fetchDevices();

    // Populate device dropdown
    populateDeviceDropdown(devices);

    // Get recent pushes
    const pushes = await fetchRecentPushes();

    // Display pushes
    displayPushes(pushes);

    // Update UI
    updateUserInfo(userInfo);

    // Connect to WebSocket for real-time updates
    connectWebSocket();

    return true;
  } catch (error) {
    console.error('Error in initializeAuthenticated:', error);
    throw error;
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
      console.log('Connected to Pushbullet WebSocket from popup');
    };

    websocket.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket message received in popup:', data);

      // Handle different message types
      switch (data.type) {
      case 'tickle':
        if (data.subtype === 'push') {
          console.log(
            'Push tickle received in popup, fetching latest pushes',
          );
          // Refresh pushes when a new push arrives
          const pushes = await fetchRecentPushes();
          displayPushes(pushes);
        }
        break;
      case 'push':
        // Handle push message directly
        if (data.push) {
          console.log('Push message received directly in popup:', data.push);
          // Add the new push to the list
          const pushes = await fetchRecentPushes();
          displayPushes(pushes);
        }
        break;
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error in popup:', error);
    };

    websocket.onclose = (event) => {
      console.log('Disconnected from Pushbullet WebSocket in popup');

      // Try to reconnect after a delay
      setTimeout(() => {
        if (apiKey && hasInitialized) {
          connectWebSocket();
        }
      }, 5000);
    };
  } catch (error) {
    console.error('Error connecting to WebSocket from popup:', error);
  }
}

// Disconnect WebSocket
function disconnectWebSocket() {
  if (websocket) {
    websocket.close();
    websocket = null;
  }
}

// Fetch user info
async function fetchUserInfo() {
  const response = await fetch(USER_INFO_URL, {
    headers: {
      'Access-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user info');
  }

  return response.json();
}

// Fetch devices
async function fetchDevices() {
  const response = await fetch(DEVICES_URL, {
    headers: {
      'Access-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch devices');
  }

  const data = await response.json();
  return data.devices.filter((device) => device.active);
}

// Fetch recent pushes
async function fetchRecentPushes() {
  // Get up to 20 recent pushes to ensure we have enough to display
  const response = await fetch(`${PUSHES_URL}?limit=20`, {
    headers: {
      'Access-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch pushes');
  }

  const data = await response.json();

  // Get the current device iden
  let deviceIden = null;
  try {
    const deviceResult = await new Promise((resolve) => {
      chrome.storage.local.get(['deviceIden'], resolve);
    });
    deviceIden = deviceResult.deviceIden;
  } catch (error) {
    console.error('Error getting device iden:', error);
  }

  // Filter pushes that aren't empty
  return data.pushes.filter((push) => {
    // Make sure we have something to display
    const hasContent = push.title || push.body || push.url;
    // Include pushes not sent from this device, and those not dismissed
    return hasContent && !push.dismissed;
  });
}

// Update user info in UI
function updateUserInfo(userInfo) {
  userName.textContent = userInfo.name || userInfo.email;

  if (userInfo.image_url) {
    userImage.src = userInfo.image_url;
    userImage.style.display = 'block';
  } else {
    userImage.style.display = 'none';
  }
}

// Populate device dropdown
function populateDeviceDropdown(devicesList) {
  // Use provided devices list or fallback to the global devices variable
  const devicesToUse = devicesList || devices;

  // Clear existing options except for 'All Devices'
  while (targetDeviceSelect.options.length > 1) {
    targetDeviceSelect.remove(1);
  }

  // Add devices to dropdown
  devicesToUse.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.iden;
    option.textContent = device.nickname || device.model || 'Unknown Device';
    targetDeviceSelect.appendChild(option);
  });
}

// Display pushes in the UI
function displayPushes(pushes) {
  pushesList.innerHTML = '';

  if (!pushes || pushes.length === 0) {
    pushesList.innerHTML = '<p>No recent pushes</p>';
    return;
  }

  // Only show the 10 most recent pushes
  const recentPushes = pushes.slice(0, 10);

  recentPushes.forEach((push) => {
    if (!push.title && !push.body && !push.url) {
      return; // Skip empty pushes
    }

    const pushItem = document.createElement('div');
    pushItem.className = 'push-item';

    // Add a timestamp
    if (push.created) {
      const timestamp = new Date(push.created * 1000);
      const timeElement = document.createElement('div');
      timeElement.className = 'push-time';
      timeElement.textContent = formatTimestamp(timestamp);
      pushItem.appendChild(timeElement);
    }

    if (push.title) {
      const title = document.createElement('div');
      title.className = 'push-title';
      title.textContent = push.title;
      pushItem.appendChild(title);
    }

    if (push.url) {
      const url = document.createElement('a');
      url.href = push.url;
      url.target = '_blank';
      url.className = 'push-url';
      url.textContent = push.url;
      pushItem.appendChild(url);
    }

    if (push.body) {
      const body = document.createElement('div');
      body.className = 'push-body';
      body.textContent = push.body;
      pushItem.appendChild(body);
    }

    pushesList.appendChild(pushItem);
  });
}

// Format timestamp
function formatTimestamp(date) {
  const now = new Date();
  const diffMs = now - date;
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
    return 'just now';
  }
}

// Toggle between push types
async function togglePushType(type) {
  currentPushType = type;

  // Update button styles
  pushTypeNoteBtn.classList.toggle('active', type === 'note');
  pushTypeLinkBtn.classList.toggle('active', type === 'link');

  if (type === 'note') {
    noteForm.style.display = 'block';
    linkForm.style.display = 'none';
  } else if (type === 'link') {
    noteForm.style.display = 'none';
    linkForm.style.display = 'block';

    // Auto-populate link fields with current tab info
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs[0]) {
        linkUrlInput.value = tabs[0].url || '';
        linkTitleInput.value = tabs[0].title || '';
      }
    } catch (error) {
      console.error('Error getting current tab info:', error);
    }
  }
}

// Send push
async function sendPush() {
  try {
    const pushType = currentPushType;
    const targetDevice = targetDeviceSelect.value;
    let pushData = {
      type: pushType,
    };

    // Set device target
    if (targetDevice !== 'all') {
      pushData.device_iden = targetDevice;
    }

    // Get the source device iden
    try {
      const deviceResult = await new Promise((resolve) => {
        chrome.storage.local.get(['deviceIden'], resolve);
      });
      if (deviceResult.deviceIden) {
        pushData.source_device_iden = deviceResult.deviceIden;
      }
    } catch (error) {
      console.error('Error getting device iden:', error);
    }

    // Set push data based on type
    if (pushType === 'note') {
      pushData.title = noteTitleInput.value.trim();
      pushData.body = noteBodyInput.value.trim();

      if (!pushData.title && !pushData.body) {
        showStatus('Please enter a title or body for the note.', 'error');
        return;
      }
    } else if (pushType === 'link') {
      pushData.title = linkTitleInput.value.trim();
      pushData.url = linkUrlInput.value.trim();
      pushData.body = linkBodyInput.value.trim();

      if (!pushData.url) {
        showStatus('Please enter a URL for the link.', 'error');
        return;
      }
    }

    // Send push
    console.log('Sending push:', pushData);
    const response = await fetch(PUSHES_URL, {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pushData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Push failed:', response.status, errorText);
      let errorMessage = 'Failed to send push';
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error && errorData.error.message) {
          errorMessage = errorData.error.message;
        }
      } catch (e) {
        // Use default error message
      }
      throw new Error(errorMessage);
    }

    // Clear form
    clearPushForm();

    // Show success message
    showStatus('Push sent successfully!', 'success');

    // Reload pushes
    const pushes = await fetchRecentPushes();
    displayPushes(pushes);
  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
  }
}

// Clear push form
function clearPushForm() {
  noteTitleInput.value = '';
  noteBodyInput.value = '';
  linkTitleInput.value = '';
  linkUrlInput.value = '';
  linkBodyInput.value = '';
}

// Show status message
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = type; // 'success' or 'error'

  // Clear message after 3 seconds
  setTimeout(() => {
    statusMessage.textContent = '';
    statusMessage.className = '';
  }, 3000);
}

// Scroll to recent pushes section
function scrollToRecentPushes() {
  const recentPushesSection = document.querySelector('.recent-pushes');
  if (recentPushesSection) {
    console.log('Scrolling to recent pushes section');
    recentPushesSection.scrollIntoView({
      behavior: 'smooth',
    });
  }
}

// Update connection indicator
function updateConnectionIndicator(state) {
  if (!connectionIndicator) return;

  // Remove all state classes
  connectionIndicator.classList.remove('connected', 'connecting', 'disconnected', 'polling');

  // Add new state class
  connectionIndicator.classList.add(state);

  // Update title
  const titles = {
    connected: 'Connected - Real-time updates active',
    connecting: 'Connecting...',
    disconnected: 'Disconnected - Reconnecting...',
    polling: 'Polling mode - Limited updates'
  };
  connectionIndicator.title = titles[state] || 'Unknown status';

  console.log('Connection indicator updated:', state);
}

// Listen for connection state changes from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'connectionStateChanged') {
    updateConnectionIndicator(message.state);
  } else if (message.action === 'pushesUpdated') {
    // Update pushes list
    if (message.pushes) {
      displayPushes(message.pushes);
    }
  }
});

