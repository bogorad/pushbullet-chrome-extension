import { debugLogger } from '../../lib/logging';
import { storageRepository } from '../../infrastructure/storage/storage.repository';

// NO DECRYPTION - API key is stored in plain text in chrome.storage.local
// Security: API keys are stored in local storage (not synced) to prevent exposure
// The crypto module is ONLY for decrypting E2EE push messages, NOT the API key!

/**
 * Ensure critical configuration is loaded from storage
 * Used for service worker wake-ups to rehydrate state
 *
 * ARCHITECTURAL PATTERN: Uses StorageRepository for centralized storage access
 * All storage operations go through the repository pattern - NO direct chrome.storage calls
 *
 * @param stateSetters - Object containing state setter functions
 * @param stateGetters - Object containing state getter functions
 */
export async function ensureConfigLoaded(
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
  try {
    if (!stateSetters || !stateGetters) {
      // No state management provided, just return
      return;
    }

    // Determine what needs to be loaded
    const needsApiKey = !stateGetters.getApiKey();
    const needsDeviceIden = !stateGetters.getDeviceIden();
    const needsNickname = stateGetters.getDeviceNickname() === null || stateGetters.getDeviceNickname() === undefined;
    const needsAutoOpen = stateGetters.getAutoOpenLinks() === null || stateGetters.getAutoOpenLinks() === undefined;
    const needsTimeout = stateGetters.getNotificationTimeout() === null || stateGetters.getNotificationTimeout() === undefined;

    // Load API key from repository (local storage, not synced)
    if (needsApiKey) {
      try {
        const apiKey = await storageRepository.getApiKey();
        if (apiKey) {
          stateSetters.setApiKey(apiKey);
        }
      } catch (err) {
        // Swallow storage errors in ensureConfigLoaded
      }
    }

    // Load device identifier from repository (local storage)
    if (needsDeviceIden) {
      try {
        const deviceIden = await storageRepository.getDeviceIden();
        if (deviceIden) {
          stateSetters.setDeviceIden(deviceIden);
        }
      } catch (err) {
        // Swallow storage errors in ensureConfigLoaded
      }
    }

    // Load device nickname from repository (synced storage)
    if (needsNickname) {
      try {
        const deviceNickname = await storageRepository.getDeviceNickname();
        if (deviceNickname !== null && deviceNickname !== undefined) {
          stateSetters.setDeviceNickname(deviceNickname);
        }
      } catch (err) {
        // Swallow storage errors in ensureConfigLoaded
      }
    }

    // Load auto-open links setting from repository (synced storage)
    if (needsAutoOpen) {
      try {
        const autoOpenLinks = await storageRepository.getAutoOpenLinks();
        if (autoOpenLinks !== null && autoOpenLinks !== undefined) {
          stateSetters.setAutoOpenLinks(autoOpenLinks);
        }
      } catch (err) {
        // Swallow storage errors in ensureConfigLoaded
      }
    }

    // Load notification timeout from repository (synced storage)
    if (needsTimeout) {
      try {
        const notificationTimeout = await storageRepository.getNotificationTimeout();
        if (notificationTimeout !== null && notificationTimeout !== undefined) {
          stateSetters.setNotificationTimeout(notificationTimeout);
        }
      } catch (err) {
        // Swallow storage errors in ensureConfigLoaded
      }
    }

    // Log completion
    try {
      debugLogger.storage('DEBUG', 'ensureConfigLoaded completed', {
        hasApiKey: !!stateGetters.getApiKey(),
        hasDeviceIden: !!stateGetters.getDeviceIden(),
        autoOpenLinks: stateGetters.getAutoOpenLinks(),
        notificationTimeout: stateGetters.getNotificationTimeout(),
        deviceNickname: stateGetters.getDeviceNickname()
      });
    } catch (err) {
      // Swallow logging errors in ensureConfigLoaded
    }
  } catch (e) {
    try {
      debugLogger.storage('WARN', 'ensureConfigLoaded encountered an error', {
        error: e && (e as Error).message
      });
    } catch (err) {
      // Ignore
    }
  }
}

