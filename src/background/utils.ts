/**
 * Utility functions for background service worker
 */

import { debugLogger } from "../lib/logging";
import { performanceMonitor } from "../lib/perf";
import { sessionCache, hydrateCutoff, setLastModifiedCutoffSafe } from "../app/session";
import { fetchIncrementalPushes } from "../app/api/client";
import { storageRepository } from "../infrastructure/storage/storage.repository";
import { hydrateBackgroundConfig } from "./config";
import {
  getApiKey,
  getNotificationTimeout,
  setPollingMode,
  isPollingMode,
} from "./state";
import type { Push } from "../types/domain";
import { createNotificationWithTimeout } from "../app/notifications";
import { globalEventBus } from "../lib/events/event-bus";
import { isTrustedImageUrl } from "../lib/security/trusted-image-url";
import { ServiceWorkerState, type ServiceWorkerStateMachine } from "./state-machine";
import { maybeAutoOpenLinkWithDismiss } from "./processing";

// Guard flag to prevent concurrent context menu setup
// Ensures idempotent behavior when multiple startup events fire
let isSettingUpContextMenu = false;

/**
 * Connection status for icon updates
 */
export type ConnectionStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "degraded";

export type WebSocketRecoveryController = Pick<
  ServiceWorkerStateMachine,
  "getCurrentState" | "transition"
>;

/**
 * Sanitize text to prevent XSS attacks
 * Removes HTML tags and dangerous characters
 *
 * DEFENSE-IN-DEPTH STRATEGY:
 * 1. This function provides basic sanitization for Chrome notification content
 * 2. The extension's CSP (Content Security Policy) provides strong XSS protection
 * 3. UI code (popup, options, etc.) uses textContent instead of innerHTML for user data
 * 4. This regex-based approach is sufficient for notification text (not rendered as HTML)
 *
 * NOTE: For HTML rendering, use textContent or a library like DOMPurify.
 * The popup's displayPushes() function correctly uses textContent for all user data.
 */
function sanitizeText(text: string): string {
  if (!text) return "";

  // Remove HTML tags
  let sanitized = text.replace(/<[^>]*>/g, "");

  // Remove script-like content
  sanitized = sanitized.replace(/javascript:/gi, "");
  sanitized = sanitized.replace(/on\w+\s*=/gi, "");

  // Trim and limit length
  sanitized = sanitized.trim().substring(0, 1000);

  return sanitized;
}

/**
 * Sanitize URL to prevent XSS attacks
 * Validates URL format and ensures it's safe
 */
function sanitizeUrl(url: string): string {
  if (!url) return "";

  try {
    const urlObj = new URL(url);
    // Only allow http/https protocols
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      return "";
    }
    return url;
  } catch {
    debugLogger.general("WARN", "Invalid URL provided", { url });
    return "";
  }
}

function hasStringValue(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function summarizePushForLog(push: Partial<Push>): Record<string, unknown> {
  const pushRecord = push as Record<string, unknown>;
  const notifications = Array.isArray(pushRecord.notifications)
    ? pushRecord.notifications
    : [];

  return {
    iden: pushRecord.iden,
    type: pushRecord.type,
    encrypted: !!pushRecord.encrypted,
    contentFlags: {
      heading: hasStringValue(pushRecord.title),
      message: hasStringValue(pushRecord.body),
      link: hasStringValue(pushRecord.url),
      fileLink: hasStringValue(pushRecord.file_url),
      imageLink: hasStringValue(pushRecord.image_url),
    },
    notificationsCount: notifications.length,
    created: pushRecord.created,
    modified: pushRecord.modified,
  };
}

/**
 * Update extension icon tooltip to show current state
 */
export function updateExtensionTooltip(stateDescription: string): void {
  try {
    chrome.action.setTitle({ title: stateDescription });
    debugLogger.general("DEBUG", "Updated extension tooltip", {
      stateDescription,
    });
  } catch (error) {
    debugLogger.general("ERROR", "Exception setting tooltip", {
      stateDescription,
      error: (error as Error).message,
    });
  }
}

/**
 * Update extension icon based on connection status
 * Uses badge color instead of different icon files since service workers have issues loading icons
 */
export function updateConnectionIcon(status: ConnectionStatus): void {
  try {
    // Set badge text
    const badgeText = " ";

    // Set badge color
    const badgeColor =
      status === "connected"
        ? "#4CAF50" // Green
        : status === "connecting"
          ? "#FFC107" // Yellow
          : status === "degraded"
            ? "#00BCD4" // Cyan
            : "#F44336"; // Red

    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: badgeColor });

    debugLogger.general("DEBUG", "Updated connection status badge", {
      status,
      badgeText,
      badgeColor,
    });
  } catch (error) {
    debugLogger.general(
      "ERROR",
      "Exception setting badge",
      {
        status,
        error: (error as Error).message,
      },
      error as Error,
    );
  }
}

