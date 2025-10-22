# ADR 0005: Service Worker State Machine

**Status:** Superseded by ADR-0006

**Date:** 2025-10-20

**Context:**

The Manifest V3 service worker has a non-persistent, event-driven lifecycle. It can be terminated by Chrome after ~30 seconds of inactivity and is restarted in response to events like alarms, user actions, or messages. This makes managing application state (e.g., "am I connected?", "am I initializing?") complex and prone to race conditions. Simple boolean flags (`isInitializing`, `isPolling`) are insufficient and lead to invalid or inconsistent states.

We need a robust, predictable, and centralized way to manage the service worker's lifecycle state.

**Decision:**

We will implement a formal State Machine pattern to manage the service worker's lifecycle. This state machine will be the single source of truth for the extension's operational state.

**States:**

- `IDLE`: The initial state. No API key is present, or the user has logged out. The extension is inactive.
- `INITIALIZING`: An API key is present, and the extension is performing its initial setup. This involves fetching user data, devices, and pushes from the API.
- `READY`: The extension is fully authenticated, has its session data loaded, and is connected to the real-time WebSocket stream. This is the optimal operational state.
- `DEGRADED`: The WebSocket connection has been lost. The extension will fall back to periodic polling (e.g., every 1 minute) to fetch new pushes. It will periodically attempt to reconnect to the WebSocket.
- `RECONNECTING`: A specific sub-state of `DEGRADED` where an active attempt to re-establish the WebSocket connection is in progress.
- `ERROR`: An unrecoverable error has occurred (e.g., an invalid API key). The extension will cease all operations until the user takes action (e.g., re-logins).

**Events and Transitions:**

The state machine will respond to a set of defined events to transition between states.

- `API_KEY_SET`: Moves from `IDLE` to `INITIALIZING`.
- `INIT_SUCCESS`: Moves from `INITIALIZING` to `READY`.
- `INIT_FAILURE`: Moves from `INITIALIZING` to `ERROR`.
- `WS_CONNECTED`: Moves from `DEGRADED` or `RECONNECTING` to `READY`.
- `WS_DISCONNECTED`: Moves from `READY` to `DEGRADED`.
- `ATTEMPT_RECONNECT`: Moves from `DEGRADED` to `RECONNECTING`.
- `WS_PERMANENT_ERROR`: Moves from any state to `ERROR`.
- `LOGOUT`: Moves from any state to `IDLE`.

**Implementation Details:**

- The state machine will be implemented as a class (`ServiceWorkerStateMachine`) in `background/state-machine.ts`.
- The current state will be persisted to `chrome.storage.local` on every transition. On service worker startup, the state machine will hydrate itself from this stored value to maintain continuity.
- The state machine will use a callback system to trigger side effects (e.g., `onInitialize`, `onStartPolling`, `onConnectWebSocket`) without being tightly coupled to the background script's implementation details.
- All initialization logic, whether triggered by browser startup or a UI event, will be funneled through a single, coordinated function (`orchestrateInitialization`) that is managed by a singleton promise to prevent race conditions.

**Consequences:**

- **Pros:**
  - **Predictability:** Eliminates invalid state combinations and makes the extension's behavior easy to reason about.
  - **Centralization:** All lifecycle logic is in one place, not scattered across multiple event listeners.
  - **Resilience:** Provides a clear framework for handling errors, disconnections, and recovery.
  - **Testability:** The state machine can be tested in isolation.
- **Cons:**
  - Adds a layer of abstraction and initial boilerplate code.

---

**UPDATE (2025-10-22):** This ADR is now superseded by **ADR-0006**, which refines the initialization flow. The core state machine remains, but its interaction with the startup process is now governed by a cache-first strategy. The `INITIALIZING` state is now primarily entered only when this cache is stale or missing.
