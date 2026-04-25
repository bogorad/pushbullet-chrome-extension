# Code Audit — Pushbullet Chrome Extension

**Date:** 2026-04-26  
**Scope:** Full codebase under `src/`  
**Auditor:** Claude Sonnet 4.6

---

## Summary

Overall quality is high. Architecture is solid (state machine, event bus, repository pattern). Prior security remediations are in place and functional. Findings below are ordered by severity.

---

## Security

### S1 — MEDIUM: `GET_PUSH_DATA` uses `message.type` not `message.action`, bypassing privileged-action check

**File:** `src/background/index.ts:983`

The privileged-message guard at line 939 dispatches on `message.action`. But the `GET_PUSH_DATA` branch checks `message.type`, not `message.action`:

```ts
if (message.type === "GET_PUSH_DATA") {
```

Because `message.type !== message.action`, `validatePrivilegedMessage` never sees this action string, so `GET_PUSH_DATA` is not validated. Any external extension can call it with a guessable notification ID (`pushbullet-push-${counter}-${Date.now()}`) and receive the full push object, including decrypted content.

**Fix:** Add `"GET_PUSH_DATA"` to `PRIVILEGED_ACTIONS`, or move the branch into the action-dispatch chain and check `message.action`.

---

### S2 — MEDIUM: `GET_NOTIFICATION_DATA` not in `PRIVILEGED_ACTIONS`

**File:** `src/lib/security/message-validation.ts:46-58`, `src/background/index.ts:1486`

