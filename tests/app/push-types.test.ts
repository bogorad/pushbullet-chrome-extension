import { describe, expect, it, vi } from 'vitest';

const debugLoggerMock = vi.hoisted(() => ({
  general: vi.fn(),
}));

vi.mock('../../src/lib/logging', () => ({
  debugLogger: debugLoggerMock,
}));

import { logUnsupportedPushType } from '../../src/app/push-types';

describe('logUnsupportedPushType', () => {
  it('logs unknown push content through the safe summary helper', () => {
    logUnsupportedPushType('new_push_type', 'push-1', 'test', {
      iden: 'push-1',
      type: 'new_push_type',
      title: 'private title',
      body: 'private body',
      url: 'https://example.com/private?token=abc',
      file_url: 'https://files.example.com/private.txt',
      image_url: 'https://images.example.com/private.png',
      ciphertext: 'private ciphertext',
      notifications: [{ body: 'private notification body' }],
    });

    expect(debugLoggerMock.general).toHaveBeenCalledWith(
      'WARN',
      'Encountered unknown push type',
      expect.objectContaining({
        pushSummary: expect.objectContaining({
          iden: 'push-1',
          type: 'new_push_type',
          contentFlags: {
            heading: true,
            message: true,
            link: true,
            fileLink: true,
            imageLink: true,
            ciphertext: true,
          },
          notificationsCount: 1,
        }),
      }),
    );

    const firstLogCall = debugLoggerMock.general.mock.calls[0];
    expect(firstLogCall).toBeDefined();
    const loggedData = firstLogCall![2];
    const exported = JSON.stringify(loggedData);
    expect(exported).not.toContain('private title');
    expect(exported).not.toContain('private body');
    expect(exported).not.toContain('https://example.com/private');
    expect(exported).not.toContain('https://files.example.com/private.txt');
    expect(exported).not.toContain('https://images.example.com/private.png');
    expect(exported).not.toContain('private ciphertext');
    expect(exported).not.toContain('private notification body');
  });
});
