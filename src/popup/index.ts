/**
 * Popup page - Full TypeScript implementation
 */

import type { Push, Device, UserInfo } from '../types/domain';
import { getElementById, formatTimestamp as formatTimestampUtil } from '../lib/ui/dom';

// API URLs
const USER_INFO_URL = 'https://api.pushbullet.com/v2/users/me';
const DEVICES_URL = 'https://api.pushbullet.com/v2/devices';
const PUSHES_URL = 'https://api.pushbullet.com/v2/pushes';
// WEBSOCKET_URL removed - popup no longer maintains its own WebSocket connection
// The background script manages the single, persistent WebSocket connection

// Type definitions
interface SessionData {
  isAuthenticated: boolean;
  devices: Device[];
  userInfo: UserInfo;
  recentPushes: Push[];
  autoOpenLinks: boolean;
  websocketConnected?: boolean;
  deviceNickname?: string;
}

type PushType = 'note' | 'link' | 'file';

interface PushData {
  type: PushType;
  device_iden?: string;
  source_device_iden?: string;
  title?: string;
  body?: string;
  url?: string;
  file_name?: string;
  file_type?: string;
  file_url?: string;
}

interface UploadRequestResponse {
  file_name: string;
  file_type: string;
  file_url: string;
  upload_url: string;
  data: Record<string, string>;
}

// DOM elements
const loadingSection = getElementById<HTMLDivElement>('loading-section');
const loginSection = getElementById<HTMLDivElement>('login-section');
const mainSection = getElementById<HTMLDivElement>('main-section');
const apiKeyInput = getElementById<HTMLInputElement>('api-key');
const deviceNicknameInput = getElementById<HTMLInputElement>('device-nickname');
const saveApiKeyButton = getElementById<HTMLButtonElement>('save-api-key');
const logoutButton = getElementById<HTMLButtonElement>('logout');
const userImage = getElementById<HTMLImageElement>('user-image');
const userName = getElementById<HTMLSpanElement>('user-name');
// Connection indicator removed - using badge instead
const pushTypeNoteBtn = getElementById<HTMLButtonElement>('push-type-note');
const pushTypeLinkBtn = getElementById<HTMLButtonElement>('push-type-link');
const pushTypeFileBtn = getElementById<HTMLButtonElement>('push-type-file');
const noteForm = getElementById<HTMLDivElement>('note-form');
const linkForm = getElementById<HTMLDivElement>('link-form');
const fileForm = getElementById<HTMLDivElement>('file-form');
const fileInput = getElementById<HTMLInputElement>('file-input');
const fileSelected = getElementById<HTMLDivElement>('file-selected');
const fileName = getElementById<HTMLSpanElement>('file-name');
const fileSize = getElementById<HTMLSpanElement>('file-size');
const noteTitleInput = getElementById<HTMLInputElement>('note-title');
const noteBodyInput = getElementById<HTMLTextAreaElement>('note-body');
const linkTitleInput = getElementById<HTMLInputElement>('link-title');
const linkUrlInput = getElementById<HTMLInputElement>('link-url');
const linkBodyInput = getElementById<HTMLTextAreaElement>('link-body');
const targetDeviceSelect = getElementById<HTMLSelectElement>('target-device');
const sendPushButton = getElementById<HTMLButtonElement>('send-push');
const pushesList = getElementById<HTMLDivElement>('pushes-list');
const statusMessage = getElementById<HTMLDivElement>('status-message');
const openSettingsBtn = getElementById<HTMLButtonElement>('open-settings');
const openDebugDashboardBtn = getElementById<HTMLButtonElement>('open-debug-dashboard');

// State variables
let apiKey: string | null = null;
let deviceNickname = 'Chrome';
let devices: Device[] = [];
let hasInitialized = false;
let currentPushType: PushType = 'note';
// websocket variable removed - background script manages the single WebSocket connection

/**
 * Initialize popup
 */
function init(): void {
  console.log('Popup initializing');
  setupEventListeners();
  checkStorageForApiKey();
}

/**
 * Initialize from session data (from background)
 */
async function initializeFromSessionData(response: SessionData): Promise<void> {
  if (!response.isAuthenticated) {
    showSection('login');
    return;
  }

  // Update device nickname
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

  // Show main section
  showSection('main');

  // Connection status is now shown via badge icon (no UI indicator needed)
  // WebSocket connection is managed by background script - popup receives updates via chrome.runtime.onMessage

  hasInitialized = true;
}

/**
 * Check storage for API key
 */
