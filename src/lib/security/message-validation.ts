/**
 * Message sender validation for security
 * Prevents external extensions/pages from sending privileged messages
 */

import { debugLogger } from '../logging';
import { MessageAction } from '../../types/domain';

/**
 * Validate that message sender is from this extension
 */
export function isValidSender(sender: chrome.runtime.MessageSender): boolean {
  // Must have a valid sender object
  if (!sender) {
    debugLogger.general('WARN', 'Message received with no sender');
    return false;
  }

  // Must be from this extension
  if (sender.id !== chrome.runtime.id) {
    debugLogger.general('WARN', 'Message received from external extension', {
      senderId: sender.id,
      expectedId: chrome.runtime.id
    });
    return false;
  }

  // Must be from an extension page (not a content script)
  if (sender.url) {
    const extensionUrl = chrome.runtime.getURL('');
    if (!sender.url.startsWith(extensionUrl)) {
      debugLogger.general('WARN', 'Message received from non-extension URL', {
        senderUrl: sender.url,
        expectedPrefix: extensionUrl
      });
      return false;
    }
  }

  return true;
}

/**
 * List of privileged actions that require sender validation
 */
const PRIVILEGED_ACTIONS = new Set([
  MessageAction.API_KEY_CHANGED,
  MessageAction.LOGOUT,
  MessageAction.SETTINGS_CHANGED,
  MessageAction.UPDATE_DEVICE_NICKNAME,
  MessageAction.SEND_PUSH,
  MessageAction.UPDATE_DEBUG_CONFIG,
  MessageAction.CLEAR_ALL_LOGS,
  MessageAction.EXPORT_DEBUG_DATA,
  MessageAction.GET_DEBUG_SUMMARY,
  MessageAction.AUTO_OPEN_LINKS_CHANGED,
  MessageAction.ENCRYPTION_PASSWORD_CHANGED,
  MessageAction.DEBUG_MODE_CHANGED,
  'attemptReconnect',
]);

/**
 * Check if an action requires privileged access
 */
export function isPrivilegedAction(action: string): boolean {
  return PRIVILEGED_ACTIONS.has(action);
}

/**
 * Validate sender for privileged actions
 * Returns true if valid, false if should be rejected
 */
export function validatePrivilegedMessage(
  action: string,
  sender: chrome.runtime.MessageSender
): boolean {
  if (!isPrivilegedAction(action)) {
    // Non-privileged actions don't need validation
    return true;
  }

  if (!isValidSender(sender)) {
    debugLogger.general('ERROR', 'Rejected privileged action from invalid sender', {
      action,
      senderId: sender?.id,
      senderUrl: sender?.url
    });
    return false;
  }

  return true;
}
