import type { Push, PushesResponse } from '../../src/types/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const debugLoggerMock = vi.hoisted(() => ({
  api: vi.fn(),
  general: vi.fn(),
}));

const storageRepositoryMock = vi.hoisted(() => ({
  getDeviceIden: vi.fn(),
  setDeviceIden: vi.fn(),
}));

vi.mock('../../src/lib/logging', () => ({
  debugLogger: debugLoggerMock,
}));

vi.mock('../../src/infrastructure/storage/storage.repository', () => ({
  storageRepository: storageRepositoryMock,
}));

import {
  createPush,
  ensureDeviceExists,
  fetchRecentPushes,
  fetchIncrementalPushes,
  PushbulletApiError,
  registerDevice,
  sendPush,
} from '../../src/app/api/client';

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

describe('fetchRecentPushes display filtering', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('keeps sms_changed pushes with notification content', async () => {
    const smsPush = {
      active: true,
      created: 10,
      dismissed: false,
      iden: 'sms-1',
      modified: 10,
      notifications: [{ title: 'Alice', body: 'Hello' }],
      type: 'sms_changed',
    } satisfies Push;

    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      pushes: [smsPush],
    } satisfies PushesResponse), {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    await expect(fetchRecentPushes('api-key', 50)).resolves.toEqual([smsPush]);
  });

  it('filters sms_changed pushes without notification content', async () => {
    const deletionPush = {
      active: true,
      created: 10,
      dismissed: false,
      iden: 'sms-delete-1',
      modified: 10,
      notifications: [],
      type: 'sms_changed',
    } satisfies Push;

    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      pushes: [deletionPush],
    } satisfies PushesResponse), {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    await expect(fetchRecentPushes('api-key', 50)).resolves.toEqual([]);
  });
});

describe('createPush', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends a typed note push request and returns the created push', async () => {
    const push = makePush(1);
    fetchMock.mockResolvedValue(new Response(JSON.stringify(push), {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    await expect(createPush('api-key', {
      type: 'note',
      title: 'Hello',
      body: 'World',
      device_iden: 'device-1',
    })).resolves.toEqual(push);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.pushbullet.com/v2/pushes',
      {
        method: 'POST',
        headers: {
          'Access-Token': 'api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'note',
          title: 'Hello',
          body: 'World',
          device_iden: 'device-1',
        }),
      },
    );
  });

  it('exposes sendPush as an alias for later call sites', async () => {
    const push = {
      ...makePush(2),
      type: 'link' as const,
      url: 'https://example.com',
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(push), {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    await expect(sendPush('api-key', {
      type: 'link',
      title: 'Example',
      url: 'https://example.com',
    })).resolves.toEqual(push);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a structured error when Pushbullet rejects the push', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: 'rate limited',
      },
    }), {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    await expect(createPush('api-key', {
      type: 'file',
      file_name: 'report.txt',
      file_type: 'text/plain',
      file_url: 'https://files.example/report.txt',
    })).rejects.toMatchObject({
      name: 'PushbulletApiError',
      code: 'push_send_failed',
      status: 429,
      message: 'rate limited',
    });
  });
});

describe('ensureDeviceExists', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('returns true only for successful device lookup responses', async () => {
    fetchMock.mockResolvedValue(new Response('{}', {
      status: 200,
      statusText: 'OK',
    }));

    await expect(ensureDeviceExists('api-key', 'device-1')).resolves.toBe(true);
  });

  it('returns false for missing devices', async () => {
    fetchMock.mockResolvedValue(new Response('{}', {
      status: 404,
      statusText: 'Not Found',
    }));

    await expect(ensureDeviceExists('api-key', 'device-1')).resolves.toBe(false);
  });

  it('throws a structured error for other non-OK responses', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: 'server unavailable',
      },
    }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    await expect(ensureDeviceExists('api-key', 'device-1')).rejects.toMatchObject({
      name: 'PushbulletApiError',
      code: 'device_lookup_failed',
      status: 503,
      message: 'server unavailable',
    });
  });

  it('uses PushbulletApiError for non-404 lookup failures', async () => {
    fetchMock.mockResolvedValue(new Response('failure', {
      status: 500,
      statusText: 'Internal Server Error',
    }));

    await expect(ensureDeviceExists('api-key', 'device-1')).rejects.toBeInstanceOf(PushbulletApiError);
  });
});

describe('registerDevice device debug logging', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    storageRepositoryMock.getDeviceIden.mockResolvedValue('device-1');
    storageRepositoryMock.setDeviceIden.mockResolvedValue(undefined);
  });

  it('does not log push token prefixes in device debug metadata', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      devices: [{
        iden: 'device-1',
        nickname: 'Chrome',
        active: true,
        push_token: 'secret-token-value',
      }],
    }), {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    await registerDevice('api-key', 'device-1', 'Chrome');

    const loggedMetadata = debugLoggerMock.general.mock.calls
      .filter(call => call[1] === '[DEVICE_DEBUG] Device #1')
      .map(call => call[2]);

    expect(loggedMetadata).toHaveLength(1);
    expect(loggedMetadata[0]).toMatchObject({
      hasPushToken: true,
      pushTokenLength: 'secret-token-value'.length,
    });
    expect(JSON.stringify(loggedMetadata)).not.toContain('secret-t');
    expect(JSON.stringify(loggedMetadata)).not.toContain('secret-token-value');
  });
});
