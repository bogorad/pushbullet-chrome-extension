import type { Push, PushesResponse } from '../../src/types/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const debugLoggerMock = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock('../../src/lib/logging', () => ({
  debugLogger: debugLoggerMock,
}));

import { fetchIncrementalPushes } from '../../src/app/api/client';

function makePush(index: number): Push {
  return {
    active: true,
    created: index,
    dismissed: false,
    iden: `push-${index}`,
    modified: index,
    title: `Push ${index}`,
    type: 'note',
  };
}

function makeResponse(index: number, cursor?: string): Response {
  const body: PushesResponse = {
    pushes: [makePush(index)],
    cursor,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('fetchIncrementalPushes pagination guard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('logs a warning when the page guard stops a fetch with a remaining cursor', async () => {
    let responseIndex = 0;
    fetchMock.mockImplementation(async () => {
      const cursor = `cursor-${responseIndex + 1}`;
      const response = makeResponse(responseIndex, cursor);
      responseIndex += 1;
      return response;
    });

    const pushes = await fetchIncrementalPushes('api-key', 123, 2);

    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect(pushes).toHaveLength(11);
    expect(debugLoggerMock.api).toHaveBeenCalledWith(
      'WARN',
      'Incremental push fetch truncated by page guard',
      expect.objectContaining({
        pagesFetched: 11,
        maxPages: 11,
        pageLimit: 2,
        total: 11,
        modifiedAfter: 123,
        hasRemainingCursor: true,
        remainingCursorLength: 'cursor-11'.length,
        remainingCursorPreview: 'cursor-1',
      }),
    );
  });

  it('does not log a truncation warning when the cursor clears on the guard page', async () => {
    let responseIndex = 0;
    fetchMock.mockImplementation(async () => {
      const cursor = responseIndex < 10 ? `cursor-${responseIndex + 1}` : undefined;
      const response = makeResponse(responseIndex, cursor);
      responseIndex += 1;
      return response;
    });

    const pushes = await fetchIncrementalPushes('api-key', 123, 2);

    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect(pushes).toHaveLength(11);
    expect(debugLoggerMock.api).not.toHaveBeenCalledWith(
      'WARN',
      'Incremental push fetch truncated by page guard',
      expect.anything(),
    );
  });
});
