import { debugLogger } from '../../lib/logging';

// NO DECRYPTION - API key is stored in plain text in chrome.storage.sync
// The crypto module is ONLY for decrypting E2EE push messages, NOT the API key!

/**
 * Ensure critical configuration is loaded from storage
 * Used for service worker wake-ups to rehydrate state
 *
 * @param stateSetters - Object containing state setter functions
 * @param stateGetters - Object containing state getter functions
 */
export function ensureConfigLoaded(
  stateSetters?: {
    setApiKey: (key: string | null) => void;
    setDeviceIden: (iden: string | null) => void;
    setAutoOpenLinks: (value: boolean) => void;
    setDeviceNickname: (nickname: string) => void;
    setNotificationTimeout: (timeout: number) => void;
  },
  stateGetters?: {
    getApiKey: () => string | null;
    getDeviceIden: () => string | null;
    getAutoOpenLinks: () => boolean;
    getDeviceNickname: () => string;
    getNotificationTimeout: () => number;
  }
): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (!stateSetters || !stateGetters) {
        // No state management provided, just resolve
        resolve();
        return;
      }

      const needsApiKey = !stateGetters.getApiKey();
      const needsNickname = stateGetters.getDeviceNickname() === null || stateGetters.getDeviceNickname() === undefined;
      const needsAutoOpen = stateGetters.getAutoOpenLinks() === null || stateGetters.getAutoOpenLinks() === undefined;
      const needsTimeout = stateGetters.getNotificationTimeout() === null || stateGetters.getNotificationTimeout() === undefined;
      const needsSync = needsApiKey || needsNickname || needsAutoOpen || needsTimeout;

      const finish = () => {
        try {
          debugLogger.storage('DEBUG', 'ensureConfigLoaded completed', {
            hasApiKey: !!stateGetters.getApiKey(),
            hasDeviceIden: !!stateGetters.getDeviceIden(),
            autoOpenLinks: stateGetters.getAutoOpenLinks(),
            notificationTimeout: stateGetters.getNotificationTimeout(),
            deviceNickname: stateGetters.getDeviceNickname()
          });
        } catch (err) {
          // Swallow logging/storage errors in ensureConfigLoaded
        }
        resolve();
      };

      const loadLocal = () => {
        chrome.storage.local.get(['deviceIden'], (lres) => {
          try {
            if (!stateGetters.getDeviceIden() && lres && lres.deviceIden) {
              stateSetters.setDeviceIden(lres.deviceIden);
            }
          } catch (err) {
            // Swallow logging/storage errors in ensureConfigLoaded
          }
          finish();
        });
      };

      if (needsSync) {
        chrome.storage.sync.get(
          ['apiKey', 'deviceNickname', 'autoOpenLinks', 'notificationTimeout'],
          (res) => {
            try {
              if (!stateGetters.getApiKey() && res && res.apiKey) {
                // API key is stored in plain text
                stateSetters.setApiKey(res.apiKey);
              }
              if (needsNickname && res && res.deviceNickname !== undefined) {
                stateSetters.setDeviceNickname(res.deviceNickname);
              }
              if (needsAutoOpen && res && res.autoOpenLinks !== undefined) {
                stateSetters.setAutoOpenLinks(res.autoOpenLinks);
              }
              if (needsTimeout && res && res.notificationTimeout !== undefined) {
                stateSetters.setNotificationTimeout(res.notificationTimeout);
              }
            } catch (err) {
              // Swallow logging/storage errors in ensureConfigLoaded
            }
            loadLocal();
          }
        );
      } else {
        loadLocal();
      }
    } catch (e) {
      try {
        debugLogger.storage('WARN', 'ensureConfigLoaded encountered an error', {
          error: e && (e as Error).message
        });
      } catch (err) {
        // Ignore
      }
      resolve();
    }
  });
}

