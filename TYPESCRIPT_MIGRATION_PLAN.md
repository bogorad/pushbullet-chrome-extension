# Pushbullet Chrome Extension — TypeScript Migration Plan (Live)

This document is the live PRD, architecture brief, and step-by-step migration plan to move the codebase to TypeScript. It will be updated continuously as work proceeds. Status badges and checklists are authoritative.

## 1) Executive Summary
- Goal: Migrate the MV3 extension from JS to TypeScript with stronger types, safer refactors, and a reproducible build.
- Approach: Introduce TS toolchain, define shared types, migrate module-by-module behind a single build, validate with lint/tests, then cut over in manifest to compiled outputs.
- Constraints: MV3 service worker, Chrome APIs, no breaking user data, minimal disruption, incremental migration with backward-compatible runtime behavior.

## 2) Current Status (Live)
- 2025-10-02: Baseline restored — background.js reset to last committed state. ESlint shows style and global warnings (expected), no parser errors from our recent edits. Minimal fix done.
- Next: Draft TS plan (this file), then set up tooling pending approval to install dev deps.

## 3) Product Requirements (PRD)
### 3.1 Goals
- Strengthen maintainability and correctness via TypeScript types and stricter linting.
- Preserve existing user-visible functionality and MV3 behaviors.
- Establish a fast, deterministic build pipeline (esbuild or equivalent) for SW and UI code.
- Improve debugging: source maps, structured logging types, better modular boundaries.

### 3.2 Non-Goals
- Feature changes unrelated to typing/structure.
- Major UX changes in popup/options.
- Server/API contract changes.

### 3.3 Success Metrics
- 2025-10-02: Phase 0 complete and baseline lint fixed (0 errors). Added tsconfig.json and initial src/types/domain.ts scaffolding.

- Build produces type-checked artifacts with 0 TS errors.
- No regressions in core flows: authentication, WebSocket streaming, pushes, notifications.
- Reduced runtime class of bugs (undefined access, shape mismatches) caught at compile time.

### 3.4 Constraints & Risks
- MV3 service worker lifecycle: keep imports light, avoid large bundling overhead.
- Chrome APIs typing: rely on @types/chrome.
- Mixed globals: current modules share state; we must introduce explicit module boundaries and typed singletons.
- Testing: ensure basic smoke validation on Chrome stable.

## 4) Current Architecture Overview (as-is)
- manifest.json: MV3 config, permissions, background service worker script, icons.
- background.js: Primary orchestrator (WS connect/reconnect, alarms, session cache updates, notifications routing, popup messaging, context menu, storage listeners).
- js/api.js: REST calls (users, devices, pushes, register/update device); uses global apiKey/sessionCache.
- js/session.js: Session cache structure and initialization helpers.
- js/crypto.js: E2EE crypto helpers (decrypt push, etc.).
- js/logging.js: Debug logger, config manager, categories.
- js/monitoring.js: InitializationTracker, WebSocketStateMonitor; connection/perf tracking.
- js/performance.js: PerformanceMonitor; timing and counters.
- js/notifications.js: Notification helpers, timeouts, permanent-error UI.
- js/reconnect.js: Reconnect policies and helpers.
- js/popup.js: Popup UI logic; interacts with background via messages.

Notes: background.js still uses global variables shared with modules via importScripts. This will be refactored to explicit imports once TypeScript and bundling are in place.

