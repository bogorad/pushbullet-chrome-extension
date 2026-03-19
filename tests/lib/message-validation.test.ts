import { beforeEach, describe, expect, it } from 'vitest';
import { MessageAction } from '../../src/types/domain';
import {
  isPrivilegedAction,
  validatePrivilegedMessage,
} from '../../src/lib/security/message-validation';

declare const chrome: any;

describe('message validation', () => {
  beforeEach(() => {
    chrome.runtime.id = 'extension-id';
    chrome.runtime.getURL.mockReturnValue('chrome-extension://extension-id/');
  });

  it('treats current mutating actions as privileged', () => {
    expect(isPrivilegedAction(MessageAction.SEND_PUSH)).toBe(true);
    expect(isPrivilegedAction(MessageAction.UPDATE_DEVICE_NICKNAME)).toBe(true);
    expect(isPrivilegedAction('attemptReconnect')).toBe(true);
    expect(isPrivilegedAction(MessageAction.GET_SESSION_DATA)).toBe(false);
  });

  it('rejects privileged actions from invalid senders', () => {
    expect(
      validatePrivilegedMessage(MessageAction.SEND_PUSH, {
        id: 'external-id',
        url: 'chrome-extension://external-id/popup.html',
      }),
    ).toBe(false);
  });

  it('allows privileged actions from this extension', () => {
    expect(
      validatePrivilegedMessage(MessageAction.SEND_PUSH, {
        id: 'extension-id',
        url: 'chrome-extension://extension-id/popup.html',
      }),
    ).toBe(true);
  });
});
