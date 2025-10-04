/**
 * Utility functions for background service worker
 */

import { debugLogger } from '../lib/logging';
import { performanceMonitor } from '../lib/perf';
import { sessionCache } from '../app/session';
import { fetchRecentPushes, fetchDevices } from '../app/api/client';
import {
  getApiKey,
  setApiKey,
  getDeviceIden,
  setDeviceIden,
  getAutoOpenLinks,
  setAutoOpenLinks,
  getDeviceNickname,
  setDeviceNickname,
  getNotificationTimeout,
  setNotificationTimeout,
  setPollingMode,
  isPollingMode
} from './state';
import type { Push, LinkPush } from '../types/domain';
import { isLinkPush } from '../types/domain';
import { createNotificationWithTimeout } from '../app/notifications';
import { ensureConfigLoaded } from '../app/reconnect';

// Counter to ensure unique notification IDs
let notificationCounter = 0;

// Guard flag to prevent concurrent context menu setup
// Ensures idempotent behavior when multiple startup events fire
let isSettingUpContextMenu = false;

/**
 * Connection status for icon updates
 */
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

/**
 * Sanitize text to prevent XSS attacks
 * Removes HTML tags and dangerous characters
 *
 * DEFENSE-IN-DEPTH STRATEGY:
 * 1. This function provides basic sanitization for Chrome notification content
 * 2. The extension's CSP (Content Security Policy) provides strong XSS protection
 * 3. UI code (popup, options, etc.) uses textContent instead of innerHTML for user data
 * 4. This regex-based approach is sufficient for notification text (not rendered as HTML)
 *
 * NOTE: For HTML rendering, use textContent or a library like DOMPurify.
 * The popup's displayPushes() function correctly uses textContent for all user data.
 */
function sanitizeText(text: string): string {
  if (!text) return '';

  // Remove HTML tags
  let sanitized = text.replace(/<[^>]*>/g, '');

  // Remove script-like content
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');

  // Trim and limit length
  sanitized = sanitized.trim().substring(0, 1000);

  return sanitized;
}

/**
 * Sanitize URL to ensure it's safe
 */
function sanitizeUrl(url: string): string {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * Update extension icon tooltip to show current state
 */
export function updateExtensionTooltip(stateDescription: string): void {
  try {
    chrome.action.setTitle({ title: stateDescription });
    debugLogger.general('DEBUG', 'Updated extension tooltip', { stateDescription });
  } catch (error) {
    debugLogger.general('ERROR', 'Exception setting tooltip', {
      stateDescription,
      error: (error as Error).message
    }, error as Error);
  }
}

/**
 * Update extension icon based on connection status
 * Uses badge color instead of different icon files since service workers have issues loading icons
 */
export function updateConnectionIcon(status: ConnectionStatus): void {
  try {
    // Set badge text
    const badgeText = status === 'connected' ? '●' :
                      status === 'connecting' ? '◐' :
                      '○';

    // Set badge color
    const badgeColor = status === 'connected' ? '#4CAF50' :  // Green
                       status === 'connecting' ? '#FFC107' :  // Yellow
                       '#F44336';  // Red

    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: badgeColor });

    debugLogger.general('DEBUG', 'Updated connection status badge', { status, badgeText, badgeColor });
  } catch (error) {
    debugLogger.general('ERROR', 'Exception setting badge', {
      status,
      error: (error as Error).message
    }, error as Error);
  }
}

/**
 * Refresh pushes from API and show notifications for new ones
 */
