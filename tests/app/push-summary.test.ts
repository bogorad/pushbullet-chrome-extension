import { describe, expect, it } from 'vitest';

import { summarizePushForLog } from '../../src/app/push-summary';

describe('summarizePushForLog', () => {
  it('summarizes sensitive push content as flags', () => {
    const summary = summarizePushForLog({
      iden: 'push-1',
      type: 'link',
      title: 'private title',
      body: 'private body',
      url: 'https://example.com/private?token=abc',
      file_url: 'https://files.example.com/private.txt',
      image_url: 'https://images.example.com/private.png',
      ciphertext: 'private ciphertext',
      notifications: [
        { body: 'private notification body' },
        { body: 'another private notification body' },
      ],
      created: 1,
      modified: 2,
    });

    expect(summary).toEqual({
      iden: 'push-1',
      type: 'link',
      encrypted: false,
      contentFlags: {
        heading: true,
        message: true,
        link: true,
        fileLink: true,
        imageLink: true,
        ciphertext: true,
      },
      notificationsCount: 2,
      created: 1,
      modified: 2,
    });

    const exported = JSON.stringify(summary);
    expect(exported).not.toContain('private title');
    expect(exported).not.toContain('private body');
    expect(exported).not.toContain('https://example.com/private');
    expect(exported).not.toContain('https://files.example.com/private.txt');
    expect(exported).not.toContain('https://images.example.com/private.png');
    expect(exported).not.toContain('private ciphertext');
    expect(exported).not.toContain('private notification body');
  });

  it('returns undefined for non-object values', () => {
    expect(summarizePushForLog(undefined)).toBeUndefined();
    expect(summarizePushForLog(null)).toBeUndefined();
    expect(summarizePushForLog('private body')).toBeUndefined();
  });
});
