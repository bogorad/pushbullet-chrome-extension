import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storageGetApiKey: vi.fn(),
  storageGetDeviceIden: vi.fn(),
  storageGetDeviceNickname: vi.fn(),
  storageGetAutoOpenLinks: vi.fn(),
  storageGetNotificationTimeout: vi.fn(),
  setApiKey: vi.fn(),
  setDeviceIden: vi.fn(),
  setAutoOpenLinks: vi.fn(),
  setDeviceNickname: vi.fn(),
  setNotificationTimeout: vi.fn(),
  getApiKey: vi.fn(),
  getDeviceIden: vi.fn(),
  getAutoOpenLinks: vi.fn(),
  getDeviceNickname: vi.fn(),
  getNotificationTimeout: vi.fn(),
}));

vi.mock('../../src/infrastructure/storage/storage.repository', () => ({
  storageRepository: {
    getApiKey: mocks.storageGetApiKey,
    getDeviceIden: mocks.storageGetDeviceIden,
    getDeviceNickname: mocks.storageGetDeviceNickname,
    getAutoOpenLinks: mocks.storageGetAutoOpenLinks,
    getNotificationTimeout: mocks.storageGetNotificationTimeout,
  },
}));

vi.mock('../../src/lib/logging', () => ({
  debugLogger: {
    general: vi.fn(),
    storage: vi.fn(),
  },
}));

describe('service worker lifecycle hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.storageGetApiKey.mockResolvedValue('stored-api-key');
    mocks.storageGetDeviceIden.mockResolvedValue('stored-device');
    mocks.storageGetDeviceNickname.mockResolvedValue('Stored Chrome');
    mocks.storageGetAutoOpenLinks.mockResolvedValue(true);
    mocks.storageGetNotificationTimeout.mockResolvedValue(30);

    mocks.getApiKey.mockReturnValue(null);
    mocks.getDeviceIden.mockReturnValue(null);
    mocks.getAutoOpenLinks.mockReturnValue(undefined);
    mocks.getDeviceNickname.mockReturnValue(undefined);
    mocks.getNotificationTimeout.mockReturnValue(undefined);
  });

  it('hydrates wake-critical config from storage when state accessors are provided', async () => {
    const { ensureConfigLoaded } = await import('../../src/app/reconnect');

    await ensureConfigLoaded(
      {
        setApiKey: mocks.setApiKey,
        setDeviceIden: mocks.setDeviceIden,
        setAutoOpenLinks: mocks.setAutoOpenLinks,
        setDeviceNickname: mocks.setDeviceNickname,
        setNotificationTimeout: mocks.setNotificationTimeout,
      },
      {
        getApiKey: mocks.getApiKey,
        getDeviceIden: mocks.getDeviceIden,
        getAutoOpenLinks: mocks.getAutoOpenLinks,
        getDeviceNickname: mocks.getDeviceNickname,
        getNotificationTimeout: mocks.getNotificationTimeout,
      },
    );

    expect(mocks.storageGetApiKey).toHaveBeenCalledTimes(1);
    expect(mocks.setApiKey).toHaveBeenCalledWith('stored-api-key');
    expect(mocks.setDeviceIden).toHaveBeenCalledWith('stored-device');
    expect(mocks.setAutoOpenLinks).toHaveBeenCalledWith(true);
    expect(mocks.setDeviceNickname).toHaveBeenCalledWith('Stored Chrome');
    expect(mocks.setNotificationTimeout).toHaveBeenCalledWith(30);
  });

  it('documents the current no-op path when wake code calls config hydration without accessors', async () => {
    const { ensureConfigLoaded } = await import('../../src/app/reconnect');

    await ensureConfigLoaded();

    expect(mocks.storageGetApiKey).not.toHaveBeenCalled();
    expect(mocks.setApiKey).not.toHaveBeenCalled();
  });
});

describe('lifecycle coordinator bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates startup initialization to the state machine once', async () => {
    const stateMachine = {
      getCurrentState: vi.fn(() => 'initializing'),
      transition: vi.fn(() => Promise.resolve()),
    };
    const { createLifecycleCoordinator } = await import('../../src/background/lifecycle');
    const coordinator = createLifecycleCoordinator({
      hydrateConfig: vi.fn(() => Promise.resolve()),
      stateMachineReady: Promise.resolve(),
      getStateMachine: () => stateMachine as never,
      getApiKey: vi.fn(() => 'stored-api-key'),
      getDeviceIden: vi.fn(() => 'stored-device'),
      getAutoOpenLinks: vi.fn(() => true),
      getDeviceNickname: vi.fn(() => 'Stored Chrome'),
      isSocketHealthy: vi.fn(() => false),
    });

    await coordinator.bootstrap('startup');

    expect(stateMachine.transition).toHaveBeenCalledTimes(1);
    expect(stateMachine.transition).toHaveBeenCalledWith('STARTUP', {
      hasApiKey: true,
    });
  });

  it('routes wake reconciliation through the state machine when the socket is unhealthy', async () => {
    const stateMachine = {
      getCurrentState: vi.fn(() => 'ready'),
      transition: vi.fn(() => Promise.resolve()),
    };
    const { createLifecycleCoordinator } = await import('../../src/background/lifecycle');
    const coordinator = createLifecycleCoordinator({
      hydrateConfig: vi.fn(() => Promise.resolve()),
      stateMachineReady: Promise.resolve(),
      getStateMachine: () => stateMachine as never,
      getApiKey: vi.fn(() => 'stored-api-key'),
      getDeviceIden: vi.fn(() => 'stored-device'),
      getAutoOpenLinks: vi.fn(() => true),
      getDeviceNickname: vi.fn(() => 'Stored Chrome'),
      isSocketHealthy: vi.fn(() => false),
    });

    await coordinator.reconcileWake('websocketHealthCheck');

    expect(stateMachine.transition).toHaveBeenCalledWith(
      'ATTEMPT_RECONNECT',
      {
        hasApiKey: true,
        socketHealthy: false,
        reason: 'websocketHealthCheck',
      },
    );
  });
});