export async function refreshPushes(notificationDataStore?: Map<string, Push>): Promise<void> {
  // RACE CONDITION FIX: Ensure configuration is loaded before processing pushes
  // This prevents the autoOpenLinks setting from being its default (false) value
  // when a push arrives before settings have finished loading from storage
  await ensureConfigLoaded();

  const apiKey = getApiKey();
  if (!apiKey) {
    debugLogger.general('WARN', 'Cannot refresh pushes - no API key');
    return;
  }

  try {
    debugLogger.general('DEBUG', 'Refreshing pushes from API');

    // Get current push idens to detect new ones
    const oldPushIdens = new Set(sessionCache.recentPushes.map(p => p.iden));

    const pushes = await fetchRecentPushes(apiKey);

    // Find NEW pushes (not in old cache)
    const newPushes = pushes.filter(p => !oldPushIdens.has(p.iden));

    debugLogger.general('INFO', 'Pushes refreshed successfully', {
      totalPushes: pushes.length,
      newPushes: newPushes.length
    });

    // Update cache
    sessionCache.recentPushes = pushes;
    sessionCache.lastUpdated = Date.now();

    // Show notifications for NEW pushes
    for (const push of newPushes) {
      debugLogger.general('INFO', 'Showing notification for new push from tickle', {
        pushIden: push.iden,
        pushType: push.type
      });
      // Don't await - fire and forget
      showPushNotification(push, notificationDataStore).catch((error) => {
        debugLogger.general('ERROR', 'Failed to show notification', { pushIden: push.iden }, error);
      });

      // Auto-open links if setting is enabled
      const autoOpenLinks = getAutoOpenLinks();
      if (autoOpenLinks && isLinkPush(push)) {
        debugLogger.general('INFO', 'Auto-opening link push from tickle', {
          pushIden: push.iden,
          url: (push as LinkPush).url
        });

        chrome.tabs.create({
          url: (push as LinkPush).url,
          active: false // Open in background to avoid disrupting user
        }).catch((error) => {
          debugLogger.general('ERROR', 'Failed to auto-open link from tickle', {
            url: (push as LinkPush).url
          }, error);
        });
      }
    }

    // Notify popup
    chrome.runtime.sendMessage({
      action: 'pushesUpdated',
      pushes: pushes
    }).catch(() => {
      // Popup may not be open
    });
  } catch (error) {
    debugLogger.general('ERROR', 'Failed to refresh pushes', null, error as Error);
  }
}

/**
 * Show push notification
 */
export async function showPushNotification(push: Push, notificationDataStore?: Map<string, Push>): Promise<void> {
  try {
    // Log the full push object for debugging
    debugLogger.notifications('INFO', 'Showing push notification', {
      pushType: push.type,
      hasTitle: !!('title' in push && push.title),
      pushKeys: Object.keys(push),
      pushJson: JSON.stringify(push)
    });

    let title = 'Pushbullet';
    let message = '';
    const iconUrl = 'icons/icon128.png'; // Always use local icon

    // Handle different push types
    const pushType = push.type;

    // Check for mirrored SMS notifications first (before generic mirror handler)
    // The application_name might vary between Android phones, so we check if it includes 'messaging'
    if (pushType === 'mirror' && push.application_name?.toLowerCase().includes('messaging')) {
      title = `SMS: ${push.title}`; // push.title contains the sender's name/number
      message = push.body || '';
    } else if (pushType === 'note') {
      title = push.title || 'Note';
      message = push.body || '';
    } else if (pushType === 'link') {
      title = push.title || 'Link';
      message = push.url || '';
    } else if (pushType === 'file') {
      title = push.file_name || 'File';
      message = push.body || push.file_url || '';
    } else if (pushType === 'mirror') {
      title = push.title || push.application_name || 'Notification';
      message = push.body || '';
    } else if (pushType === 'sms_changed') {
      // SMS notification from phone
      const smsData = push as any;
      if (smsData.notifications && smsData.notifications.length > 0) {
        const sms = smsData.notifications[0];
        title = sms.title || 'SMS';
        message = sms.body || '';
      } else {
        title = 'SMS';
        message = 'New SMS received';
      }
    } else if (pushType === 'dismissal') {
      // Don't show notifications for dismissals
      debugLogger.notifications('DEBUG', 'Skipping dismissal push notification');
      return;
    } else if (pushType === 'ping' || pushType === 'pong') {
      // These are internal keep-alive messages, do not show a notification
      debugLogger.notifications('DEBUG', 'Ignoring internal push type', { pushType });
      return;
    } else {
      // Unknown type - show raw data
      title = 'Push';
      message = JSON.stringify(push).substring(0, 200);
      debugLogger.notifications('WARN', 'Unknown push type', { pushType, push });
      performanceMonitor.recordUnknownPushType();
    }

    // Create notification with GUARANTEED unique ID
    // Use counter + timestamp to ensure no ID collisions even for rapid notifications
    const notificationId = `pushbullet-push-${++notificationCounter}-${Date.now()}`;

    // Store push data for detail view (SECURITY FIX M-06: uses size-limited store)
    if (notificationDataStore) {
      // Import addToNotificationStore from background/index.ts would create circular dependency
      // So we just use the Map directly here - the size limit is enforced in background/index.ts
      notificationDataStore.set(notificationId, push);
    }

    createNotificationWithTimeout(
      notificationId,
      {
        type: 'basic',
        iconUrl, // Always use local icon, never external URLs
        title: title.substring(0, 100), // Limit title length
        message: message.substring(0, 200), // Limit message length
        priority: 1
      },
      (createdId) => {
        debugLogger.notifications('INFO', 'Push notification created', {
          notificationId: createdId,
          pushType: push.type
        });
        performanceMonitor.recordNotification('push_notification_created');
        performanceMonitor.recordNotificationCreated();
      }
    );
  } catch (error) {
    debugLogger.notifications('ERROR', 'Failed to show push notification', {
      error: (error as Error).message,
      pushType: push.type
    }, error as Error);
    performanceMonitor.recordNotificationFailed();
  }
}

