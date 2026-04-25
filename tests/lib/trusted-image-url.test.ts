import { describe, expect, it } from 'vitest';

import { isTrustedImageUrl } from '../../src/lib/security/trusted-image-url';

describe('isTrustedImageUrl', () => {
  it('accepts trusted HTTPS Pushbullet image hosts', () => {
    expect(isTrustedImageUrl('https://pushbullet.com/image.png')).toBe(true);
    expect(isTrustedImageUrl('https://cdn.pushbullet.com/image.png')).toBe(true);
    expect(isTrustedImageUrl('https://pushbulletusercontent.com/image.png')).toBe(true);
    expect(isTrustedImageUrl('https://files.pushbulletusercontent.com/image.png')).toBe(true);
  });

  it('accepts trusted HTTPS googleusercontent image hosts', () => {
    expect(isTrustedImageUrl('https://lh3.googleusercontent.com/avatar.png')).toBe(true);
  });

  it('rejects trusted hosts over non-HTTPS protocols', () => {
    expect(isTrustedImageUrl('http://files.pushbulletusercontent.com/image.png')).toBe(false);
    expect(isTrustedImageUrl('javascript:alert(1)')).toBe(false);
    expect(isTrustedImageUrl('data:image/png;base64,abc')).toBe(false);
  });

  it('rejects invalid URLs and hostname lookalikes', () => {
    expect(isTrustedImageUrl('not a url')).toBe(false);
    expect(isTrustedImageUrl('https://evilpushbullet.com/image.png')).toBe(false);
    expect(isTrustedImageUrl('https://pushbullet.com.evil.example/image.png')).toBe(false);
    expect(isTrustedImageUrl('https://lh33.googleusercontent.com/avatar.png')).toBe(false);
  });
});
