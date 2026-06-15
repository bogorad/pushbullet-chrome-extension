import { describe, expect, it } from 'vitest';

import { extractVerificationCode } from '../../src/lib/verification-code';

describe('extractVerificationCode', () => {
  it('extracts contiguous numeric codes', () => {
    expect(extractVerificationCode('SMS', 'the code it 527176.')).toBe('527176');
  });

  it('extracts hyphenated numeric codes', () => {
    expect(extractVerificationCode('SMS', 'your code is 527-176.')).toBe('527-176');
  });

  it('extracts three-character alpha-only grouped codes', () => {
    expect(extractVerificationCode('SMS', 'your code is abc-pqr.')).toBe('abc-pqr');
  });

  it('extracts four-character alphanumeric grouped codes', () => {
    expect(extractVerificationCode('SMS', 'your code is A1c2-P9r8.')).toBe(
      'A1c2-P9r8',
    );
  });

  it('extracts codes that precede the code phrase', () => {
    expect(extractVerificationCode('SMS', 'abc-pqr is your code.')).toBe('abc-pqr');
  });

  it('ignores phone numbers after code help text', () => {
    expect(
      extractVerificationCode('SMS', 'Need help with your code? Call 800-555-1212.'),
    ).toBeNull();
  });

  it('ignores unrelated hyphenated tokens outside the code clause', () => {
    expect(
      extractVerificationCode('SMS', 'Ticket abc-pqr was opened. Enter the code later.'),
    ).toBeNull();
  });
});