/**
 * Check if we should enter polling mode
 */
export function checkPollingMode(): void {
  const qualityMetrics = performanceMonitor.getQualityMetrics();
  
  if (qualityMetrics.consecutiveFailures >= 3 && !isPollingMode()) {
    debugLogger.general('WARN', 'Entering polling mode due to consecutive failures', {
      consecutiveFailures: qualityMetrics.consecutiveFailures
    });
    
    setPollingMode(true);
    
    // Start polling alarm
    chrome.alarms.create('pollingFallback', { periodInMinutes: 1 });
    
    debugLogger.general('INFO', 'Polling mode activated', { interval: '1 minute' });
  }
}

/**
 * Stop polling mode
 */
export function stopPollingMode(): void {
  if (isPollingMode()) {
    debugLogger.general('INFO', 'Stopping polling mode - WebSocket reconnected');
    setPollingMode(false);
    chrome.alarms.clear('pollingFallback');
  }
}

/**
 * Perform polling fetch
 */
export async function performPollingFetch(): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    debugLogger.general('WARN', 'Cannot perform polling fetch - no API key');
    return;
  }

  debugLogger.general('DEBUG', 'Performing polling fetch', { 
    timestamp: new Date().toISOString() 
  });

  try {
    // Fetch recent pushes
    const pushes = await fetchRecentPushes(apiKey);

    // Check for new pushes
    const latestPush = pushes[0];
    if (latestPush && sessionCache.recentPushes[0]?.iden !== latestPush.iden) {
      debugLogger.general('INFO', 'New push detected via polling', {
        pushId: latestPush.iden,
        pushType: latestPush.type
      });

      // Update session cache
      sessionCache.recentPushes = pushes;

      // Notify popup
      chrome.runtime.sendMessage({
        action: 'pushesUpdated',
        pushes: pushes
      }).catch(() => {});
    }
  } catch (error) {
    debugLogger.general('ERROR', 'Polling fetch failed', null, error as Error);
  }
}

/**
 * Perform WebSocket health check
 */
export function performWebSocketHealthCheck(wsClient: any, connectFn: () => void): void {
  const apiKey = getApiKey();
  
  // If we have an API key but WebSocket is not connected, reconnect
  if (apiKey && (!wsClient || !wsClient.isConnected())) {
    debugLogger.websocket('WARN', 'Health check failed - WebSocket not connected', {
      hasWebSocket: !!wsClient,
      isConnected: wsClient ? wsClient.isConnected() : false
    });

    performanceMonitor.recordHealthCheckFailure();
    connectFn();
  } else if (wsClient && wsClient.isConnected()) {
    debugLogger.websocket('DEBUG', 'Health check passed - WebSocket connected');
    performanceMonitor.recordHealthCheckSuccess();
  } else {
    debugLogger.websocket('DEBUG', 'Health check skipped - no API key');
  }
}

/**
 * Update popup connection state
 */