function upsertPushes(
  existing: Push[],
  incoming: Push[]
): [updated: Push[], newOnes: Push[]] {
  const map = new Map(existing.map(p => [p.iden, p]));
  const newOnes: Push[] = [];

  for (const p of incoming) {
    if (map.has(p.iden)) {
      map.set(p.iden, { ...map.get(p.iden)!, ...p }); // merge updates like dismissed
    } else {
      newOnes.push(p);
      map.set(p.iden, p);
    }
  }

  // Keep most-recent-first, cap length to prevent unbounded growth (e.g., 200)
  const updated = Array.from(map.values()).sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 200);
  return [updated, newOnes];
}

function getPushModified(push: Push): number {
  return typeof push.modified === 'number' ? push.modified : 0;
}

/**
 * Refresh pushes from API and show notifications for new ones
 */
export async function refreshPushes(
  notificationDataStore?: Map<string, Push>,
): Promise<void> {
  await hydrateBackgroundConfig();
  const apiKey = getApiKey();
  if (!apiKey) {
    debugLogger.general('WARN', 'Cannot refresh pushes - no API key');
    return;
  }

  try {
    // ========================================
    // PIPELINE 1: Incremental Auto-Open Pipeline
    // ========================================
    // Fetch only NEW pushes since last check for auto-opening

    debugLogger.general('DEBUG', 'Pipeline 1: Checking for new pushes (incremental)');

    const cutoff = sessionCache.lastModifiedCutoff ?? (await storageRepository.getLastModifiedCutoff()) ?? 0;
    const incrementalPushes = await fetchIncrementalPushes(apiKey, cutoff, 100);

    debugLogger.general('INFO', 'Pipeline 1: Incremental fetch complete', {
      newPushCount: incrementalPushes.length,
      cutoff,
    });

    if (incrementalPushes.length === 0) {
      debugLogger.general('INFO', 'Pipeline 1: No new pushes to process');
      return; // Nothing new, exit early
    }

    // ========================================
    // PIPELINE 2: Update Display Data
    // ========================================
    // Merge new pushes into display array using upsert

    debugLogger.general('DEBUG', 'Pipeline 2: Updating display pushes');

    const [updatedDisplayPushes, newPushes] = upsertPushes(
      sessionCache.recentPushes ?? [],
      incrementalPushes
    );

    sessionCache.recentPushes = updatedDisplayPushes;
    sessionCache.lastUpdated = Date.now();

    debugLogger.general('INFO', 'Pipeline 2: Display updated', {
      totalDisplayPushes: updatedDisplayPushes.length,
      newPushes: newPushes.length,
    });

    // ========================================
    // Process New Pushes (Notifications & Auto-Open)
    // ========================================
    // Only notify and auto-open for truly NEW pushes (from newPushes array)

    let openedThisRun = 0;
    const cap = await storageRepository.getMaxAutoOpenPerReconnect();

    let processedCutoff = cutoff;
    const pushesForProcessing = [...incrementalPushes].sort(
      (left, right) => getPushModified(left) - getPushModified(right),
    );

    for (const push of pushesForProcessing) {
      const modified = getPushModified(push);
      if (modified <= 0) {
        debugLogger.general('WARN', 'Skipping push with invalid modified timestamp', {
          pushIden: push.iden,
        });
        continue;
      }
      if (!push.iden) {
        debugLogger.general('WARN', 'Skipping push with missing iden');
        continue;
      }

      if (await storageRepository.wasPushProcessed(push.iden, modified)) {
        if (modified > processedCutoff) {
          await setLastModifiedCutoffSafe(modified);
          processedCutoff = modified;
        }
        continue;
      }

      debugLogger.general('INFO', 'Processing new push', {
        pushIden: push.iden,
        pushType: push.type,
      });

      // Show notification
      await showPushNotification(push, notificationDataStore);

      if (openedThisRun >= cap) {
        debugLogger.general('WARN', 'Auto-open links capped', {
          opened: openedThisRun,
          total: pushesForProcessing.length,
          cap,
        });
      } else {
        const opened = await maybeAutoOpenLinkWithDismiss(push);
        if (opened) {
          openedThisRun += 1;

          if (openedThisRun >= cap) {
            debugLogger.general('WARN', 'Auto-open links capped', {
              opened: openedThisRun,
              total: pushesForProcessing.length,
              cap,
            });
          }
        }
      }

      await storageRepository.markPushProcessed(push.iden, modified);
      if (modified > processedCutoff) {
        await setLastModifiedCutoffSafe(modified);
        processedCutoff = modified;
      }
    }

    // Notify popup of updated data
    chrome.runtime
      .sendMessage({
        action: 'pushesUpdated',
        pushes: sessionCache.recentPushes,
      })
      .catch(() => undefined);

  } catch (error) {
    debugLogger.general('ERROR', 'Incremental refresh failed', {}, error as Error);
    performanceMonitor.recordHealthCheckFailure();
  }
}

