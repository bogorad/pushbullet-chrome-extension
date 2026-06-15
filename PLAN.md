# Reliability Plan — Post-Sleep Wake & SMS Display

**Status:** Implemented, committed, and closed in Beads. The execution epic was `pushbullet-chrome-extension-5dm`; the original implementation landed in `c65a3cf`, and the follow-up roborev fix tightened SMS-history correlation before publication.

**Repo:** `/home/chuck/git/pushbullet-chrome-extension` · **Manifest V3** · version at analysis: `1.5.5` · **Date:** 2026-06-15

---

## TL;DR

- **Problem 1 — won't wake after extended sleep:** the reconnect is *decided* but never *executed*. `connectWebSocket()` early-returns on a half-open (OPEN-but-dead) socket because its guard checks `isConnected()` but not `isConnectionHealthy()`, so the zombie socket is never disposed and the extension loops in `RECONNECTING` until a manual Force Wake.
- **Problem 2 — SMS doesn't display:** SMS arrives only as transient WebSocket *ephemerals* (never fetched from history); the popup list is fed from `/v2/pushes` (which never contains SMS); received SMS is overwritten by the next refresh; encrypted SMS is dropped silently.
- **They are coupled:** Pushbullet never replays ephemerals, so a dead socket (Problem 1) permanently loses SMS (Problem 2).
- The prior **closed** epic `pushbullet-chrome-extension-audit-p1-wake` fixed the state-machine *decision* (a stale persisted `READY` no longer blocks reconnect) and introduced `reconcileWake()`. This plan fixes the **residual execution gaps** that survived that work. `isValidPush()` already admits `sms_changed` (closed `…-rrg.2.1`).

---

## Diagnosis

### Problem 1 — wake/reconnect after extended computer sleep

Intended recovery path: persistent alarms (`longSleepRecovery` 5 min, `websocketHealthCheck` 1 min) → `reconcileWake()` → `ATTEMPT_RECONNECT` → state `RECONNECTING` → `onConnectWebSocket` → `connectWebSocket()`.

**Residual root cause:** after OS resume, a suspended TCP socket is commonly **half-open** — `readyState === OPEN` but dead, and `onclose` may never fire. So `isConnected()` returns `true`, `connectWebSocket()` early-returns, and the zombie socket is never replaced. Meanwhile `isConnectionHealthy()` is `false` (no `nop` in 60 s), so the 1-/5-minute health checks keep firing `ATTEMPT_RECONNECT` → `RECONNECTING` → `connectWebSocket()` → early-return: a permanent stall (yellow "connecting" icon).

| # | Fact (verified) | Evidence |
|---|------|----------|
| F1 | Reconnect guard checks `isConnected()` (OPEN) but **not** `isConnectionHealthy()`; dispose code sits after the early return | `src/background/index.ts:734-768`, `src/app/ws/client.ts:64-68,363-368` |
| F2 | Nothing force-closes a half-open socket; recovery relies on `onclose` (may not fire post-resume) | `src/app/ws/client.ts:270-310` |
| F3 | `chrome.idle` is **unused** and the `idle` permission is **not declared** → no proactive wake trigger | `manifest.json:19-25` |
| F4 | `websocketHealthCheck` (1-min) alarm created **only** in `initializeSessionCache`, never re-armed at `onStartup`/`onInstalled` | `src/app/session/index.ts:519`; `src/background/index.ts:1719-1730` |
| F5 | No internal heartbeat-driven reconnect; `reconnectAttempts` never incremented | `src/app/ws/client.ts:38,106` |
| F6 | Long sleep coalesces/skips alarms → recovery latency unbounded by anything but the next alarm | ADR-0007 Context |

### Problem 2 — SMS does not display

The SMS notification code works in the happy path (`src/background/utils.ts:444-545`; popup renders `sms_changed` + SMS-app `mirror` at `src/popup/index.ts:588-625`). The failures are around it:

