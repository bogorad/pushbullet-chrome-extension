import { describe, expect, it } from 'vitest';

import { ChromeStorageRepository } from '../../src/infrastructure/storage/storage.repository';

declare const chrome: any;

describe('ChromeStorageRepository encryption password storage', () => {
  it('stores encryption passwords in local storage', async () => {
    const repository = new ChromeStorageRepository();

    await repository.setEncryptionPassword('secret');

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ encryptionPassword: 'secret' });
    expect(chrome.storage.session.remove).toHaveBeenCalledWith(['encryptionPassword']);
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
  });

  it('gets encryption passwords from local storage', async () => {
    const repository = new ChromeStorageRepository();
    chrome.storage.local.get.mockResolvedValue({ encryptionPassword: 'old-secret' });

    await expect(repository.getEncryptionPassword()).resolves.toBe('old-secret');

    expect(chrome.storage.local.get).toHaveBeenCalledWith(['encryptionPassword']);
    expect(chrome.storage.session.get).not.toHaveBeenCalled();
  });

  it('migrates session-only encryption passwords into local storage', async () => {
    const repository = new ChromeStorageRepository();
    chrome.storage.local.get.mockResolvedValue({});
    chrome.storage.session.get.mockResolvedValue({ encryptionPassword: 'session-secret' });

    await expect(repository.getEncryptionPassword()).resolves.toBe('session-secret');

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      encryptionPassword: 'session-secret',
    });
    expect(chrome.storage.session.remove).toHaveBeenCalledWith(['encryptionPassword']);
  });

  it('clears encryption passwords from both session and local storage', async () => {
    const repository = new ChromeStorageRepository();

    await repository.setEncryptionPassword(null);

    expect(chrome.storage.session.remove).toHaveBeenCalledWith(['encryptionPassword']);
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['encryptionPassword']);
  });
});
