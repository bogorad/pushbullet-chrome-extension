/*
Background service worker (TypeScript shim)
- Hybrid phase: load the legacy background.js via importScripts to preserve behavior.
- Allows manifest to point to dist/background.js while we migrate internals to TS.
*/

// Declare global to satisfy TS
declare function importScripts(...urls: string[]): void;

try {
  importScripts('background.js');
} catch (e) {
  // Fallback log; avoid throwing in SW
  // eslint-disable-next-line no-console
  console.error('Failed to import legacy background.js', e);
}

