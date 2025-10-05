import { debugLogger } from '../../lib/logging';
import { performanceMonitor } from '../../lib/perf';

// Track last disconnection notification to avoid spam
let lastDisconnectionNotification = 0;
const DISCONNECTION_NOTIFICATION_COOLDOWN = 300000; // 5 minutes

/**
 * Helper function to create notification with auto-dismiss
 */
export function createNotificationWithTimeout(
  notificationId: string,
  options: chrome.notifications.NotificationCreateOptions,
  callback?: (id?: string) => void,
  timeoutMs?: number
): void {
  // Get ABSOLUTE URL for the icon - service workers need absolute paths!
  const iconUrl = chrome.runtime.getURL('icons/icon128.png');

  // Create CLEAN options with ONLY the properties we want
  const safeOptions: chrome.notifications.NotificationCreateOptions = {
    type: 'basic',
    iconUrl: iconUrl, // Use absolute URL
    title: options.title || 'Pushbullet',
    message: options.message || '',
    priority: options.priority || 1
  };

  // Log what we're creating
  debugLogger.notifications('DEBUG', 'Creating notification with safe options', {
    notificationId,
    iconUrl,
    title: safeOptions.title,
    messageLength: safeOptions.message?.length || 0
  });

  chrome.notifications.create(notificationId, safeOptions, (createdId) => {
    // Check for errors
    if (chrome.runtime.lastError) {
      debugLogger.notifications('ERROR', 'Notification creation error', {
        error: chrome.runtime.lastError.message,
        notificationId
      });
    }

    if (callback) callback(createdId);

    // Auto-dismiss logic
    try {
      const timeout = timeoutMs !== undefined ? timeoutMs : 10000; // Default 10 seconds
      if (typeof timeout === 'number' && timeout > 0) {
        setTimeout(() => {
          chrome.notifications.clear(createdId || notificationId, () => {});
        }, timeout);
      }
    } catch (error) {
      debugLogger.notifications('ERROR', 'Failed to set notification timeout', {
        error: (error as Error).message
      }, error as Error);
    }
  });
}

/**
 * Check if we should show a disconnection notification
 */
export function checkDisconnectionNotification(): void {
  const now = Date.now();
  const timeSinceLastNotification = now - lastDisconnectionNotification;

  // Only notify if cooldown period has passed
  if (timeSinceLastNotification < DISCONNECTION_NOTIFICATION_COOLDOWN) {
    debugLogger.general('DEBUG', 'Disconnection notification suppressed - cooldown active', {
      timeSinceLastNotification: `${Math.round(timeSinceLastNotification / 1000)}s`,
      cooldownPeriod: `${DISCONNECTION_NOTIFICATION_COOLDOWN / 1000}s`
    });
    return;
  }

  // Check if we've been disconnected for threshold period
  const qualityMetrics = performanceMonitor.getQualityMetrics();
  if (qualityMetrics.consecutiveFailures >= 3) {
    showDisconnectionNotification();
    lastDisconnectionNotification = now;
  }
}

/**
 * Show disconnection notification
 */
export function showDisconnectionNotification(): void {
  createNotificationWithTimeout(
    'pushbullet-disconnected',
    {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Pushbullet Connection Issue',
      message: 'Real-time push notifications may be delayed. Reconnecting...',
      priority: 1
    },
    (notificationId) => {
      debugLogger.general('INFO', 'Disconnection notification shown', { notificationId });
    }
  );
}

/**
 * Show permanent WebSocket error notification
 */
export function showPermanentWebSocketError(closeInfo: { code: number; reason?: string; wasClean?: boolean }): void {
  const title = 'Pushbullet requires attention';
  const message = `Real-time connection stopped (code ${closeInfo.code}). ${closeInfo.reason || ''}`.trim();

  createNotificationWithTimeout(
    'pushbullet-permanent-error',
    {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
      priority: 2
    },
    () => {}
  );

  try {
    chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
    chrome.action.setBadgeText({ text: 'ERR' });
  } catch {
    // noop
  }
}

/**
 * Clear error badge
 */
export function clearErrorBadge(): void {
  try {
    chrome.action.setBadgeText({ text: '' });
  } catch {
    // ignore
  }
}

