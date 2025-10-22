import { storageRepository } from '../infrastructure/storage/storage.repository';
import { hasOpenedIden, markOpened, getMaxOpenedCreated } from '../infrastructure/storage/opened-mru.repository';
import { debugLogger } from '../lib/logging';
import { dismissPush } from '../app/api/client';
import { getApiKey } from './state';
import { openTab } from './links';

async function maybeAutoOpenLink(push: { iden?: string; type: string; url?: string; created?: number }): Promise<boolean> {
  if (!push.iden || push.type !== 'link' || !push.url) return false;
  const created = typeof push.created === 'number' ? push.created : 0;
  const lastAuto = (await storageRepository.getLastAutoOpenCutoff()) ?? 0;
  const maxOpenedCreated = await getMaxOpenedCreated();

  // MRU skip check with log
  if (await hasOpenedIden(push.iden)) {
    debugLogger.general('DEBUG', 'Auto-open skip (MRU)', { iden: push.iden });
    return false;
  }

  // Created-time guards stay unchanged
  if (!(created > lastAuto && created > maxOpenedCreated)) {
    debugLogger.general('DEBUG', 'Auto-open skip (created guard)', {
      iden: push.iden,
      created,
      lastAuto,
      maxOpenedCreated,
    });
    return false;
  }

  try {
    await openTab(push.url!);
    await markOpened(push.iden!, created);
    debugLogger.general('DEBUG', 'MRU marked opened', {
      iden: push.iden,
      created,
    });
    const nextCutoff = Math.max(lastAuto, created);
    await storageRepository.setLastAutoOpenCutoff(nextCutoff);
    debugLogger.general('INFO', 'Advanced lastAutoOpenCutoff', {
      old: lastAuto,
      new: nextCutoff,
    });
    return true;
  } catch (e) {
    debugLogger.general('WARN', `AutoOpen: failed to open iden=${push.iden}: ${(e as Error).message}`);
    return false;
  }
}

export async function maybeAutoOpenLinkWithDismiss(push: { iden?: string; type: string; url?: string; created?: number }): Promise<boolean> {
  const opened = await maybeAutoOpenLink(push);
  if (!opened || !push.iden) return false;

  if (await storageRepository.getDismissAfterAutoOpen()) {
    try {
      const apiKey = getApiKey();
      if (apiKey) {
        await dismissPush(push.iden, apiKey);
        debugLogger.general('INFO', `AutoOpen: dismissed iden=${push.iden} after auto-open`);
      }
    } catch (e) {
      debugLogger.general('WARN', `AutoOpen: dismiss failed for iden=${push.iden}: ${(e as Error).message}`);
    }
  }
  return true;
}