# Testing Guide - Pushbullet Chrome Extension

## Overview

This document describes the testing infrastructure for the Pushbullet Chrome Extension, focusing on unit tests for race condition fixes in the Manifest V3 service worker.

## Test Framework

- **Framework**: [Vitest](https://vitest.dev/) v2.1.9
- **Mocking**: Custom Chrome API mocks (see `tests/setup.ts`)
- **Coverage**: @vitest/coverage-v8
- **Language**: TypeScript with ES modules

## Running Tests

### Run all tests once
```bash
npm test
```

### Run tests in watch mode (auto-rerun on file changes)
```bash
npm run test:watch
```

### Run tests with coverage report
```bash
npm run test:coverage
```

### Run tests with UI (interactive browser interface)
```bash
npm run test:ui
```

## Test Structure

```
tests/
├── setup.ts                    # Global test setup and Chrome API mocks
├── app/
│   └── session.test.ts        # Session initialization tests
└── background/
    └── utils.test.ts          # Context menu setup tests
```

## What's Being Tested

### 1. Session Initialization (tests/app/session.test.ts)

Tests the **promise singleton pattern** that prevents race conditions when multiple events trigger initialization concurrently.

**Test Cases:**
- ✅ Single initialization completes successfully
- ✅ Concurrent calls return same promise (race condition prevention)
- ✅ Completed initialization returns null on subsequent calls
- ✅ Failed initialization clears promise for retry
- ✅ Promise singleton prevents "Initialization already in progress" errors
- ✅ State setters are called correctly
- ✅ WebSocket connection is initiated when provided

**What This Prevents:**
- `Error: Initialization already in progress` when onInstalled and onStartup fire simultaneously
- Multiple redundant API calls to Pushbullet during startup
- Inconsistent state from overlapping initialization attempts

### 2. Context Menu Setup (tests/background/utils.test.ts)

Tests the **idempotent guard pattern** that prevents duplicate context menu creation.

**Test Cases:**
- ✅ Creates all four context menu items (push-link, push-page, push-selection, push-image)
- ✅ Concurrent calls are idempotent (only first executes)
- ✅ removeAll completes before create calls
- ✅ chrome.runtime.lastError is checked after removeAll
- ✅ chrome.runtime.lastError is checked after each create call
- ✅ Guard flag is cleared after completion
- ✅ Guard flag is cleared even on error

**What This Prevents:**
- `Cannot create item with duplicate id` errors during startup
- Race conditions between onInstalled and onStartup event handlers
- Incomplete menu setup due to unchecked errors

## Chrome API Mocking

The test suite uses custom Chrome API mocks defined in `tests/setup.ts`. These mocks provide:

- **Event listeners**: `chrome.runtime.onMessage`, `onInstalled`, `onStartup`
- **Storage API**: `chrome.storage.sync.get/set/remove/clear`
- **Context Menus**: `chrome.contextMenus.create/removeAll/update/remove`
- **Tabs API**: `chrome.tabs.create/query/sendMessage`
- **Notifications**: `chrome.notifications.create/clear`
- **Alarms**: `chrome.alarms.create/clear/get/getAll`

### Mock Features

- **Event simulation**: Call `chrome.runtime.onMessage.callListeners(...)` to trigger event handlers
- **Error simulation**: Set `chrome.runtime.lastError = { message: '...' }` to simulate Chrome API errors
- **Call tracking**: All mocked functions use Vitest's `vi.fn()` for assertion

## Writing New Tests

### Basic Test Structure

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chrome API is mocked globally
declare const chrome: any;

// Mock dependencies
vi.mock('../../src/lib/logging', () => ({
  debugLogger: {
    general: vi.fn(),
    storage: vi.fn(),
    api: vi.fn()
  }
}));

describe('My Feature', () => {
  beforeEach(async () => {
    // Reset module state
    vi.resetModules();
    
    // Re-import module for fresh state
    const module = await import('../../src/my-module');
    
    // Setup Chrome API mocks
    chrome.storage.sync.get.mockImplementation((keys, callback) => {
      callback({ /* mock data */ });
    });
  });

  it('should do something', async () => {
    // Test implementation
    expect(true).toBe(true);
  });
});
```

### Testing Async Chrome APIs

```typescript
// Mock chrome.storage.sync.get
chrome.storage.sync.get.mockImplementation((keys, callback) => {
  callback({
    apiKey: 'test-key',
    deviceIden: 'test-device'
  });
});

// Mock chrome.contextMenus.removeAll
chrome.contextMenus.removeAll.mockImplementation((callback) => {
  // Simulate successful removal
  callback();
});
```

### Testing Error Scenarios

```typescript
chrome.storage.sync.get.mockImplementation((keys, callback) => {
  // Simulate error
  chrome.runtime.lastError = { message: 'Storage error' };
  callback({});
  delete chrome.runtime.lastError;
});
```

## Coverage Goals

Current coverage targets (defined in `vitest.config.ts`):

- **Lines**: 80%
- **Functions**: 80%
- **Branches**: 75%
- **Statements**: 80%

Coverage is focused on:
- `src/app/session/**/*.ts`
- `src/background/utils.ts`
- `src/background/index.ts`

## Continuous Integration

Tests should be run:
- ✅ Before committing changes
- ✅ In CI/CD pipeline (if configured)
- ✅ Before creating pull requests
- ✅ After pulling changes from main branch

## Troubleshooting

### Tests fail with "chrome is not defined"
- Ensure `tests/setup.ts` is properly configured in `vitest.config.ts`
- Check that `setupFiles: ['./tests/setup.ts']` is present

### Module import errors
- Ensure `package.json` has `"type": "module"`
- Check that all imports use `.ts` or `.js` extensions where required

### Mock not working
- Call `vi.resetModules()` in `beforeEach` to reset module state
- Re-import the module after `vi.resetModules()` to get fresh state

### Tests pass but coverage is low
- Add more test cases covering edge cases
- Test error paths and failure scenarios
- Use `npm run test:coverage` to see uncovered lines

## Best Practices

1. **Test behavior, not implementation**: Focus on what the code does, not how it does it
2. **Isolate tests**: Each test should be independent and not rely on others
3. **Use descriptive names**: Test names should clearly describe what they're testing
4. **Test edge cases**: Include tests for error conditions, empty inputs, etc.
5. **Keep tests fast**: Mock external dependencies to avoid slow I/O operations
6. **Maintain tests**: Update tests when code changes to prevent false positives

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Chrome Extension API Reference](https://developer.chrome.com/docs/extensions/reference/)
- [Testing Best Practices](https://vitest.dev/guide/best-practices.html)

