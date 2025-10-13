export async function fetchWithTimeout(input: RequestInfo, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function retry<T>(fn: () => Promise<T>, retries = 1, backoffMs = 300): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise(r => setTimeout(r, backoffMs * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Check if an API error response indicates an invalid cursor
 *
 * Pushbullet API returns specific error when cursor is invalid:
 * - HTTP 400 or 410
 * - Error message contains "cursor" or "invalid"
 */
export function isInvalidCursorError(response: Response, errorData?: any): boolean {
  // Check HTTP status codes
  if (response.status === 400 || response.status === 410) {
    // Check error message for cursor-related keywords
    const errorMessage = errorData?.error?.message || errorData?.message || '';
    const lowerMessage = errorMessage.toLowerCase();

    return lowerMessage.includes('cursor') ||
           lowerMessage.includes('invalid') ||
           lowerMessage.includes('expired');
  }

  return false;
}