| # | Fact (verified) | Evidence |
|---|------|----------|
| G1 | SMS/MMS reach the extension **only** as real-time ephemerals (`mirror`/`sms_changed`); no SMS-history fetch (`/v2/permanents/*_threads`) exists | API client only hits `/v2/pushes`,`/devices`,`/users/me`,`/chats`,`/upload-request` (`src/app/api/client.ts`) |
| G2 | Popup list is built from `/v2/pushes`, which **never** contains ephemerals → list essentially never shows SMS | `src/app/api/client.ts:250-308,435-461`; `src/popup/index.ts:644-664` |
| G3 | Real-time SMS is `unshift`ed + persisted, but init/background refresh **overwrite** `recentPushes` wholesale → SMS wiped from memory and IndexedDB on next refresh | write `src/background/index.ts:491-494`; overwrites `src/app/session/index.ts:143,483` |
| G4 | Encrypted ephemerals are **silently dropped** when no E2EE password is set (common for SMS mirroring) | `src/background/index.ts:382-438` (return at 437) |
| G5 | A pure-signal `sms_changed` (empty `notifications`) is dropped with no fallback fetch of content | `src/background/utils.ts:409-416` |

**Non-code prerequisites to rule out during verification:** SMS sync must be enabled in the **phone's** Pushbullet app; if E2EE is on, the same password must be set in the extension Options (G4 should make that case visible instead of silent).

---

## Proposed Beads epic

One epic → two phases → nine task leaves, optimized for parallel execution. Dependency edges (blocker → blocked): **A1 → A4**, **B1 → B4**, **B3 → B4**. Phases A and B are independent.

```
EPIC  Post-sleep wake reliability & SMS delivery/visibility            (epic, p0)
├─ Phase A  Wake & reconnect — eliminate zombie-socket reconnect stall (epic, p0)
│  ├─ A1  Fix connectWebSocket(): dispose stale/half-open sockets       (task, p0)  ── blocks A4
│  ├─ A2  chrome.idle wake detection -> reconcileWake on resume         (task, p2)
│  ├─ A3  Re-arm recovery alarms at startup and on wake                 (task, p1)
│  ├─ A4  WebSocket nop-timeout watchdog self-closes dead sockets       (task, p1)
│  └─ A5  Keepalive interval correctness (>=30s)                        (task, p3)
└─ Phase B  SMS delivery & display                                     (epic, p1)
   ├─ B1  Merge-preserve received SMS/mirror ephemerals                 (task, p1)  ── blocks B4
   ├─ B2  Surface encrypted SMS instead of silently dropping           (task, p2)
   ├─ B3  Fetch SMS thread history via /v2/permanents                   (task, p2)  ── blocks B4
   └─ B4  End-to-end SMS diagnostics (counters + dashboard)            (task, p3)
```

---

## Phase A — Wake & reconnect

### A1 · Fix connectWebSocket(): dispose stale/half-open sockets so reconnect runs
Primary: `src/background/index.ts` (`connectWebSocket`, ~734-768). Related: `src/app/ws/client.ts`, `tests/app/ws-client.test.ts`. **Blocks A4.**

**Problem (root cause of "won't wake"):** half-open socket after resume → `isConnected()` true → early-return → zombie never disposed → permanent `RECONNECTING` stall.

**Evidence:**
```ts
// src/background/index.ts:734
function connectWebSocket(): void {
  if (websocketClient) {
    const isConnected = websocketClient.isConnected();                 // readyState === OPEN
    const isConnecting = websocketClient.getReadyState() === WebSocket.CONNECTING;
    if (isConnected || isConnecting) { return; }                       // <-- STALL on half-open
  }
  if (websocketClient) { websocketClient.disconnect(); websocketClient = null; }  // unreachable
  websocketClient = new WebSocketClient(WEBSOCKET_URL, getApiKey);
  setWebSocketClient(websocketClient);
  websocketClient.connect();
}
// src/app/ws/client.ts:363  isConnectionHealthy(): OPEN AND (now - lastNopAt) <= 60000
```

