# ADR 0001: Handling Service Worker Initialization Race Conditions

## Status
Accepted

## Context
The Manifest V3 service worker can be started by multiple events simultaneously (e.g., `onInstalled` and `onStartup`). This was causing our `initializeSessionCache` function to be called multiple times concurrently, leading to:

- "Initialization already in progress" errors
- Duplicate context menu creation
- Wasted API calls
- Inconsistent state

The problem occurred because:
1. Chrome can fire multiple startup events nearly simultaneously
2. Each event handler called `initializeSessionCache()`
3. The function had no mechanism to prevent concurrent execution
4. Multiple API calls were made for the same data

## Decision
We will implement a **Promise Singleton** pattern for the `initializeSessionCache` function.

### How it works:
1. The first time the function is called, it creates and stores a promise
2. Any subsequent calls that arrive while the first is still in progress receive the *same* stored promise
3. The promise is cleared upon completion or failure, allowing for retries
4. All callers await the same initialization, ensuring consistency

### Implementation:
```typescript
let initPromise: Promise<string | null> | null = null;

export async function initializeSessionCache(
  source: string,
  stateSetters?: StateSetters
): Promise<string | null> {
  // If initialization is already in progress, return the existing promise
  if (initPromise) {
    debugLogger.general('INFO', 'Initialization already in progress, reusing promise', { source });
    return initPromise;
  }

  // Create new initialization promise
  initPromise = (async () => {
    // ... initialization logic ...
  })();

  try {
    const result = await initPromise;
    return result;
  } finally {
    // Clear promise on completion or error
    initPromise = null;
  }
}
```

## Consequences

### Pros
- **Prevents Race Conditions**: Effectively prevents concurrent initialization
- **Ensures Single Execution**: Initialization logic runs only once per cycle
- **Safe for Multiple Callers**: Multiple parts of the extension can safely trigger and await initialization
- **Automatic Retry**: Promise is cleared on failure, allowing retries
- **No Duplicate API Calls**: Saves bandwidth and API quota
- **Consistent State**: All callers get the same initialization result

### Cons
- **Added Complexity**: Adds a small amount of complexity to the session management logic
- **Module-Level State**: Uses module-level variable (though this is acceptable for a singleton pattern)

### Neutral
- **Not a General Solution**: This pattern is specific to initialization; other race conditions may need different solutions
- **Testing Considerations**: Tests need to be aware of the promise caching behavior

## Related
- Implementation: `src/app/session/index.ts`
- Tests: `tests/app/session.test.ts`
- Issue: Manifest V3 service worker startup race conditions

