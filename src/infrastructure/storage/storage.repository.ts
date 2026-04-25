/**
 * Storage Repository Pattern
 * 
 * This module implements the Repository Pattern for storage operations.
 * It abstracts away the chrome.storage API, making the code more testable
 * and maintainable.
 * 
 * Benefits:
 * - Testability: Easy to mock storage in tests
 * - Maintainability: Storage logic centralized in one place
 * - Clarity: Simple, clear API for storage operations
 */

/**
 * Storage Repository Interface
 * 
 * This interface defines the contract for storage operations.
 * Any implementation must provide these methods.
 */
export interface StorageRepository {
  // API Key
  getApiKey(): Promise<string | null>;
  setApiKey(key: string | null): Promise<void>;

  // Device Information
  getDeviceIden(): Promise<string | null>;
  setDeviceIden(iden: string | null): Promise<void>;

  getDeviceNickname(): Promise<string | null>;
  setDeviceNickname(nickname: string): Promise<void>;

  // Settings
  getAutoOpenLinks(): Promise<boolean>;
  setAutoOpenLinks(enabled: boolean): Promise<void>;

  getNotificationTimeout(): Promise<number>;
  setNotificationTimeout(timeout: number): Promise<void>;

  getOnlyThisDevice(): Promise<boolean>;
  setOnlyThisDevice(value: boolean): Promise<void>;

  // Encryption
  getEncryptionPassword(): Promise<string | null>;
  setEncryptionPassword(password: string | null): Promise<void>;

  // UI State
  getScrollToRecentPushes(): Promise<boolean>;
  setScrollToRecentPushes(scroll: boolean): Promise<void>;
  removeScrollToRecentPushes(): Promise<void>;

  // Device Registration
  getDeviceRegistrationInProgress(): Promise<boolean>;
  setDeviceRegistrationInProgress(inProgress: boolean): Promise<void>;

  // Last Modified Cutoff
  getLastModifiedCutoff(): Promise<number | null>;
  setLastModifiedCutoff(value: number): Promise<void>;
  removeLastModifiedCutoff(): Promise<void>;
  wasPushProcessed(iden: string, modified: number): Promise<boolean>;
  markPushProcessed(iden: string, modified: number): Promise<void>;

  // Auto Open Links on Reconnect
  getLastAutoOpenCutoff(): Promise<number | null>;
  setLastAutoOpenCutoff(value: number): Promise<void>;
  getAutoOpenLinksOnReconnect(): Promise<boolean>;
  setAutoOpenLinksOnReconnect(value: boolean): Promise<void>;
  getMaxAutoOpenPerReconnect(): Promise<number>;
  setMaxAutoOpenPerReconnect(value: number): Promise<void>;
  getDismissAfterAutoOpen(): Promise<boolean>;
  setDismissAfterAutoOpen(value: boolean): Promise<void>;

  // User Info Cache
  getUserInfoCache(): Promise<any | null>;
  setUserInfoCache(value: any): Promise<void>;

  // Bulk Operations
  clear(): Promise<void>;
  remove(keys: string[]): Promise<void>;

  // Diagnostics
  getAutoOpenDebugSnapshot(): Promise<{
    lastAutoOpenCutoff: number;
    lastModifiedCutoff: number;
    mruCount: number;
    maxOpenedCreated: number;
  }>;
}

const getStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const getBooleanOrDefault = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const getNumberOrDefault = (value: unknown, fallback: number): number =>
  typeof value === 'number' ? value : fallback;

const ENCRYPTION_PASSWORD_KEY = 'encryptionPassword';
const PROCESSED_PUSHES_KEY = 'processedPushes';
const MAX_PROCESSED_PUSH_MARKERS = 500;

const getProcessedPushMarkers = (
  value: unknown,
): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const markers: Record<string, number> = {};
  for (const [iden, modified] of Object.entries(value)) {
    if (typeof modified === 'number' && Number.isFinite(modified)) {
      markers[iden] = modified;
    }
  }
  return markers;
};

const pruneProcessedPushMarkers = (
  markers: Record<string, number>,
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(markers)
      .sort(([, leftModified], [, rightModified]) => rightModified - leftModified)
      .slice(0, MAX_PROCESSED_PUSH_MARKERS),
  );

/**
 * Chrome Storage Repository Implementation
 * 
 * This class implements the StorageRepository interface using the
 * chrome.storage API. It handles the promisification of the callback-based
 * chrome.storage API.
 */
export class ChromeStorageRepository implements StorageRepository {
  private fallbackEncryptionPassword: string | null = null;

