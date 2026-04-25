import { describe, expect, it, vi } from 'vitest';

import { ChromeStorageRepository } from '../../src/infrastructure/storage/storage.repository';

declare const chrome: any;

describe('ChromeStorageRepository encryption password storage', () => {
  it('stores encryption passwords in session storage when available', async () => {
    const repository = new ChromeStorageRepository();
    chrome.storage.local.get.mockResolvedValue({});

    await repository.setEncryptionPassword('secret');

    expect(chrome.storage.session.set).toHaveBeenCalledWith({ encryptionPassword: 'secret' });
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['encryptionPassword']);
    expect(chrome.storage.local.get).toHaveBeenCalledWith(['encryptionPassword']);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('migrates existing local encryption passwords into session storage', async () => {
    const repository = new ChromeStorageRepository();
    chrome.storage.session.get.mockResolvedValue({});
    chrome.storage.local.get
      .mockResolvedValueOnce({ encryptionPassword: 'old-secret' })
      .mockResolvedValueOnce({});

    await expect(repository.getEncryptionPassword()).resolves.toBe('old-secret');

    expect(chrome.storage.session.set).toHaveBeenCalledWith({ encryptionPassword: 'old-secret' });
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['encryptionPassword']);
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(2);
  });

  it('logs a sanitized warning when legacy local cleanup cannot be verified', async () => {
    const repository = new ChromeStorageRepository();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    chrome.storage.session.get.mockResolvedValue({});
    chrome.storage.local.get
      .mockResolvedValueOnce({ encryptionPassword: 'old-secret' })
      .mockResolvedValueOnce({ encryptionPassword: 'old-secret' });

    await expect(repository.getEncryptionPassword()).resolves.toBe('old-secret');

    expect(warnSpy).toHaveBeenCalledWith(
      'Storage: Failed to remove legacy encryption password from local storage',
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('old-secret');

    warnSpy.mockRestore();
  });

  it('keeps fallback encryption passwords out of local storage when session storage is unavailable', async () => {
    const repository = new ChromeStorageRepository();
    const sessionStorage = chrome.storage.session;
    delete chrome.storage.session;
    chrome.storage.local.get.mockResolvedValue({});

    try {
      await repository.setEncryptionPassword('fallback-secret');
      await expect(repository.getEncryptionPassword()).resolves.toBe('fallback-secret');
    } finally {
      chrome.storage.session = sessionStorage;
    }

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['encryptionPassword']);
  });

  it('clears encryption passwords from both session and local storage', async () => {
    const repository = new ChromeStorageRepository();

    await repository.setEncryptionPassword(null);

    expect(chrome.storage.session.remove).toHaveBeenCalledWith(['encryptionPassword']);
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['encryptionPassword']);
  });
});