export function updatePopupConnectionState(state: string): void {
  chrome.runtime.sendMessage({
    action: 'connectionStateChanged',
    state: state
  }).catch(() => {
    // Popup may not be open
  });
}

/**
 * Setup context menu
 * Idempotent - safe to call from multiple event listeners
 */
export function setupContextMenu(): void {
  // Guard against concurrent setup attempts
  if (isSettingUpContextMenu) {
    debugLogger.general('INFO', 'Context menu setup already in progress, skipping');
    return;
  }

  isSettingUpContextMenu = true;

  try {
    chrome.contextMenus.removeAll(() => {
      // Check for errors from removeAll
      if (chrome.runtime.lastError) {
        debugLogger.general('ERROR', 'Failed to remove existing context menus', {
          error: chrome.runtime.lastError.message
        });
        isSettingUpContextMenu = false;
        return;
      }

      // Now that menus are removed, create new ones
      try {
        chrome.contextMenus.create({
          id: 'push-link',
          title: 'Push this link',
          contexts: ['link']
        });
        if (chrome.runtime.lastError) {
          debugLogger.general('ERROR', 'Failed to create push-link menu', {
            error: chrome.runtime.lastError.message
          });
        }

        chrome.contextMenus.create({
          id: 'push-page',
          title: 'Push this page',
          contexts: ['page']
        });
        if (chrome.runtime.lastError) {
          debugLogger.general('ERROR', 'Failed to create push-page menu', {
            error: chrome.runtime.lastError.message
          });
        }

        chrome.contextMenus.create({
          id: 'push-selection',
          title: 'Push selected text',
          contexts: ['selection']
        });
        if (chrome.runtime.lastError) {
          debugLogger.general('ERROR', 'Failed to create push-selection menu', {
            error: chrome.runtime.lastError.message
          });
        }

        chrome.contextMenus.create({
          id: 'push-image',
          title: 'Push this image',
          contexts: ['image']
        });
        if (chrome.runtime.lastError) {
          debugLogger.general('ERROR', 'Failed to create push-image menu', {
            error: chrome.runtime.lastError.message
          });
        }

        debugLogger.general('INFO', 'Context menu created successfully');
      } finally {
        // Always clear the guard flag when done
        isSettingUpContextMenu = false;
      }
    });
  } catch (error) {
    debugLogger.general('ERROR', 'Failed to create context menu', null, error as Error);
    isSettingUpContextMenu = false;
  }
}

/**
 * Push a link
 */
export async function pushLink(url: string, title?: string): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    debugLogger.general('WARN', 'Cannot push link - no API key');
    return;
  }

  // Sanitize inputs to prevent XSS
  const sanitizedUrl = sanitizeUrl(url);
  const sanitizedTitle = sanitizeText(title || 'Link');

  if (!sanitizedUrl) {
    debugLogger.general('ERROR', 'Invalid URL provided', { url });
    return;
  }

  try {
    const response = await fetch('https://api.pushbullet.com/v2/pushes', {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'link',
        title: sanitizedTitle,
        url: sanitizedUrl
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to push link: ${response.status}`);
    }

    debugLogger.general('INFO', 'Link pushed successfully', { url, title });
    
    createNotificationWithTimeout(
      'pushbullet-link-sent',
      {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Link Sent',
        message: title || url
      }
    );
  } catch (error) {
    debugLogger.general('ERROR', 'Failed to push link', { url, title }, error as Error);
  }
}

/**
 * Push a note
 */
export async function pushNote(title: string, body: string): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    debugLogger.general('WARN', 'Cannot push note - no API key');
    return;
  }

  // Sanitize inputs to prevent XSS
  const sanitizedTitle = sanitizeText(title);
  const sanitizedBody = sanitizeText(body);

  try {
    const response = await fetch('https://api.pushbullet.com/v2/pushes', {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'note',
        title: sanitizedTitle,
        body: sanitizedBody
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to push note: ${response.status}`);
    }

    debugLogger.general('INFO', 'Note pushed successfully', { title });
    
    createNotificationWithTimeout(
      'pushbullet-note-sent',
      {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Note Sent',
        message: title
      }
    );
  } catch (error) {
    debugLogger.general('ERROR', 'Failed to push note', { title }, error as Error);
  }
}

