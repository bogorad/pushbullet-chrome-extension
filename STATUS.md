# Pushbullet Chrome Extension – Reconnect Reliability Plan

Last updated: 2025-10-02 (post-interval + notifications + modules + version bump)
Owner: Eugene (Chuck) Bogorad

## Goals
- Survive MV3 service worker restarts: reliably reconnect to WebSocket without user action
- Reconnect on transient network/server closures using alarms (no tight loops)
- Surface permanent errors; avoid silent failure

## Plan (Tasks)
1. Add ensureConfigLoaded(): Rehydrate apiKey and essential settings from storage when missing
2. Alarm handler: On websocketReconnect and websocketHealthCheck, call ensureConfigLoaded() first; attempt reconnect if needed
3. On close: Schedule 30s one-shot reconnect alarm; auto-reschedule while disconnected; enter polling mode as designed
4. On open: Clear reconnect alarm to stop periodic attempts; reset counters
5. Disconnect behavior: Do not clear reconnect alarm in disconnectWebSocket(); leave safety net active during in-progress connects
6. getSessionData: If worker woke without apiKey or session cache, rehydrate and initialize session; ensure popup always recovers connection
7. Health check: Ensure rehydration precedes connectivity checks; reconnect if not OPEN
8. Validate: Manual run-through (as much as possible), review logs for expected flow

## Status
- 1: COMPLETE (ensureConfigLoaded() implemented)
- 2: COMPLETE (alarms rehydrate + reconnect)
- 3: COMPLETE (30s one-shot reconnect alarm on close, auto-reschedules)
- 4: COMPLETE (clear reconnect alarm on open)
- 5: COMPLETE (do not clear alarm in disconnectWebSocket)
- 6: COMPLETE (popup wake-up rehydrates and initializes)
- 7: COMPLETE (health check rehydrates before decision)
- 8: Pending (manual validation)

## Module split (Phase 1)
- Extracted into modules:
  - js/logging.js (DEBUG_CONFIG, DebugLogger, DebugConfigManager, GlobalErrorTracker)
  - js/performance.js (PerformanceMonitor)
  - js/monitoring.js (InitializationTracker, WebSocketStateMonitor)
  - js/reconnect.js (ensureConfigLoaded)
  - js/notifications.js (notification helpers, badge + permanent error, auto-dismiss)
- background.js imports these modules and the corresponding in-file blocks were removed.

## UI/Version updates
- Debug Dashboard: Auto-refresh toggle moved to header (“Auto-refresh: Enabled (every 2s)”).
- Version bump: manifest.json to 1.0.28; package.json to 1.0.1.
## Module split (Phase 2)
- Extracted API utilities to js/api.js: fetchUserInfo, fetchDevices, fetchRecentPushes, registerDevice, updateDeviceNickname
- Extracted session state/initializer to js/session.js: sessionCache, initializeSessionCache
- background.js now imports js/api.js and js/session.js and the original blocks are removed
- Manifest version bumped to 1.0.29



## Notes
- Keep logging as-is; goal is correctness, not reduced verbosity
- Phase 2 complete: API + Session modules extracted and wired; background.js cleaned up orphaned WebSocket fragment; new js/websocket.js owns connectWebSocket
- Version bump: manifest.json to 1.0.30; package.json to 1.0.3

- Permanent WS codes (1008/4001/4xxx): stop retries and surface cause