**Fix:**
```ts
function connectWebSocket(): void {
  if (websocketClient) {
    const live = websocketClient.isConnected() && websocketClient.isConnectionHealthy();
    const isConnecting = websocketClient.getReadyState() === WebSocket.CONNECTING;
    if (live || isConnecting) {
      debugLogger.websocket("DEBUG", "WebSocket live or connecting, skipping duplicate connect");
      return;
    }
    debugLogger.websocket("INFO", "Disposing stale/unhealthy socket before reconnect", {
      readyState: websocketClient.getReadyState(),
    });
    websocketClient.disconnect();
    websocketClient = null;
  }
  websocketClient = new WebSocketClient(WEBSOCKET_URL, getApiKey);
  setWebSocketClient(websocketClient);
  websocketClient.connect();
}
```
Optional: record a connect-attempt timestamp so a socket stuck in `CONNECTING` after resume is also replaced after N seconds.

**Acceptance:** OPEN-but-unhealthy → dispose+recreate; healthy → still no-ops; test simulates post-hibernate half-open (OPEN + stale `lastNopAt`). **Verify:** `npx vitest run tests/app/ws-client.test.ts tests/background`; `npm run typecheck`.

### A2 · chrome.idle wake detection → reconcileWake on resume
Primary: `manifest.json`, `src/background/index.ts`.

**Problem:** no proactive wake trigger; recovery waits for the next (possibly coalesced) alarm. **Evidence:** `manifest.json:19-25` has no `idle`; no `chrome.idle` usage.

**Fix:**
```json
"permissions": ["storage", "notifications", "contextMenus", "tabs", "alarms", "idle"],
```
```ts
try {
  chrome.idle.setDetectionInterval(60);
  chrome.idle.onStateChanged.addListener((state) => {
    if (state === "active") {
      debugLogger.general("INFO", "[Idle] Returned to active - reconciling wake");
      void reconcileWake("idle-active");
    }
  });
} catch (e) {
  debugLogger.general("WARN", "chrome.idle unavailable", { error: String(e) });
}
```
**Acceptance:** `idle` declared; `active` → one `reconcileWake`; `locked`/`idle` do not reconnect. **Note:** new permission re-prompts users on update — call out in release notes.

### A3 · Re-arm recovery alarms at startup and on wake
Primary: `src/background/index.ts`, `src/background/lifecycle.ts`, `src/app/session/index.ts`.

**Problem:** `websocketHealthCheck` is created only during full network init, so a cache-hydrate startup may run a whole SW generation without it. **Evidence:** `src/app/session/index.ts:519`; `src/background/index.ts:1719-1730`.

**Fix:**
```ts
async function ensureRecoveryAlarmsExist(): Promise<void> {
  const have = new Set((await chrome.alarms.getAll()).map((a) => a.name));
  if (!have.has("longSleepRecovery"))    chrome.alarms.create("longSleepRecovery",    { periodInMinutes: 5 });
  if (!have.has("websocketHealthCheck")) chrome.alarms.create("websocketHealthCheck", { periodInMinutes: 1 });
}
// call from onStartup, onInstalled (replacing ensureLongSleepRecoveryAlarm), and reconcileWake (via DI)
```
**Acceptance:** both alarms exist after a cache-hydrate startup and after `reconcileWake`. **Verify:** `npx vitest run tests/background/session-cache.test.ts`.

### A4 · WebSocket nop-timeout watchdog self-closes dead sockets
Primary: `src/app/ws/client.ts`. **Depends on A1.**

**Problem:** dead-socket detection relies on `onclose`, which may not fire after resume. **Evidence:** `src/app/ws/client.ts:35,152,192,270-310,363-368`.