/**
 * Counter for notification IDs
 */
let counter = 0;

/**
 * Show push notification
 */
export async function showPushNotification(
  push: Push,
  notificationDataStore?: Map<string, Push>,
): Promise<void> {
  try {
    // --- NEW GUARD CLAUSE: START ---
    // This specifically catches the empty push that follows an SMS deletion.
    // It checks for a push that is 'sms_changed' but has an empty or missing 'notifications' array.
    if (
      (push as any).type === "sms_changed" &&
      (!(push as any).notifications || (push as any).notifications.length === 0)
    ) {
      debugLogger.notifications(
        "INFO",
        "Ignoring sms_changed push with no notification content (deletion event).",
        { pushIden: push.iden },
      );
      return; // Exit the function immediately.
    }
    // --- NEW GUARD CLAUSE: END ---

    const notificationId = `pushbullet-push-${counter++}-${Date.now()}`;
    const baseOptions = {
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    };

    let notificationOptions: chrome.notifications.NotificationOptions = {
      ...baseOptions,
      type: "basic",
      title: "Pushbullet",
      message: "New push received",
    };

    // Handle undecrypted pushes first
    if (push.encrypted && "ciphertext" in push) {
      notificationOptions = {
        ...baseOptions,
        type: "basic",
        title: "Pushbullet",
        message:
          "An encrypted push was received. To view future encrypted pushes you need to add the correct end2end password in options",
      };
      debugLogger.notifications(
        "INFO",
        "Showing notification for undecrypted push",
      );
    } else if ((push as any).type === "sms_changed") {
      // The condition is now much simpler because the guard clause at the top
      // has already guaranteed that if we get here, the 'notifications' array
      // exists and is not empty.

      debugLogger.notifications(
        "DEBUG",
        "SMS push summary received",
        { push: summarizePushForLog(push) },
      );
      const sms = (push as any).notifications[0];

      // This redundant check is now removed, as the guard clause handles all empty cases.
      // if (!sms.body) { ... }

      const title = sms.title || "New SMS";
      const message = sms.body; // We can trust that 'body' exists.
      const imageUrl = sms.image_url;

      if (imageUrl && isTrustedImageUrl(imageUrl)) {
        try {
          debugLogger.notifications(
            "DEBUG",
            "Fetching contact photo for SMS notification",
            {
              imageUrl,
            },
          );

          // Fetch the image and convert to data URL to avoid CORS issues
          const response = await fetch(imageUrl);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const blob = await response.blob();

          // Convert blob to data URL
          const reader = new FileReader();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          debugLogger.notifications("DEBUG", "Contact photo converted to data URL", {
            originalUrl: imageUrl,
            dataUrlLength: dataUrl.length,
            blobSize: blob.size,
            blobType: blob.type,
          });

          // Use data URL for notification (avoids CORS issues)
          notificationOptions = {
            ...baseOptions,
            type: "basic",
            title: title,
            message: message,
            iconUrl: dataUrl,
          };

          debugLogger.notifications(
            "INFO",
            "Showing business card SMS notification with contact photo",
            {
              title,
              hasIcon: true,
            },
          );
        } catch (error) {
          debugLogger.notifications(
            "WARN",
            "Failed to fetch/convert contact photo, showing SMS without image",
            {
              imageUrl,
              error: (error as Error).message,
            },
          );

          // Fallback: notification without image
          notificationOptions = {
            ...baseOptions,
            type: "basic",
            title: title,
            message: message,
          };
        }
      } else {
        // Regular SMS without photo
        notificationOptions = {
          ...baseOptions,
          type: "basic",
          title: title,
          message: message,
        };

        debugLogger.notifications("INFO", "Showing basic notification for SMS", {
          title,
          hasImage: false,
        });
      }
    } else {
      // Standard handler for note, link, and file
      let title = "Pushbullet";
      let message = "";

      if (push.type === "note") {
        title = push.title || "New Note";
        message = push.body || "";

        notificationOptions = {
          ...baseOptions,
          type: "basic",
          title: title,
          message: message,
        };
      } else if (push.type === "link") {
        title = push.title || push.url || "New Link";
        message = push.url || "";

        notificationOptions = {
          ...baseOptions,
          type: "basic",
          title: title,
          message: message,
        };
      } else if (push.type === "file") {
        // Security validation for image URLs in file pushes
        debugLogger.notifications(
          "DEBUG",
          "File push summary received",
          { push: summarizePushForLog(push) },
        );

        let fileTitle = "New File";
        let fileMessage = "";

        if ((push as any).title) {
          // MMS-style file push
          fileTitle = (push as any).title;
          fileMessage =
            (push as any).body || `Image (${(push as any).file_type})`;
        } else {
          // Regular file push
          fileTitle = `New File: ${(push as any).file_name || "unknown file"}`;
          fileMessage = (push as any).body || (push as any).file_type || "";
        }

        // Security validation for image URLs - check both image_url and file_url
        const imageUrl = (push as any).image_url;
        const fileUrl = (push as any).file_url;

        // Determine which URL to use for image preview
        let previewUrl = null;
        if (imageUrl && isTrustedImageUrl(imageUrl)) {
          previewUrl = imageUrl;
        } else if (
          fileUrl &&
          isTrustedImageUrl(fileUrl) &&
          (push as any).file_type?.startsWith("image/")
        ) {
          previewUrl = fileUrl;
        }

        if (previewUrl) {
          // Show image notification for trusted Pushbullet URLs
          notificationOptions = {
            ...baseOptions,
            type: "image",
            title: fileTitle,
            message: fileMessage,
            imageUrl: previewUrl,
          };
          debugLogger.notifications(
            "INFO",
            "Showing image notification for trusted file push",
            {
              fileName: (push as any).file_name,
              previewUrl: previewUrl,
            },
          );
        } else {
          // Fallback to basic notification for security
          notificationOptions = {
            ...baseOptions,
            type: "basic",
            title: fileTitle,
            message: fileMessage,
          };
          if (imageUrl && !isTrustedImageUrl(imageUrl)) {
            debugLogger.notifications(
              "WARN",
              "Ignored image from untrusted domain for file push",
              {
                imageUrl: imageUrl,
              },
            );
          }
        }
      } else if (push.type === "mirror") {
        // Format title as "AppName: SenderName" for better clarity
        const mirrorTitle =
          push.application_name && push.title
            ? `${push.application_name}: ${push.title}`
            : push.title || push.application_name || "Notification";
        const mirrorMessage = push.body || "";
        const iconData = (push as any).icon;

        // Check if mirror has an icon (base64 image data)
        if (iconData && typeof iconData === 'string' && iconData.startsWith('/9j/')) {
          debugLogger.notifications("DEBUG", "Processing mirror notification icon", {
            iconDataLength: iconData.length,
            title: mirrorTitle,
          });

          // Icon is already base64 JPEG data, just add data URL prefix
          const dataUrl = `data:image/jpeg;base64,${iconData}`;

          notificationOptions = {
            ...baseOptions,
            type: "basic",
            title: mirrorTitle,
            message: mirrorMessage,
            iconUrl: dataUrl,
          };

          debugLogger.notifications("INFO", "Showing mirror notification with icon", {
            title: mirrorTitle,
            hasIcon: true,
            application: push.application_name,
          });
        } else {
          // Security validation for image URLs (fallback)
          const mirrorImageUrl = (push as any).image_url;
          if (mirrorImageUrl && isTrustedImageUrl(mirrorImageUrl)) {
            notificationOptions = {
              ...baseOptions,
              type: "image",
              title: mirrorTitle,
              message: mirrorMessage,
              imageUrl: mirrorImageUrl,
            };
            debugLogger.notifications(
              "INFO",
              "Showing image notification for trusted mirrored push",
              { pushType: push.type },
            );
          } else {
            // No icon, show basic notification
            notificationOptions = {
              ...baseOptions,
              type: "basic",
              title: mirrorTitle,
              message: mirrorMessage,
            };

            debugLogger.notifications("INFO", "Showing mirror notification without icon", {
              title: mirrorTitle,
              hasIcon: false,
              application: push.application_name,
            });
          }
        }
      } else {
        // Default handler for other types
        const defaultTitle = "Pushbullet";
        const defaultMessage = `New ${push.type}`;

        notificationOptions = {
          ...baseOptions,
          type: "basic",
          title: defaultTitle,
          message: defaultMessage,
        };
        debugLogger.notifications("INFO", "Showing basic notification", {
          pushType: push.type,
        });
      }
    }

    // Ensure all required properties are defined
    const finalNotificationOptions: chrome.notifications.NotificationCreateOptions =
      {
        type: notificationOptions.type || "basic",
        title: notificationOptions.title || "Pushbullet",
        message: notificationOptions.message || "New push received",
        iconUrl:
          notificationOptions.iconUrl ||
          chrome.runtime.getURL("icons/icon128.png"),
      };

    // Add optional properties if they exist
    if (notificationOptions.imageUrl) {
      finalNotificationOptions.imageUrl = notificationOptions.imageUrl;
    }

    await createNotificationWithTimeout(
      notificationId,
      finalNotificationOptions,
      undefined,
      getNotificationTimeout(),
    );

    if (notificationDataStore) {
      notificationDataStore.set(notificationId, push);
    }

    performanceMonitor.recordNotificationCreated();
    debugLogger.notifications("INFO", "Push notification created", {
      notificationId,
      pushType: push.type,
    });
  } catch (error) {
    performanceMonitor.recordNotificationFailed();
    debugLogger.notifications(
      "ERROR",
      "Failed to show push notification",
      { pushIden: push.iden },
      error as Error,
    );
    throw error;
  }
}