  private getSessionStorage(): chrome.storage.StorageArea | undefined {
    return chrome.storage.session;
  }

  private async removeLegacyEncryptionPassword(): Promise<void> {
    try {
      await chrome.storage.local.remove([ENCRYPTION_PASSWORD_KEY]);
      const result = await chrome.storage.local.get([ENCRYPTION_PASSWORD_KEY]);
      if (getStringOrNull(result[ENCRYPTION_PASSWORD_KEY]) !== null) {
        console.warn('Storage: Failed to remove legacy encryption password from local storage');
      }
    } catch (error) {
      console.warn('Storage: Failed to clean up legacy encryption password from local storage', {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  /**
   * Get API Key from local storage
   * Security: API keys are stored in local storage (not synced) to prevent
   * exposure through Chrome's sync infrastructure
   */
  async getApiKey(): Promise<string | null> {
    const result = await chrome.storage.local.get(['apiKey']);
    return getStringOrNull(result.apiKey);
  }

  /**
   * Set API Key in local storage
   * Security: API keys are stored in local storage (not synced) to prevent
   * exposure through Chrome's sync infrastructure
   */
  async setApiKey(key: string | null): Promise<void> {
    if (key === null) {
      await chrome.storage.local.remove(['apiKey']);
    } else {
      await chrome.storage.local.set({ apiKey: key });
    }
  }

  /**
   * Get Device Identifier from local storage
   */
  async getDeviceIden(): Promise<string | null> {
    const result = await chrome.storage.local.get(['deviceIden']);
    return getStringOrNull(result.deviceIden);
  }

  /**
   * Set Device Identifier in local storage
   */
  async setDeviceIden(iden: string | null): Promise<void> {
    if (iden === null) {
      await chrome.storage.local.remove(['deviceIden']);
    } else {
      await chrome.storage.local.set({ deviceIden: iden });
    }
  }

  /**
    * Get Device Nickname from local storage
    */
  async getDeviceNickname(): Promise<string | null> {
    const result = await chrome.storage.local.get(['deviceNickname']);
    return getStringOrNull(result.deviceNickname);
  }

  /**
    * Set Device Nickname in local storage
    */
  async setDeviceNickname(nickname: string): Promise<void> {
    await chrome.storage.local.set({ deviceNickname: nickname });
  }

  /**
   * Get Auto Open Links setting from sync storage
   */
  async getAutoOpenLinks(): Promise<boolean> {
    const result = await chrome.storage.sync.get(['autoOpenLinks']);
    return getBooleanOrDefault(result.autoOpenLinks, false);
  }

  /**
   * Set Auto Open Links setting in sync storage
   */
  async setAutoOpenLinks(enabled: boolean): Promise<void> {
    await chrome.storage.sync.set({ autoOpenLinks: enabled });
  }

  /**
   * Get Notification Timeout from sync storage
   */
  async getNotificationTimeout(): Promise<number> {
    const result = await chrome.storage.sync.get(['notificationTimeout']);
    return getNumberOrDefault(result.notificationTimeout, 5000);
  }

  /**
   * Set Notification Timeout in sync storage
   */
  async setNotificationTimeout(timeout: number): Promise<void> {
    await chrome.storage.sync.set({ notificationTimeout: timeout });
  }

  /**
   * Get Only This Device setting from sync storage
   */
  async getOnlyThisDevice(): Promise<boolean> {
    const result = await chrome.storage.sync.get(['onlyThisDevice']);
    return getBooleanOrDefault(result.onlyThisDevice, false);
  }

  /**
   * Set Only This Device setting in sync storage
   */
  async setOnlyThisDevice(value: boolean): Promise<void> {
    await chrome.storage.sync.set({ onlyThisDevice: value });
  }

  /**
   * Get Encryption Password from session storage when available.
   * Existing local plaintext values are migrated once, then removed.
   */
  async getEncryptionPassword(): Promise<string | null> {
    const sessionStorage = this.getSessionStorage();
    if (sessionStorage) {
      const sessionResult = await sessionStorage.get([ENCRYPTION_PASSWORD_KEY]);
      const sessionPassword = getStringOrNull(sessionResult[ENCRYPTION_PASSWORD_KEY]);
      if (sessionPassword) {
        return sessionPassword;
      }
    }

    const localResult = await chrome.storage.local.get([ENCRYPTION_PASSWORD_KEY]);
    const localPassword = getStringOrNull(localResult[ENCRYPTION_PASSWORD_KEY]);
    if (localPassword && sessionStorage) {
      await sessionStorage.set({ [ENCRYPTION_PASSWORD_KEY]: localPassword });
      await this.removeLegacyEncryptionPassword();
    }
    if (!sessionStorage) {
      return localPassword ?? this.fallbackEncryptionPassword;
    }
    return localPassword;
  }

  /**
   * Set Encryption Password in session storage when available.
   * Falls back to memory only on browsers without storage.session.
   */
  async setEncryptionPassword(password: string | null): Promise<void> {
    const sessionStorage = this.getSessionStorage();
    if (password === null) {
      this.fallbackEncryptionPassword = null;
      await Promise.all([
        sessionStorage?.remove([ENCRYPTION_PASSWORD_KEY]) ?? Promise.resolve(),
        chrome.storage.local.remove([ENCRYPTION_PASSWORD_KEY])
      ]);
    } else if (sessionStorage) {
      this.fallbackEncryptionPassword = null;
      await sessionStorage.set({ [ENCRYPTION_PASSWORD_KEY]: password });
      await this.removeLegacyEncryptionPassword();
    } else {
      this.fallbackEncryptionPassword = password;
      await chrome.storage.local.remove([ENCRYPTION_PASSWORD_KEY]);
    }
  }

  /**
   * Get Scroll to Recent Pushes flag from local storage
   */
  async getScrollToRecentPushes(): Promise<boolean> {
    const result = await chrome.storage.local.get(['scrollToRecentPushes']);
    return getBooleanOrDefault(result.scrollToRecentPushes, false);
  }

  /**
   * Set Scroll to Recent Pushes flag in local storage
   */
  async setScrollToRecentPushes(scroll: boolean): Promise<void> {
    await chrome.storage.local.set({ scrollToRecentPushes: scroll });
  }

  /**
   * Remove Scroll to Recent Pushes flag from local storage
   */
  async removeScrollToRecentPushes(): Promise<void> {
    await chrome.storage.local.remove(['scrollToRecentPushes']);
  }

  /**
   * Get Device Registration In Progress flag from local storage
   */
  async getDeviceRegistrationInProgress(): Promise<boolean> {
    const result = await chrome.storage.local.get(['deviceRegistrationInProgress']);
    return getBooleanOrDefault(result.deviceRegistrationInProgress, false);
  }

  /**
   * Set Device Registration In Progress flag in local storage
   */
  async setDeviceRegistrationInProgress(inProgress: boolean): Promise<void> {
    await chrome.storage.local.set({ deviceRegistrationInProgress: inProgress });
  }

  /**
   * Get Last Modified Cutoff from local storage
   */
  async getLastModifiedCutoff(): Promise<number | null> {
    const result = await chrome.storage.local.get(['lastModifiedCutoff']);
    const cutoff = result.lastModifiedCutoff;
    return typeof cutoff === 'number' ? cutoff : null;
  }

  /**
   * Set Last Modified Cutoff in local storage
   */
  async setLastModifiedCutoff(value: number): Promise<void> {
    if (value === 0) {
      console.warn('Storage: Setting lastModifiedCutoff to 0 - ensure this is via unsafe setter');
    }
    await chrome.storage.local.set({ lastModifiedCutoff: value });
  }

  /**
   * Remove Last Modified Cutoff from local storage
   * Used during invalid cursor recovery
   */
  async removeLastModifiedCutoff(): Promise<void> {
    await chrome.storage.local.remove('lastModifiedCutoff');
  }

  /**
   * Check whether a push version has already completed side effects.
   */
  async wasPushProcessed(iden: string, modified: number): Promise<boolean> {
    if (!iden || !Number.isFinite(modified)) {
      return false;
    }

    const result = await chrome.storage.local.get([PROCESSED_PUSHES_KEY]);
    const markers = getProcessedPushMarkers(result[PROCESSED_PUSHES_KEY]);
    return (markers[iden] ?? 0) >= modified;
  }

  /**
   * Mark a push version as completed after notification and auto-open work.
   */
  async markPushProcessed(iden: string, modified: number): Promise<void> {
    if (!iden || !Number.isFinite(modified)) {
      return;
    }

    const result = await chrome.storage.local.get([PROCESSED_PUSHES_KEY]);
    const markers = getProcessedPushMarkers(result[PROCESSED_PUSHES_KEY]);
    markers[iden] = Math.max(markers[iden] ?? 0, modified);
    await chrome.storage.local.set({
      [PROCESSED_PUSHES_KEY]: pruneProcessedPushMarkers(markers),
    });
  }

  /**
   * Get Last Auto Open Cutoff from local storage
   */
  async getLastAutoOpenCutoff(): Promise<number | null> {
    const result = await chrome.storage.local.get(['lastAutoOpenCutoff']);
    const v = result.lastAutoOpenCutoff;
    return typeof v === 'number' ? v : null;
  }

  /**
   * Set Last Auto Open Cutoff in local storage
   */
  async setLastAutoOpenCutoff(value: number): Promise<void> {
    await chrome.storage.local.set({ lastAutoOpenCutoff: value });
  }

  /**
   * Get Auto Open Links on Reconnect setting from local storage
   */
  async getAutoOpenLinksOnReconnect(): Promise<boolean> {
    const result = await chrome.storage.local.get(['autoOpenLinksOnReconnect']);
    const v = result.autoOpenLinksOnReconnect;
    return typeof v === 'boolean' ? v : false;
  }

  /**
   * Set Auto Open Links on Reconnect setting in local storage
   */
  async setAutoOpenLinksOnReconnect(value: boolean): Promise<void> {
    await chrome.storage.local.set({ autoOpenLinksOnReconnect: value });
  }

  /**
   * Get Max Auto Open Per Reconnect from local storage
   */
  async getMaxAutoOpenPerReconnect(): Promise<number> {
    const result = await chrome.storage.local.get(['maxAutoOpenPerReconnect']);
    const v = result.maxAutoOpenPerReconnect;
    return typeof v === 'number' && v > 0 ? v : 5;
  }

  /**
   * Set Max Auto Open Per Reconnect in local storage
   */
  async setMaxAutoOpenPerReconnect(value: number): Promise<void> {
    await chrome.storage.local.set({ maxAutoOpenPerReconnect: value });
  }

  /**
   * Get Dismiss After Auto Open setting from local storage
   */
  async getDismissAfterAutoOpen(): Promise<boolean> {
    const result = await chrome.storage.local.get(['dismissAfterAutoOpen']);
    return Boolean(result.dismissAfterAutoOpen);
  }

  /**
   * Set Dismiss After Auto Open setting in local storage
   */
  async setDismissAfterAutoOpen(value: boolean): Promise<void> {
    await chrome.storage.local.set({ dismissAfterAutoOpen: value });
  }

  /**
   * Get User Info Cache from local storage
   */
  async getUserInfoCache(): Promise<any | null> {
    const result = await chrome.storage.local.get(['userInfoCache']);
    return result.userInfoCache || null;
  }

  /**
   * Set User Info Cache in local storage
   */
  async setUserInfoCache(value: any): Promise<void> {
    await chrome.storage.local.set({ userInfoCache: value });
  }

  /**
   * Clear all storage (both sync and local)
   */
  async clear(): Promise<void> {
    await Promise.all([
      chrome.storage.sync.clear(),
      chrome.storage.local.clear(),
      this.getSessionStorage()?.clear() ?? Promise.resolve()
    ]);
  }

  /**
   * Remove specific keys from storage
   * Removes from both sync and local storage
   */
  async remove(keys: string[]): Promise<void> {
    await Promise.all([
      chrome.storage.sync.remove(keys),
      chrome.storage.local.remove(keys),
      this.getSessionStorage()?.remove(keys) ?? Promise.resolve()
    ]);
  }

  /**
   * Get Auto Open Debug Snapshot for diagnostics
   */
  async getAutoOpenDebugSnapshot(): Promise<{
    lastAutoOpenCutoff: number;
    lastModifiedCutoff: number;
    mruCount: number;
    maxOpenedCreated: number;
  }> {
    const { lastAutoOpenCutoff = 0 } =
      await chrome.storage.local.get('lastAutoOpenCutoff');
    const { lastModifiedCutoff = 0 } =
      await chrome.storage.local.get('lastModifiedCutoff');
    const raw = await chrome.storage.local.get('openedPushMRU');
    const mru = raw.openedPushMRU as
      | { idens?: string[]; maxOpenedCreated?: number }
      | undefined;
    return {
      lastAutoOpenCutoff:
        typeof lastAutoOpenCutoff === 'number' ? lastAutoOpenCutoff : 0,
      lastModifiedCutoff:
        typeof lastModifiedCutoff === 'number' ? lastModifiedCutoff : 0,
      mruCount: Array.isArray(mru?.idens) ? mru!.idens!.length : 0,
      maxOpenedCreated:
        typeof mru?.maxOpenedCreated === 'number' ? mru!.maxOpenedCreated! : 0,
    };
  }
}

/**
 * Create a singleton instance of the storage repository
 * This ensures we have a single point of access throughout the application
 */
export const storageRepository = new ChromeStorageRepository();
