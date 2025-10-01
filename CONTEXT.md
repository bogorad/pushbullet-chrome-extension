# PUSHBULLET CHROME EXTENSION - COMPLETE CONTEXT

## QUICK START FOR AI ASSISTANT

**Read this file first when starting a new conversation about this project.**

### Critical Rules (NEVER VIOLATE)
1. ✅ Use `'use strict';` in all JS files
2. ✅ Use `WS_READY_STATE.OPEN` not `WebSocket.OPEN`
3. ✅ Initialize variables as `null`, not defaults
4. ✅ Call `ensureInitialized()` before critical operations
5. ✅ Check `wasPushAlreadyShown()` before showing notifications
6. ✅ Re-throw errors in catch blocks (don't swallow)
7. ✅ Increment patch version (1.0.XX) for bug fixes
8. ❌ NEVER add fallback values that mask bugs
9. ❌ NEVER use `|| 'default'` patterns
10. ❌ NEVER skip deduplication checks

### Current State
- **Version**: 1.0.26
- **Status**: Production-ready with E2EE SMS support + Code audit complete
- **Last Issue**: Infinite recursion in error tracking (FIXED v1.0.25)
- **Latest Features**:
  - Full E2EE decryption with password storage (v1.0.23)
  - SMS notification support via sms_changed type (v1.0.24)
  - File attachment with upload to Pushbullet API (v1.0.18)
  - Code audit fixes (v1.0.26)
- **Code Quality**: Audited and hardened
- **Next Steps**: Production deployment

## RECENT CHANGES

### Code Audit & Hardening (v1.0.26)
- **Security**: Added Web Crypto API availability check in crypto.js
- **Reliability**: Fixed context menu race condition by calling setupContextMenu() at top level
- **Audit Results**: 9/10 issues already fixed, 2 new fixes applied
- **Code Quality**: Production-ready after comprehensive audit

### Critical Bug Fix (v1.0.25)
- **CRITICAL**: Fixed infinite recursion in GlobalErrorTracker
- **Impact**: Prevented 853 stack overflow errors
- **Fix**: Replaced debugLogger.error() with console.error() in error tracker
- **Result**: Error tracking now stable and non-recursive

### E2EE SMS Support (v1.0.23-24)
- **Full E2EE Decryption**: Implemented PBKDF2 + AES-256-GCM decryption
- **Password Storage**: Added encryption password field in options (local storage only)
- **SMS Display**: Handle sms_changed type and extract from notifications array
- **Fallback**: Show "Encrypted Message Received" notification if no password set
- **Click Handler**: Opens pushbullet.com for encrypted messages without password

### File Attachment Feature (v1.0.18)
- Added "Attach" button to popup
- Implemented 3-step file upload process
- Added optional description field
- File size limit: 25MB (Pushbullet free tier)

### If User Reports Bug
1. Check `CRITICAL_ISSUES_ANALYSIS.md` for known issues
2. Check debug dashboard logs
3. Verify initialization state
4. Check for error swallowing
5. Verify deduplication working

## PROJECT OVERVIEW

**Name**: Pushbullet for Chrome (Unofficial)
**Current Version**: 1.0.26
**Type**: Chrome Extension (Manifest V3)
**Purpose**: Unofficial Pushbullet client for Chrome with real-time push notifications and E2EE SMS support
**Repository**: git@github.com:bogorad/pushbullet-chrome-extension.git
**Branch**: main

## CRITICAL ARCHITECTURE DECISIONS

### 1. Service Worker Environment (Manifest V3)
- **NO `WebSocket` global constant** - Must use numeric constants
- **Solution**: Created `WS_READY_STATE` object with CONNECTING(0), OPEN(1), CLOSING(2), CLOSED(3)
- **All WebSocket checks**: Use `WS_READY_STATE.OPEN` instead of `WebSocket.OPEN`

### 2. Strict Mode Enforcement
- **ALL JavaScript files** start with `'use strict';`
- **Purpose**: Catch undefined variables, prevent silent failures
- **Files**: background.js, js/popup.js, js/options.js

### 3. No Fallback Values (Fail Loudly)
- **Variables initialized as NULL**: deviceNickname, autoOpenLinks, notificationTimeout
- **NO defaults** - Must be loaded from storage
- **First run only**: Sets defaults and saves to storage
- **Rationale**: Can't distinguish between "not loaded" and "default value"

### 4. Initialization State Tracking
```javascript
const initializationState = {
  inProgress: false,   // Prevents double-init
  completed: false,    // Tracks completion
  error: null,         // Stores errors
  timestamp: null      // When completed
};
```
- **Prevents**: Double initialization, operations before init complete, race conditions
- **Helper**: `ensureInitialized(operation)` - Throws if not initialized

### 5. Duplicate Push Prevention
```javascript
const shownPushIds = new Set();           // Track shown pushes
const shownPushTimestamps = new Map();    // Track when shown
const SHOWN_PUSH_RETENTION = 1000;        // Keep last 1000
```
- **Problem**: Pushbullet sends BOTH 'tickle' AND 'push' messages
- **Solution**: Track shown push IDs, skip duplicates
- **Helpers**: `wasPushAlreadyShown(pushId)`, `markPushAsShown(pushId)`
- **Auto-cleanup**: Removes oldest when exceeds 1000

### 6. Single Source of Truth
- **Session Cache**: Only stores userInfo, devices, recentPushes, isAuthenticated, lastUpdated
- **Global Variables**: deviceNickname, autoOpenLinks, notificationTimeout
- **NO duplication** between sessionCache and globals

## KEY BUGS FIXED

### Bug 1: Orange Dot Always Showing "Connecting"
**Root Cause**: Line 174 in popup.js overwrote connection state AFTER it was correctly set  
**Fix**: Removed duplicate `updateConnectionIndicator('connecting')` call  
**Result**: Dot shows GREEN when WebSocket connected  

### Bug 2: Total Logs Stuck at 50
**Root Cause**: `getDebugSummary` only sent 50 recent logs, dashboard displayed array length  
**Fix**: Added `totalLogs` field to response, dashboard uses it  
**Result**: Shows actual total count  

### Bug 3: Notifications Not Disappearing
**Root Cause**: Line 2625 called `chrome.notifications.create()` directly instead of helper  
**Fix**: Changed to `createNotificationWithTimeout()` which sets timeout and clears  
**Result**: Notifications disappear after configured timeout  

### Bug 4: Duplicate Push Notifications
**Root Cause**: Both 'tickle' and 'push' WebSocket messages showed notifications  
**Fix**: Added deduplication tracking with Set/Map  
**Result**: Each push shown only once  

### Bug 5: Device Re-registration Not Working
**Root Cause**: `updateDeviceNickname()` had try-catch that swallowed errors  
**Fix**: Added `throw error;` in catch block to re-throw  
**Result**: Failed update triggers re-registration  

### Bug 6: WebSocket.OPEN Undefined in Service Worker
**Root Cause**: `WebSocket` global not available in service worker context  
**Fix**: Created `WS_READY_STATE` constants, replaced all references  
**Result**: No more undefined errors  

## FILE STRUCTURE

```
/
├── manifest.json              # Extension manifest (v3)
├── background.js              # Service worker (main logic)
├── popup.html                 # Popup UI
├── options.html               # Options page
├── debug-dashboard.html       # Debug dashboard
├── js/
│   ├── popup.js              # Popup logic
│   ├── options.js            # Options logic
│   └── debug-dashboard.js    # Debug dashboard logic
├── css/
│   ├── popup.css
│   ├── options.css
│   └── debug-dashboard.css
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── CONTEXT.md                 # This file
└── CRITICAL_ISSUES_ANALYSIS.md
```

## CRITICAL FUNCTIONS

### background.js

#### `initializeSessionCache(source)`
- **Purpose**: Load config from storage, fetch user/devices/pushes, connect WebSocket
- **State Tracking**: Uses `initializationState` to prevent double-init
- **Error Handling**: Throws errors, sets `initializationState.error`
- **Completion**: Sets `initializationState.completed = true`

#### `ensureInitialized(operation)`
- **Purpose**: Validate extension is initialized before operations
- **Checks**: initializationState.completed, deviceNickname, autoOpenLinks, notificationTimeout
- **Throws**: Error if any check fails

#### `showPushNotification(push, trackingId)`
- **Deduplication**: Calls `wasPushAlreadyShown()` first
- **Skips**: Empty pushes, pushes from same device, duplicate pushes
- **Marks**: Calls `markPushAsShown()` after successful creation
- **Timeout**: Uses `createNotificationWithTimeout()` helper

#### `wasPushAlreadyShown(pushId)`
- **Returns**: true if push already shown
- **Logs**: Warning with timestamp if duplicate detected

#### `markPushAsShown(pushId)`
- **Adds**: pushId to `shownPushIds` Set
- **Tracks**: Timestamp in `shownPushTimestamps` Map
- **Cleanup**: Removes oldest if exceeds SHOWN_PUSH_RETENTION (1000)

#### `createNotificationWithTimeout(notificationId, options, callback)`
- **Creates**: Chrome notification
- **Sets**: setTimeout to clear after `notificationTimeout` ms
- **Logs**: Auto-dismiss event

## STORAGE SCHEMA

### chrome.storage.sync
```javascript
{
  apiKey: string,              // Encrypted API key
  deviceNickname: string,      // Device nickname (default: 'Chrome')
  autoOpenLinks: boolean,      // Auto-open links (default: true)
  notificationTimeout: number  // Timeout in ms (default: 10000)
}
```

### chrome.storage.local
```javascript
{
  deviceIden: string,                    // Device identifier
  deviceRegistrationInProgress: boolean, // Registration lock
  debugConfig: object,                   // Debug configuration
  scrollToRecentPushes: boolean,        // Popup scroll flag
  [notificationId]: object              // Push data for notifications
}
```

## WEBSOCKET MESSAGE HANDLING

### Message Types
1. **'nop'** - Keep-alive, no action
2. **'tickle'** - Something changed, fetch updates
   - `subtype: 'push'` - New push available, fetch and show
3. **'push'** - Direct push with data, add to cache and show

### Deduplication Flow
```
1. 'tickle' arrives → fetch latest → check wasPushAlreadyShown() → NO → show → markPushAsShown()
2. 'push' arrives → check wasPushAlreadyShown() → YES → SKIP (already shown)
```

## DEBUG SYSTEM

### Categories
- WEBSOCKET, NOTIFICATIONS, API, STORAGE, GENERAL, PERFORMANCE, ERROR

### Key Features
- **Sanitization**: Removes sensitive data (API keys, emails)
- **Performance Tracking**: WebSocket metrics, notification timings
- **Error Tracking**: Global error handler, critical error detection
- **Export**: Full debug data export via `exportDebugData` action

### Debug Dashboard
- Real-time updates every 2 seconds
- Shows: Total logs, errors, WebSocket status, performance metrics
- Export: JSON download of all debug data

## VERSION HISTORY

- **1.0.26**: Code audit fixes - Added Web Crypto availability check, context menu race condition fix
- **1.0.25**: CRITICAL FIX - Fixed infinite recursion in error tracking (853 stack overflow errors)
- **1.0.24**: Fixed SMS display by handling sms_changed type and extracting from notifications array
- **1.0.23**: Implemented full E2EE decryption support with password storage in options
- **1.0.22**: Added encrypted message detection and notification (E2EE SMS)
- **1.0.21**: Enhanced logging for push message structure debugging
- **1.0.20**: Added SMS/mirrored notification support (type='mirror')
- **1.0.19**: Removed dead code (PushbulletService class), implemented real XOR obfuscation, enhanced logging
- **1.0.18**: Added file attachment feature with Pushbullet API upload, improved button contrast
- **1.0.17**: Fixed duplicate push notifications
- **1.0.16**: Fixed notification timeout, removed fallbacks, added null checks
- **1.0.15**: Fixed orange dot, fixed total logs display
- **1.0.14**: Added strict mode, fixed WebSocket constants
- **1.0.13**: Added websocketConnected to getSessionData
- **1.0.12**: Fixed error logging (removed ANSI codes)
- **1.0.11**: Fixed device re-registration
- **1.0.10**: Initial debug system

## KNOWN LIMITATIONS

1. **Chrome Notifications**: Cannot be "destroyed", only cleared from notification center
2. **Service Worker**: Limited globals, must use constants for WebSocket states
3. **Storage Limits**: chrome.storage.sync has 100KB limit
4. **WebSocket**: Can disconnect, polling mode fallback implemented

## TESTING CHECKLIST

After any changes, verify:
1. ✅ Orange dot GREEN when connected
2. ✅ Total logs increases correctly
3. ✅ Notifications disappear after timeout
4. ✅ NO duplicate push notifications
5. ✅ Strict mode catches errors
6. ✅ NULL checks throw errors if uninitialized
7. ✅ Device re-registration works on 404
8. ✅ Push sending works
9. ✅ Link auto-open works (if enabled)
10. ✅ Debug dashboard updates

## IMPORTANT NOTES

- **NEVER** add fallback values that mask bugs
- **ALWAYS** use `ensureInitialized()` before critical operations
- **ALWAYS** check `wasPushAlreadyShown()` before showing notifications
- **ALWAYS** use `WS_READY_STATE` constants, never `WebSocket.OPEN`
- **ALWAYS** re-throw errors in catch blocks unless intentionally swallowing
- **ALWAYS** increment patch version (1.0.XX) for bug fixes

## API ENDPOINTS

```javascript
const API_BASE_URL = 'https://api.pushbullet.com/v2';
const PUSHES_URL = `${API_BASE_URL}/pushes`;
const DEVICES_URL = `${API_BASE_URL}/devices`;
const USER_INFO_URL = `${API_BASE_URL}/users/me`;
const WEBSOCKET_URL = 'wss://stream.pushbullet.com/websocket/';
```

### Authentication
- **Header**: `Access-Token: <apiKey>`
- **Encryption**: API key encrypted with simple XOR (see `encryptKey()`/`decryptKey()`)

## ENCRYPTION SCHEME

```javascript
// Simple XOR encryption for API key storage
const ENCRYPTION_KEY = 'pushbullet-chrome-extension-key';

function encryptKey(key) {
  // XOR each character with encryption key
}

function decryptKey(encrypted) {
  // XOR to decrypt
}
```

**Note**: This is obfuscation, not real security. Chrome storage is already protected.

## GLOBAL VARIABLES (background.js)

```javascript
// Core state
let apiKey = null;                    // Decrypted API key
let deviceIden = null;                // This device's identifier
let deviceNickname = null;            // Device nickname (MUST load from storage)
let autoOpenLinks = null;             // Auto-open setting (MUST load from storage)
let notificationTimeout = null;       // Timeout in ms (MUST load from storage)

// WebSocket
let websocket = null;                 // WebSocket connection
let reconnectAttempts = 0;            // Reconnection counter
let reconnectTimeout = null;          // Reconnection timer
let pollingMode = false;              // Fallback polling mode
let pollingInterval = null;           // Polling timer

// Tracking
let lastDisconnectionNotification = 0;  // Last disconnection notification time
const DISCONNECTION_NOTIFICATION_COOLDOWN = 300000;  // 5 minutes
const DISCONNECTION_NOTIFICATION_THRESHOLD = 300000; // 5 minutes

// Deduplication
const shownPushIds = new Set();
const shownPushTimestamps = new Map();
const SHOWN_PUSH_RETENTION = 1000;

// Initialization
const initializationState = {
  inProgress: false,
  completed: false,
  error: null,
  timestamp: null
};

// Session cache
let sessionCache = {
  userInfo: null,
  devices: [],
  recentPushes: [],
  isAuthenticated: false,
  lastUpdated: 0
};
```

## COMMON PITFALLS

### 1. Forgetting to Check Initialization
```javascript
// ❌ WRONG
function doSomething() {
  if (!apiKey) return;
  // ... use deviceNickname (might be null!)
}

// ✅ RIGHT
function doSomething() {
  ensureInitialized('doSomething');
  if (!apiKey) throw new Error('API key not set');
  // ... safe to use deviceNickname
}
```

### 2. Using WebSocket Constants
```javascript
// ❌ WRONG (undefined in service worker)
if (websocket.readyState === WebSocket.OPEN) { }

// ✅ RIGHT
if (websocket.readyState === WS_READY_STATE.OPEN) { }
```

### 3. Swallowing Errors
```javascript
// ❌ WRONG
try {
  await criticalOperation();
} catch (error) {
  console.error(error); // Swallowed!
}

// ✅ RIGHT
try {
  await criticalOperation();
} catch (error) {
  debugLogger.general('ERROR', 'Critical operation failed', null, error);
  throw error; // Re-throw!
}
```

### 4. Not Checking for Duplicates
```javascript
// ❌ WRONG
function showPushNotification(push) {
  chrome.notifications.create(...); // Might show twice!
}

// ✅ RIGHT
function showPushNotification(push) {
  if (wasPushAlreadyShown(push.iden)) return;
  createNotificationWithTimeout(...);
  markPushAsShown(push.iden);
}
```

### 5. Using Fallback Values
```javascript
// ❌ WRONG
const nickname = result.deviceNickname || 'Chrome';

// ✅ RIGHT
if (!result.deviceNickname) {
  throw new Error('Device nickname not found in storage');
}
const nickname = result.deviceNickname;
```

## DEBUGGING TIPS

### Enable Debug Logging
1. Open debug dashboard: Click extension icon → "Debug Dashboard"
2. Check categories: All enabled by default
3. Export data: Click "Export Debug Data" for full JSON

### Common Debug Scenarios

**WebSocket not connecting**:
- Check: `websocketState.current.readyState` in debug dashboard
- Look for: "WebSocket connection established" in logs
- Check: API key is valid

**Pushes not showing**:
- Check: "Duplicate push detected" warnings (deduplication working)
- Check: "Skipping notification - push from this device" (sent from same device)
- Check: notificationTimeout setting (might be 0)

**Orange dot stuck**:
- Check: `websocketConnected` in getSessionData response
- Check: Popup initialization order (should set state AFTER getting response)

**Total logs not increasing**:
- Check: `totalLogs` field in getDebugSummary response
- Check: Dashboard using `data.totalLogs` not `data.logs.length`

## PERFORMANCE CONSIDERATIONS

- **WebSocket**: Preferred over polling (real-time, low overhead)
- **Polling Mode**: Fallback after 5 consecutive failures
- **Session Cache**: Reduces API calls, 30-second staleness threshold
- **Notification Tracking**: Limited to 1000 recent pushes (auto-cleanup)
- **Debug Logs**: Limited to 1000 entries (configurable)

## SECURITY NOTES

- **API Key**: Stored encrypted in chrome.storage.sync
- **Sanitization**: Debug logs sanitize API keys, emails
- **HTTPS**: All API calls use HTTPS
- **WSS**: WebSocket uses secure connection
- **No Secrets**: No hardcoded secrets in code

## FUTURE IMPROVEMENTS

- [ ] Add proper encryption for API key (currently XOR obfuscation)
- [ ] Add push history persistence
- [ ] Add notification sound customization
- [ ] Add push filtering/rules
- [ ] Add multi-account support
- [ ] Add offline queue for failed pushes
- [ ] Add push templates
- [ ] Add keyboard shortcuts

