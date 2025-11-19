# Agent Guidelines for Pushbullet Chrome Extension

## Build Commands
- `npm run build` - Build all extension components with esbuild
- `npm run typecheck` - Run TypeScript type checking
- `npm run lint` - Lint TypeScript files with ESLint
- `npm run lint:fix` - Auto-fix ESLint issues
- `node ./scripts/bump-patch.cjs` - Bump patch level

## Test Commands
- `npm run test` - Run all tests with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `vitest run path/to/test.ts` - Run single test file

## Code Style Guidelines
- **Formatting**: 2-space indentation, single quotes, semicolons required, ES2022 target
- **TypeScript**: Strict mode, explicit types over `any`, interfaces for complex objects, async/await
- **Imports**: Group stdlib → third-party → local modules, relative imports, barrel exports
- **Naming**: camelCase variables/functions, PascalCase types, SCREAMING_SNAKE_CASE constants, `_` prefix unused params
- **Error Handling**: Try/catch for async ops, centralized logging, graceful degradation, event-driven tracking
- **Architecture**: Repository pattern, event bus, state machine, single-flight pattern
- **Security**: Input sanitization, CSP compliance, message validation, no sensitive data in logs

## Feature: Dismiss After Offline Auto-Open

### Overview
When the extension reconnects after being offline, it can automatically open missed link pushes AND optionally dismiss them on the Pushbullet server. This keeps the Pushbullet inbox clean while still opening important links.

### Implementation Details
- **File**: `src/background/links.ts` - `autoOpenOfflineLinks()` function
- **Pattern**: Matches existing real-time dismiss behavior from `src/background/processing.ts`
- **Settings**: Controlled by `getDismissAfterAutoOpen()` storage setting
- **Performance**: API calls hoisted outside loops for efficiency
- **Error Handling**: Non-fatal - dismiss failures don't prevent auto-opening
- **Logging**: Uses `websocket` category with `Offline AutoOpen:` prefix

### Code Structure
```typescript
// Pre-loop optimization (efficiency)
const shouldDismiss = await storageRepository.getDismissAfterAutoOpen();
const dismissApiKey = getApiKey();

// Inside loop after markOpened()
if (shouldDismiss && dismissApiKey && p.iden) {
  try {
    await dismissPush(p.iden, dismissApiKey);
    debugLogger.websocket("INFO", `Offline AutoOpen: dismissed iden=${p.iden} after auto-open`);
  } catch (e) {
    debugLogger.websocket("WARN", `Offline AutoOpen: dismiss failed for iden=${p.iden}: ${(e as Error).message}`);
  }
}
```

### Testing
- Enable both "Auto-open links on reconnect" and "Dismiss after auto-open" in options
- Disconnect network, send link pushes, reconnect
- Verify: tabs open AND pushes are dismissed in Pushbullet web interface
- Check console logs for `Offline AutoOpen:` messages

### Dependencies
- `dismissPush()` from `src/app/api/client.ts`
- `getApiKey()` from `src/background/state.ts`
- `getDismissAfterAutoOpen()` from `src/infrastructure/storage/storage.repository.ts`
