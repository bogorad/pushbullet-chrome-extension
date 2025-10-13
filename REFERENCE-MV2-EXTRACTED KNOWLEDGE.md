<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# correction: instead of oauth2 login it will use Access Tokens generated via pushbullet website.

Understood: authentication will use Access Tokens created on the Pushbullet website, entered by the user in the extension’s UI and sent as Authorization: Bearer <token> (or equivalent) on every API call, with users/me used to validate and bootstrap the session. All other features remain at full parity, including end‑to‑end encryption, real‑time streaming, SMS/MMS, file uploads, Android notification mirroring with actions, grouped notifications, context menus, keyboard commands, diagnostics, and robust retry/backoff behavior, now re‑architected for Manifest V3 service worker lifecycles and, where needed, an offscreen document for DOM‑bound tasks and stable sockets.[^1][^2][^3][^4]

### Objectives and constraints

- Full parity with the legacy extension: devices, pushes (note/link/file), SMS/MMS, Android mirroring with actions and quick‑reply, grouped notifications, context menus, keyboard shortcuts, cursor‑based sync, logs upload, and complete E2E encryption framing and UX, unchanged in behavior where feasible.[^4]
- MV3 compliance and resilience: replace the persistent background page with a service worker, adopt alarms and storage semantics for wake/sleep safety, use improved MV3 WebSocket support and/or an offscreen document to host long‑lived connections and progress events, and minimize permissions while preserving functionality.[^5][^3]


### Authentication with Access Tokens

- Token entry and validation: provide an Options page field for pasting a Pushbullet Access Token created via the Pushbullet website’s Account Settings, then validate by calling v2/users/me, storing success and beginning bootstrap if authorized.[^6][^2]
- HTTP headers and usage: authenticate all REST and streaming calls using Authorization: Bearer <access_token> or Access‑Token, ensuring HTTPS and JSON bodies for POSTs per Pushbullet API guidance.[^2][^1]
- Token lifecycle: handle rotation and revocation by monitoring 401 responses, performing sign‑out, tearing down stream/sync/queues, and prompting for a new token with a clear UI, without relying on site cookies or OAuth2 flows.[^2][^4]


### System architecture (MV3)

- Core runtime: a service worker hosts an internal event bus, storage layer, HTTP client, crypto (E2E), cursor sync, stream connection controller, push/file queues, SMS/chats controller, mirroring and notifications, context menus, keyboard handlers, and diagnostics/log‑request responders, all communicating via semantic events to preserve decoupling and sequencing.[^4]
- Long‑lived contexts: leverage MV3 WebSocket improvements to keep the worker alive via active messaging when possible, and use an offscreen document to host WebSocket and upload progress in environments where worker suspension would otherwise sever connections or lose DOM‑based progress callbacks.[^3][^5]


### Process boundaries and messaging

- Worker ↔ Offscreen: the service worker owns orchestration and durable state, while the offscreen page maintains the WebSocket and XHR uploads when required; bi‑directional runtime messaging transports stream events, progress updates, and control requests (connect, reconnect, pause).[^7][^3]
- Worker ↔ UI: the action popup, chat windows, quick‑reply views, and options pages subscribe to store slices and dispatch user intents using structured runtime messages with acknowledgements and clear error payloads.[^4]


### Data model and storage

- Entities and mirrors: persist devices, chats, grants, subscriptions, channels, pushes, texts, and auxiliary maps (successful/failed pushes, SMS GUIDs, pendingMirrors, visibleGroups), using chrome.storage.local with versioned migrations and write‑through notifications for reactive UI updates.[^4]
- Cursor and pruning: maintain the server’s sync cursor and prune pushes per stream to bounded counts while normalizing link schemes as in the legacy code to keep storage tight and UI stable.[^4]


### HTTP client and endpoints

- Client behavior: implement get/post/del with timeouts, JSON parsing, Authorization: Bearer headers, X‑User‑Agent string, structured 200/400 errors, and 401→sign‑out wiring to prevent cascading failures across modules.[^2][^4]
- Endpoints: v2/users/me, v2/sync, v2/devices (create/update), v2/pushes (create/dismiss), v3/start‑upload, v3/finish‑upload, v2/ephemerals for actions/replies, and v2/error‑report for diagnostics, maintaining request/response shapes compatible with existing behaviors.[^4]


### Real‑time streaming

