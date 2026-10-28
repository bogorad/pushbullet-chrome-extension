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

describe('ChromeStorageRepository Jev API key storage', () => {
  it('stores Jev key in local storage only, sync untouched', async () => {
    const repository = new ChromeStorageRepository();
    await repository.setJevApiKey('jev-secret');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ jevApiKey: 'jev-secret' });
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.storage.sync.get).not.toHaveBeenCalled();
  });
  it('reads Jev key from local storage only', async () => {
    const repository = new ChromeStorageRepository();
    chrome.storage.local.get.mockResolvedValue({ jevApiKey: 'jev-secret' });
    await expect(repository.getJevApiKey()).resolves.toBe('jev-secret');
    expect(chrome.storage.local.get).toHaveBeenCalledWith(['jevApiKey']);
    expect(chrome.storage.sync.get).not.toHaveBeenCalled();
  });
  it('empty Jev key deletes from local storage', async () => {
    const repository = new ChromeStorageRepository();
    await repository.setJevApiKey(null);
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['jevApiKey']);
    await repository.setJevApiKey('  ');
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({ jevApiKey: expect.anything() }));
  });
});
