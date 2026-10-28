# Direnv / flake dev shell load fix

Decision: Follow the global ADR "Reproducible Project Dev Shell" — dependencies install only when absent, from the project lock file, and the shell hook never blocks shell load.

Change: In `flake.nix`, removed the unconditional `npm install vitest` (with stderr hidden and `exit 1`) and the `exit 1` failure paths; the hook now exports `node_modules/.bin` on PATH, runs `npm ci` only when `node_modules` is absent, and warns instead of exiting when install or vitest is missing. Added `default.nix` flake shim for `nix-shell`. Removed `flake.lock` from `.gitignore` so the lock can be committed (file left uncommitted for review). Bumped patch version to 1.5.23 in `package.json`, `manifest.json`, and `options.html`.

Reason: `npm install vitest` (unpinned) crashed under npm 11.19.0 with `Cannot read properties of null (reading 'children')` while resolving against `@vitest/coverage-v8@4.1.9`, which peers exactly `vitest@4.1.9`; the hook hid the error and exited 1, so `direnv export bash` always failed. Vitest is already a locked devDependency, so a per-load registry install was unnecessary and mutating.
