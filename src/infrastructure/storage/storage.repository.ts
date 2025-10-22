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

/**
 * Chrome Storage Repository Implementation
 * 
 * This class implements the StorageRepository interface using the
 * chrome.storage API. It handles the promisification of the callback-based
 * chrome.storage API.
 */
export class ChromeStorageRepository implements StorageRepository {
  /**
   * Get API Key from local storage
   * Security: API keys are stored in local storage (not synced) to prevent
   * exposure through Chrome's sync infrastructure
   */
  async getApiKey(): Promise<string | null> {
    const result = await chrome.storage.local.get(['apiKey']);
    return result.apiKey || null;
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
    return result.deviceIden || null;
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
    return result.deviceNickname || null;
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
    return result.autoOpenLinks !== undefined ? result.autoOpenLinks : false;
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
    return result.notificationTimeout !== undefined ? result.notificationTimeout : 5000;
  }

  /**
   * Set Notification Timeout in sync storage
   */
  async setNotificationTimeout(timeout: number): Promise<void> {
    await chrome.storage.sync.set({ notificationTimeout: timeout });
  }

  /**
   * Get Encryption Password from local storage
   */
  async getEncryptionPassword(): Promise<string | null> {
    const result = await chrome.storage.local.get(['encryptionPassword']);
    return result.encryptionPassword || null;
  }

  /**
   * Set Encryption Password in local storage
   */
  async setEncryptionPassword(password: string | null): Promise<void> {
    if (password === null) {
      await chrome.storage.local.remove(['encryptionPassword']);
    } else {
      await chrome.storage.local.set({ encryptionPassword: password });
    }
  }

  /**
   * Get Scroll to Recent Pushes flag from local storage
   */
  async getScrollToRecentPushes(): Promise<boolean> {
    const result = await chrome.storage.local.get(['scrollToRecentPushes']);
    return result.scrollToRecentPushes || false;
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
    return result.deviceRegistrationInProgress || false;
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
      chrome.storage.local.clear()
    ]);
  }

  /**
   * Remove specific keys from storage
   * Removes from both sync and local storage
   */
  async remove(keys: string[]): Promise<void> {
    await Promise.all([
      chrome.storage.sync.remove(keys),
      chrome.storage.local.remove(keys)
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

