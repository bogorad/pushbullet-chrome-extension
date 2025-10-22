import type { SessionCache, Push } from "../../types/domain";
import { debugLogger } from "../../lib/logging";
import { performanceMonitor } from "../../lib/perf";
import {
  fetchChats,
  fetchDevices,
  fetchDisplayPushes,  // ← ADD: Import new function
  fetchIncrementalPushes,
  fetchRecentPushes,
  fetchUserInfo,
  registerDevice,
} from "../api/client";
import { storageRepository } from "../../infrastructure/storage/storage.repository";
import { saveSessionCache } from "../../infrastructure/storage/indexed-db";
import { startCriticalKeepalive, stopCriticalKeepalive } from "../../background/keepalive";
import { refreshPushesIncremental } from "./pipeline";

// Session cache state
export const sessionCache: SessionCache = {
  userInfo: null,
  devices: [],
  recentPushes: [],
  chats: [], // ← ADD THIS LINE
  isAuthenticated: false,
  lastUpdated: 0,
  autoOpenLinks: true,
  deviceNickname: "Chrome",
  lastModifiedCutoff: 0,  // ← ADD: Initialize to 0
};

/**
 * Reset the session cache to its initial, unauthenticated state.
 * This ensures no stale data remains when logging out.
 */
export function resetSessionCache(): void {
  sessionCache.userInfo = null;
  sessionCache.devices = [];
  sessionCache.recentPushes = [];
  sessionCache.chats = [];
  sessionCache.isAuthenticated = false;
  sessionCache.lastUpdated = 0;
  sessionCache.autoOpenLinks = true;
  sessionCache.deviceNickname = "Chrome";
  sessionCache.lastModifiedCutoff = 0;  // ← ADD: Reset cutoff on logout
}

/**
 * Handle invalid cursor recovery
 *
 * This function is called when the API returns an invalid_cursor error.
 * It clears all local state and triggers a fresh bootstrap.
 *
 * Steps:
 * 1. Clear the corrupted cursor from storage
 * 2. Reset session cache to empty
 * 3. Trigger full re-initialization
 */
export async function handleInvalidCursorRecovery(
  apiKey: string,
  connectWebSocketFn?: () => void
): Promise<void> {
  debugLogger.general('WARN', 'Invalid cursor detected - starting recovery process');

  try {
    // Step 1: Clear cursor from storage
    debugLogger.general('INFO', 'Clearing invalid cursor from storage');
    await handleInvalidCursorRecoveryReset();

    // Step 2: Reset session cache
    debugLogger.general('INFO', 'Resetting session cache');
    sessionCache.lastModifiedCutoff = 0;
    sessionCache.recentPushes = [];

    // Step 3: Track recovery attempt
    performanceMonitor.recordInvalidCursorRecovery();

    // Step 4: Re-bootstrap session
    debugLogger.general('INFO', 'Re-bootstrapping session after invalid cursor');
    await initializeSessionCache('invalid-cursor-recovery', connectWebSocketFn);

    debugLogger.general('INFO', 'Invalid cursor recovery completed successfully');
  } catch (error) {
    debugLogger.general('ERROR', 'Failed to recover from invalid cursor', null, error as Error);
    throw error;
  }
}

export async function hydrateCutoff(): Promise<void> {
  const cutoff = await storageRepository.getLastModifiedCutoff();
  sessionCache.lastModifiedCutoff = typeof cutoff === 'number' ? cutoff : 0;
  debugLogger.general('DEBUG', `Session: Hydrated lastModifiedCutoff=${sessionCache.lastModifiedCutoff}`);
}



// Explicit reset flows only:
export async function handleLogoutReset(): Promise<void> {
  await storageRepository.setLastModifiedCutoff(0); // allowed here
  debugLogger.general('INFO', 'Cutoff: set to 0 due to explicit logout.');
}

