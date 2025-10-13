import { fetchIncrementalPushes } from "../app/api/client";
import { storageRepository } from "../infrastructure/storage/storage.repository";
import type { Push } from "../types/domain";
import { debugLogger } from "../lib/logging";

function isLinkPush(p: Push): p is Push & { url: string } {
  return p.type === "link" && typeof p.url === "string" && p.url.length > 0;
}

/**
 * Opens a URL in a new tab (or window as fallback).
 *
 * This function attempts to open a URL in a new background tab first.
 * If that fails (due to focus restrictions, permissions, or browser state),
 * it falls back to creating a new window.
 *
 * Both operations are non-intrusive:
 * - Tabs are created with `active: false` (background)
 * - Windows are created with `focused: false` (background)
 *
 * @param url - The URL to open. Must be a valid HTTP/HTTPS URL.
 * @returns Promise that resolves when the tab/window is created, or rejects if both fail.
 */
async function openTab(url: string): Promise<void> {
  // Validate URL before attempting to open
  if (!url || typeof url !== "string") {
    debugLogger.general("ERROR", "Cannot open tab: invalid URL provided", {
      url,
    });
    throw new Error("Invalid URL provided to openTab");
  }

  // Primary strategy: Create a new background tab
  try {
    await chrome.tabs.create({ url, active: false });
    debugLogger.general("DEBUG", "Tab created successfully", { url });
    return; // Success - exit early
  } catch (primaryError) {
    // Log the primary failure for debugging
    debugLogger.general(
      "WARN",
      "Failed to create tab, attempting window fallback",
      {
        url,
        error: (primaryError as Error).message,
        errorType: (primaryError as Error).name,
      },
      primaryError as Error,
    );

    // Fallback strategy: Create a new unfocused window
    try {
      await chrome.windows.create({ url, focused: false });
      debugLogger.general("INFO", "Window created as fallback", { url });
      return; // Fallback success
    } catch (fallbackError) {
      // Both strategies failed - log and propagate error
      const error = new Error(
        `Failed to open URL in tab or window: ${(fallbackError as Error).message}`,
      );

      debugLogger.general(
        "ERROR",
        "Both tab and window creation failed",
        {
          url,
          primaryError: (primaryError as Error).message,
          fallbackError: (fallbackError as Error).message,
        },
        error,
      );

      throw error; // Propagate to caller
    }
  }
}

export async function autoOpenOfflineLinks(
  apiKey: string,
  sessionCutoff: number | null,
): Promise<void> {
  const enabled = await storageRepository.getAutoOpenLinksOnReconnect();
  if (!enabled) {
    debugLogger.websocket("DEBUG", "Auto-open offline links disabled");
    return;
  }

  const safetyCap = await storageRepository.getMaxAutoOpenPerReconnect();
  const lastAuto = (await storageRepository.getLastAutoOpenCutoff()) || 0;
  const modifiedAfter = Math.max(lastAuto, sessionCutoff || 0);

  debugLogger.websocket(
    "INFO",
    "Auto-open links: fetching incremental changes",
    { modifiedAfter },
  );

  const changes = await fetchIncrementalPushes(apiKey, modifiedAfter, 100);
  const candidates = changes
    .filter(isLinkPush)
    .filter((p) => (typeof p.created === "number" ? p.created : 0) > lastAuto)
    .sort((a, b) => (a.created || 0) - (b.created || 0));

  if (candidates.length === 0) {
    debugLogger.websocket(
      "INFO",
      "Auto-open links: no new link pushes to open",
    );
    return;
  }

  const toOpen = candidates.slice(0, safetyCap);
  debugLogger.websocket("INFO", "Auto-opening link pushes", {
    count: toOpen.length,
    total: candidates.length,
  });

  for (const p of toOpen) {
    await openTab(p.url);
  }

  const maxCreated = Math.max(lastAuto, ...toOpen.map((p) => p.created || 0));
  if (maxCreated > lastAuto) {
    await storageRepository.setLastAutoOpenCutoff(maxCreated);
    debugLogger.websocket("INFO", "Advanced lastAutoOpenCutoff", {
      old: lastAuto,
      new: maxCreated,
    });
  }

  if (candidates.length > safetyCap) {
    debugLogger.websocket("WARN", "Auto-open links capped", {
      total: candidates.length,
      opened: toOpen.length,
    });
  }
}