- Ownership and keepalive: on Chrome 116+ the worker can hold a WebSocket and stay alive by exchanging periodic messages; otherwise, host the WebSocket in the offscreen page to ensure continuity and then relay events to the worker.[^8][^5]
- Heartbeats and reconnects: process “nop” heartbeats, record lastNop, run a watcher interval, and reconnect with exponential backoff, fully tearing down prior sockets to avoid dual streams or duplicate event processing.[^4]


### Cursor‑based sync

- Delta ingestion: call v2/sync with a saved cursor, ingest devices/chats/subscriptions/channels/pushes/texts, decrypt protected payloads as needed, and write normalized entities into storage, triggering UI updates and pruning policies.[^4]
- Recovery path: on invalidcursor, clear local mirrors and cursor, then re‑bootstrap via users/me and initial sync to restore consistency without manual intervention.[^4]


### Push sending

- Queueing semantics: enqueue pushes with GUIDs and queued state, run a single‑flight processor to POST v2/pushes, mark success in successfulPushes or register failedPushes for UI retry, ensuring idempotence across worker wakes.[^4]
- Entry points: panel composition, context menus deriving content from selection/link/page, and keyboard commands for instant push of the current tab with note/link heuristics as before.[^4]


### File uploads

- Choreography: use v3/start‑upload to get pieceurls/piecesize, sequentially PUT chunk slices with progress updates, and finalize via v3/finish‑upload to obtain file metadata embedded in the enclosing push.[^4]
- Progress and cancellation: implement XHR progress events in the offscreen document with an xhrs map for abort, fail fast on errors, reset queue flags, and continue robustly with subsequent items.[^3][^4]


### SMS and chats

- Threads and messages: load SMS‑capable device threads and a thread’s messages, respect MMS capabilities and image preprocessing, and propagate delivery states and errors through smschanged events to keep chat windows synchronized.[^4]
- Sending and quotas: format recipients, send via the device bridge, and surface upgrade cues based on replycountquota while maintaining full E2E coverage for text payloads where applicable.[^4]


### Android notification mirroring

- Rendering and dedupe: map mirror and dismissal pushes into Chrome notifications with icons, title/body, timestamps, action buttons, compute stable notificationKey to de‑duplicate, and suppress while chat windows are focused.[^4]
- Actions and replies: implement mute/unmute/dismiss/quick‑reply by sending ephemeral messages to v2/ephemerals, encrypting payloads when E2E is enabled, and reconciling pendingMirrors state to avoid duplicate UX.[^4]


### Notifications and UX rules

- Grouping and behavior: group by party or stream and render single vs list notifications, suppress in‑conversation alerts when a focused chat window exists, and wire clicks to open the most relevant resource or party page.[^4]
- Dismissal synchronization: when appropriate, mark pushes dismissed via v2/pushes/{iden} dismissed=true on close to keep server and local state aligned.[^4]


### End‑to‑end encryption (E2E)

- Algorithms and framing: derive AES‑GCM keys via PBKDF2 from a user password, frame ciphertext as [version, tag, iv, ciphertext] in Base64, and decrypt incoming stream/sync payloads before dispatching to consumers.[^4]
- Device fingerprinting and UX: include keyfingerprint in device updates, gate protected actions/views until a password is configured, and show explicit “password needed” notifications and flows without leaking plaintext.[^4]


### Timers, alarms, and lifecycle

- Periodic tasks: use chrome.alarms for sync cadence, reconnect backoff caps, and telemetry flushes so tasks resume after worker suspensions, respecting MV3 lifecycle constraints and minimum periods on modern Chrome.[^8][^4]
- Short timers: limit setTimeout/setInterval to active contexts (worker or offscreen) and clear them on teardown to avoid leaks or orphaned operations across reconnects.[^3][^4]


### Concurrency and race conditions

- Single‑flight queues: guard push/file queues with processing flags and durable queue heads to prevent double sends across wake cycles or overlapping instances in complex lifecycles.[^4]
- Device attach/create race: prevent parallel operations with inProgress and retryBackoff, deterministically selecting an existing matching browser device or creating one when needed to avoid duplication.[^4]
- Stream reconnects: always close prior sockets and cancel heartbeat intervals before reconnect, stretching heartbeat tolerance temporarily after parse errors to dampen flapping on shaky networks.[^4]


### Error handling and resilience

