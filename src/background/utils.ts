/**
 * Utility functions for background service worker
 */

import { debugLogger } from '../lib/logging';
import { performanceMonitor } from '../lib/perf';
import { sessionCache } from '../app/session';
import { fetchRecentPushes, fetchDevices } from '../app/api/client';
import { getApiKey, setPollingMode, isPollingMode } from './state';
import type { Push } from '../types/domain';
import { createNotificationWithTimeout } from '../app/notifications';

/**
 * Refresh pushes from API and show notifications for new ones
 */
export async function refreshPushes(): Promise<void> {
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
      await showPushNotification(push);
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
export async function showPushNotification(push: Push): Promise<void> {
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

    if (pushType === 'note') {
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
    } else {
      // Unknown type - show raw data
      title = 'Push';
      message = JSON.stringify(push).substring(0, 200);
      debugLogger.notifications('WARN', 'Unknown push type', { pushType, push });
    }

    // Create notification
    createNotificationWithTimeout(
      `pushbullet-push-${push.iden || Date.now()}`,
      {
        type: 'basic',
        iconUrl, // Always use local icon, never external URLs
        title: title.substring(0, 100), // Limit title length
        message: message.substring(0, 200), // Limit message length
        priority: 1
      },
      (notificationId) => {
        debugLogger.notifications('INFO', 'Push notification created', {
          notificationId,
          pushType: push.type
        });
        performanceMonitor.recordNotification('push_notification_created');
      }
    );
  } catch (error) {
    debugLogger.notifications('ERROR', 'Failed to show push notification', {
      error: (error as Error).message,
      pushType: push.type
    }, error as Error);
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
 */
export function setupContextMenu(): void {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'push-link',
        title: 'Push this link',
        contexts: ['link']
      });

      chrome.contextMenus.create({
        id: 'push-page',
        title: 'Push this page',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'push-selection',
        title: 'Push selected text',
        contexts: ['selection']
      });

      chrome.contextMenus.create({
        id: 'push-image',
        title: 'Push this image',
        contexts: ['image']
      });

      debugLogger.general('INFO', 'Context menu created');
    });
  } catch (error) {
    debugLogger.general('ERROR', 'Failed to create context menu', null, error as Error);
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

  try {
    const response = await fetch('https://api.pushbullet.com/v2/pushes', {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'link',
        title: title || 'Link',
        url: url
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

  try {
    const response = await fetch('https://api.pushbullet.com/v2/pushes', {
      method: 'POST',
      headers: {
        'Access-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'note',
        title: title,
        body: body
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

