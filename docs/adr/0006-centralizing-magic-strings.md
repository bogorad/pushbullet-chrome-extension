# ADR 0006: Cache-First Startup and Session Hydration

**Status:** Accepted

**Date:** 2025-10-22

**Context:**

The previous architecture (ADR-0005) initiated a full network-based initialization on every service worker startup. Log analysis revealed two critical performance issues:

1.  **Slow Popup Opening:** When the service worker was terminated due to inactivity, opening the popup would trigger a full, blocking re-initialization, taking 2-3 seconds and making the UI feel unresponsive.
2.  **Startup Race Condition:** A browser startup could trigger a slow background initialization. If the user opened the popup during this time, a second, concurrent initialization would be triggered, leading to redundant API calls and unpredictable state.

We need a startup mechanism that prioritizes instant UI responsiveness and prevents redundant initialization processes.

**Decision:**

We will adopt a **"cache-first" hydration strategy** for all initialization triggers, managed by a **singleton promise** to prevent race conditions.

1.  **Unified Initialization Entry Point:** All events that require session initialization (e.g., `onStartup`, `onInstalled`, `getSessionData` from the popup) will call a single function: `orchestrateInitialization`.

2.  **Singleton Promise Wrapper:** The `orchestrateInitialization` function will be wrapped with a singleton promise (`initPromise`).
    - The first call to this function creates and registers a global promise.
    - Subsequent calls while the first is in progress will not start a new process but will instead `await` the completion of the existing promise.
    - The promise is always cleared in a `finally` block to ensure the system can recover from errors.

3.  **Cache-First Hydration Logic:** Inside `orchestrateInitialization`, the following sequence will occur:
    - **Step 1: Load from Cache.** Attempt to load the full `SessionCache` object from IndexedDB.
    - **Step 2: Check Freshness.** Check the `cachedAt` timestamp of the loaded cache. If it is within a defined Time-To-Live (TTL, e.g., 5 minutes), the cache is considered "fresh."
    - **Step 3a (Fast Path):** If the cache is fresh, instantly hydrate the in-memory `sessionCache` with the data from IndexedDB. The function then returns immediately, unblocking the UI. A non-blocking, "fire-and-forget" background refresh (`refreshSessionInBackground`) is initiated to update the cache silently.
    - **Step 3b (Slow Path):** If the cache is missing, stale, or invalid, proceed with the original full network initialization (fetching user, devices, pushes, etc.).
    - **Step 4 (Slow Path):** After the network fetch is complete, save the newly populated `sessionCache` back to IndexedDB with an updated `cachedAt` timestamp.

**Consequences:**

- **Pros:**
  - **Massive Performance Gain:** Popup opening time for active users (with a fresh cache) will decrease from several seconds to under 100ms.
  - **Reduced API Load:** The number of API calls will be drastically reduced, as network fetches are only performed when the cache is stale or during a background refresh.
  - **Race Condition Eliminated:** The singleton promise ensures that no matter how many events fire, only one initialization process will run at a time.
  - **Improved User Experience:** The extension will feel significantly more responsive and reliable. The UI is no longer blocked by network latency.
- **Cons:**
  - **Data Latency:** Users might briefly see data that is up to 5 minutes old. This is an acceptable trade-off for the massive performance gain. The background refresh mechanism mitigates this by updating the data shortly after the UI is displayed.
  - **Increased Complexity:** The startup logic is now more complex, involving cache validation and two distinct paths (fast/slow).

**Diagram of New Flow:**

                               +---------------------------+
                               |   Initialization Trigger  |
                               | (Startup, Popup Open, etc.)|
                               +-------------+-------------+
                                             |
                                             v
                               +---------------------------+
                               | orchestrateInitialization()|
                               +-------------+-------------+
                                             |
                                             v
                                 +-----------------------+
                                 | Is Init Promise Set?  |
                                 +-----------+-----------+
                                             |
                                     /---------------\
                                    | YES             | NO
                                    v                 v
                         +-----------------+   +----------------------+
                         | await existing  |   | setInitPromise()     |
                         | promise         |   +----------------------+
                         +-----------------+               |
                                                           v
                                               +-----------------------+
                                               | Load Cache from DB    |
                                               +-----------+-----------+
                                                           |
                                                   /---------------\
                                                  | YES             | NO (Stale/Missing)
                                                  v                 v
                                       +-----------------+   +----------------------+
                                       | HYDRATE (FAST)  |   | NETWORK INIT (SLOW)  |
                                       | - Use cache     |   | - Fetch from API     |
                                       | - Return        |   | - Save to DB         |
                                       | - Start bg sync |   +----------------------+
                                       +-----------------+
