# Wake And SMS Reliability

Implemented the Beads plan for post-sleep wake recovery and SMS visibility in the Chrome extension. The service worker now replaces unhealthy half-open WebSocket connections, re-arms recovery alarms, listens for `chrome.idle` wake signals, and uses a nop watchdog to force reconnects when the stream goes stale.

SMS handling now preserves ephemeral SMS/mirror pushes across refreshes, prompts when encrypted SMS arrives without an E2EE password, resolves eligible `sms_changed` events through Pushbullet SMS history, and exposes received/shown/drop counters in the debug dashboard.

After roborev review, the SMS-history fallback was made conservative: it selects a correlated SMS-capable device and requires the fetched message timestamp to match the tickle window, avoiding stale or wrong-thread notifications from empty `sms_changed` events.

Project instructions now explicitly require `record-activity` notes in the repo-root `activity/` directory after material changes.
