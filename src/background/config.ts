import { ensureConfigLoaded } from '../app/reconnect';
import {
  debugConfigManager,
  debugLogger,
} from '../lib/logging';
import {
  getApiKey,
  getAutoOpenLinks,
  getDeviceIden,
  getDeviceNickname,
  getNotificationTimeout,
  setApiKey,
  setAutoOpenLinks,
  setDeviceIden,
  setDeviceNickname,
  setNotificationTimeout,
} from './state';

export async function hydrateBackgroundConfig(): Promise<void> {
  await ensureConfigLoaded(
    {
      setApiKey,
      setDeviceIden,
      setAutoOpenLinks,
      setDeviceNickname,
      setNotificationTimeout,
    },
    {
      getApiKey,
      getDeviceIden,
      getAutoOpenLinks,
      getDeviceNickname,
      getNotificationTimeout,
    },
  );
}

let loadDebugConfigOnce: Promise<void> | null = null;

export function ensureDebugConfigLoadedOnce(): Promise<void> {
  if (!loadDebugConfigOnce) {
    loadDebugConfigOnce = (async () => {
      try {
        await debugConfigManager.loadConfig();
        debugLogger.general(
          'INFO',
          'Debug configuration loaded (single-flight)',
        );
      } catch (e) {
        debugLogger.general(
          'WARN',
          'Failed to load debug configuration (single-flight)',
          { error: (e as Error).message },
        );
      }
    })();
  }
  return loadDebugConfigOnce;
}
