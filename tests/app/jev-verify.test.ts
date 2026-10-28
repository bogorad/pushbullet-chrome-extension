import { describe, expect, it, vi } from 'vitest';

import { verifyJevApiKey } from '../../src/app/api/jev';

function jsonResponse(status = 200): Response {
  return new Response(JSON.stringify({ data: [] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('verifyJevApiKey', () => {
  it('calls GET /v1/models once with the candidate key header and returns valid on 200', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200));
    await expect(
      verifyJevApiKey('fake-candidate-key', { fetchFn: fetchFn as unknown as typeof fetch }),
    ).resolves.toEqual({ kind: 'valid' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/models');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer fake-candidate-key',
    );
  });

  it('returns invalid on 401 without logging the key', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401));
    await expect(
      verifyJevApiKey('fake-bad-key', { fetchFn: fetchFn as unknown as typeof fetch }),
    ).resolves.toEqual({ kind: 'invalid', status: 401 });
  });

  it('returns network-error when fetch throws', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      verifyJevApiKey('fake-key', { fetchFn: fetchFn as unknown as typeof fetch }),
    ).resolves.toEqual({ kind: 'network-error' });
  });

  it('returns timeout when the request is aborted', async () => {
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    await expect(
      verifyJevApiKey('fake-key', {
        fetchFn: fetchFn as unknown as typeof fetch,
        timeoutMs: 10,
      }),
    ).resolves.toEqual({ kind: 'timeout' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not call fetch for an empty key', async () => {
    const fetchFn = vi.fn();
    await expect(
      verifyJevApiKey('  ', { fetchFn: fetchFn as unknown as typeof fetch }),
    ).resolves.toEqual({ kind: 'invalid', status: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