## 5) Target Architecture (TypeScript)
- src/types/*.ts: Shared domain types (Push, Device, User, SessionCache, WebSocketState, etc.).
- src/env/chrome.d.ts: Chrome API types via @types/chrome; ambient declarations for MV3.
- src/lib/logging/*.ts: Logger + config types, categories, safe structured fields.
- src/lib/perf/*.ts: Performance monitor with typed metrics.
- src/lib/monitoring/*.ts: Init/WebSocket state trackers.
- src/lib/crypto/*.ts: E2EE crypto helpers with typed inputs/outputs.
- src/app/api/*.ts: REST client; typed endpoints and responses.
- src/app/session/*.ts: Session cache and rehydration.
- src/app/ws/*.ts: WebSocket client with typed message handling.
- src/app/notifications/*.ts: Notification helpers and flows.
- src/background/index.ts: Service worker composition root; wires modules.
- src/popup/*.ts(x): Popup scripts (optional TSX if we modernize later; for now TS).
- build: esbuild-based pipeline emitting dist/*.js with source maps.

## 6) Tooling Plan (pending approval to install dev deps)
Proposed dev dependencies:
- typescript, ts-node (scripts), esbuild, esbuild-plugin-copy (for assets), @types/chrome, @types/node, eslint, @typescript-eslint/parser, @typescript-eslint/eslint-plugin.
Rationale: esbuild is fast, handles MV3 SW target, easy to wire copy tasks. We will ask permission before installing.

## 7) Migration Strategy (Phased)
- Phase 0 (Baseline):
  - [x] Reset background.js to last committed version (completed 2025-10-02).
  - [ ] Capture current behavior snapshots (logs, screenshots) as needed.
- Phase 1 (Scaffold):
  - [ ] Add TS config (tsconfig.json) with strict settings; include MV3 target (ES2022).
  - [ ] Add esbuild scripts to package.json for background and popup bundles.
  - [ ] Add typings (@types/chrome) and minimal eslint config for TS.
  - [ ] Do not modify runtime wiring yet.
- Phase 2 (Types & Adapters):
  - [ ] Define domain types: Push, Device, User, RecentPush, SessionCache, WS enums.
  - [ ] Create thin typed wrappers around Chrome APIs where helpful (optional).
- Phase 3 (Module Migrations — low risk first):
  - [ ] logging.ts, performance.ts, monitoring.ts (internal libs with minimal Chrome impact).
  - [ ] crypto.ts (ensure browser-compatible crypto APIs; keep same behavior).
- Phase 4 (Core App Migrations):
  - [ ] api.ts (typed fetch, response guards; no behavioral change).
  - [ ] session.ts (sessionCache, init/rehydrate typed; explicit return values).
  - [ ] notifications.ts (strict types for options and flows).
- Phase 5 (WebSocket & Background Composition):
  - [ ] ws.ts (typed message union, handlers, reconnection policy preserved).
  - [ ] background/index.ts (compose modules, typed message router and alarms).
- Phase 6 (Popup):
  - [ ] popup scripts to TS; add types for message contracts.
- Phase 7 (Cutover):
  - [ ] Update manifest.json to point to dist background service worker.
  - [ ] Smoke test, fix issues, tighten lint.

## 8) Backward Compatibility & Validation
- Maintain identical manifest permissions and behaviors.
- Produce source maps to aid debugging parity.
- Incremental migration: each phase must build and run without breaking core flows.
- Validation gates per phase:
  - Build succeeds, ESLint passes (or warnings only for style).
  - WebSocket connects/reconnects; push notifications show; popup interactions work.

## 9) Testing Strategy
- Unit-level where feasible (pure helpers/types).
- Integration smoke for background SW:
  - WebSocket connect, tickle(push) -> refresh; push -> notification.
  - Storage changes -> state updates; alarms trigger reconnect.
- Automated lint/type checks in CI.

## 10) Operational Notes
- Installing tooling requires explicit approval. Proposed commands (do not run yet):
  - npm install -D typescript esbuild esbuild-plugin-copy @types/chrome @types/node eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
  - Dev dependencies installed: typescript, esbuild, esbuild-plugin-copy, @types/chrome, @types/node, @typescript-eslint/parser, @typescript-eslint/eslint-plugin.
  - Scripts added: build, build:background, build:popup, typecheck. Initial build produces dist/background.js and dist/popup.js (placeholders).

- Windows line endings: align ESLint to allow CRLF or configure .editorconfig.

## 11) Risks & Mitigations
- Shared global state: Mitigate by centralizing into typed singletons and DI pattern in background/index.ts.
- MV3 quirks: Keep SW small; lazy-load where possible post-migration.
- Crypto/browser APIs: Validate compatibility and bundle size.

## 12) Live Checklist
- [x] Phase 0.1 Restore background.js to last committed state.
- [ ] Phase 0.2 Verify baseline smoke (manual) and capture notes.
- [x] Phase 1.1 Add tsconfig.json and minimal scaffolding (awaiting approval to install dev deps).
- [x] Phase 1.2 Add esbuild scripts and skeleton build pipeline.
- [ ] Phase 3.1 Create TS libraries (logging/perf/monitoring) in src/lib (done, not yet wired).
- [ ] Phase 4.1 Create TS app-layer skeletons (api/session/notifications) in src/app (done, not yet wired).
- [ ] Phase 5.1 Create TS ws client skeleton in src/app/ws (done, not yet wired).

- [x] Phase 2 Define domain types (initial scaffolding in src/types/domain.ts).
- [ ] Phase 3 Migrate libs (logging/perf/monitoring/crypto).
- [ ] Phase 4 Migrate app-layer (api/session/notifications).
- [ ] Phase 5 Migrate ws/background composition.
- [ ] Phase 6 Migrate popup.
- [ ] Phase 7 Cutover in manifest + final smoke test.

## 13) Change Log (Live)
- 2025-10-02
  - Added TS library modules: src/lib/logging, src/lib/perf, src/lib/monitoring.
  - Added TS app-layer skeletons: src/app/api, src/app/session, src/app/notifications, src/app/ws.
  - Lint/typecheck green (0 errors). Warnings remain acceptable; no runtime wires changed yet.

  - Restored background.js to last committed state (minimal fix recovery).
  - Created this live migration plan and PRD.
  - Installed TS/esbuild tooling, added scripts, and produced initial dist build (placeholders).
  - Fixed baseline lint errors (now 0 errors; warnings acceptable for now).
  - Added tsconfig.json and src/types/domain.ts scaffolding.