// SAFE: for normal advancement; rejects 0 and non-increasing values
export async function setLastModifiedCutoffSafe(next: number): Promise<void> {
  const current = await storageRepository.getLastModifiedCutoff();
  if (!Number.isFinite(next) || next <= 0) {
    debugLogger.general('WARN', 'CutoffSafe: refusing non-positive or invalid value', { next });
    return;
  }
  if (current && next <= current) {
    debugLogger.general('DEBUG', 'CutoffSafe: unchanged or non-increasing', { current, next });
    return;
  }
  await storageRepository.setLastModifiedCutoff(next);
  sessionCache.lastModifiedCutoff = next;
  debugLogger.general('INFO', 'Pipeline 1 Updated cutoff via safe setter', { old: current ?? null, new: next });
}

// UNSAFE: only for explicit logout or invalid-cursor recovery
export async function setLastModifiedCutoffUnsafeForRecovery(next: number): Promise<void> {
  await storageRepository.setLastModifiedCutoff(next);
  sessionCache.lastModifiedCutoff = next;
  debugLogger.general('INFO', 'Cutoff set UNSAFE due to explicit recovery/logout', { new: next });
}

export async function handleInvalidCursorRecoveryReset(): Promise<void> {
  await setLastModifiedCutoffUnsafeForRecovery(0); // allowed here
  debugLogger.general('INFO', 'Cutoff: set to 0 due to invalid-cursor recovery.');
}



// Promise singleton for single-flight initialization
// Prevents race conditions when multiple events trigger initialization concurrently
let initPromise: Promise<string | null> | null = null;

/**
 * Get the current initialization promise (if any)
 * This allows callers to await ongoing initialization instead of polling
 */
export function getInitPromise(): Promise<string | null> | null {
  return initPromise;
}

// NO DECRYPTION - API key is stored in plain text in chrome.storage.sync
// The crypto module is ONLY for decrypting E2EE push messages, NOT the API key!