function checkStorageForApiKey(): void {
  console.log('Checking storage for API key');
  showSection('loading');

  const syncPromise = chrome.storage.sync.get(['apiKey', 'autoOpenLinks', 'deviceNickname']);
  const localPromise = chrome.storage.local.get(['scrollToRecentPushes']);

  Promise.all([syncPromise, localPromise]).then(
    async ([syncResult, localResult]) => {
      const result = { ...syncResult, ...localResult };
      if (result.apiKey) {
        apiKey = result.apiKey as string;

        if (result.autoOpenLinks !== undefined) {
          console.log('Auto-open links setting:', result.autoOpenLinks);
        }

        if (result.deviceNickname) {
          deviceNickname = result.deviceNickname as string;
          console.log('Device nickname:', deviceNickname);
        }

        try {
          await initializeAuthenticated();
          showSection('main');
          hasInitialized = true;

          // Check if we should scroll to recent pushes
          if (result.scrollToRecentPushes) {
            chrome.storage.local.remove(['scrollToRecentPushes']);
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

/**
 * Show section
 */
function showSection(section: 'loading' | 'login' | 'main'): void {
  console.log('Showing section:', section);
  loadingSection.style.display = section === 'loading' ? 'flex' : 'none';
  loginSection.style.display = section === 'login' ? 'block' : 'none';
  mainSection.style.display = section === 'main' ? 'block' : 'none';
}

/**
 * Set up event listeners
 */
function setupEventListeners(): void {
  // Save API key button
  saveApiKeyButton.addEventListener('click', saveApiKey);

  // API key input - save on Enter
  apiKeyInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
      saveApiKey();
    }
  });

  // Device nickname input - save on Enter
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
  pushTypeFileBtn.addEventListener('click', () => togglePushType('file'));

  // File input
  fileInput.addEventListener('change', handleFileSelect);

  // Send push button
  sendPushButton.addEventListener('click', sendPush);

  // Open settings
  openSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Open debug dashboard
  openDebugDashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL('debug-dashboard.html')
    });
  });
}

/**
 * Save API key
 */
async function saveApiKey(): Promise<void> {
  const newApiKey = apiKeyInput.value.trim();
  const newNickname = deviceNicknameInput.value.trim() || 'Chrome';

  if (!newApiKey) {
    showStatus('Please enter an Access Token.', 'error');
    return;
  }

  showSection('loading');

  try {
    // Validate API key
    const response = await fetch(USER_INFO_URL, {
      headers: {
        'Access-Token': newApiKey,
      },
    });

    if (!response.ok) {
      throw new Error('Invalid Access Token');
    }

    // Save to storage
    await chrome.storage.sync.set({
      apiKey: newApiKey,
      deviceNickname: newNickname,
    });

    apiKey = newApiKey;
    deviceNickname = newNickname;

    // Notify background
    chrome.runtime.sendMessage({
      action: 'apiKeyChanged',
      apiKey: newApiKey,
      deviceNickname: newNickname,
    }).catch((error) => {
      console.warn('Could not notify background of API key change:', error.message);
    });

    await initializeAuthenticated();
    showSection('main');
    hasInitialized = true;
  } catch (error) {
    showStatus(`Error: ${(error as Error).message}`, 'error');
    showSection('login');
  }
}

/**
 * Logout
 */
function logout(): void {
  // WebSocket disconnection is handled by background script
  chrome.storage.sync.remove(['apiKey']);
  chrome.storage.local.remove(['deviceIden']);
  apiKey = null;
  hasInitialized = false;

  // Notify background script to disconnect WebSocket
  chrome.runtime.sendMessage({ action: 'logout' }).catch((error) => {
    console.warn('Could not notify background of logout:', error.message);
  });

  showSection('login');
  apiKeyInput.value = '';
  deviceNicknameInput.value = '';
}

/**
 * Initialize authenticated state
 */
async function initializeAuthenticated(): Promise<boolean> {
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

    // WebSocket connection is managed by background script
    // Popup receives updates via chrome.runtime.onMessage

    return true;
  } catch (error) {
    console.error('Error in initializeAuthenticated:', error);
    throw error;
  }
}

/**
 * Fetch user info
 */
