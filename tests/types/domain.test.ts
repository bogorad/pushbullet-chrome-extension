import { describe, expect, it } from 'vitest';

import { isValidPush } from '../../src/types/domain';

describe('isValidPush', () => {
  it('accepts supported visible push types including sms_changed', () => {
    expect(isValidPush({ type: 'link', url: 'https://example.com' })).toBe(true);
    expect(isValidPush({ type: 'note', title: 'Title', body: 'Body' })).toBe(true);
    expect(isValidPush({ type: 'file', file_name: 'report.pdf' })).toBe(true);
    expect(isValidPush({ type: 'mirror', package_name: 'com.example.app' })).toBe(true);
    expect(isValidPush({ type: 'sms_changed', notifications: [{ title: 'SMS', body: 'Hello' }] })).toBe(true);
  });

  it('keeps dismissal valid because dismissal events are part of the Push union', () => {
    expect(isValidPush({ type: 'dismissal', package_name: 'com.example.app' })).toBe(true);
  });

  it('rejects unknown and malformed push values', () => {
    expect(isValidPush({ type: 'unknown' })).toBe(false);
    expect(isValidPush({})).toBe(false);
    expect(isValidPush(null)).toBe(false);
  });
});