export async function initializeSessionCache(
  source = "unknown",
  connectWebSocketFn?: () => void,
  stateSetters?: {
    setApiKey: (key: string | null) => void;
    setDeviceIden: (iden: string | null) => void;
    setAutoOpenLinks: (value: boolean) => void;
    setDeviceNickname: (nickname: string) => void;
    setNotificationTimeout: (timeout: number) => void;
  },
): Promise<string | null> {
  // If initialization is already in progress, return the existing promise
  // This allows concurrent callers to await the same initialization
  if (initPromise) {
    debugLogger.general(
      "INFO",
      "Initialization already in progress, returning existing promise",
      {
        source,
        existingInitialization: true,
      },
    );
    return initPromise;
  }

  // If the session is already authenticated (e.g., loaded from IndexedDB),
  // then there is no work to do here.
  if (sessionCache.isAuthenticated) {
    const hasData =
      sessionCache.userInfo !== null && (sessionCache.devices?.length ?? 0) > 0;

    if (!hasData) {
      debugLogger.general(
        "WARN",
        "Authenticated flag set but session data missing — forcing re-initialization",
      );
      sessionCache.isAuthenticated = false;
    } else {
      debugLogger.general(
        "INFO",
        "Session already loaded with data, skipping network initialization.",
      );
      if (connectWebSocketFn) connectWebSocketFn();
      return null;
    }
  }

  // Create and store the initialization promise
  initPromise = (async () => {
    // START keepalive
    startCriticalKeepalive();

    try {
      debugLogger.general("INFO", "Initializing session cache", {
        source,
        timestamp: new Date().toISOString(),
      });

      // Load core settings from sync storage
      debugLogger.storage(
        "DEBUG",
        "Loading initial configuration from storage repository",
      );

      // Get API key and device iden from storage repository
      const apiKeyValue = await storageRepository.getApiKey();
      const deviceIdenValue = await storageRepository.getDeviceIden();

      if (stateSetters) {
        stateSetters.setApiKey(apiKeyValue);
        stateSetters.setDeviceIden(deviceIdenValue);
      }

      // Get settings with defaults from storage repository
      const autoOpenLinksValue = await storageRepository.getAutoOpenLinks();
      const notificationTimeoutValue =
        await storageRepository.getNotificationTimeout();
      const deviceNicknameValue =
        (await storageRepository.getDeviceNickname()) || "Chrome";

      if (stateSetters) {
        stateSetters.setAutoOpenLinks(autoOpenLinksValue);
        stateSetters.setNotificationTimeout(notificationTimeoutValue);
        stateSetters.setDeviceNickname(deviceNicknameValue);
      }

      sessionCache.autoOpenLinks = autoOpenLinksValue;
      sessionCache.deviceNickname = deviceNicknameValue;

      debugLogger.storage(
        "INFO",
        "Loaded configuration from storage repository",
        {
          hasApiKey: !!apiKeyValue,
          hasDeviceIden: !!deviceIdenValue,
          autoOpenLinks: autoOpenLinksValue,
          deviceNickname: deviceNicknameValue,
          notificationTimeout: notificationTimeoutValue,
        },
      );

      debugLogger.general("DEBUG", "API key status", {
        hasApiKey: !!apiKeyValue,
        apiKeyLength: apiKeyValue ? apiKeyValue.length : 0,
      });

      if (apiKeyValue) {
        debugLogger.general(
          "INFO",
          "API key available - initializing session data",
        );

        // Fetch user info
        const userInfo = await fetchUserInfo(apiKeyValue);
        sessionCache.userInfo = userInfo;

        // Fetch devices
        const devices = await fetchDevices(apiKeyValue);
        sessionCache.devices = devices;

        // ========================================
        // PIPELINE 1: Incremental Auto-Open Pipeline
        // ========================================
        // This pipeline tracks what pushes we've already seen and processes
        // new ones for auto-opening links. It uses lastModifiedCutoff to
        // fetch only changes since the last check.

        debugLogger.general('INFO', 'Pipeline 1: Fetching incremental pushes for auto-open');

        const { pushes: incrementalPushes, isSeedRun } = await refreshPushesIncremental(apiKeyValue);

        if (isSeedRun) {
          debugLogger.general('INFO', 'Seed run: cutoff initialized; skipping processing and auto-open.');
          // Update sessionCache.lastModifiedCutoff from storage
          const updatedCutoff = await storageRepository.getLastModifiedCutoff();
          sessionCache.lastModifiedCutoff = updatedCutoff ?? 0;
          return null; // Do not proceed to processing
        }

        // Update sessionCache.lastModifiedCutoff from storage
        const updatedCutoff = await storageRepository.getLastModifiedCutoff();
        sessionCache.lastModifiedCutoff = updatedCutoff ?? 0;

        // ========================================
        // PIPELINE 2: Display History Pipeline
        // ========================================
        // This pipeline fetches the last 50 pushes for display in the popup.
        // It is completely independent of the incremental tracking used for
        // auto-opening links.

        debugLogger.general('INFO', 'Pipeline 2: Fetching display pushes for UI');

        const displayPushes = await fetchDisplayPushes(apiKeyValue, 50);

        debugLogger.general('INFO', 'Pipeline 2: Display fetch complete', {
          count: displayPushes.length,
        });

        // Store display pushes in session cache for popup consumption
        sessionCache.recentPushes = displayPushes;

        // ========== ADD THIS ENTIRE BLOCK ==========
        // Fetch chats (friends/contacts)
        try {
          const chats = await fetchChats(apiKeyValue);
          sessionCache.chats = chats;
          debugLogger.general("INFO", "Chats loaded successfully", {
            chatCount: chats.length,
          });
        } catch (error) {
          // Don't fail initialization if chats fail to load
          debugLogger.general("WARN", "Failed to load chats, continuing anyway", {
            error: (error as Error).message,
          });
          sessionCache.chats = [];
        }
        // ========== END OF BLOCK ==========

        // Update session cache
        sessionCache.isAuthenticated = true;
        sessionCache.lastUpdated = Date.now();

        debugLogger.general("INFO", "Session cache populated successfully", {
          hasUserInfo: !!sessionCache.userInfo,
          deviceCount: sessionCache.devices.length,
          pushCount: sessionCache.recentPushes.length,
          lastUpdated: new Date(sessionCache.lastUpdated).toISOString(),
        });

        // Register device
        await registerDevice(apiKeyValue, deviceIdenValue, deviceNicknameValue);

        // Connect WebSocket if the function is provided
        if (connectWebSocketFn) {
          debugLogger.general("INFO", "Session initialized, connecting WebSocket.");
          connectWebSocketFn();
        }

        // Start periodic health check
        chrome.alarms.create("websocketHealthCheck", { periodInMinutes: 1 });
        debugLogger.general("DEBUG", "WebSocket health check alarm created", {
          interval: "1 minutes",
        });
      } else {
        debugLogger.general(
          "WARN",
          "No API key available - session cache not initialized",
        );
      }

      // Save our freshly built session to the database for next time.
      saveSessionCache(sessionCache);
      debugLogger.general("INFO", "Initialization completed successfully", {
        source,
        timestamp: new Date().toISOString(),
      });

      return apiKeyValue;
    } catch (error) {
      debugLogger.general(
        "ERROR",
        "Error initializing session cache",
        {
          error:
            (error as Error).message ||
            (error as Error).name ||
            "Unknown error",
        },
        error as Error,
      );
      sessionCache.isAuthenticated = false;
      throw error;
    } finally {
      // ALWAYS stop keepalive
      stopCriticalKeepalive();
      // Clear the promise reference to allow retry on failure
      initPromise = null;
    }
  })();

  return initPromise;
}