async function fetchUserInfo(): Promise<UserInfo> {
  if (!apiKey) throw new Error('No API key');

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

/**
 * Fetch devices
 */
async function fetchDevices(): Promise<Device[]> {
  if (!apiKey) throw new Error('No API key');

  const response = await fetch(DEVICES_URL, {
    headers: {
      'Access-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch devices');
  }

  const data = await response.json() as { devices: Device[] };
  return data.devices.filter((device) => device.active);
}

/**
 * Fetch recent pushes
 */
async function fetchRecentPushes(): Promise<Push[]> {
  if (!apiKey) throw new Error('No API key');

  const response = await fetch(`${PUSHES_URL}?limit=20`, {
    headers: {
      'Access-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch pushes');
  }

  const data = await response.json() as { pushes: Push[] };

  // Get device iden
  let deviceIden: string | null = null;
  try {
    const deviceResult = await chrome.storage.local.get(['deviceIden']);
    deviceIden = deviceResult.deviceIden as string;
  } catch (error) {
    console.error('Error getting device iden:', error);
  }

  // Filter pushes
  return data.pushes.filter((push) => {
    const hasContent = push.title || push.body || push.url;
    return hasContent && !push.dismissed;
  });
}

/**
 * REMOVED: connectWebSocket() and disconnectWebSocket()
 *
 * The popup no longer maintains its own WebSocket connection.
 * The background service worker manages a single, persistent WebSocket connection
 * and sends push updates to the popup via chrome.runtime.sendMessage with action 'pushesUpdated'.
 *
 * This architectural change:
 * - Eliminates dual state (popup and background having separate connections)
 * - Reduces resource consumption (only one WebSocket connection)
 * - Ensures connection persists when popup is closed
 * - Makes background script the single source of truth for WebSocket state
 */

/**
 * Update user info
 */
function updateUserInfo(userInfo: UserInfo): void {
  userName.textContent = userInfo.name || userInfo.email;

  if (userInfo.image_url) {
    userImage.src = userInfo.image_url;
    userImage.style.display = 'block';
  } else {
    userImage.style.display = 'none';
  }
}

/**
 * Populate device dropdown
 */
function populateDeviceDropdown(devicesList: Device[]): void {
  const devicesToUse = devicesList || devices;

  // Clear existing options except 'All Devices'
  while (targetDeviceSelect.options.length > 1) {
    targetDeviceSelect.remove(1);
  }

  // Add devices
  devicesToUse.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.iden;
    option.textContent = device.nickname || device.model || 'Unknown Device';
    targetDeviceSelect.appendChild(option);
  });
}

/**
 * Display pushes
 */
function displayPushes(pushes: Push[]): void {
  pushesList.innerHTML = '';

  if (!pushes || pushes.length === 0) {
    pushesList.innerHTML = '<p>No recent pushes</p>';
    return;
  }

  // Show 10 most recent
  const recentPushes = pushes.slice(0, 10);

  recentPushes.forEach((push) => {
    let title = push.title;
    let body = push.body;
    const url = push.url;

    // Handle SMS pushes
    if (push.type === 'sms_changed' && push.notifications && push.notifications.length > 0) {
      const sms = push.notifications[0];
      title = sms.title || 'SMS';
      body = sms.body || '';
    }

    // Skip empty
    if (!title && !body && !url) {
      return;
    }

    const pushItem = document.createElement('div');
    pushItem.className = 'push-item';

    // Add SMS badge
    if (push.type === 'sms_changed') {
      pushItem.classList.add('push-sms');
    }

    // Timestamp
    if (push.created) {
      const timestamp = new Date(push.created * 1000);
      const timeElement = document.createElement('div');
      timeElement.className = 'push-time';
      timeElement.textContent = formatTimestamp(timestamp);
      pushItem.appendChild(timeElement);
    }

    // Title
    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'push-title';
      titleEl.textContent = title;
      pushItem.appendChild(titleEl);
    }

    // URL
    if (url) {
      const urlEl = document.createElement('a');
      urlEl.href = url;
      urlEl.target = '_blank';
      urlEl.className = 'push-url';
      urlEl.textContent = url;
      pushItem.appendChild(urlEl);
    }

    // Body
    if (body) {
      const bodyEl = document.createElement('div');
      bodyEl.className = 'push-body';
      bodyEl.textContent = body;
      pushItem.appendChild(bodyEl);
    }

    pushesList.appendChild(pushItem);
  });
}

/**
 * Format timestamp
 */
function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
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

/**
 * Handle file selection
 */
function handleFileSelect(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    fileSelected.style.display = 'block';
  } else {
    fileSelected.style.display = 'none';
  }
}

/**
 * Format file size
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Toggle push type
 */
