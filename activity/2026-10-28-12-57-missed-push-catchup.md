# Missed-push catch-up on reconnect

Decision: Reuse the existing incremental `refreshPushes()` path for catch-up instead of adding a new fetch pipeline, alarms, or seed logic.

Change: Added single-flight `runMissedPushCatchUp()` in `src/background/utils.ts`; it skips without side effects when no API key or no persisted cursor is hydrated, otherwise delegates to `refreshPushes()`. The `websocket:connected` handler in `src/background/index.ts` now awaits the `WS_CONNECTED` transition and, only when state is READY, invokes the catch-up with the shared `notificationDataStore`. Added `tests/background/missed-push-catchup.test.ts` covering missed pushes notified once, cursor advancement, no duplicates on a second run, single-flight, and the no-key/no-cursor skips. Bumped patch version to 1.5.24.

Reason: After prolonged inactivity the socket reconnected but nothing fetched pushes missed while disconnected, so their notifications never appeared. The tickle path already fetched incrementally on live pushes; running the same path once on connect closes the gap without duplicating notification, processed-marker, or cursor logic.
