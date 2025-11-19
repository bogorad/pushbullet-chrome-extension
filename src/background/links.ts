import {
  fetchIncrementalPushes,
  dismissPush,
} from "../app/api/client"; // dismissPush added
import { storageRepository } from "../infrastructure/storage/storage.repository";
import { hasOpenedIden, markOpened, getMaxOpenedCreated } from "../infrastructure/storage/opened-mru.repository";
import type { Push } from "../types/domain";
import { debugLogger } from "../lib/logging";
import { getApiKey } from "./state"; // ⬅️ NEW LINE

function isLinkPush(p: Push): p is Push & { url: string; iden: string } {
  return p.type === "link" && typeof p.url === "string" && p.url.length > 0 && typeof p.iden === "string";
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
export async function openTab(url: string): Promise<void> {
  if (!url || typeof url !== "string") {
    debugLogger.general("WARN", "Invalid URL (empty or non-string)", { url });
    throw new Error("Invalid URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    debugLogger.general("WARN", "Invalid URL (parse failed)", { url });
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    debugLogger.general("WARN", "Invalid URL (protocol rejected)", {
      url,
      protocol: parsed.protocol,
    });
    throw new Error("Invalid protocol");
  }
  try {
    await chrome.tabs.create({ url, active: false });
    debugLogger.general("DEBUG", "Tab created successfully", { url });
  } catch {
    debugLogger.general("WARN", "Tab creation failed, trying window fallback", {
      url,
    });
    await chrome.windows.create({ url, focused: false });
    debugLogger.general("INFO", "Window created as fallback", { url });
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

  // New: apply MRU + created guards before selecting toOpen
  const maxOpenedCreated = await getMaxOpenedCreated();
  const candidates = changes
    .filter(isLinkPush)
    .filter(p => {
      const created = typeof p.created === 'number' ? p.created : 0;
      return created > lastAuto && created > maxOpenedCreated;
    })
    .sort((a, b) => (a.created ?? 0) - (b.created ?? 0));

  if (candidates.length === 0) {
    debugLogger.websocket("INFO", "Auto-open links: no new link pushes to open");
    return;
  }

  debugLogger.websocket("INFO", "Auto-opening link pushes", {
    count: candidates.length,
    total: candidates.length,
  });

  const openedCreated: number[] = [];
  let openedThisRun = 0;

  // Pre-loop optimization (added in Step 4C)
  const shouldDismiss = await storageRepository.getDismissAfterAutoOpen();
  const dismissApiKey = getApiKey();

  for (const p of candidates) {
    if (openedThisRun >= safetyCap) {
      debugLogger.websocket("WARN", "Auto-open links capped", {
        opened: openedThisRun,
        total: candidates.length,
        cap: safetyCap,
      });
      break;
    }

    if (await hasOpenedIden(p.iden)) {
      debugLogger.websocket("DEBUG", "Auto-open skip (MRU)", { iden: p.iden });
      continue;
    }

    try {
      await openTab(p.url);
      await markOpened(p.iden, p.created ?? 0);
      debugLogger.websocket("DEBUG", "MRU marked opened", {
        iden: p.iden,
        created: p.created ?? 0,
      });

      // 🔥 NEW BLOCK: Dismiss after auto-open (added in Step 4B)
      if (shouldDismiss && dismissApiKey && p.iden) {
        try {
          await dismissPush(p.iden, dismissApiKey);
          debugLogger.websocket(
            "INFO",
            `Offline AutoOpen: dismissed iden=${p.iden} after auto-open`,
          );
        } catch (e) {
          debugLogger.websocket(
            "WARN",
            `Offline AutoOpen: dismiss failed for iden=${p.iden}: ${(e as Error).message}`,
          );
        }
      }

      openedThisRun += 1;
      openedCreated.push(p.created ?? 0);
    } catch {
      debugLogger.websocket("WARN", "Auto-open failed", { iden: p.iden, url: p.url });
    }
  }

  const maxCreated = Math.max(lastAuto, ...openedCreated, 0);
  if (maxCreated > lastAuto) {
    await storageRepository.setLastAutoOpenCutoff(maxCreated);
    debugLogger.websocket("INFO", "Advanced lastAutoOpenCutoff", { old: lastAuto, new: maxCreated });
  }
}

