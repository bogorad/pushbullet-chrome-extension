import { debugLogger } from "../../lib/logging";

export function createNotificationWithTimeout(notificationId: string, options: chrome.notifications.NotificationCreateOptions, timeoutMs?: number, callback?: (id?: string) => void) {
  chrome.notifications.create(notificationId, options, (createdId) => {
    if (callback) callback(createdId);
    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      setTimeout(() => { try { chrome.notifications.clear(createdId || notificationId, () => {}); } catch (_) { /* noop */ } }, timeoutMs);
    }
  });
}

export function showPermanentWebSocketError(closeInfo: { code: number; reason?: string; wasClean?: boolean }) {
  const title = 'Pushbullet requires attention';
  const message = `Real-time connection stopped (code ${closeInfo.code}). ${closeInfo.reason || ''}`.trim();

  createNotificationWithTimeout('pushbullet-permanent-error', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 2
  }, undefined);

  try {
    chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
    chrome.action.setBadgeText({ text: 'ERR' });
  } catch (_) { /* noop */ }
}

