# Invalid Cursor Recovery

## Overview
The extension uses cursor-based sync to track which pushes have been fetched. If the API cursor expires or becomes invalid, the extension automatically recovers.

## How It Works
1. API returns 400/410 with "invalid cursor" error
2. Extension detects the error in `fetchIncrementalPushes`
3. `handleInvalidCursorRecovery` is called
4. Cursor is cleared from storage
5. Session cache is reset
6. Full re-initialization is triggered

## Monitoring
Check `performanceMonitor.recoveryMetrics` for:
- `invalidCursorRecoveries`: Total recovery attempts
- `lastRecoveryTime`: Timestamp of last recovery

## Logs
Search for these log messages:
- `"Invalid cursor detected"`
- `"Invalid cursor recovery completed"`

## Files Modified
- `src/infrastructure/storage/storage.repository.ts`: Added `removeLastModifiedCutoff`
- `src/lib/perf/index.ts`: Added recovery metrics
- `src/app/api/http.ts`: Added `isInvalidCursorError` detection
- `src/app/session/index.ts`: Added `handleInvalidCursorRecovery` function
- `src/app/api/client.ts`: Integrated detection in `fetchIncrementalPushes`
- `src/background/index.ts`: Added recovery handlers to event listeners