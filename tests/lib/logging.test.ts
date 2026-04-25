import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEBUG_CONFIG,
  DebugLogger,
  GlobalErrorTracker,
  type LogCategory,
  type LogEntry,
} from '../../src/lib/logging';

const categories = Object.keys(DEBUG_CONFIG.categories) as LogCategory[];

function makeStoredLog(message: string): LogEntry {
  return {
    timestamp: '2026-04-25T00:00:00.000Z (+0ms)',
    category: 'GENERAL',
    level: 'INFO',
    message,
    data: null,
    error: null,
  };
}

describe('DebugLogger persistence', () => {
  beforeEach(() => {
    DEBUG_CONFIG.enabled = true;
    DEBUG_CONFIG.logLevel = 'DEBUG';
    DEBUG_CONFIG.maxLogEntries = 1000;
    DEBUG_CONFIG.sanitizeData = true;
    categories.forEach((category) => {
      DEBUG_CONFIG.categories[category] = true;
    });

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps logs written while persistent logs are still loading', async () => {
    let resolveGet!: (value: Record<string, LogEntry[]>) => void;
    const storageGet = chrome.storage.local.get as ReturnType<typeof vi.fn>;
    storageGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    const logger = new DebugLogger();
    const rehydrate = logger.rehydrate();

    logger.general('INFO', 'new log during rehydrate');

    resolveGet({ persistentDebugLogs: [makeStoredLog('stored log')] });
    await rehydrate;

    expect(logger.getRecentLogs(10).map((log) => log.message)).toEqual([
      'stored log',
      'new log during rehydrate',
    ]);
  });

  it('redacts sensitive fields in nested objects and arrays', () => {
    const logger = new DebugLogger();

    logger.general('INFO', 'private payload', {
      body: 'private SMS body',
      title: 'private title',
      url: 'https://example.com/private?token=abc',
      file_url: 'https://files.example.com/private.png',
      image_url: 'https://images.example.com/private.png',
      email: 'friend@example.com',
      phoneNumber: '+1 555 123 4567',
      nested: {
        accessToken: 'secret-token',
        apiKey: 'pbk_private_api_key',
        password: 'private password',
        clientSecret: 'private client secret',
        visibleCount: 2,
      },
      array: [
        {
          address: '123 Private St',
          label: 'safe label',
        },
      ],
    });

    const exported = JSON.stringify(logger.exportLogs());

    expect(exported).not.toContain('private SMS body');
    expect(exported).not.toContain('private title');
    expect(exported).not.toContain('https://example.com/private');
    expect(exported).not.toContain('https://files.example.com/private.png');
    expect(exported).not.toContain('https://images.example.com/private.png');
    expect(exported).not.toContain('friend@example.com');
    expect(exported).not.toContain('+1 555 123 4567');
    expect(exported).not.toContain('secret-token');
    expect(exported).not.toContain('pbk_private_api_key');
    expect(exported).not.toContain('private password');
    expect(exported).not.toContain('private client secret');
    expect(exported).not.toContain('123 Private St');
    expect(exported).toContain('[redacted]');
    expect(exported).toContain('safe label');
    expect(exported).toContain('visibleCount');
  });
});

describe('GlobalErrorTracker', () => {
  it('bounds retained errors and still exports recent errors', () => {
    const tracker = new GlobalErrorTracker();

    for (let index = 0; index < 600; index += 1) {
      tracker.trackError(new Error(`error-${index}`), {}, 'GENERAL');
    }

    const exportData = tracker.exportErrorData();

    expect(exportData.summary.total).toBe(500);
    expect(exportData.summary.critical).toBe(500);
    expect(exportData.errors).toHaveLength(200);
    expect(exportData.errors[0]?.message).toBe('error-400');
    expect(exportData.errors[199]?.message).toBe('error-599');
  });
});