- HTTP outcomes: return structured error objects on 400 timeouts for UI retry affordances, and trigger sign‑out on 401 to immediately halt dependent features until re‑authentication with a new Access Token.[^2][^4]
- Sync and uploads: treat invalidcursor as a hard reset via clear‑and‑bootstrap, and on upload errors abort all active chunks, mark failed, reset flags, and proceed with the next queue item to avoid deadlocks.[^4]


### Manifest and permissions

- Manifest entries: background.service_worker, action popup, host_permissions for Pushbullet API domains, and permissions including storage, notifications, contextMenus, tabs, activeTab, alarms, offscreen (if used), downloads, and clipboard for parity features.[^3][^4]
- MV3 guards: set minimum_chrome_version to a version with improved WebSocket lifetimes (Chrome 116+) if relying purely on worker‑owned sockets, or use offscreen for sockets/uploads to broaden compatibility.[^5][^8]


### Security and privacy

- Token handling: accept user‑pasted Access Tokens, store in chrome.storage.local with least privilege access and no logging, and consider optional OS keystore via native messaging only if explicitly planned later; never fetch tokens from cookies.[^2][^4]
- E2E protections: minimize clear‑key residency in memory, prefer SubtleCrypto where available, and decrypt only when necessary for rendering or actions, redacting sensitive content in diagnostics.[^4]


### Observability and diagnostics

- Rolling logs and logrequest: maintain bounded logs in storage and respond to a logrequest push by uploading to v2/error‑report with environment/version metadata while excluding secrets and plaintext content.[^4]
- Metrics: track queue latencies, reconnect attempts, invalidcursor frequency, upload error classes, and E2E failures to guide stability work during rollout and operation.[^4]


### Testing and validation

- Unit tests: http client behaviors, crypto framing and vectors, queues and state transitions, pruning logic, and device fingerprinting edge cases.[^4]
- Integration tests: bootstrap with token, device attach/update, sync with paging and invalidation, stream heartbeats and reconnects, mirroring with actions and quick‑reply, file upload start/chunk/finish flows, and SMS/MMS end‑to‑end.[^4]
- UI tests: panel compose, chat windows, notification grouping and behaviors, context menus on varied pages, keyboard shortcuts under active/focused conditions, and E2E password UX.[^4]


### MV2→MV3 comparison

| Topic | MV2 legacy | MV3 rewrite |
| :-- | :-- | :-- |
| Background | Persistent page [^4] | Service worker with alarms; optional offscreen document for DOM and long‑lived connections [^3] |
| WebSocket | Always‑alive in background [^4] | Worker‑owned with keepalive on Chrome 116+, or offscreen‑owned for continuity and progress routing [^5] |
| Timers | setInterval/setTimeout everywhere [^4] | chrome.alarms for periodic; short timers only in active contexts [^8] |
| Storage | localStorage mirrors [^4] | chrome.storage.local with versioned schema [^4] |
| Auth | Cookie/API‑key heuristics [^4] | User‑pasted Access Token with users/me validation [^2] |
| Upload progress | XHR in background [^4] | XHR in offscreen; progress to worker via messaging [^3] |

### High‑level rewrite plan

- Phase 1: Foundation and schema
    - Implement event bus, storage wrapper with versioned schema and migrations, HTTP client with Authorization: Bearer and structured errors, and crypto module reproducing PBKDF2 AES‑GCM framing and fingerprinting.[^2][^4]
- Phase 2: Auth and bootstrap
    - Build Options UI for Access Token entry, validate via users/me, persist user, dispatch signedin, and wire phase‑ordered startup signals in the worker.[^2][^4]
- Phase 3: Streaming and lifecycle
    - Implement WebSocket client in worker with keepalive on Chrome 116+ or in offscreen with messaging bridge, heartbeat watcher, and exponential backoff reconnects with safe teardown.[^5][^3]
- Phase 4: Cursor sync
    - Implement v2/sync ingestion, typed merges, decrypt‑on‑ingest where needed, pruning, and invalidcursor recovery with clear‑and‑bootstrap.[^4]
- Phase 5: Pushes and notifications
    - Implement push queue, panel compose, context menus, keyboard commands, notifier with grouping/suppression rules, and dismissal synchronization.[^4]
- Phase 6: File uploads
    - Implement start‑upload/chunk PUT/finish‑upload choreography with offscreen XHR progress, cancellations, and robust failure recovery.[^3][^4]
