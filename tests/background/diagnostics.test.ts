import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEBUG_CONFIG } from '../../src/lib/logging';
import { installDiagnosticsMessageHandler } from '../../src/background/diagnostics';
import { storageRepository } from '../../src/infrastructure/storage/storage.repository';
import { clearOpenedMRU } from '../../src/infrastructure/storage/opened-mru.repository';

declare const chrome: any;

const autoOpenSnapshot = {
  lastAutoOpenCutoff: 1,
  lastModifiedCutoff: 2,
  mruCount: 3,
  maxOpenedCreated: 4,
};

vi.mock('../../src/infrastructure/storage/storage.repository', () => ({
  storageRepository: {
    getAutoOpenDebugSnapshot: vi.fn(),
  },
}));

vi.mock('../../src/infrastructure/storage/opened-mru.repository', () => ({
  clearOpenedMRU: vi.fn(),
}));

const getAutoOpenDebugSnapshotMock = vi.mocked(storageRepository.getAutoOpenDebugSnapshot);
const clearOpenedMRUMock = vi.mocked(clearOpenedMRU);

function getDiagnosticsListener(): (
  msg: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean {
  installDiagnosticsMessageHandler();
  return chrome.runtime.onMessage.addListener.mock.calls[0][0];
}

async function waitForAsyncResponse(sendResponse: ReturnType<typeof vi.fn>): Promise<void> {
  await vi.waitFor(() => {
    expect(sendResponse).toHaveBeenCalled();
  });
}

describe('diagnostics message handler', () => {
  beforeEach(() => {
    chrome.runtime.id = 'extension-id';
    chrome.runtime.getURL.mockReturnValue('chrome-extension://extension-id/');
    DEBUG_CONFIG.enabled = true;
    getAutoOpenDebugSnapshotMock.mockReset();
    clearOpenedMRUMock.mockReset();
    getAutoOpenDebugSnapshotMock.mockResolvedValue(autoOpenSnapshot);
    clearOpenedMRUMock.mockResolvedValue(undefined);
  });

  it('handles diag:dump-autoopen from this extension when debug is enabled', async () => {
    const sendResponse = vi.fn();
    const listener = getDiagnosticsListener();

    const result = listener(
      { type: 'diag:dump-autoopen' },
      { id: 'extension-id', url: 'chrome-extension://extension-id/debug-dashboard.html' },
      sendResponse,
    );

    expect(result).toBe(true);
    await waitForAsyncResponse(sendResponse);
    expect(getAutoOpenDebugSnapshotMock).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, snap: autoOpenSnapshot });
  });

  it('rejects diag:dump-autoopen from another extension', () => {
    const sendResponse = vi.fn();
    const listener = getDiagnosticsListener();

    const result = listener(
      { type: 'diag:dump-autoopen' },
      { id: 'external-id', url: 'chrome-extension://external-id/debug-dashboard.html' },
      sendResponse,
    );

    expect(result).toBe(false);
    expect(getAutoOpenDebugSnapshotMock).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'unauthorized' });
  });

  it('handles diag:clear-mru from this extension when debug is enabled', async () => {
    const sendResponse = vi.fn();
    const listener = getDiagnosticsListener();

    const result = listener(
      { type: 'diag:clear-mru' },
      { id: 'extension-id', url: 'chrome-extension://extension-id/debug-dashboard.html' },
      sendResponse,
    );

    expect(result).toBe(true);
    await waitForAsyncResponse(sendResponse);
    expect(clearOpenedMRUMock).toHaveBeenCalledTimes(1);
    expect(getAutoOpenDebugSnapshotMock).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, snap: autoOpenSnapshot });
  });

  it('rejects diag:clear-mru from a non-extension URL', () => {
    const sendResponse = vi.fn();
    const listener = getDiagnosticsListener();

    const result = listener(
      { type: 'diag:clear-mru' },
      { id: 'extension-id', url: 'https://example.com/debug-dashboard.html' },
      sendResponse,
    );

    expect(result).toBe(false);
    expect(clearOpenedMRUMock).not.toHaveBeenCalled();
    expect(getAutoOpenDebugSnapshotMock).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'unauthorized' });
  });

  it('rejects diagnostics from this extension when debug is disabled', () => {
    DEBUG_CONFIG.enabled = false;
    const sendResponse = vi.fn();
    const listener = getDiagnosticsListener();

    const result = listener(
      { type: 'diag:dump-autoopen' },
      { id: 'extension-id', url: 'chrome-extension://extension-id/debug-dashboard.html' },
      sendResponse,
    );

    expect(result).toBe(false);
    expect(getAutoOpenDebugSnapshotMock).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'diagnostics_disabled' });
  });
});
