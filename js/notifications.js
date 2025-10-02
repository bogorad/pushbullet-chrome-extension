// Notification helpers (disconnection and permanent errors)
// Helper function to create notification with auto-dismiss
function createNotificationWithTimeout(notificationId, options, callback) {
  chrome.notifications.create(notificationId, options, (createdId) => {
    if (callback) callback(createdId);

    // Auto-dismiss logic (respect existing global timeout if present)
    try {
      if (typeof notificationTimeout === 'number' && notificationTimeout > 0) {
        setTimeout(() => {
          chrome.notifications.clear(createdId || notificationId, () => {});
        }, notificationTimeout);
      }
    } catch (_) { /* noop */ }
  });
}



function checkDisconnectionNotification() {
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

function showDisconnectionNotification() {
  createNotificationWithTimeout('pushbullet-disconnected', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Pushbullet Connection Issue',
    message: 'Real-time push notifications may be delayed. Reconnecting...',
    priority: 1
  }, (notificationId) => {
    debugLogger.general('INFO', 'Disconnection notification shown', { notificationId });
  });
}

function showPermanentWebSocketError(closeInfo) {
  const title = 'Pushbullet requires attention';
  const message = `Real-time connection stopped (code ${closeInfo.code}). ${closeInfo.reason || ''}`.trim();

  createNotificationWithTimeout('pushbullet-permanent-error', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 2
  }, () => {});

  try {
    chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
    chrome.action.setBadgeText({ text: 'ERR' });
  } catch (e) {
    // ignore if action not available
  }
}

function clearErrorBadge() {
  try {
    chrome.action.setBadgeText({ text: '' });
  } catch (e) {
    // ignore
  }
}