- Phase 7: SMS/MMS and chats
    - Implement threads/messages loading, compose with MMS attachments, quotas display, chat windows parity, and smschanged synchronization.[^4]
- Phase 8: Mirroring and ephemerals
    - Implement mirror rendering, notificationKey dedupe, mute/unmute/dismiss/reply actions via v2/ephemerals, and E2E envelopes for protected actions.[^4]
- Phase 9: Diagnostics and hardening
    - Implement logrequest→error‑report upload, stability metrics, fuzz wake/suspend, race audits, cross‑browser verification, and canary rollout gates.[^4]


### ADRs (selected)

- Event‑bus orchestration: keep pb‑style semantic events to decouple modules and govern startup, wake, and teardown ordering across MV3 suspensions.[^4]
- Streaming host selection: prefer worker‑owned sockets on Chrome 116+ due to improved lifetime behavior; otherwise host socket in offscreen to ensure reliability and progress callbacks, abstracted behind the same connection contract.[^5][^3]
- Access Token auth: remove cookie/OAuth flows, require user‑pasted Access Token, validate via users/me, and guard all calls with Authorization headers, simplifying re‑auth UX and code paths.[^1][^2]
- Durable queues: serialize push/file work with single‑flight guards and durable queue heads to prevent duplicate sends across wake cycles and reconnections.[^4]
- E2E framing and UX: preserve PBKDF2 AES‑GCM framing, fingerprint propagation, and password‑needed UX, decrypting before re‑emitting events to consumers for consistent behavior.[^4]


### Acceptance criteria

- Authentication: users/me succeeds with a pasted Access Token, failure surfaces actionable UI, and 401 anywhere triggers sign‑out and teardown reliably.[^2][^4]
- Streaming: heartbeats and reconnects survive worker suspensions, never run dual sockets, and deliver ephemerals and pushes with correct ordering and no duplication.[^5][^4]
- Sync: deltas ingest correctly with pruning and invalidcursor recovery, and local mirrors remain consistent across upgrades and suspensions.[^4]
- Deliveries: pushes, SMS/MMS, and file uploads show accurate queued/inflight/succeeded/failed states, with retry affordances and correct notification grouping and suppression.[^4]
- E2E: encrypted payloads decrypt correctly, missing/invalid keys produce clear UX, and device keyfingerprint propagates as expected.[^4]

This plan preserves the legacy product’s behavior while adapting it to MV3’s lifecycles, adopting user‑pasted Access Tokens for authentication and modern Chrome capabilities for resilient streaming, background work, and secure state management across all features including end‑to‑end encryption and Android notification mirroring with actions and quick‑reply.[^3][^2]
<span style="display:none">[^10][^11][^12][^13][^14][^15][^16][^17][^18][^19][^20][^21][^9]</span>

<div align="center">⁂</div>

[^1]: https://docs.pushbullet.com/v10

[^2]: https://docs.pushbullet.com/v7

[^3]: https://developer.chrome.com/blog/Offscreen-Documents-in-Manifest-v3

[^4]: repomix-output.xml

[^5]: https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets

[^6]: https://www.pushbullet.com/api

[^7]: https://developer.chrome.com/docs/extensions/reference/api/offscreen

[^8]: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

[^9]: https://docs.pushbullet.com/v1

[^10]: https://api.docs.cpanel.net/openapi/whm/operation/send_test_pushbullet_note/

[^11]: https://github.com/w3c/webextensions/issues/170

[^12]: https://api.docs.cpanel.net/openapi/cpanel/operation/send_test_message/

[^13]: https://sites.google.com/site/jmaathuis/openwrt/ash-bash/ip-logger/ip-logger-page1

[^14]: https://stackoverflow.com/questions/68966727/maintaining-a-persitant-connection-in-a-mv3-chrome-extension

[^15]: https://www.gitguardian.com/remediation/pushbullet-api-key

[^16]: https://stackoverflow.com/questions/76610531/how-to-debug-offscreen-page-in-chrome-extension-manifest-v3

[^17]: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/23pCzk69Ueo

[^18]: https://www.home-assistant.io/integrations/pushbullet/

[^19]: https://issues.chromium.org/40849649

[^20]: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/6T3BqCveSXk

[^21]: https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/detectors/specifics/pushbullet_api_key