**Fix:**
```ts
private nopTimer: ReturnType<typeof setTimeout> | null = null;

private armNopWatchdog(): void {
  if (this.nopTimer) clearTimeout(this.nopTimer);
  this.nopTimer = setTimeout(() => {
    if (!this.isConnectionHealthy()) {
      debugLogger.websocket("WARN", "No server nop within window - forcing reconnect", { ageMs: Date.now() - this.lastNopAt });
      try { this.socket?.close(4999, "nop-timeout"); } catch { /* noop */ }
      globalEventBus.emit("websocket:disconnected", { code: 4999, reason: "nop-timeout" });
    }
  }, WebSocketClient.NOP_TIMEOUT + 5000);
}
// arm in onopen and on each "nop"; clear in disconnect()
```
**Important:** code 4999 is inside the current permanent-close range (`>=4000 && <5000`, `ws/client.ts:283-303`) — emit `websocket:disconnected` directly (as above) or exclude the synthetic code from the permanent set. **Acceptance:** no-nop → emits disconnected without external alarm; healthy stream never triggers; timer cleared on disconnect.

### A5 · Keepalive interval correctness (>=30s)
Primary: `src/background/keepalive.ts`. **Problem:** 20 s is below Chrome's 30 s floor and is clamped (`keepalive.ts:7,20-23`).
```ts
const KEEPALIVE_INTERVAL_SECONDS = 30; // Chrome's minimum alarm period is 30s; lower values are clamped
```
Document that keepalive only spans `startCriticalKeepalive()`/`stopCriticalKeepalive()` windows.

---

## Phase B — SMS delivery & display

### B1 · Merge-preserve received SMS/mirror ephemerals (stop overwriting recentPushes)
Primary: `src/app/session/index.ts`. **Blocks B4.**

**Problem:** init/background refresh replace `recentPushes` wholesale with `/v2/pushes` (no ephemerals) → received SMS wiped. **Evidence:** write `src/background/index.ts:491-494`; overwrites `src/app/session/index.ts:143,483`.

**Fix:**
```ts
function mergeKeepingEphemerals(fresh: Push[], prev: Push[]): Push[] {
  const isEphemeral = (p: Push) => p.type === "sms_changed" || p.type === "mirror";
  const key = (p: Push) =>
    p.iden ?? `${p.type}|${p.created ?? 0}|${"body" in p ? (p as { body?: string }).body ?? "" : ""}`;
  const keptEphemerals = (prev ?? []).filter(isEphemeral);
  const freshKeys = new Set(fresh.map(key));
  const merged = [...fresh, ...keptEphemerals.filter((p) => !freshKeys.has(key(p)))];
  return merged.sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 200);
}
// session/index.ts:483 and :143:
//   sessionCache.recentPushes = mergeKeepingEphemerals(displayPushes, sessionCache.recentPushes);
```
Add an age cap (e.g., last 24h) to avoid stale buildup. **Acceptance:** received SMS survives a display refresh and IndexedDB reload; note/link/file unchanged.

### B2 · Surface encrypted SMS instead of silently dropping
Primary: `src/background/index.ts`. **Problem:** encrypted ephemeral + no password → silent `return` (`index.ts:382-438`).
```ts
if (decryptionFailed) {
  const hasPwd = !!(await storageRepository.getEncryptionPassword());
  if (!hasPwd) {
    await createNotificationWithTimeout("pushbullet-need-e2e-password", {
      type: "basic", iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "Encrypted message received",
      message: "Set your Pushbullet end-to-end password in Options to view encrypted SMS/notifications.",
      priority: 2,
    }, undefined, 0);
  }
  debugLogger.general("WARN", "Encrypted ephemeral dropped", { hasPwd });
  return;
}
```
Optionally route a click to `chrome.runtime.openOptionsPage()`. **Acceptance:** E2EE+no-password → one actionable prompt (not per-message); password present decrypts and shows.

### B3 · Fetch SMS thread history via /v2/permanents and resolve sms_changed
Primary: `src/app/api/client.ts` (+ background integration, optional popup history). **Blocks B4.** Single task leaf.

**Problem:** no SMS-history fetch; empty `sms_changed` can't resolve to content. **Evidence:** no `/v2/permanents` anywhere; `src/background/utils.ts:409-416`; `Device.has_sms` unused (`src/types/domain.ts:32`).

