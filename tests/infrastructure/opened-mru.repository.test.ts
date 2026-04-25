import { describe, expect, it, vi } from 'vitest';

import { getMaxOpenedCreated, hasOpenedIden, markOpened } from '../../src/infrastructure/storage/opened-mru.repository';

type OpenedMRU = {
  idens: string[];
  maxOpenedCreated: number;
};

type StorageRecord = {
  openedPushMRU?: OpenedMRU;
};

type StorageMocks = {
  get: {
    mockImplementation: (implementation: () => Promise<StorageRecord>) => void;
    mockResolvedValue: (value: StorageRecord) => void;
  };
  set: {
    mockImplementation: (implementation: (value: unknown) => Promise<void>) => void;
  };
};

function cloneMRU(mru: OpenedMRU): OpenedMRU {
  return {
    idens: [...mru.idens],
    maxOpenedCreated: mru.maxOpenedCreated,
  };
}

function cloneStorage(storage: StorageRecord): StorageRecord {
  return storage.openedPushMRU
    ? { openedPushMRU: cloneMRU(storage.openedPushMRU) }
    : {};
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('opened MRU repository', () => {
  it('preserves MRU cap and newest-first ordering', async () => {
    const storage: StorageRecord = {};
    const storageMocks = chrome.storage.local as unknown as StorageMocks;

    storageMocks.get.mockImplementation(async () => cloneStorage(storage));
    storageMocks.set.mockImplementation(async (value) => {
      storage.openedPushMRU = cloneMRU((value as StorageRecord).openedPushMRU!);
    });

    for (let index = 0; index < 501; index += 1) {
      await markOpened(`push-${index}`, index);
    }

    expect(storage.openedPushMRU?.idens).toHaveLength(500);
    expect(storage.openedPushMRU?.idens[0]).toBe('push-500');
    expect(storage.openedPushMRU?.idens[499]).toBe('push-1');
    expect(storage.openedPushMRU?.idens).not.toContain('push-0');
    expect(storage.openedPushMRU?.maxOpenedCreated).toBe(500);
  });

  it('serializes concurrent markOpened calls without losing idens or max created', async () => {
    const storage: StorageRecord = {};
    const storageMocks = chrome.storage.local as unknown as StorageMocks;
    const getRequests: Array<ReturnType<typeof createDeferred<StorageRecord>>> = [];
    const setRequests: Array<ReturnType<typeof createDeferred<void>>> = [];

    storageMocks.get.mockImplementation(() => {
      const request = createDeferred<StorageRecord>();
      getRequests.push(request);
      return request.promise;
    });
    storageMocks.set.mockImplementation((value) => {
      const request = createDeferred<void>();
      storage.openedPushMRU = cloneMRU((value as StorageRecord).openedPushMRU!);
      setRequests.push(request);
      return request.promise;
    });

    const firstMark = markOpened('first', 10);
    const secondMark = markOpened('second', 20);

    await flushPromises();
    expect(getRequests).toHaveLength(1);

    const firstGet = getRequests[0];
    if (!firstGet) throw new Error('Expected first storage get');
    firstGet.resolve(cloneStorage(storage));
    await flushPromises();

    expect(setRequests).toHaveLength(1);
    expect(storage.openedPushMRU).toEqual({
      idens: ['first'],
      maxOpenedCreated: 10,
    });
    expect(getRequests).toHaveLength(1);

    const firstSet = setRequests[0];
    if (!firstSet) throw new Error('Expected first storage set');
    firstSet.resolve();
    await flushPromises();

    expect(getRequests).toHaveLength(2);

    const secondGet = getRequests[1];
    if (!secondGet) throw new Error('Expected second storage get');
    secondGet.resolve(cloneStorage(storage));
    await flushPromises();

    expect(setRequests).toHaveLength(2);
    expect(storage.openedPushMRU).toEqual({
      idens: ['second', 'first'],
      maxOpenedCreated: 20,
    });

    const secondSet = setRequests[1];
    if (!secondSet) throw new Error('Expected second storage set');
    secondSet.resolve();
    await expect(firstMark).resolves.toBeUndefined();
    await expect(secondMark).resolves.toBeUndefined();

    storageMocks.get.mockResolvedValue(cloneStorage(storage));

    await expect(hasOpenedIden('first')).resolves.toBe(true);
    await expect(hasOpenedIden('second')).resolves.toBe(true);
    await expect(getMaxOpenedCreated()).resolves.toBe(20);
  });
});
