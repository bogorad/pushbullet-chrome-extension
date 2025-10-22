import { storageRepository } from '../../infrastructure/storage/storage.repository';
import { fetchIncrementalPushes } from '../api/client';
import { debugLogger } from '../../lib/logging';
import { setLastModifiedCutoffSafe } from './index';
import type { Push } from '../../types/domain';

type IncrementalSeedResult = { isSeedRun: true; pushes: [] };
type IncrementalNormalResult = { isSeedRun: false; pushes: Push[] };
export type IncrementalResult = IncrementalSeedResult | IncrementalNormalResult;

async function computeMaxModified(pushes: Array<{ modified?: number }>): Promise<number> {
  let maxModified = 0;
  for (const p of pushes) {
    const m = typeof p.modified === 'number' ? p.modified : 0;
    if (m > maxModified) maxModified = m;
  }
  return maxModified;
}

export async function refreshPushesIncremental(apiKey: string): Promise<IncrementalResult> {
  const storedCutoff = await storageRepository.getLastModifiedCutoff();
  const isSeedRun = !storedCutoff || storedCutoff === 0;

  if (isSeedRun) {
    debugLogger.general('INFO', 'Pipeline 1 First run cutoff missing/0. Seeding cutoff only; skipping side effects.');
    // Compute cutoff only (no side effects)
    const pushes = await fetchIncrementalPushes(apiKey, null, 100);
    const newCutoff = await computeMaxModified(pushes);
    if (newCutoff > 0) {
      await setLastModifiedCutoffSafe(newCutoff);
      debugLogger.general('INFO', 'Pipeline 1 Seed complete. Updated lastModifiedCutoff via safe setter.', { newCutoff });
    } else {
      debugLogger.general('WARN', 'Pipeline 1 Seed returned no items; leaving cutoff unchanged.');
    }
    // CRITICAL: return empty pushes to prevent accidental processing by callers
    return { pushes: [], isSeedRun: true as const };
  }

  // Normal incremental: fetch and advance cutoff
  const pushes = await fetchIncrementalPushes(apiKey, storedCutoff, 100);
  const maxModified = await computeMaxModified(pushes);
  if (maxModified > storedCutoff!) {
    await setLastModifiedCutoffSafe(maxModified);
    debugLogger.general('DEBUG', 'Pipeline 1 Updated cutoff via safe setter', {
      old: storedCutoff,
      new: maxModified,
    });
  }
  return { pushes, isSeedRun: false as const };
}