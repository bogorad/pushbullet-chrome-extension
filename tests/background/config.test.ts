import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureConfigLoaded: vi.fn(),
  debugConfigManager: {
    loadConfig: vi.fn(),
  },
  debugLogger: {
    general: vi.fn(),
  },
}));

vi.mock('../../src/app/reconnect', () => ({
  ensureConfigLoaded: mocks.ensureConfigLoaded,
}));

vi.mock('../../src/lib/logging', () => ({
  debugConfigManager: mocks.debugConfigManager,
  debugLogger: mocks.debugLogger,
}));

vi.mock('../../src/background/state', () => ({
  getApiKey: vi.fn(),
  getAutoOpenLinks: vi.fn(),
  getDeviceIden: vi.fn(),
  getDeviceNickname: vi.fn(),
  getNotificationTimeout: vi.fn(),
  setApiKey: vi.fn(),
  setAutoOpenLinks: vi.fn(),
  setDeviceIden: vi.fn(),
  setDeviceNickname: vi.fn(),
  setNotificationTimeout: vi.fn(),
}));

async function importConfigModule(): Promise<typeof import('../../src/background/config')> {
  return import('../../src/background/config');
}

describe('ensureDebugConfigLoadedOnce', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('keeps concurrent successful loads single-flight', async () => {
    const { ensureDebugConfigLoadedOnce } = await importConfigModule();

    let resolveLoad!: () => void;
    mocks.debugConfigManager.loadConfig.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const firstLoad = ensureDebugConfigLoadedOnce();
    const secondLoad = ensureDebugConfigLoadedOnce();

    expect(secondLoad).toBe(firstLoad);
    expect(mocks.debugConfigManager.loadConfig).toHaveBeenCalledTimes(1);

    resolveLoad();
    await Promise.all([firstLoad, secondLoad]);

    await ensureDebugConfigLoadedOnce();

    expect(mocks.debugConfigManager.loadConfig).toHaveBeenCalledTimes(1);
    expect(mocks.debugLogger.general).toHaveBeenCalledWith(
      'INFO',
      'Debug configuration loaded (single-flight)',
    );
  });

  it('clears the cached load after a first-call failure', async () => {
    const { ensureDebugConfigLoadedOnce } = await importConfigModule();

    mocks.debugConfigManager.loadConfig.mockRejectedValueOnce(
      new Error('token abc123 leaked in storage error'),
    );

    await ensureDebugConfigLoadedOnce();

    mocks.debugConfigManager.loadConfig.mockResolvedValueOnce(undefined);

    await ensureDebugConfigLoadedOnce();

    expect(mocks.debugConfigManager.loadConfig).toHaveBeenCalledTimes(2);
  });

  it('retries successfully after a failed load', async () => {
    const { ensureDebugConfigLoadedOnce } = await importConfigModule();

    mocks.debugConfigManager.loadConfig
      .mockRejectedValueOnce(new TypeError('https://example.com/private-config'))
      .mockResolvedValueOnce(undefined);

    await ensureDebugConfigLoadedOnce();
    await ensureDebugConfigLoadedOnce();
    await ensureDebugConfigLoadedOnce();

    expect(mocks.debugConfigManager.loadConfig).toHaveBeenCalledTimes(2);
    expect(mocks.debugLogger.general).toHaveBeenCalledWith(
      'WARN',
      'Failed to load debug configuration (single-flight)',
      {
        errorName: 'TypeError',
        errorType: 'TypeError',
      },
    );
    expect(mocks.debugLogger.general).toHaveBeenCalledWith(
      'INFO',
      'Debug configuration loaded (single-flight)',
    );
  });
});
