# ADR 0009: Per-Device Push Filter Toggle (Display Only)

## Status
Accepted

## Context
Users receive pushes to multiple devices → recentPushes list cluttered. Need toggle \"Only show pushes directed to this device\" (OFF default) for popup UI. Preserve full list for notifications/WS/auto-open.

Constraints:
- Notifications/links must show **all** pushes.
- Cache/DB/WS unfiltered (incremental fetch).
- Toggle syncs across devices.

Forces:
- UX: Filter UI without breaking behavior.
- Consistency: Full data preserved.

## Decision
1. **Storage**: `onlyThisDevice: boolean` in StorageConfig/sync (default false).
2. **UI**: Options checkbox → save + SETTINGS_CHANGED message.
3. **Filter Logic**: Background getSessionData → `if onlyThisDevice && deviceIden: filter recentPushes where target_device_iden === deviceIden`.
4. **Broadcast**: PUSHES_UPDATED sends **unfiltered** (popup re-queries on open).
5. **Preservation**: sessionCache.recentPushes **always full** (IndexedDB/WS).

Implementation:
- domain.ts: StorageConfig + SettingsChangedMessage + SessionDataResponse.
- storage.repository.ts: get/setOnlyThisDevice.
- options/index.ts: checkbox + saveOnlyThisDevice.
- background/index.ts: SETTINGS_CHANGED handler + getSessionData filter/log.

## Consequences

### Pros
- Clean UI toggle (OFF: all, ON: this device).
- Notifications/WS/cache unaffected.
- Syncs via chrome.storage.sync.

### Cons
- Popup open re-filters (negligible).
- No deviceIden → shows all (edge case).

### Neutral
- Minor storage overhead.
- Logs filter stats for debug.