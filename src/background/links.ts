import { fetchIncrementalPushes } from '../app/api/client';
import { storageRepository } from '../infrastructure/storage/storage.repository';
import type { Push } from '../types/domain';
import { debugLogger } from '../lib/logging';

function isLinkPush(p: Push): p is Push & { url: string } {
  return p.type === 'link' && typeof p.url === 'string' && p.url.length > 0;
}

async function openTab(url: string): Promise<void> {
  try {
    await chrome.tabs.create({ url, active: false });
  } catch (e) {
    // Fallback: try window if tabs fails due to focus rules or permissions
    try { await chrome.windows.create({ url, focused: false }); } catch { /* swallow */ }
  }
}

export async function autoOpenOfflineLinks(apiKey: string, sessionCutoff: number | null): Promise<void> {
  const enabled = await storageRepository.getAutoOpenLinksOnReconnect();
  if (!enabled) {
    debugLogger.websocket('DEBUG', 'Auto-open offline links disabled');
    return;
  }

  const safetyCap = await storageRepository.getMaxAutoOpenPerReconnect();
  const lastAuto = (await storageRepository.getLastAutoOpenCutoff()) || 0;
  const modifiedAfter = Math.max(lastAuto, sessionCutoff || 0);

  debugLogger.websocket('INFO', 'Auto-open links: fetching incremental changes', { modifiedAfter });

  const changes = await fetchIncrementalPushes(apiKey, modifiedAfter, 100);
  const candidates = changes
    .filter(isLinkPush)
    .filter(p => (typeof p.created === 'number' ? p.created : 0) > lastAuto)
    .sort((a, b) => (a.created || 0) - (b.created || 0));

  if (candidates.length === 0) {
    debugLogger.websocket('INFO', 'Auto-open links: no new link pushes to open');
    return;
  }

  const toOpen = candidates.slice(0, safetyCap);
  debugLogger.websocket('INFO', 'Auto-opening link pushes', { count: toOpen.length, total: candidates.length });

  for (const p of toOpen) {
    await openTab(p.url);
  }

  const maxCreated = Math.max(lastAuto, ...toOpen.map(p => p.created || 0));
  if (maxCreated > lastAuto) {
    await storageRepository.setLastAutoOpenCutoff(maxCreated);
    debugLogger.websocket('INFO', 'Advanced lastAutoOpenCutoff', { old: lastAuto, new: maxCreated });
  }

  if (candidates.length > safetyCap) {
    debugLogger.websocket('WARN', 'Auto-open links capped', { total: candidates.length, opened: toOpen.length });
  }
}