**Fix (skeleton):**
```ts
const PERMANENTS_URL = `${API_BASE_URL}/permanents`;
export async function fetchSmsThreads(apiKey: string, deviceIden: string) {
  const res = await fetch(`${PERMANENTS_URL}/${deviceIden}_threads`, { headers: authHeaders(apiKey) });
  if (!res.ok) throw new Error(`Failed to fetch SMS threads: ${res.status}`);
  const data = await res.json();                 // confirm exact shape against live data
  return data?.data?.threads ?? data?.threads ?? [];
}
export async function fetchSmsThread(apiKey: string, deviceIden: string, threadId: string) {
  const res = await fetch(`${PERMANENTS_URL}/${deviceIden}_thread_${threadId}`, { headers: authHeaders(apiKey) });
  if (!res.ok) throw new Error(`Failed to fetch SMS thread ${threadId}: ${res.status}`);
  const data = await res.json();
  return data?.data?.thread ?? data?.thread ?? [];
}
// On sms_changed: const smsDevice = sessionCache.devices.find((d) => d.has_sms);
// fetch latest thread to populate notification + durable popup history.
```
Notes: permanents may be E2EE-encrypted (reuse B2 password path); cache+persist threads so the popup shows recent conversations across restarts; **verify exact response shapes against live data**; gate behind `has_sms`. **Acceptance:** empty `sms_changed` resolves to content; popup shows recent SMS after SW restart.

### B4 · End-to-end SMS diagnostics (received/shown/dropped counters + dashboard)
Primary: `src/background/index.ts`, `src/lib/perf`, `src/debug-dashboard/index.ts`. **Depends on B1, B3.**
```ts
// counters: ephemeralReceived, smsShown, droppedEncrypted, droppedEmpty, droppedUnsupported
ephemeralStats.received++;
if (decryptionFailed) { ephemeralStats.droppedEncrypted++; return; }
if (isSmsChangedPush(p) && !hasSmsNotification(p)) { ephemeralStats.droppedEmpty++; }
// on success: ephemeralStats.smsShown++;
```
Expose via `GET_DEBUG_SUMMARY`; render an "SMS / Ephemerals" card in the debug dashboard. **Acceptance:** counters increment per path; dashboard shows received/shown/dropped(by reason).

---

## Tracker blocker

`bd create` fails for **every** issue with:

```
failed to insert issue …: insert issue into issues: Error 1105 (HY000): cannot add or update a child row:
a foreign key constraint fails (`pushbullet_chrome_extension`.`child_counters`,
CONSTRAINT `fk_counter_parent` FOREIGN KEY (`parent_id`) REFERENCES `issues` (`id`))
```

**Root cause (verified via read-only Dolt SELECTs):** an **orphaned `child_counters` row** — `parent_id = pushbullet-chrome-extension-69e` — whose referenced issue no longer exists (58 issues, 6 counters, 1 orphan). Dolt re-validates `fk_counter_parent` on every write transaction, so all creates fail. `bd doctor` reports 0 errors (it does not check this), and there are **no federation peers** (`dolt_mode: server`).

**Safe remediation (one statement, requires explicit authorization — mutates the shared `doltsrv.lan` DB used by all clients):**
```sql
DELETE FROM child_counters WHERE parent_id = 'pushbullet-chrome-extension-69e';
```
Recommended sequence: pin a Dolt backup branch first, delete the orphan, then create the epic from the staged bodies in `/tmp/pb_*.md`.

**To create the tree once unblocked** (`bd create` with `--body-file`, then wire edges):
```
bd create --title "<title>" --type epic|task --priority 0-4 [--parent <id>] --body-file /tmp/pb_<x>.md --silent
bd dep add <A4> <A1> --type blocks   # A1 blocks A4
bd dep add <B4> <B1> --type blocks   # B1 blocks B4
bd dep add <B4> <B3> --type blocks   # B3 blocks B4
```

---

## Verification & sequencing

- Land **A1 first** (core stall fix); A2/A3/A4/A5 are parallel-safe after.
- Phase A and Phase B are independent; B4 last (depends on B1, B3).
- Per repo policy, bump the patch (`zz` in `xx.yy.zz`) in `package.json`, `manifest.json`, `options.html` once code lands.
- Gates: `npm run typecheck`, `npm run lint`, `npm run test`.