/**
 * Check if we should enter polling mode
 */
export function checkPollingMode(): void {
  const qualityMetrics = performanceMonitor.getQualityMetrics();

  if (qualityMetrics.consecutiveFailures >= 3 && !isPollingMode()) {
    debugLogger.general(
      "WARN",
      "Entering polling mode due to consecutive failures",
      {
        consecutiveFailures: qualityMetrics.consecutiveFailures,
      },
    );

    setPollingMode(true);

    // Start polling alarm
    chrome.alarms.create("pollingFallback", { periodInMinutes: 1 });

    debugLogger.general("INFO", "Polling mode activated", {
      interval: "1 minute",
    });
  }
}

/**
 * Stop polling mode
 */
export function stopPollingMode(): void {
  if (isPollingMode()) {
    debugLogger.general("INFO", "Stopping polling mode - WebSocket reconnected");
    setPollingMode(false);
    chrome.alarms.clear("pollingFallback");
  }
}

/**
 * Perform polling fetch
 */
export async function performPollingFetch(): Promise<void> {
  await hydrateCutoff();
  const apiKey = getApiKey();
  if (!apiKey) {
    debugLogger.general("WARN", "Cannot perform polling fetch - no API key");
    return;
  }
  debugLogger.general('DEBUG', 'Performing polling fetch (incremental)');
  await refreshPushes(); // now incremental via refreshPushes
}

