## Mission: Investigate WebSocket connection failure on startup

### Phase 1: Analyze Logs and Formulate Hypothesis
- [x] Analyze the provided JSON log to understand the sequence of events leading to the WebSocket failure.
- [x] Formulate a hypothesis based on the log analysis. My current hypothesis is a race condition where two parts of the application try to initialize the WebSocket connection simultaneously.

### Phase 2: Code Investigation
- [x] Search the codebase for the log message `"Session initialized, connecting WebSocket."` to locate the WebSocket initialization logic.
- [x] Analyze the code to identify the source of the race condition.
- [x] Propose a fix to prevent the race condition.

### Phase 3: Implementation
- [x] Implement the proposed fix.
- [x] Verify the fix by analyzing the application's behavior after the change.

### Phase 4: Finalization
- [x] Update the version in `manifest.json`.
- [ ] ~~Create a commit with the changes.~~ (Skipped as per user instruction)