/**
 * Keepalive utility to prevent service worker termination during critical operations
 */
import { debugLogger } from '../lib/logging';

const KEEPALIVE_ALARM = 'criticalKeepalive';
const KEEPALIVE_INTERVAL_SECONDS = 20; // Chrome's minimum is 0.5 minutes (30s), but we use seconds for clarity

let activeCount = 0;

/**
 * Start aggressive keepalive during critical operations
 * Call this BEFORE starting initialization
 */
export function startCriticalKeepalive(): void {
  activeCount++;

  if (activeCount === 1) {
    // First caller - create the alarm
    chrome.alarms.create(KEEPALIVE_ALARM, {
      delayInMinutes: KEEPALIVE_INTERVAL_SECONDS / 60,
      periodInMinutes: KEEPALIVE_INTERVAL_SECONDS / 60
    });

    debugLogger.general('INFO', 'Critical keepalive started', {
      interval: `${KEEPALIVE_INTERVAL_SECONDS}s`,
      activeCount
    });
  } else {
    debugLogger.general('DEBUG', 'Critical keepalive already active', { activeCount });
  }
}

/**
 * Stop aggressive keepalive after critical operation completes
 * Call this AFTER initialization finishes (success or failure)
 */
export function stopCriticalKeepalive(): void {
  if (activeCount > 0) {
    activeCount--;
  }

  if (activeCount === 0) {
    // Last caller - remove the alarm
    chrome.alarms.clear(KEEPALIVE_ALARM, (wasCleared) => {
      debugLogger.general('INFO', 'Critical keepalive stopped', { wasCleared });
    });
  } else {
    debugLogger.general('DEBUG', 'Critical keepalive still needed', { activeCount });
  }
}

/**
 * Handle the keepalive alarm event
 * Add this to chrome.alarms.onAlarm listener
 */
export function handleKeepaliveAlarm(alarm: chrome.alarms.Alarm): boolean {
  if (alarm.name === KEEPALIVE_ALARM) {
    debugLogger.general('DEBUG', 'Critical keepalive heartbeat', {
      timestamp: new Date().toISOString(),
      activeCount
    });
    return true; // Handled
  }
  return false; // Not our alarm
}