`MessageAction.GET_NOTIFICATION_DATA` is not in the privileged set. Any extension with an enumerated or brute-forced notification ID can retrieve push content including decrypted push data. The notification ID is not secret (it is set via Chrome's notifications API which is readable).

**Fix:** Add `MessageAction.GET_NOTIFICATION_DATA` to `PRIVILEGED_ACTIONS`.

---

### S3 — LOW: Mirror push icon accepted without size guard

**File:** `src/background/utils.ts:601-616`

```ts
if (iconData && typeof iconData === 'string' && iconData.startsWith('/9j/')) {
  const dataUrl = `data:image/jpeg;base64,${iconData}`;
```

The `/9j/` prefix check (JPEG magic bytes in base64) is a reasonable type hint but there is no upper-bound on `iconData.length`. A malicious sender could include a very large base64 blob (megabytes) that is loaded into memory and set as a data URL on every mirror notification. No cap is enforced.

**Fix:** Add a length guard, e.g., `iconData.length <= 2_000_000` (≈1.5 MB decoded).

---

### S4 — LOW: `setHTML` provides insufficient sanitization

**File:** `src/lib/ui/dom.ts:63-65`

```ts
const sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
element.innerHTML = sanitized;
```

Stripping `<script>` tags does not prevent XSS from inline handlers (`onerror=`, `onload=`), `<svg>`, `<iframe>`, `javascript:` hrefs, or CSS expressions. The popup's `displayPushes()` correctly uses `textContent` for all push data, so this function is not currently exploited. But its presence is a footgun.

**Fix:** Either remove `setHTML` entirely (nothing in the codebase calls it with untrusted data), or replace `innerHTML` with a proper sanitizer or a `textContent`-only approach.

---

### S5 — LOW: Encryption password persists to `chrome.storage.local` when `storage.session` is unavailable

**File:** `src/infrastructure/storage/storage.repository.ts:276-279`

The fallback path stores the raw encryption password to `chrome.storage.local`, which survives browser restarts and is accessible on disk. The code acknowledges this but it is not surfaced to the user.

**Fix:** At minimum, show a UI warning when falling back to local storage, or refuse to persist and require the user to re-enter the password on each browser start.

---

## Correctness

### C1 — HIGH: `JSON.parse` in WebSocket `onmessage` has no error boundary

**File:** `src/app/ws/client.ts:173`

```ts
this.socket.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
```

A malformed or non-JSON WebSocket frame (e.g., during a reconnect or a server bug) throws a `SyntaxError` that is not caught. The error silently terminates the handler; no disconnect or reconnect is triggered. Subsequent messages will still be processed, but the current message (and any following synchronous state updates) is lost with no log entry.

**Fix:** Wrap `JSON.parse` in a try/catch, log the parse error, and return early.

---

### C2 — MEDIUM: `isValidPush` omits `sms_changed` type

**File:** `src/types/domain.ts:402-406`

```ts
export function isValidPush(push: unknown): push is Push {
  ...
  return typeof p.type === 'string' && ['link', 'note', 'file', 'mirror', 'dismissal'].includes(p.type);
}
```

`sms_changed` is a valid `Push` union member and is handled throughout the codebase, but is absent from the `isValidPush` guard. Any caller that relies on this guard to admit `sms_changed` pushes will reject them.

**Fix:** Add `'sms_changed'` to the array.

---

### C3 — MEDIUM: `ranReconnectAutoOpen` can fire auto-open on initial startup

**File:** `src/background/index.ts:308, 786-800`

`ranReconnectAutoOpen` is initialized to `false` and is only reset to `false` when entering the `RECONNECTING` state. The keepalive alarm handler calls `maybeRunReconnectAutoOpen()` when `notReady` (state is not READY):

```ts
if (notReady) {
  stateMachine.transition("WS_CONNECTED");
  void runPostConnect();
  void maybeRunReconnectAutoOpen();  // ← ranReconnectAutoOpen is false on first startup
}
```

On a clean startup (never entering RECONNECTING), the flag starts `false`, so this path will fire `autoOpenOfflineLinks()`. This could open tabs on the very first WebSocket connection, before any offline period has occurred, if the keepalive tick beats the `websocket:connected` event.

**Fix:** Reset `ranReconnectAutoOpen = false` only inside `maybeRunReconnectAutoOpen` immediately before checking, or explicitly set it to `true` after the first successful startup sequence completes so it is not re-triggered via keepalive.

---

### C4 — LOW: Dead code — READY state `onConnectWebSocket` branch for INITIALIZING is unreachable

**File:** `src/background/state-machine.ts:408-410`

```ts
if (previousState === ServiceWorkerState.INITIALIZING && this.callbacks.onConnectWebSocket) {
  this.callbacks.onConnectWebSocket();
}
```

The transition table routes `INITIALIZING → RECONNECTING` (on `INIT_SUCCESS`), never directly to `READY`. So `previousState === INITIALIZING` is never true when entering `READY`. The WebSocket connection is correctly initiated in `onStateEnter(RECONNECTING)` at line 428-431.

**Fix:** Remove the dead branch.

---

## Code Quality

### Q1 — `summarizePushForLog` is duplicated

**Files:** `src/background/index.ts:91-113`, `src/background/utils.ts:95-116`

Nearly identical copies with one minor difference (`ciphertext` flag in `index.ts`). The `index.ts` version is unexported.

**Fix:** Move the canonical version to `utils.ts` (or a shared helper file) and remove the duplicate from `index.ts`.

---

### Q2 — `hasStringValue` is duplicated

**Files:** `src/background/index.ts:87-89`, `src/background/utils.ts:91-93`

Identical one-liner defined twice.

**Fix:** Export from `utils.ts`, import in `index.ts`.

---

### Q3 — `chrome.runtime.onStartup` registered twice

**File:** `src/background/index.ts:1760, 1824`

```ts
chrome.runtime.onStartup.addListener(async () => {  // line 1760 — calls bootstrap
  ...
});
// ... 60 lines later ...
chrome.runtime.onStartup.addListener(async () => {  // line 1824 — calls checkExtensionHealth
  ...
});
```

This is legal but confusing. Chrome will call both listeners on startup.

**Fix:** Merge into a single `onStartup` listener.

---

### Q4 — `SEND_PUSH` handler duplicates `pushLink()` API call logic

**File:** `src/background/index.ts:1606-1629`

The `SEND_PUSH` message handler calls `fetch('https://api.pushbullet.com/v2/pushes', ...)` directly, bypassing the API client's retry logic, timeout, and centralized error handling. The same endpoint is used by `pushLink()` and `pushNote()` in `utils.ts` which also call `fetch` directly (not through `client.ts` either). These three paths all duplicate HTTP boilerplate.

**Fix:** Extract a shared `sendPush(apiKey, body)` function in `client.ts` and use it from all three call sites.

---

### Q5 — `console.log`/`console.warn` used instead of `debugLogger` in several places

**Files:**
- `src/infrastructure/storage/storage.repository.ts:334` — `console.warn`
- `src/options/index.ts:81` — `console.log`
- `src/popup/index.ts:1063` — `console.log`

These bypass the centralized logging and debug export system.

**Fix:** Replace with `debugLogger.general(...)` calls.

---

### Q6 — `autoOpenLinks` default value inconsistency

**Files:** `src/infrastructure/storage/storage.repository.ts:202` (default `false`), `src/options/index.ts:28` (`DEFAULT_SETTINGS.autoOpenLinks = true`)

The storage layer defaults to `false`. The options page `DEFAULT_SETTINGS` says `true`. On first install, `getAutoOpenLinks()` returns `false` but the options UI shows the checkbox as checked based on the code path that sets it from `DEFAULT_SETTINGS.autoOpenLinks`.

Wait — actually `loadSettings()` calls `await storageRepository.getAutoOpenLinks()` which returns `false` if unset, and sets `autoOpenLinksCheckbox.checked = false`. So the `DEFAULT_SETTINGS.autoOpenLinks = true` value is unused. This is dead/confusing code.

**Fix:** Remove `autoOpenLinks` from `DEFAULT_SETTINGS` or align the two defaults.

---

### Q7 — `'attemptReconnect'` in `PRIVILEGED_ACTIONS` as a string literal

**File:** `src/lib/security/message-validation.ts:58`

```ts
'attemptReconnect',
```

All other entries use `MessageAction.*` enum values. This action is handled in `index.ts` as `message.action === "attemptReconnect"` (also a string literal). If the action is ever refactored into the enum, this entry will silently stop working.

**Fix:** Add `ATTEMPT_RECONNECT = 'attemptReconnect'` to the `MessageAction` enum and use it consistently.

---

### Q8 — Excessive `any` in state machine and callbacks

**Files:** `src/background/state-machine.ts:59, 189, 353`

`onInitialize?: (data?: any)`, `transition(event, data?: any)`, `onStateEnter(state, previousState, data?: any)` all use untyped `data`. This erodes type safety around the most critical state transitions.

**Fix:** Define a discriminated union or typed interface for transition data.

---

## Architecture

### A1 — Alarm handler does not guard against double-registration of `longSleepRecovery`

**File:** `src/background/index.ts:1762`

```ts
chrome.runtime.onStartup.addListener(async () => {
  ...
  chrome.alarms.create('longSleepRecovery', { periodInMinutes: 5 });
```

`chrome.alarms.create` with an existing alarm name either silently updates or creates a duplicate depending on the Chrome version. There is no `chrome.alarms.clear('longSleepRecovery')` before creating it. The alarm is also not created in `onInstalled`, so first-install users don't get it until they restart the browser.

**Fix:** Either use `chrome.alarms.get` before create, or always clear then recreate in both `onInstalled` and `onStartup`.

---

### A2 — `MAX_PROCESSED_PUSH_MARKERS = 500` may grow large

**File:** `src/infrastructure/storage/storage.repository.ts:100`

Processed push markers are stored in `chrome.storage.local` as a flat `Record<string, number>`. At 500 entries, each entry is roughly `~30 bytes` (iden + modified), totaling ~15 KB per write. Chrome's `storage.local` has a 5 MB default quota, so this is not a quota risk, but the per-write cost of reading, deserializing, pruning, re-serializing, and writing this map on every `markPushProcessed` call grows with load. Under high push volume, this could cause noticeable latency.

**Fix:** Consider a time-based expiry (drop entries older than N days) rather than a count-based cap, or use IndexedDB for this data.

---

## Minor / Style

| # | File | Line | Issue |
|---|------|------|-------|
| M1 | `src/background/state-machine.ts` | 358-359 | Commented-out `debugLogger.general` calls left in production code |
| M2 | `src/background/index.ts` | 1770-1773 | Commented-out alarm listener block; confusing and should be removed |
| M3 | `src/background/utils.ts` | 788-791 | Excessive object key formatting splits a 3-field object over 8 lines |
| M4 | `src/app/api/client.ts` | 413-419 | `ensureDeviceExists` uses `response.status !== 404` — a 500 would return `true` (device "exists"), which would suppress re-registration when the API is unhealthy |

---

## Positive Observations

- **MV3 lifecycle** is handled robustly: keepalive alarms, state-machine hydration across restarts, IndexedDB session cache.
- **Sender validation** (`validatePrivilegedMessage`) is correctly applied to all destructive actions except the two gaps noted in S1/S2.
- **Trusted image URL allowlist** (`isTrustedImageUrl`) is well-implemented with explicit hostname matching.
- **Encryption** uses the correct PBKDF2 + AES-256-GCM with user iden as salt, matching Pushbullet's published spec.
- **Push deduplication** via `upsertPushes` + `markPushProcessed` is clean and prevents notification spam on reconnect.
- **Auto-open safety cap** (`MAX_AUTO_OPEN_PER_RECONNECT`) and MRU deduplication prevent tab storms.
- **`notificationDataStore` size cap** (100 entries) prevents unbounded memory growth.
