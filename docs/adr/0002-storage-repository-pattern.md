# ADR 0002: Storage Repository Pattern

## Status
Accepted

## Context
The codebase had direct `chrome.storage` API calls scattered throughout multiple modules:
- Background script (8 calls)
- Session module (5 calls)
- Popup (6 calls)
- Options page (13 calls)
- API client (11 calls)
- And more...

This created several problems:
1. **Hard to Test**: Tests had to mock the `chrome` API with complex callback handling
2. **Code Duplication**: Similar storage logic repeated across modules
3. **Difficult to Maintain**: Changes to storage logic required updates in multiple files
4. **Complex Promise Wrapping**: Callback-based API required verbose promise wrapping
5. **No Type Safety**: Storage operations weren't type-safe or documented

Example of the problem:
```typescript
// Complex promise wrapping scattered everywhere
const result = await new Promise<{...}>(resolve => {
  chrome.storage.sync.get(['apiKey', 'deviceIden', ...], (items) => {
    resolve(items as any);
  });
});

// Manual default handling
if (result.autoOpenLinks === undefined) {
  await chrome.storage.sync.set({ autoOpenLinks: true });
}
```

## Decision
We will implement the **Repository Pattern** to abstract all storage operations behind a clean interface.

### Architecture:
1. **Interface**: Define `StorageRepository` interface with all storage operations
2. **Implementation**: Create `ChromeStorageRepository` class that implements the interface
3. **Singleton**: Export a single instance for app-wide use
4. **Promisification**: Convert callback-based API to promise-based

### Implementation:
```typescript
// Interface (contract)
export interface StorageRepository {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string | null): Promise<void>;
  // ... other methods
}

// Implementation
export class ChromeStorageRepository implements StorageRepository {
  async getApiKey(): Promise<string | null> {
    const result = await chrome.storage.sync.get(['apiKey']);
    return result.apiKey || null;
  }
  // ... other methods
}

// Singleton
export const storageRepository = new ChromeStorageRepository();
```

### Usage:
```typescript
// Before: Complex promise wrapping
const result = await new Promise<{...}>(resolve => {
  chrome.storage.sync.get(['apiKey'], (items) => resolve(items));
});
const apiKey = result.apiKey || null;

// After: Clean async/await
const apiKey = await storageRepository.getApiKey();
```

## Consequences

### Pros
- **Improved Testability**: Easy to mock repository in tests
  ```typescript
  vi.spyOn(storageRepository, 'getApiKey').mockResolvedValue('test-key');
  ```
- **Better Maintainability**: Storage logic centralized in one file (210 lines)
- **Cleaner Code**: 60% code reduction in session module (50 lines → 20 lines)
- **Type Safety**: All operations are type-safe and documented
- **Simple API**: Clean async/await instead of complex promise wrapping
- **Single Responsibility**: Storage logic has one place to change
- **Dependency Inversion**: Modules depend on interface, not implementation

### Cons
- **Initial Effort**: Required refactoring 32 chrome.storage calls across 5 files
- **Learning Curve**: Team needs to understand repository pattern
- **Indirection**: One extra layer between code and chrome.storage API

### Neutral
- **Not Complete**: Some specialized features (debug config, device registration) still use direct chrome.storage
- **Testing Strategy**: Tests now mock repository instead of chrome.storage

## Metrics
- **Chrome Storage Calls Eliminated**: 32 → 2 (94% reduction in core modules)
- **Code Reduction**: Session module 50 lines → 20 lines (60% reduction)
- **Files Refactored**: 5 core modules (background, session, popup, options, tests)
- **Tests**: All 14 tests passing with updated mocks

## Related
- Implementation: `src/infrastructure/storage/storage.repository.ts`
- Tests: `tests/app/session.test.ts`
- Documentation: `PHASE7.1_SUMMARY.md`
- Principles: Repository Pattern, Dependency Inversion Principle, Single Responsibility Principle

