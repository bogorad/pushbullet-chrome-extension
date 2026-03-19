// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { buildExtension } from '../../scripts/build-extension.js';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const repoRoot = path.resolve(currentDirPath, '..', '..');

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'pushbullet-build-extension-'),
  );

  tempDirs.push(tempDir);
  return tempDir;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) =>
      fs.rm(tempDir, { recursive: true, force: true }),
    ),
  );
});

describe('buildExtension', () => {
  it('creates a loadable unpacked extension directory', async () => {
    const distDir = await createTempDir();

    await buildExtension({ rootDir: repoRoot, distDir });

    const requiredPaths = [
      'manifest.json',
      'popup.html',
      'options.html',
      'debug-dashboard.html',
      'notification-detail.html',
      'background.js',
      'popup.js',
      'options.js',
      'debug-dashboard.js',
      'notification-detail.js',
      'css/popup.css',
      'css/options.css',
      'css/debug-dashboard.css',
      'icons/icon16.png',
      'icons/icon48.png',
      'icons/icon128.png',
      'icons/original-green.png',
    ];

    for (const relativePath of requiredPaths) {
      expect(
        await fileExists(path.join(distDir, relativePath)),
        `${relativePath} should exist in the built extension package`,
      ).toBe(true);
    }
  });

  it('rewrites built manifest and html paths for dist-root loading', async () => {
    const distDir = await createTempDir();

    await buildExtension({ rootDir: repoRoot, distDir });

    const manifestText = await fs.readFile(
      path.join(distDir, 'manifest.json'),
      'utf8',
    );
    const manifest = JSON.parse(manifestText) as {
      action: { default_popup: string };
      background: { service_worker: string };
      options_page: string;
    };

    expect(manifest.background.service_worker).toBe('background.js');
    expect(manifest.action.default_popup).toBe('popup.html');
    expect(manifest.options_page).toBe('options.html');

    const htmlExpectations: Array<[string, string]> = [
      ['popup.html', '<script src="popup.js"></script>'],
      ['options.html', '<script src="options.js"></script>'],
      ['debug-dashboard.html', '<script src="debug-dashboard.js"></script>'],
      ['notification-detail.html', '<script src="notification-detail.js"></script>'],
    ];

    for (const [fileName, expectedScriptTag] of htmlExpectations) {
      const html = await fs.readFile(path.join(distDir, fileName), 'utf8');

      expect(html).not.toContain('src="dist/');
      expect(html).toContain(expectedScriptTag);
    }
  });
});
