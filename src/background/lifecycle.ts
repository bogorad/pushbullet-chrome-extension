import { debugLogger } from '../lib/logging';
import type { ServiceWorkerStateMachine } from './state-machine';

export interface LifecycleCoordinatorDeps {
  hydrateConfig: () => Promise<void>;
  stateMachineReady: Promise<void>;
  getStateMachine: () => ServiceWorkerStateMachine;
  getApiKey: () => string | null;
  getDeviceIden: () => string | null;
  getAutoOpenLinks: () => boolean;
  getDeviceNickname: () => string;
  isSocketHealthy: () => boolean;
}

export type BootstrapTrigger = 'startup' | 'install' | 'wakeup';

export function createLifecycleCoordinator(deps: LifecycleCoordinatorDeps) {
  async function reconcileWake(reason: string): Promise<void> {
    await deps.hydrateConfig();
    await deps.stateMachineReady;

    const apiKey = deps.getApiKey();
    const socketHealthy = deps.isSocketHealthy();
    const stateMachine = deps.getStateMachine();

    debugLogger.general('DEBUG', '[Wake] Reconcile wake state', {
      reason,
      hasApiKey: !!apiKey,
      socketHealthy,
      currentState: stateMachine.getCurrentState(),
    });

    if (apiKey && !socketHealthy) {
      await stateMachine.transition('ATTEMPT_RECONNECT', {
        hasApiKey: true,
        socketHealthy: false,
        reason,
      });
    }
  }

  async function bootstrap(trigger: BootstrapTrigger): Promise<void> {
    debugLogger.general('INFO', 'Bootstrap start', { trigger });

    await deps.hydrateConfig().catch((error) => {
      debugLogger.general(
        'ERROR',
        'Failed to load config before STARTUP',
        null,
        error as Error,
      );
    });

    debugLogger.general('DEBUG', 'Configuration loaded before STARTUP event');

    const apiKey = deps.getApiKey();
    const deviceIden = deps.getDeviceIden();
    const autoOpenLinks = deps.getAutoOpenLinks();
    const deviceNickname = deps.getDeviceNickname();

    debugLogger.general(
      'INFO',
      '[BOOTSTRAP_DEBUG] Config state after ensureConfigLoaded',
      {
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey?.length || 0,
        apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : 'null',
        hasDeviceIden: !!deviceIden,
        deviceIden: deviceIden || 'null',
        autoOpenLinks,
        deviceNickname: deviceNickname || 'null',
      },
    );

    await deps.stateMachineReady;
    const stateMachine = deps.getStateMachine();

    debugLogger.general('INFO', '[BOOTSTRAP_DEBUG] Triggering STARTUP event', {
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey?.length || 0,
      trigger,
    });

    await stateMachine.transition('STARTUP', { hasApiKey: !!apiKey });

    debugLogger.general(
      'INFO',
      '[BOOTSTRAP_DEBUG] STARTUP transition completed',
      {
        newState: stateMachine.getCurrentState(),
      },
    );

    if (apiKey && stateMachine.getCurrentState() === 'idle') {
      debugLogger.general(
        'WARN',
        '[Bootstrap] Detected orphaned session: have API key but state is IDLE. Triggering recovery.',
      );

      try {
        await stateMachine.transition('ATTEMPT_RECONNECT', {
          hasApiKey: true,
        });
      } catch (error) {
        debugLogger.general(
          'ERROR',
          '[Bootstrap] Failed to recover orphaned session',
          null,
          error as Error,
        );
      }
    }

    debugLogger.general(
      'INFO',
      'Bootstrap completed',
      {
        finalState: stateMachine.getCurrentState(),
        trigger,
      },
    );
  }

  return {
    bootstrap,
    reconcileWake,
  };
}
