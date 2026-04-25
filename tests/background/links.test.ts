import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Push } from '../../src/types/domain';

const fetchIncrementalPushes = vi.fn();
const dismissPush = vi.fn();
const getApiKey = vi.fn();
const hasOpenedIden = vi.fn();
const markOpened = vi.fn();
const getMaxOpenedCreated = vi.fn();
const storageRepository = {
  getAutoOpenLinksOnReconnect: vi.fn(),
  getMaxAutoOpenPerReconnect: vi.fn(),
  getLastAutoOpenCutoff: vi.fn(),
  getDismissAfterAutoOpen: vi.fn(),
  setLastAutoOpenCutoff: vi.fn(),
};

vi.mock('../../src/app/api/client', () => ({
  fetchIncrementalPushes,
  dismissPush,
}));

vi.mock('../../src/background/state', () => ({
  getApiKey,
}));

vi.mock('../../src/infrastructure/storage/opened-mru.repository', () => ({
  hasOpenedIden,
  markOpened,
  getMaxOpenedCreated,
}));

vi.mock('../../src/infrastructure/storage/storage.repository', () => ({
  storageRepository,
}));

vi.mock('../../src/lib/logging', () => ({
  debugLogger: {
    general: vi.fn(),
    websocket: vi.fn(),
  },
}));

function makeLinkPush(iden: string, created: number): Push {
  return {
    active: true,
    created,
    dismissed: false,
    iden,
    modified: created,
    title: `Title ${iden}`,
    type: 'link',
    url: `https://example.com/${iden}`,
  };
}

describe('autoOpenOfflineLinks dismiss credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    chrome.tabs.create = vi.fn(async (): Promise<chrome.tabs.Tab> => ({} as chrome.tabs.Tab));

    fetchIncrementalPushes.mockResolvedValue([
      makeLinkPush('push-101', 101),
      makeLinkPush('push-102', 102),
    ]);
    dismissPush.mockResolvedValue(undefined);
    getApiKey.mockReturnValue('current-key');
    hasOpenedIden.mockResolvedValue(false);
    markOpened.mockResolvedValue(undefined);
    getMaxOpenedCreated.mockResolvedValue(0);
    storageRepository.getAutoOpenLinksOnReconnect.mockResolvedValue(true);
    storageRepository.getMaxAutoOpenPerReconnect.mockResolvedValue(100);
    storageRepository.getLastAutoOpenCutoff.mockResolvedValue(0);
    storageRepository.getDismissAfterAutoOpen.mockResolvedValue(true);
    storageRepository.setLastAutoOpenCutoff.mockResolvedValue(undefined);
  });

  it('skips later dismiss attempts when the API key is cleared mid-run while still opening tabs', async () => {
    getApiKey
      .mockReturnValueOnce('initial-key')
      .mockReturnValueOnce(null);
    const { autoOpenOfflineLinks } = await import('../../src/background/links');

    await autoOpenOfflineLinks('fetch-key', null);

    expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
    expect(dismissPush).toHaveBeenCalledTimes(1);
    expect(dismissPush).toHaveBeenCalledWith('push-101', 'initial-key');
    expect(markOpened).toHaveBeenCalledTimes(2);
    expect(storageRepository.setLastAutoOpenCutoff).toHaveBeenCalledWith(102);
  });

  it('uses the changed API key for later dismiss attempts in the same run', async () => {
    getApiKey
      .mockReturnValueOnce('old-key')
      .mockReturnValueOnce('new-key');
    const { autoOpenOfflineLinks } = await import('../../src/background/links');

    await autoOpenOfflineLinks('fetch-key', null);

    expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
    expect(dismissPush).toHaveBeenNthCalledWith(1, 'push-101', 'old-key');
    expect(dismissPush).toHaveBeenNthCalledWith(2, 'push-102', 'new-key');
    expect(storageRepository.setLastAutoOpenCutoff).toHaveBeenCalledWith(102);
  });

  it('continues opening later tabs when a dismiss request fails', async () => {
    dismissPush
      .mockRejectedValueOnce(new Error('dismiss failed'))
      .mockResolvedValueOnce(undefined);
    const { autoOpenOfflineLinks } = await import('../../src/background/links');

    await autoOpenOfflineLinks('fetch-key', null);

    expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
    expect(dismissPush).toHaveBeenCalledTimes(2);
    expect(markOpened).toHaveBeenCalledTimes(2);
    expect(storageRepository.setLastAutoOpenCutoff).toHaveBeenCalledWith(102);
  });
});