/**
 * Perform WebSocket health check
 */
export function performWebSocketHealthCheck(
  websocketClient: any,
  connectFn: () => void,
  recoveryController?: WebSocketRecoveryController,
): void {
  const apiKey = getApiKey();

  debugLogger.websocket(
    "DEBUG",
    "[HealthCheck] Running WebSocket health check",
    {
      hasClient:
        !!websocketClient,
      hasApiKey:
        !!apiKey,
      isConnected:
        websocketClient?.isConnected() ??
        false,
      readyState:
        websocketClient?.[
          "ws"
        ]
          ?.readyState ??
        "N/A",
    },
  );

  // Case 1: No client or disconnected
  if (
    !websocketClient ||
    !websocketClient.isConnected()
  ) {
    debugLogger.websocket(
      "WARN",
      "[HealthCheck] WebSocket is null or disconnected",
      {
        hasApiKey:
          !!apiKey,
        currentState:
          recoveryController?.getCurrentState() ?? "unknown",
      },
    );

    if (apiKey) {
      const currentState = recoveryController?.getCurrentState();
      const shouldRecoverViaStateMachine =
        recoveryController &&
        (currentState === ServiceWorkerState.IDLE ||
          currentState === ServiceWorkerState.READY);
      const shouldReconnectDirectly =
        !recoveryController ||
        currentState === ServiceWorkerState.DEGRADED ||
        currentState === ServiceWorkerState.RECONNECTING;

      if (shouldRecoverViaStateMachine) {
        debugLogger.websocket(
          "WARN",
          "[HealthCheck] Detected stale state with API key - triggering recovery",
          {
            currentState,
          },
        );

        // Use state machine transition instead of direct connect
        recoveryController
          .transition(
            "ATTEMPT_RECONNECT",
            {
              hasApiKey: true,
              socketHealthy: false,
            },
          )
          .catch(
            (
              error,
            ) => {
              debugLogger.websocket(
                "ERROR",
                "[HealthCheck] Failed to trigger recovery",
                null,
                error as Error,
              );
              // Fallback to direct connection
              connectFn();
            },
          );
      } else if (shouldReconnectDirectly) {
        // Normal reconnection for expected states
        connectFn();
      } else {
        debugLogger.websocket(
          "DEBUG",
          "[HealthCheck] Skipping reconnect - unexpected state",
          {
            currentState,
          },
        );
      }
    } else {
      debugLogger.websocket(
        "DEBUG",
        "[HealthCheck] No API key - cannot reconnect",
      );
    }
    return;
  }

  // Case 2: Client exists and connected - check health
  if (
    !websocketClient.isConnectionHealthy()
  ) {
    const currentState =
      recoveryController?.getCurrentState() ?? "unknown";
    debugLogger.websocket(
      "WARN",
      "[HealthCheck] Connection unhealthy - triggering recovery",
      {
        currentState,
        hasApiKey: !!apiKey,
      },
    );
    if (apiKey && recoveryController) {
      recoveryController
        .transition(
          "ATTEMPT_RECONNECT",
          {
            hasApiKey: true,
            socketHealthy: false,
          },
        )
        .catch(
          (
            error,
          ) => {
            debugLogger.websocket(
              "ERROR",
              "[HealthCheck] Failed to trigger recovery for unhealthy connection",
              null,
              error as Error,
            );
            connectFn();
          },
        );
      return;
    }
    globalEventBus.emit(
      "websocket:disconnected",
    );
  }
}

