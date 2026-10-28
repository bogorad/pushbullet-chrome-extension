import { describe, expect, it } from 'vitest';

import {
  MAX_RENDERED_LOGS,
  capLogs,
  filterLogs,
  formatLogLine,
  formatRelativeTime,
  isNearBottom,
  parseLogTimestamp,
  parsePrefs,
  shouldShowLogByLevel,
  type LogViewEntry,
} from '../../src/debug-dashboard/log-view';

const logs: LogViewEntry[] = [
  { timestamp: '2026-10-28T12:00:00.000Z (+0ms)', category: 'WEBSOCKET', level: 'INFO', message: 'Connected ok', data: null, error: null },
  { timestamp: '2026-10-28T12:01:00.000Z (+60000ms)', category: 'API', level: 'ERROR', message: 'Push failed badly', data: null, error: null },
  { timestamp: '2026-10-28T12:02:00.000Z (+120000ms)', category: 'API', level: 'WARN', message: 'Retry push soon', data: null, error: null },
  { timestamp: '2026-10-28T12:03:00.000Z (+180000ms)', category: 'STORAGE', level: 'DEBUG', message: 'Saved token cache', data: null, error: null },
];

describe('filterLogs', () => {
  it('combines category, level hierarchy and search', () => {
    expect(filterLogs(logs, { category: 'API', level: '', search: '' })).toHaveLength(2);
    expect(filterLogs(logs, { category: 'API', level: 'WARN', search: '' }).map((l) => l.level)).toEqual(['ERROR', 'WARN']);
    expect(filterLogs(logs, { category: 'API', level: 'WARN', search: 'retry' }).map((l) => l.message)).toEqual(['Retry push soon']);
    expect(filterLogs(logs, { category: '', level: 'ERROR', search: '' })).toHaveLength(1);
  });
  it('search is case-insensitive substring/regex and invalid regex falls back', () => {
    expect(filterLogs(logs, { category: '', level: '', search: 'CONNECTED' })).toHaveLength(1);
    expect(filterLogs(logs, { category: '', level: '', search: 'push (failed|soon)' })).toHaveLength(2);
    expect(filterLogs(logs, { category: '', level: '', search: '[' })).toHaveLength(0);
    expect(filterLogs(logs, { category: '', level: '', search: 'websocket' })).toHaveLength(1);
  });
  it('shouldShowLogByLevel hierarchy', () => {
    expect(shouldShowLogByLevel('DEBUG', 'WARN')).toBe(false);
    expect(shouldShowLogByLevel('ERROR', 'WARN')).toBe(true);
    expect(shouldShowLogByLevel('INFO', '')).toBe(true);
  });
});

describe('capLogs', () => {
  it('keeps newest entries and respects default cap', () => {
    expect(MAX_RENDERED_LOGS).toBe(1000);
    const many = Array.from({ length: 1500 }, (_, i) => ({ ...logs[0], message: `m${i}` }));
    const capped = capLogs(many as LogViewEntry[]);
    expect(capped).toHaveLength(1000);
    expect(capped[0]?.message).toBe('m500');
    expect(capLogs(logs, 2).map((l) => l.message)).toEqual(['Retry push soon', 'Saved token cache']);
  });
});

describe('time and scroll helpers', () => {
  it('parses logger timestamp with elapsed suffix', () => {
    expect(parseLogTimestamp('2026-10-28T12:00:00.000Z (+5ms)')).toBe(Date.parse('2026-10-28T12:00:00.000Z'));
    expect(parseLogTimestamp('not a date')).toBeNull();
  });
  it('formats relative time', () => {
    const now = Date.parse('2026-10-28T12:05:30.000Z');
    expect(formatRelativeTime('2026-10-28T12:05:25.000Z (+0ms)', now)).toBe('5s ago');
    expect(formatRelativeTime('2026-10-28T12:03:30.000Z', now)).toBe('2m ago');
    expect(formatRelativeTime('2026-10-28T10:05:30.000Z', now)).toBe('2h ago');
    expect(formatRelativeTime('bad', now)).toBe('bad');
  });
  it('isNearBottom', () => {
    expect(isNearBottom({ scrollTop: 950, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
    expect(isNearBottom({ scrollTop: 0, clientHeight: 100, scrollHeight: 1000 })).toBe(false);
  });
  it('formatLogLine includes level category message and error', () => {
    expect(formatLogLine(logs[1] as LogViewEntry)).toContain('[API:ERROR] Push failed badly');
  });
});

describe('parsePrefs', () => {
  it('returns defaults for bad input and sanitizes values', () => {
    expect(parsePrefs(null)).toEqual({ category: '', level: '', search: '', wrap: true, density: 'comfortable' });
    expect(parsePrefs('{"density":"compact","wrap":false,"level":"WARN","search":"x"}')).toMatchObject({ density: 'compact', wrap: false, level: 'WARN', search: 'x' });
    expect(parsePrefs('{"density":"huge","level":"NOPE"}')).toMatchObject({ density: 'comfortable', level: '' });
    expect(parsePrefs('not json')).toMatchObject({ density: 'comfortable' });
  });
});
