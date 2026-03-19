import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const defaultRootDir = path.resolve(currentDirPath, '..');

const bundleConfigs = [
  {
    entryPoint: 'src/background/index.ts',
    outfile: 'background.js',
  },
  {
    entryPoint: 'src/popup/index.ts',
    outfile: 'popup.js',
  },
  {
    entryPoint: 'src/options/index.ts',
    outfile: 'options.js',
  },
  {
    entryPoint: 'src/debug-dashboard/index.ts',
    outfile: 'debug-dashboard.js',
  },
  {
    entryPoint: 'src/notification-detail/index.ts',
    outfile: 'notification-detail.js',
  },
];

const htmlFiles = [
  'popup.html',
  'options.html',
  'debug-dashboard.html',
  'notification-detail.html',
];

const staticDirs = ['css', 'icons'];

function rewriteManifestForDistRoot(manifestText) {
  const manifest = JSON.parse(manifestText);

  if (typeof manifest.background?.service_worker === 'string') {
    manifest.background.service_worker = manifest.background.service_worker.replace(
      /^dist\//,
      '',
    );
  }

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function rewriteHtmlForDistRoot(htmlText) {
  return htmlText.replace(/(<script\b[^>]*\bsrc=["'])dist\//g, '$1');
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeTransformedFile({
  rootDir,
  sourceRelativePath,
  distDir,
  transform,
}) {
  const sourcePath = path.join(rootDir, sourceRelativePath);
  const destinationPath = path.join(distDir, sourceRelativePath);
  const sourceText = await fs.readFile(sourcePath, 'utf8');

  await ensureDir(path.dirname(destinationPath));
  await fs.writeFile(destinationPath, transform(sourceText), 'utf8');
}

async function buildBundles({ rootDir, distDir }) {
  for (const { entryPoint, outfile } of bundleConfigs) {
    await build({
      bundle: true,
      entryPoints: [path.join(rootDir, entryPoint)],
      format: 'iife',
      outfile: path.join(distDir, outfile),
      platform: 'browser',
      sourcemap: true,
      target: 'es2022',
    });
  }
}

export async function packageExtension({
  rootDir = defaultRootDir,
  distDir = path.join(rootDir, 'dist'),
} = {}) {
  await writeTransformedFile({
    rootDir,
    sourceRelativePath: 'manifest.json',
    distDir,
    transform: rewriteManifestForDistRoot,
  });

  for (const htmlFile of htmlFiles) {
    await writeTransformedFile({
      rootDir,
      sourceRelativePath: htmlFile,
      distDir,
      transform: rewriteHtmlForDistRoot,
    });
  }

  for (const staticDir of staticDirs) {
    await fs.cp(path.join(rootDir, staticDir), path.join(distDir, staticDir), {
      recursive: true,
    });
  }
}

export async function buildExtension({
  rootDir = defaultRootDir,
  distDir = path.join(rootDir, 'dist'),
} = {}) {
  await fs.rm(distDir, { recursive: true, force: true });
  await ensureDir(distDir);

  await buildBundles({ rootDir, distDir });
  await packageExtension({ rootDir, distDir });
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  buildExtension()
    .then(() => {
      const relativeDistPath = path.relative(defaultRootDir, path.join(defaultRootDir, 'dist')) || 'dist';
      console.log(`Built extension package in ${relativeDistPath}/`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