async function togglePushType(type: PushType): Promise<void> {
  currentPushType = type;

  // Update buttons
  pushTypeNoteBtn.classList.toggle('active', type === 'note');
  pushTypeLinkBtn.classList.toggle('active', type === 'link');
  pushTypeFileBtn.classList.toggle('active', type === 'file');

  if (type === 'note') {
    noteForm.style.display = 'block';
    linkForm.style.display = 'none';
    fileForm.style.display = 'none';
  } else if (type === 'link') {
    noteForm.style.display = 'none';
    linkForm.style.display = 'block';
    fileForm.style.display = 'none';

    // Auto-populate with current tab
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
  } else if (type === 'file') {
    noteForm.style.display = 'none';
    linkForm.style.display = 'none';
    fileForm.style.display = 'block';
  }
}

/**
 * Send push
 */
async function sendPush(): Promise<void> {
  if (!apiKey) return;

  try {
    const pushType = currentPushType;
    const targetDevice = targetDeviceSelect.value;
    const pushData: PushData = {
      type: pushType,
    };

    // Set device target
    if (targetDevice !== 'all') {
      pushData.device_iden = targetDevice;
    }

    // Get source device iden
    try {
      const deviceResult = await chrome.storage.local.get(['deviceIden']);
      if (deviceResult.deviceIden) {
        pushData.source_device_iden = deviceResult.deviceIden as string;
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
    } else if (pushType === 'file') {
      const file = fileInput.files?.[0];
      if (!file) {
        showStatus('Please select a file to attach.', 'error');
        return;
      }

      showStatus('Uploading file...', 'info');

      try {
        // Request upload authorization
        const uploadRequestResponse = await fetch('https://api.pushbullet.com/v2/upload-request', {
          method: 'POST',
          headers: {
            'Access-Token': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            file_name: file.name,
            file_type: file.type || 'application/octet-stream'
          })
        });

        if (!uploadRequestResponse.ok) {
          throw new Error('Failed to request file upload authorization');
        }

        const uploadData = await uploadRequestResponse.json() as UploadRequestResponse;

        // Upload to S3
        const formData = new FormData();
        Object.keys(uploadData.data).forEach(key => {
          formData.append(key, uploadData.data[key]);
        });
        formData.append('file', file);

        const uploadResponse = await fetch(uploadData.upload_url, {
          method: 'POST',
          body: formData
        });

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload file to server');
        }

        // Create file push
        pushData.type = 'file';
        pushData.file_name = uploadData.file_name;
        pushData.file_type = uploadData.file_type;
        pushData.file_url = uploadData.file_url;
        pushData.body = (document.getElementById('file-body') as HTMLTextAreaElement).value.trim();

        showStatus('File uploaded, sending push...', 'info');
      } catch (uploadError) {
        console.error('File upload error:', uploadError);
        showStatus('Failed to upload file: ' + (uploadError as Error).message, 'error');
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
        const errorData = JSON.parse(errorText) as { error?: { message?: string } };
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // Use default
      }
      throw new Error(errorMessage);
    }

    // Clear form
    clearPushForm();

    // Show success
    showStatus('Push sent successfully!', 'success');

    // Reload pushes
    const pushes = await fetchRecentPushes();
    displayPushes(pushes);
  } catch (error) {
    showStatus(`Error: ${(error as Error).message}`, 'error');
  }
}

/**
 * Clear push form
 */
function clearPushForm(): void {
  noteTitleInput.value = '';
  noteBodyInput.value = '';
  linkTitleInput.value = '';
  linkUrlInput.value = '';
  linkBodyInput.value = '';
  fileInput.value = '';
  (document.getElementById('file-body') as HTMLTextAreaElement).value = '';
  fileSelected.style.display = 'none';
}

/**
 * Show status message
 */
function showStatus(message: string, type: 'success' | 'error' | 'info'): void {
  statusMessage.textContent = message;
  statusMessage.className = type;

  setTimeout(() => {
    statusMessage.textContent = '';
    statusMessage.className = '';
  }, 3000);
}

/**
 * Scroll to recent pushes
 */
function scrollToRecentPushes(): void {
  const recentPushesSection = document.querySelector('.recent-pushes');
  if (recentPushesSection) {
    console.log('Scrolling to recent pushes section');
    recentPushesSection.scrollIntoView({
      behavior: 'smooth',
    });
  }
}

/**
 * Update connection indicator
 * REMOVED: Connection indicator UI element removed, using badge instead
 */
// function updateConnectionIndicator() - REMOVED

/**
 * Listen for messages from background
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'connectionStateChanged') {
    // Connection state changes now shown via badge icon only
    console.log('Connection state changed:', message.state);
  } else if (message.action === 'pushesUpdated') {
    if (message.pushes) {
      displayPushes(message.pushes as Push[]);
    }
  }
});

// Initialize on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

