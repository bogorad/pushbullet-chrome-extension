# ADR 0004: API Centralization - Dumb Client Pattern

## Status
Accepted

## Context
The popup script was making direct API calls to the Pushbullet API every time it opened:

```typescript
// Popup opens → Makes 3 API calls EVERY TIME
async function initializeAuthenticated() {
  const userInfo = await fetchUserInfo();      // API call 1
  const devices = await fetchDevices();        // API call 2
  const pushes = await fetchRecentPushes();    // API call 3
  // Display data
}
```

This created several problems:
1. **Inefficient**: 3 API calls every time popup opens (even if data hasn't changed)
2. **Dual State**: Both popup and background maintained their own state
3. **Desynchronization**: Popup and background could have different data
4. **Wasted Bandwidth**: Redundant API calls for data background already has
5. **Slow Popup**: Popup had to wait for API calls before displaying anything

The popup also had its own WebSocket connection, creating even more duplication.

## Decision
We will implement the **Dumb Client Pattern** where the popup is a "dumb client" that only displays data from the background script's session cache.

### Architecture:
1. **Background = Single Source of Truth**: All API calls made by background script
2. **Popup = Display Only**: Popup only displays data, makes no API calls
3. **Message Passing**: Popup requests data via `chrome.runtime.sendMessage`
4. **Proactive Updates**: Background sends updates to popup when data changes

### Data Flow:
```
┌─────────────────────────────────────────┐
│           POPUP (Dumb Client)           │
│  - Opens → Sends getSessionData message │
│  - Receives cached data from background │
│  - Displays data (NO API calls)         │
│  - Listens for proactive updates        │
└─────────────────────────────────────────┘
                    ↕ Messages Only
┌─────────────────────────────────────────┐
│    BACKGROUND (Single Source of Truth)  │
│  - Makes ALL API calls                  │
│  - Maintains session cache              │
│  - Manages WebSocket                    │
│  - Sends updates to popup proactively   │
└─────────────────────────────────────────┘
                    ↓ ALL API Calls
┌─────────────────────────────────────────┐
│           PUSHBULLET API                │
└─────────────────────────────────────────┘
```

### Implementation:
```typescript
// Popup: Request data from background
chrome.runtime.sendMessage({ action: 'getSessionData' }, (response) => {
  // Display cached data immediately (no API calls!)
  initializeFromSessionData(response);
});

// Background: Respond with cached data
if (message.action === 'getSessionData') {
  sendResponse({
    isAuthenticated: !!getApiKey(),
    userInfo: sessionCache.userInfo,
    devices: sessionCache.devices,
    recentPushes: sessionCache.recentPushes,
    // ... all cached data
  });
}

// Background: Proactively send updates
globalEventBus.on('websocket:push', (push) => {
  // Update cache
  sessionCache.recentPushes.unshift(push);
  
  // Notify popup
  chrome.runtime.sendMessage({
    action: 'pushesUpdated',
    pushes: sessionCache.recentPushes
  });
});
```

## Consequences

### Pros
- **Efficiency**: Zero redundant API calls when popup opens
  - Before: 3 API calls every time
  - After: 0 API calls (uses cached data)
- **Single Source of Truth**: Background is the only source of API data
  - No state desynchronization
  - Consistent data across extension
- **Fast Popup**: Popup displays instantly (no waiting for API)
- **Reduced Bandwidth**: Significant reduction in API calls
- **Reduced API Quota Usage**: Saves API quota
- **Proactive Updates**: Popup receives updates automatically via WebSocket

### Cons
- **Stale Data**: Popup shows cached data (though background keeps it fresh via WebSocket)
- **Message Passing Overhead**: Small overhead for message passing (negligible)
- **Complexity**: Requires message passing infrastructure

### Neutral
- **Background Dependency**: Popup depends on background being initialized
  - This is acceptable since background initializes on extension startup

## Metrics

### API Call Reduction
- **Before**: 3 API calls every time popup opens
- **After**: 0 API calls when popup opens
- **Reduction**: 100% for popup open scenario

### Message Passing
- **Before**: 2 messages (apiKeyChanged, logout)
- **After**: 4 messages (apiKeyChanged, logout, getSessionData, sendPush)
- **Trade-off**: 2 extra messages eliminate 3 API calls per popup open

### Code Removed from Popup
- `fetchUserInfo()` - 18 lines removed
- `fetchDevices()` - 16 lines removed
- `fetchRecentPushes()` - 30 lines removed
- `initializeAuthenticated()` - 30 lines removed
- **Total**: 94 lines of redundant API code removed

## Related
- Implementation: `src/popup/index.ts`, `src/background/index.ts`
- Documentation: `PHASE6.2_SUMMARY.md`
- Related ADRs: ADR 0003 (Event Bus for proactive updates)
- Principles: Single Source of Truth, Separation of Concerns, Client-Server Architecture

