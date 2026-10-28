import { describe, expect, it, vi } from 'vitest';

import { analyzeVerificationCode } from '../../src/lib/verification-code';
import { extractVerificationCodeWithJevFallback } from '../../src/lib/verification-code-jev';
import { JEV_MODEL, NO_MATCH_CHOICE } from '../../src/app/api/jev';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function choiceResponse(choice: string): Response {
  return jsonResponse({ model: JEV_MODEL, answers: { code: { type: 'choice', choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } }, usage: { input_tokens: 10, output_tokens: 1 } });
}
const withKey = (fetchFn: typeof fetch) => ({ getJevApiKey: async () => 'test-jev-key', fetchFn });

describe('analyzeVerificationCode', () => {
  it('exposes qualified and numeric candidates', () => {
    const a = analyzeVerificationCode('SMS', 'Your code is 111111. Your code is 222222.');
    expect(a.qualifiedCandidates).toEqual(['111111', '222222']);
    expect(a.numericCandidates).toEqual(['111111', '222222']);
    expect(a.code).toBe('111111');
    expect(a.ambiguous).toBe(true);
  });
  it('marks zero-qualified with numeric candidates ambiguous', () => {
    const a = analyzeVerificationCode('SMS', 'Order 482913 shipped. Ref 739204.');
    expect(a.qualifiedCandidates).toEqual([]);
    expect(a.numericCandidates).toEqual(['482913', '739204']);
    expect(a.code).toBeNull();
    expect(a.ambiguous).toBe(true);
  });
  it('marks exactly one qualified candidate unambiguous', () => {
    const a = analyzeVerificationCode('SMS', 'Your code is 123456.');
    expect(a.ambiguous).toBe(false);
    expect(a.code).toBe('123456');
  });
});

describe('extractVerificationCodeWithJevFallback', () => {
  it('key absent => fetch never called', async () => {
    const fetchFn = vi.fn();
    await expect(extractVerificationCodeWithJevFallback('SMS', 'Order 482913 shipped. Ref 739204.', { getJevApiKey: async () => null, fetchFn })).resolves.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('unambiguous => fetch never called even with key', async () => {
    const fetchFn = vi.fn();
    await expect(extractVerificationCodeWithJevFallback('SMS', 'Your code is 123456.', withKey(fetchFn))).resolves.toBe('123456');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('ambiguous + key => fetch called once, Jev choice returned, contract checked', async () => {
    const fetchFn = vi.fn(async () => choiceResponse('739204'));
    await expect(extractVerificationCodeWithJevFallback('SMS', 'Order 482913 shipped. Ref 739204.', withKey(fetchFn))).resolves.toBe('739204');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-jev-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('jev-1.14.0');
    expect(body.state).toBe('Order 482913 shipped. Ref 739204.');
    expect(body.questions.code.type).toBe('choice');
    expect(Object.keys(body.questions.code.criteria)).toEqual(['482913', '739204', NO_MATCH_CHOICE]);
  });
  it('multiple qualified + key => Jev choice returned', async () => {
    const fetchFn = vi.fn(async () => choiceResponse('222222'));
    await expect(extractVerificationCodeWithJevFallback('SMS', 'Your code is 111111. Your code is 222222.', withKey(fetchFn))).resolves.toBe('222222');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('Jev picks no-match => null', async () => {
    const fetchFn = vi.fn(async () => choiceResponse(NO_MATCH_CHOICE));
    await expect(extractVerificationCodeWithJevFallback('SMS', 'Order 482913 shipped. Ref 739204.', withKey(fetchFn))).resolves.toBeNull();
  });
  it('Jev HTTP error => local result unchanged', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ detail: 'err' }, 500));
    await expect(extractVerificationCodeWithJevFallback('SMS', 'Your code is 111111. Your code is 222222.', withKey(fetchFn))).resolves.toBe('111111');
  });
  it('Jev garbage choice => local result unchanged', async () => {
    const fetchFn = vi.fn(async () => choiceResponse('999999'));
    await expect(extractVerificationCodeWithJevFallback('SMS', 'Order 482913 shipped. Ref 739204.', withKey(fetchFn))).resolves.toBeNull();
  });
  it('Jev timeout => local result unchanged', async () => {
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    await expect(extractVerificationCodeWithJevFallback('SMS', 'Order 482913 shipped. Ref 739204.', { getJevApiKey: async () => 'k', fetchFn: fetchFn as unknown as typeof fetch, timeoutMs: 10 })).resolves.toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
