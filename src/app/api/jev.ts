import { debugLogger } from "../../lib/logging";

export const JEV_MODEL = 'jev-1.14.0';
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const NO_MATCH_CHOICE = '__none__';
export const JEV_TIMEOUT_MS = 8000;

export type JevPickResult =
  | { kind: 'picked'; code: string }
  | { kind: 'none' }
  | { kind: 'failed' };

export interface JevPickOptions {
  apiKey: string;
  messageText: string;
  candidates: string[];
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export async function pickVerificationCodeWithJev(options: JevPickOptions): Promise<JevPickResult> {
  const candidates = [...new Set(options.candidates)].filter((c) => c !== NO_MATCH_CHOICE);
  if (candidates.length === 0) {
    return { kind: 'failed' };
  }
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? JEV_TIMEOUT_MS;
  const criteria: Record<string, string | null> = {};
  for (const candidate of candidates) {
    criteria[candidate] = null;
  }
  criteria[NO_MATCH_CHOICE] = 'None of these numeric strings is the verification code.';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: options.messageText,
        questions: {
          code: {
            type: 'choice',
            instructions: 'Which of these numeric strings is the verification code in the message? Choose __none__ if none of them is the verification code.',
            criteria,
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      debugLogger.api('WARN', 'Jev disambiguation failed', { status: response.status });
      return { kind: 'failed' };
    }
    const data: unknown = await response.json();
    const choice = (data as { answers?: { code?: { type?: unknown; choice?: unknown } } })?.answers?.code;
    if (!choice || choice.type !== 'choice' || typeof choice.choice !== 'string') {
      return { kind: 'failed' };
    }
    if (choice.choice === NO_MATCH_CHOICE) {
      return { kind: 'none' };
    }
    if (!candidates.includes(choice.choice)) {
      return { kind: 'failed' };
    }
    return { kind: 'picked', code: choice.choice };
  } catch {
    debugLogger.api('WARN', 'Jev disambiguation request failed', {});
    return { kind: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
