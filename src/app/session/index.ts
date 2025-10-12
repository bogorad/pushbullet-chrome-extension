import type { SessionCache } from "../../types/domain";
import { debugLogger } from "../../lib/logging";
import {
  fetchChats,
  fetchDevices,
  fetchRecentPushes,
  fetchUserInfo,
  registerDevice,
} from "../api/client";
import { storageRepository } from "../../infrastructure/storage/storage.repository";
import { saveSessionCache } from "../../infrastructure/storage/indexed-db";

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
    debugLogger.general("INFO", "Session already loaded, skipping network initialization.");
    // We must still connect the WebSocket.
    if (connectWebSocketFn) {
      connectWebSocketFn();
    }
    return null;
  }

  // Create and store the initialization promise
  initPromise = (async () => {
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

        // Fetch recent pushes
        const pushes = await fetchRecentPushes(apiKeyValue);
        sessionCache.recentPushes = pushes;

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
          interval: "5 minutes",
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

      // Fetch recent pushes
      debugLogger.general("DEBUG", "Refreshing recent pushes");
      const pushes = await fetchRecentPushes(apiKeyParam);
      sessionCache.recentPushes = pushes;

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
