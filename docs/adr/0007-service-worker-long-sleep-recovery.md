# ADR 0007: Service Worker Long Sleep Recovery via Alarms and Manual Trigger

## Status
Accepted

## Context
Chrome MV3 service workers terminate after ~30s inactivity. Long browser sleep (hibernation >1h) causes alarms to coalesce/skip, leaving extension in IDLE/ERROR state on wake (no WS reconnection). Users report \"extension not waking up\".

Constraints:
- No persistent execution (SW model).
- Alarms min 30s, throttled during sleep.
- IndexedDB/session state survives restarts.

Forces:
- Reliability: Auto-recovery without user action.
- UX: Manual \"Force Wake\" for edge cases.
- Debug: Log downtime >1h for monitoring.

## Decision
1. **Periodic Recovery Alarm**: `longSleepRecovery` (5min period, created onStartup). Triggers `ATTEMPT_RECONNECT` if IDLE/ERROR + has API key.
2. **Downtime Detection**: startup.ts checks `Date.now() - cachedSession.cachedAt > 1h` → log WARN, force full reinit.
3. **Manual Force Wake**: Options page button → `chrome.runtime.sendMessage({action: 'attemptReconnect'})`.
4. **State Machine Integration**: Transitions handle recovery idempotently.

Implementation:
- Alarms in background/index.ts:onStartup/onAlarm.
- Cache timestamp check in startup.ts:isCacheFresh.
- Button + handler in options.html/index.ts → background message.

## Consequences

### Pros
- Reliable wake-up post long sleep (alarms resume).
- Detects/logs downtime for debugging.
- Manual override for stubborn cases.
- No perf impact (periodic, conditional).

### Cons
- Alarm battery drain (mitigated: 5min, low-work).
- Race if multiple alarms fire (handled by state machine guards).

### Neutral
- Increases alarm count (negligible).
- Requires SW hydration for deviceIden/API key.