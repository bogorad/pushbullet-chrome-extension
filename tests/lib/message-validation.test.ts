import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';
import { MessageAction } from '../../src/types/domain';
import {
  isPrivilegedAction,
  validatePrivilegedMessage,
} from '../../src/lib/security/message-validation';

declare const chrome: any;

const messageActionValues = Object.fromEntries(
  Object.entries(MessageAction).map(([key, value]) => [key, value]),
);

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function resolveActionValue(enumName: string | undefined, literalValue: string | undefined): string {
  if (enumName) {
    return messageActionValues[enumName] ?? enumName;
  }

  if (literalValue) {
    return literalValue;
  }

  throw new Error('Unable to resolve message action value');
}

function extractOptionsSentActions(source: string): Set<string> {
  const actions = new Set<string>();
  const pattern =
    /chrome\.runtime\.sendMessage\(\s*\{\s*action:\s*(?:MessageAction\.([A-Z_]+)|['"]([^'"]+)['"])/g;
  let match = pattern.exec(source);

  while (match) {
    actions.add(resolveActionValue(match[1], match[2]));
    match = pattern.exec(source);
  }

  return actions;
}

function extractBackgroundHandledActions(source: string): Set<string> {
  const actions = new Set<string>();
  const pattern = /message\.action\s*===\s*(?:MessageAction\.([A-Z_]+)|['"]([^'"]+)['"])/g;
  let match = pattern.exec(source);

  while (match) {
    actions.add(resolveActionValue(match[1], match[2]));
    match = pattern.exec(source);
  }

  return actions;
}

describe('message validation', () => {
  beforeEach(() => {
    chrome.runtime.id = 'extension-id';
    chrome.runtime.getURL.mockReturnValue('chrome-extension://extension-id/');
  });

  it('treats current mutating actions as privileged', () => {
    expect(isPrivilegedAction(MessageAction.SEND_PUSH)).toBe(true);
    expect(isPrivilegedAction(MessageAction.UPDATE_DEVICE_NICKNAME)).toBe(true);
    expect(isPrivilegedAction(MessageAction.SETTINGS_CHANGED)).toBe(true);
    expect(isPrivilegedAction(MessageAction.UPDATE_DEBUG_CONFIG)).toBe(true);
    expect(isPrivilegedAction(MessageAction.GET_PUSH_DATA)).toBe(true);
    expect(isPrivilegedAction(MessageAction.GET_NOTIFICATION_DATA)).toBe(true);
    expect(isPrivilegedAction(MessageAction.ATTEMPT_RECONNECT)).toBe(true);
    expect(isPrivilegedAction(MessageAction.GET_SESSION_DATA)).toBe(false);
  });

  it('does not privilege removed options-only action names', () => {
    expect(isPrivilegedAction('autoOpenLinksChanged')).toBe(false);
    expect(isPrivilegedAction('encryptionPasswordChanged')).toBe(false);
    expect(isPrivilegedAction('debugModeChanged')).toBe(false);
  });

  it('rejects privileged actions from invalid senders', () => {
    expect(
      validatePrivilegedMessage(MessageAction.SEND_PUSH, {
        id: 'external-id',
        url: 'chrome-extension://external-id/popup.html',
      }),
    ).toBe(false);
  });

  it('rejects notification data actions from external senders', () => {
    const externalSender = {
      id: 'external-id',
      url: 'chrome-extension://external-id/notification-detail.html',
    };

    expect(
      validatePrivilegedMessage(MessageAction.GET_PUSH_DATA, externalSender),
    ).toBe(false);
    expect(
      validatePrivilegedMessage(MessageAction.GET_NOTIFICATION_DATA, externalSender),
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

  it('allows notification data actions from extension pages', () => {
    const extensionPageSender = {
      id: 'extension-id',
      url: 'chrome-extension://extension-id/notification-detail.html',
    };

    expect(
      validatePrivilegedMessage(MessageAction.GET_PUSH_DATA, extensionPageSender),
    ).toBe(true);
    expect(
      validatePrivilegedMessage(MessageAction.GET_NOTIFICATION_DATA, extensionPageSender),
    ).toBe(true);
  });

  it('keeps options message actions aligned with background handlers', () => {
    const optionsSource = readProjectFile('src/options/index.ts');
    const backgroundSource = readProjectFile('src/background/index.ts');
    const optionsSentActions = extractOptionsSentActions(optionsSource);
    const backgroundHandledActions = extractBackgroundHandledActions(backgroundSource);
    const unhandledActions = [...optionsSentActions].filter(
      (action) => !backgroundHandledActions.has(action),
    );

    expect(optionsSentActions).toEqual(
      new Set([
        MessageAction.UPDATE_DEVICE_NICKNAME,
        MessageAction.SETTINGS_CHANGED,
        MessageAction.UPDATE_DEBUG_CONFIG,
        MessageAction.ATTEMPT_RECONNECT,
      ]),
    );
    expect(unhandledActions).toEqual([]);
    expect(optionsSource).not.toContain('autoOpenLinksChanged');
    expect(optionsSource).not.toContain('encryptionPasswordChanged');
    expect(optionsSource).not.toContain('debugModeChanged');
  });
});
