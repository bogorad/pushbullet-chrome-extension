const VERIFICATION_CODE_TOKEN =
  '[A-Za-z0-9]{3,4}-[A-Za-z0-9]{3,4}|\\d{6}';
const TOKEN_BOUNDARY_PATTERN =
  `(^|[^A-Za-z0-9-])(${VERIFICATION_CODE_TOKEN})(?![A-Za-z0-9-])`;
const MAX_CONTEXT_CHARS = 48;

const VERIFICATION_WORD_PATTERN =
  /(?:\b(?:verification|security|login|auth(?:entication)?|sms)\s+)?\b(?:code|passcode|otp)\b|\bone[-\s]?time\s+password\b/i;
const TRAILING_VERIFICATION_CONTEXT_PATTERN =
  /^\s*(?:is|as|=|:)?\s*(?:your|the|a|an)?\s*(?:verification\s+|security\s+|login\s+|auth(?:entication)?\s+|sms\s+)?(?:code|passcode|otp)\b/i;
const CLAUSE_BREAK_PATTERN = /[.!?]/;

function currentClauseTail(text: string): string {
  const lastBreak = Math.max(
    text.lastIndexOf('.'),
    text.lastIndexOf('!'),
    text.lastIndexOf('?'),
  );
  return text.slice(lastBreak + 1);
}

function currentClauseHead(text: string): string {
  const firstBreak = text.search(CLAUSE_BREAK_PATTERN);
  return firstBreak === -1 ? text : text.slice(0, firstBreak);
}

function hasVerificationContext(
  fullText: string,
  tokenStart: number,
  tokenEnd: number,
): boolean {
  const before = currentClauseTail(
    fullText.slice(Math.max(0, tokenStart - MAX_CONTEXT_CHARS), tokenStart),
  );
  if (VERIFICATION_WORD_PATTERN.test(before)) {
    return true;
  }

  const after = currentClauseHead(
    fullText.slice(tokenEnd, Math.min(fullText.length, tokenEnd + MAX_CONTEXT_CHARS)),
  );
  return TRAILING_VERIFICATION_CONTEXT_PATTERN.test(after);
}

export function extractVerificationCode(title: string, message: string): string | null {
  const fullText = `${title} ${message}`;
  const tokenPattern = new RegExp(TOKEN_BOUNDARY_PATTERN, 'g');

  for (const match of fullText.matchAll(tokenPattern)) {
    const prefix = match[1] ?? '';
    const code = match[2];
    if (!code || match.index === undefined) {
      continue;
    }

    const tokenStart = match.index + prefix.length;
    const tokenEnd = tokenStart + code.length;
    if (hasVerificationContext(fullText, tokenStart, tokenEnd)) {
      return code;
    }
  }

  return null;
}
