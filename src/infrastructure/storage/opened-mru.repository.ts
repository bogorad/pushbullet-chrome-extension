import { debugLogger } from '../../lib/logging';

const OPENED_MRU_KEY = 'openedPushMRU';
const MRU_CAP = 500;

type OpenedMRU = {
  idens: string[];       // newest-first
  maxOpenedCreated: number; // largest push.created observed on auto-open
};

async function loadMRU(): Promise<OpenedMRU> {
  const raw = await chrome.storage.local.get(OPENED_MRU_KEY);
  const mru = raw[OPENED_MRU_KEY] as OpenedMRU | undefined;
  return mru ?? { idens: [], maxOpenedCreated: 0 };
}

async function saveMRU(mru: OpenedMRU): Promise<void> {
  await chrome.storage.local.set({ [OPENED_MRU_KEY]: mru });
}

export async function hasOpenedIden(iden: string): Promise<boolean> {
  const mru = await loadMRU();
  return mru.idens.includes(iden);
}

export async function markOpened(iden: string, created: number): Promise<void> {
  const mru = await loadMRU();
  // Fast skip if already present
  if (!mru.idens.includes(iden)) {
    mru.idens.unshift(iden);
    if (mru.idens.length > MRU_CAP) mru.idens.length = MRU_CAP;
  }
  if (Number.isFinite(created) && created > mru.maxOpenedCreated) {
    mru.maxOpenedCreated = created;
  }
  await saveMRU(mru);
  debugLogger.general('DEBUG', `MRU: marked opened iden=${iden}, maxOpenedCreated=${mru.maxOpenedCreated}`);
}

export async function getMaxOpenedCreated(): Promise<number> {
  const mru = await loadMRU();
  return mru.maxOpenedCreated || 0;
}

export async function clearOpenedMRU(): Promise<void> {
  await chrome.storage.local.set({
    [OPENED_MRU_KEY]: { idens: [], maxOpenedCreated: 0 },
  });
}