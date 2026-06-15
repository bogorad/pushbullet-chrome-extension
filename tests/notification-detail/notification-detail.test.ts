import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageAction } from '../../src/types/domain';

declare const chrome: any;

function setupNotificationDetailDom(): void {
  document.body.innerHTML = `
    <div class="header"></div>
    <h1 id="title"></h1>
    <div id="message"></div>
    <span id="type-badge"></span>
    <span id="timestamp"></span>
    <span id="source"></span>
    <div id="file-info"></div>
    <div id="file-name"></div>
    <div id="file-type"></div>
    <div id="image-preview"></div>
    <img id="preview-image" />
    <button id="download-btn"></button>
    <button id="copy-btn"></button>
    <button id="close-btn"></button>
    <div id="copy-feedback"></div>
    <div class="actions"></div>
  `;
  window.history.replaceState({}, '', '/notification-detail.html?id=test-notification');
}

function mockPushResponse(imageUrl: string): void {
  chrome.runtime.sendMessage.mockImplementation(
    (_message: unknown, callback: (response: unknown) => void) => {
      callback({
        success: true,
        push: {
          type: 'sms_changed',
          notifications: [
            {
              title: 'Alice',
              body: 'Hello',
              image_url: imageUrl,
            },
          ],
          created: 123,
        },
      });
    },
  );
}

function mockTextPushResponse(body: string): void {
  chrome.runtime.sendMessage.mockImplementation(
    (_message: unknown, callback: (response: unknown) => void) => {
      callback({
        success: true,
        push: {
          type: 'sms_changed',
          notifications: [
            {
              title: 'Alice',
              body,
            },
          ],
          created: 123,
        },
      });
    },
  );
}

describe('notification detail image URL trust', () => {
  beforeEach(() => {
    vi.resetModules();
    setupNotificationDetailDom();
  });

  it('does not fetch an untrusted SMS image URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockPushResponse('http://files.pushbulletusercontent.com/avatar.png');

    await import('../../src/notification-detail/index');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.getElementById('message')?.textContent).toBe('Hello');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        action: MessageAction.GET_PUSH_DATA,
        notificationId: 'test-notification',
      },
      expect.any(Function),
    );
  });

  it('fetches a trusted HTTPS SMS image URL', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    mockPushResponse('https://files.pushbulletusercontent.com/avatar.png');

    await import('../../src/notification-detail/index');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith('https://files.pushbulletusercontent.com/avatar.png');
  });

  it('adds a copy button for hyphenated verification codes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: { writeText },
    });
    mockTextPushResponse('Your code is 527-176.');

    await import('../../src/notification-detail/index');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();

    const codeButton = document.querySelector<HTMLButtonElement>('.btn-code');
    expect(codeButton?.textContent).toContain('Copy Code: 527-176');

    codeButton?.click();
    expect(writeText).toHaveBeenCalledWith('527-176');
  });

  it('adds a copy button for grouped alphanumeric verification codes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: { writeText },
    });
    mockTextPushResponse('Your code is A1c2-P9r8.');

    await import('../../src/notification-detail/index');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();

    const codeButton = document.querySelector<HTMLButtonElement>('.btn-code');
    expect(codeButton?.textContent).toContain('Copy Code: A1c2-P9r8');

    codeButton?.click();
    expect(writeText).toHaveBeenCalledWith('A1c2-P9r8');
  });

  it('adds a copy button for alpha-only grouped verification codes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      clipboard: { writeText },
    });
    mockTextPushResponse('Your code is abcd-pqrs.');

    await import('../../src/notification-detail/index');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();

    const codeButton = document.querySelector<HTMLButtonElement>('.btn-code');
    expect(codeButton?.textContent).toContain('Copy Code: abcd-pqrs');

    codeButton?.click();
    expect(writeText).toHaveBeenCalledWith('abcd-pqrs');
  });

  it('does not add a copy button for phone numbers after code help text', async () => {
    mockTextPushResponse('Need help with your code? Call 800-555-1212.');

    await import('../../src/notification-detail/index');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();

    expect(document.querySelector<HTMLButtonElement>('.btn-code')).toBeNull();
  });
});
