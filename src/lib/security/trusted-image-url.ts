/**
 * Trusted image URL validation for notification image loading.
 */

function isTrustedPushbulletHost(hostname: string): boolean {
  return (
    hostname === 'pushbullet.com' ||
    hostname.endsWith('.pushbullet.com') ||
    hostname === 'pushbulletusercontent.com' ||
    hostname.endsWith('.pushbulletusercontent.com')
  );
}

function isTrustedGoogleUserContentHost(hostname: string): boolean {
  return /^lh[0-9]\.googleusercontent\.com$/.test(hostname);
}

export function isTrustedImageUrl(urlString: string): boolean {
  if (!urlString) {
    return false;
  }

  try {
    const url = new URL(urlString);

    if (url.protocol !== 'https:') {
      return false;
    }

    return (
      isTrustedPushbulletHost(url.hostname) ||
      isTrustedGoogleUserContentHost(url.hostname)
    );
  } catch {
    return false;
  }
}
