import { describe, expect, it } from 'vitest';

import { ChromeStorageRepository } from '../../src/infrastructure/storage/storage.repository';

declare const chrome: any;

describe('ChromeStorageRepository encryption password storage', () => {
  it('stores encryption passwords in session storage when available', async () => {
    const repository = new ChromeStorageRepository();

    await repository.setEncryptionPassword('secret');

    expect(chrome.storage.session.set).toHaveBeenCalledWith({ encryptionPassword: 'secret' });
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['encryptionPassword']);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('migrates existing local encryption passwords into session storage', async () => {
    const repository = new ChromeStorageRepository();
    chrome.storage.session.get.mockResolvedValue({});
    chrome.storage.local.get.mockResolvedValue({ encryptionPassword: 'old-secret' });

    await expect(repository.getEncryptionPassword()).resolves.toBe('old-secret');

    expect(chrome.storage.session.set).toHaveBeenCalledWith({ encryptionPassword: 'old-secret' });
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['encryptionPassword']);
  });

  it('falls back to local storage when session storage is unavailable', async () => {
    const repository = new ChromeStorageRepository();
    const sessionStorage = chrome.storage.session;
    delete chrome.storage.session;

    try {
      await repository.setEncryptionPassword('fallback-secret');
    } finally {
      chrome.storage.session = sessionStorage;
    }

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ encryptionPassword: 'fallback-secret' });
  });

  it('clears encryption passwords from both session and local storage', async () => {
    const repository = new ChromeStorageRepository();

    await repository.setEncryptionPassword(null);

    expect(chrome.storage.session.remove).toHaveBeenCalledWith(['encryptionPassword']);
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['encryptionPassword']);
  });
});
