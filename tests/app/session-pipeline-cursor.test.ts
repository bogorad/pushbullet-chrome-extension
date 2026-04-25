import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Push } from '../../src/types/domain';

const push = {
  active: true,
  body: 'Body',
  created: 101,
  dismissed: false,
  direction: 'incoming',
  iden: 'push-101',
  modified: 101,
  title: 'Title',
  type: 'note',
} satisfies Push;

const storageRepository = {
  getLastModifiedCutoff: vi.fn(async (): Promise<number> => 100),
};

const fetchIncrementalPushes = vi.fn(
  async (): Promise<Push[]> => [push],
);

const setLastModifiedCutoffSafe = vi.fn(async (): Promise<void> => undefined);

vi.mock('../../src/infrastructure/storage/storage.repository', () => ({
  storageRepository,
}));

vi.mock('../../src/app/api/client', () => ({
  fetchIncrementalPushes,
}));

vi.mock('../../src/app/session/index', () => ({
  setLastModifiedCutoffSafe,
}));

vi.mock('../../src/lib/logging', () => ({
  debugLogger: {
    general: vi.fn(),
  },
}));

describe('refreshPushesIncremental cursor advancement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageRepository.getLastModifiedCutoff.mockResolvedValue(100);
    fetchIncrementalPushes.mockResolvedValue([push]);
  });

  it('does not advance cutoff for normal incremental fetch before callers process pushes', async () => {
    const { refreshPushesIncremental } = await import('../../src/app/session/pipeline');

    const result = await refreshPushesIncremental('api-key');

    expect(result).toEqual({ pushes: [push], isSeedRun: false });
    expect(setLastModifiedCutoffSafe).not.toHaveBeenCalled();
  });
});
