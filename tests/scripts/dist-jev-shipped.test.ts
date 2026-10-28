// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function readDist(rel: string): Promise<string> {
  return fs.readFile(path.join(repoRoot, 'dist', rel), 'utf8');
}

// Real seam: the unpacked extension loads the tracked dist/ bundle
// (root options.html -> dist/options.js; dist/options.html -> options.js),
// not src/ directly. Mocked jsdom tests import src/ and cannot catch a
// stale tracked dist/. These assertions fail if dist/ was not rebuilt.
describe('tracked dist/ shipped bundle contains Jev verification', () => {
  it('dist/options.js contains paste wiring, verify call, and dot updates', async () => {
    const js = await readDist('options.js');
    expect(js).toContain('jev-api-key-dot');
    expect(js).toContain('https://api.typesafe.ai/v1/models');
    expect(js).toContain('paste');
    expect(js).toContain('jev-key-dot--');
  });

  it('dist/options.html contains the Jev input and dot', async () => {
    const html = await readDist('options.html');
    expect(html).toContain('id="jev-api-key"');
    expect(html).toContain('id="jev-api-key-dot"');
  });

  it('dist/css/options.css has green/red dot states', async () => {
    const css = await readDist(path.join('css', 'options.css'));
    expect(css).toContain('.jev-key-dot--valid');
    expect(css).toContain('.jev-key-dot--invalid');
  });

  it('dist/manifest.json permits fetch to api.typesafe.ai from options page', async () => {
    const manifest = JSON.parse(await readDist('manifest.json')) as {
      host_permissions?: string[];
    };
    expect(manifest.host_permissions).toContain('https://api.typesafe.ai/*');
  });
});

describe('tracked dist/ shipped bundle contains options auto-save toast', () => {
  it('dist/options.html has the toast container and no save-all/status remnants', async () => {
    const html = await readDist('options.html');
    expect(html).toContain('id="toast-container"');
    expect(html).not.toContain('id="save-settings"');
    expect(html).not.toContain('id="update-nickname"');
    expect(html).not.toContain('id="status-message"');
  });

  it('dist/options.js contains toast calls and nickname debounce', async () => {
    const js = await readDist('options.js');
    expect(js).toContain('toast-container');
    expect(js).toContain('toast-close');
    expect(js).toContain('scheduleNicknameSave');
    expect(js).toContain('Device nickname updated');
    expect(js).not.toContain('saveAllSettings');
  });

  it('dist/css/options.css has toast styles', async () => {
    const css = await readDist(path.join('css', 'options.css'));
    expect(css).toContain('.toast-container');
    expect(css).toContain('.toast-success');
    expect(css).toContain('.toast-error');
  });
});
