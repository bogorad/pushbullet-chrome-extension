# Agent Guidelines for Pushbullet Chrome Extension

## General

Use beads instead of native task management.
When a beads issue's work is done and pushed, close the issue in the same workflow with the pushed commit as the close-reason evidence. Do not leave completed pushed work open.
Activity directory: repo-root `activity/` (see system `record-activity` rule).
On any extension change (code or shipped files), bump the patch version (`zz` in `xx.yy.zz`) in all relevant version files: `package.json`, `manifest.json`, and `options.html`. Docs-only changes do not warrant a bump.

## Build Commands

- `npm run build` - Build all extension components with esbuild
- `npm run typecheck` - Run TypeScript type checking
- `npm run lint` - Lint TypeScript files with ESLint
- `npm run lint:fix` - Auto-fix ESLint issues
- `node ./scripts/bump-patch.cjs` - Bump patch level
- **Never stale `dist/`:** `dist/` is tracked and shipped; the browser runs `dist/`, not `src/`.
- After any source change, run `npm run build` and KEEP the `dist/` changes; commit them with the source.
- Never revert build output as dirt; a dirty `dist/` after a build is the expected shipped result.
- Before commit, `tests/scripts/dist-jev-shipped.test.ts` must pass.

## Test Commands

- `npm run test` - Run all tests with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `vitest run path/to/test.ts` - Run single test file

## Code Style Guidelines

- **Formatting**: 2-space indentation, single quotes, semicolons required, ES2022 target
- **TypeScript**: Strict mode, explicit types over `any`, interfaces for complex objects, async/await
- **Imports**: Group stdlib → third-party → local modules, relative imports, barrel exports
- **Naming**: camelCase variables/functions, PascalCase types, SCREAMING*SNAKE_CASE constants, `*` prefix unused params
- **Error Handling**: Try/catch for async ops, centralized logging, graceful degradation, event-driven tracking
- **Architecture**: Repository pattern, event bus, state machine, single-flight pattern
- **Security**: Input sanitization, CSP compliance, message validation, no sensitive data in logs

## Feature: Dismiss After Offline Auto-Open

On reconnect, missed link pushes can auto-open and, optionally, be dismissed on the server. This keeps the inbox clean.

- **File/function**: `src/background/links.ts` - `autoOpenOfflineLinks()`; pattern matches real-time dismiss in `src/background/processing.ts`
- **Setting**: `getDismissAfterAutoOpen()`; API calls hoisted outside loops
- **Behaviour**: Dismiss failure is non-fatal; it does not block auto-open. Log category `websocket`, prefix `Offline AutoOpen:`
- **Dependencies**: `dismissPush()` from `src/app/api/client.ts`; `getApiKey()` from `src/background/state.ts`; `getDismissAfterAutoOpen()` from `src/infrastructure/storage/storage.repository.ts`
- **Test**: Enable "Auto-open links on reconnect" and "Dismiss after auto-open"; go offline, send link pushes, reconnect; check tabs open, pushes are dismissed on the web, and logs show `Offline AutoOpen:`