/**
 * Update popup connection state
 */
export function updatePopupConnectionState(state: string): void {
  chrome.runtime
    .sendMessage({
      action: "connectionStateChanged",
      state: state,
    })
    .catch(() => {
      // Popup may not be open
    });
}

/**
 * Setup context menu
 * Idempotent - safe to call from multiple event listeners
 */
export function setupContextMenu(): void {
  // Guard against concurrent setup attempts
  if (isSettingUpContextMenu) {
    debugLogger.general(
      "INFO",
      "Context menu setup already in progress, skipping",
    );
    return;
  }

  isSettingUpContextMenu = true;

  try {
    chrome.contextMenus.removeAll(() => {
      // Check for errors from removeAll
      if (chrome.runtime.lastError) {
        debugLogger.general(
          "ERROR",
          "Failed to remove existing context menus",
          {
            error: chrome.runtime.lastError.message,
          },
        );
        isSettingUpContextMenu = false;
        return;
      }

      // Now that menus are removed, create new ones
      try {
        chrome.contextMenus.create({
          id: "push-link",
          title: "Push this link",
          contexts: ["link"],
        });
        if (chrome.runtime.lastError) {
          const lastError = chrome.runtime.lastError as any;
          const errorMessage = lastError.message || "Unknown error";
          debugLogger.general("ERROR", "Failed to create push-link menu", {
            error: errorMessage,
          });
        }

        chrome.contextMenus.create({
          id: "push-page",
          title: "Push this page",
          contexts: ["page"],
        });
        if (chrome.runtime.lastError) {
          const lastError = chrome.runtime.lastError as any;
          const errorMessage = lastError.message || "Unknown error";
          debugLogger.general("ERROR", "Failed to create push-page menu", {
            error: errorMessage,
          });
        }

        chrome.contextMenus.create({
          id: "push-selection",
          title: "Push selected text",
          contexts: ["selection"],
        });
        if (chrome.runtime.lastError) {
          const lastError = chrome.runtime.lastError as any;
          const errorMessage = lastError.message || "Unknown error";
          debugLogger.general("ERROR", "Failed to create push-selection menu", {
            error: errorMessage,
          });
        }

        chrome.contextMenus.create({
          id: "push-image",
          title: "Push this image",
          contexts: ["image"],
        });
        if (chrome.runtime.lastError) {
          const lastError = chrome.runtime.lastError as any;
          const errorMessage = lastError.message || "Unknown error";
          debugLogger.general("ERROR", "Failed to create push-image menu", {
            error: errorMessage,
          });
        }

        debugLogger.general("INFO", "Context menu created successfully");
      } finally {
        // Always clear the guard flag when done
        isSettingUpContextMenu = false;
      }
    });
  } catch (error) {
    debugLogger.general(
      "ERROR",
      "Failed to create context menu",
      null,
      error as Error,
    );
    isSettingUpContextMenu = false;
  }
}

