import { pickVerificationCodeWithJev } from '../app/api/jev';
import { storageRepository } from '../infrastructure/storage/storage.repository';
import { analyzeVerificationCode } from './verification-code';

export interface JevFallbackDeps {
  getJevApiKey?: () => Promise<string | null>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export async function extractVerificationCodeWithJevFallback(
  title: string,
  message: string,
  deps: JevFallbackDeps = {},
): Promise<string | null> {
  const analysis = analyzeVerificationCode(title, message);
  if (!analysis.ambiguous) {
    return analysis.code;
  }
  if (analysis.numericCandidates.length === 0) {
    return analysis.code;
  }
  const getKey = deps.getJevApiKey ?? (() => storageRepository.getJevApiKey());
  let apiKey: string | null;
  try {
    apiKey = await getKey();
  } catch {
    return analysis.code;
  }
  if (!apiKey || apiKey.trim().length === 0) {
    return analysis.code;
  }
  const result = await pickVerificationCodeWithJev({
    apiKey,
    messageText: message,
    candidates: analysis.numericCandidates,
    fetchFn: deps.fetchFn,
    timeoutMs: deps.timeoutMs,
  });
  if (result.kind === 'picked') {
    return result.code;
  }
  if (result.kind === 'none') {
    return null;
  }
  return analysis.code;
}