export async function refreshSessionCache(apiKeyParam: string): Promise<void> {
  debugLogger.general("INFO", "Refreshing session cache", {
    hasApiKey: !!apiKeyParam,
    timestamp: new Date().toISOString(),
  });

  try {
    if (apiKeyParam) {
      debugLogger.general(
        "DEBUG",
        "API key available - refreshing session data",
      );

      // Fetch user info
      debugLogger.general("DEBUG", "Refreshing user info");
      const userInfo = await fetchUserInfo(apiKeyParam);
      sessionCache.userInfo = userInfo;

      // Fetch devices
      debugLogger.general("DEBUG", "Refreshing devices");
      const devices = await fetchDevices(apiKeyParam);
      sessionCache.devices = devices;

      // ========================================
      // PIPELINE 1: Incremental Auto-Open Pipeline (Refresh)
      // ========================================
      debugLogger.general('DEBUG', 'Pipeline 1: Refreshing incremental pushes');

       const { pushes: incrementalPushes, isSeedRun } = await refreshPushesIncremental(apiKeyParam);

       if (isSeedRun) {
         debugLogger.general('INFO', 'Seed run: cutoff initialized; skipping processing and auto-open.');
         // Update sessionCache.lastModifiedCutoff from storage
         const updatedCutoff = await storageRepository.getLastModifiedCutoff();
         sessionCache.lastModifiedCutoff = updatedCutoff ?? 0;
         return; // Do not proceed to processing
       }

      // Update sessionCache.lastModifiedCutoff from storage
      const updatedCutoff = await storageRepository.getLastModifiedCutoff();
      sessionCache.lastModifiedCutoff = updatedCutoff ?? 0;

      // ========================================
      // PIPELINE 2: Display History Pipeline (Refresh)
      // ========================================
      debugLogger.general('DEBUG', 'Pipeline 2: Refreshing display pushes');

      const displayPushes = await fetchDisplayPushes(apiKeyParam, 50);
      sessionCache.recentPushes = displayPushes;

      debugLogger.general('INFO', 'Session refresh complete', {
        incrementalCount: incrementalPushes.length,
        displayCount: displayPushes.length,
      });

      // ========== ADD THIS ==========
      // Refresh chats
      try {
        const chats = await fetchChats(apiKeyParam);
        sessionCache.chats = chats;
      } catch (error) {
        debugLogger.general("WARN", "Failed to refresh chats", {
          error: (error as Error).message,
        });
      }
      // ========== END ==========

      // Update session cache
      sessionCache.isAuthenticated = true;
      sessionCache.lastUpdated = Date.now();

      debugLogger.general("INFO", "Session cache refreshed successfully", {
        hasUserInfo: !!sessionCache.userInfo,
        deviceCount: sessionCache.devices.length,
        pushCount: sessionCache.recentPushes.length,
        lastUpdated: new Date(sessionCache.lastUpdated).toISOString(),
      });
    } else {
      debugLogger.general(
        "WARN",
        "No API key available - cannot refresh session cache",
      );
      sessionCache.isAuthenticated = false;
    }
  } catch (error) {
    debugLogger.general(
      "ERROR",
      "Error refreshing session cache",
      {
        error: (error as Error).message,
      },
      error as Error,
    );
    throw error;
  }
}