/**
 * Push a link
 */
export async function pushLink(url: string, title?: string): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    debugLogger.general("WARN", "Cannot push link - no API key");
    return;
  }

  // Sanitize inputs to prevent XSS
  const sanitizedUrl = sanitizeUrl(url);
  const sanitizedTitle = sanitizeText(title || "Link");

  if (!sanitizedUrl) {
    debugLogger.general("ERROR", "Invalid URL provided", { url });
    return;
  }

  try {
    const response = await fetch("https://api.pushbullet.com/v2/pushes", {
      method: "POST",
      headers: {
        "Access-Token": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "link",
        title: sanitizedTitle,
        url: sanitizedUrl,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to push link: ${response.status}`);
    }

    debugLogger.general("INFO", "Link pushed successfully", { url, title });

    createNotificationWithTimeout("pushbullet-link-sent", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Link Sent",
      message: title || url,
    });
  } catch (error) {
    debugLogger.general(
      "ERROR",
      "Failed to push link",
      { url, title },
      error as Error,
    );
  }
}

/**
 * Push a note
 */
export async function pushNote(title: string, body: string): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    debugLogger.general("WARN", "Cannot push note - no API key");
    return;
  }

  // Sanitize inputs to prevent XSS
  const sanitizedTitle = sanitizeText(title);
  const sanitizedBody = sanitizeText(body);

  try {
    const response = await fetch("https://api.pushbullet.com/v2/pushes", {
      method: "POST",
      headers: {
        "Access-Token": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "note",
        title: sanitizedTitle,
        body: sanitizedBody,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to push note: ${response.status}`);
    }

    debugLogger.general("INFO", "Note pushed successfully", { title });

    createNotificationWithTimeout("pushbullet-note-sent", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Note Sent",
      message: title,
    });
  } catch (error) {
    debugLogger.general(
      "ERROR",
      "Failed to push note",
      { title },
      error as Error,
    );
  }
}
