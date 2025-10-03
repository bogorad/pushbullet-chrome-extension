# ADR 0005: Service Worker State Machine

## Status
Accepted

## Context
The service worker's lifecycle logic is currently scattered across multiple state flags and variables:

```typescript
// Scattered state management
initializationState.inProgress = true;
initializationState.completed = false;
let isPollingMode = false;
let websocketClient: WebSocketClient | null = null;
// ... and more
```

This creates several problems:
1. **Unpredictable Behavior**: To know the extension's status, you must check multiple variables
2. **Invalid States**: The system can get into inconsistent states (e.g., `inProgress=true` but `completed=true`)
3. **Hard to Debug**: State transitions are implicit side effects scattered throughout the code
4. **Race Conditions**: Multiple flags can be modified concurrently
5. **Difficult to Test**: Testing all possible state combinations is complex

Example of the problem:
```typescript
// What state are we in? You have to check multiple flags:
if (initializationState.completed && websocketClient && !isPollingMode) {
  // We're "ready"?
} else if (initializationState.completed && isPollingMode) {
  // We're "degraded"?
} else if (initializationState.inProgress) {
  // We're "initializing"?
}
```

## Decision
We will implement a **State Machine Pattern** to centralize all service worker lifecycle logic.

### States Defined
```typescript
export enum ServiceWorkerState {
  IDLE = 'idle',                 // Fresh start, no API key
  INITIALIZING = 'initializing', // API key present, fetching session data
  READY = 'ready',               // Authenticated, WebSocket connected
  DEGRADED = 'degraded',         // Authenticated, using polling fallback
  ERROR = 'error',               // Permanent, unrecoverable error
}
```

### Events Defined
```typescript
export type ServiceWorkerEvent =
  | 'STARTUP'            // onInstalled or onStartup
  | 'API_KEY_SET'        // User saves a new API key
  | 'INIT_SUCCESS'       // Session data successfully fetched
  | 'INIT_FAILURE'       // Session data fetching failed
  | 'WS_CONNECTED'       // WebSocket connected successfully
  | 'WS_DISCONNECTED'    // WebSocket disconnected (transient error)
  | 'WS_PERMANENT_ERROR' // WebSocket disconnected (permanent error)
  | 'LOGOUT';            // User logged out
```

### State Transition Table

| Current State | Event Trigger | Next State | Side Effect(s) to Run |
|--------------|---------------|------------|----------------------|
| `IDLE` | `STARTUP` (with API key) | `INITIALIZING` | `initializeSessionCache()` |
| `IDLE` | `STARTUP` (no API key) | `IDLE` | None |
| `IDLE` | `API_KEY_SET` | `INITIALIZING` | `initializeSessionCache()` |
| `INITIALIZING` | `INIT_SUCCESS` | `READY` | `connectWebSocket()` |
| `INITIALIZING` | `INIT_FAILURE` | `ERROR` | `showErrorNotification()` |
| `READY` | `WS_DISCONNECTED` | `DEGRADED` | `startPolling()` |
| `READY` | `WS_PERMANENT_ERROR` | `ERROR` | `showErrorNotification()` |
| `DEGRADED` | `WS_CONNECTED` | `READY` | `stopPolling()` |
| `DEGRADED` | `WS_PERMANENT_ERROR` | `ERROR` | `showErrorNotification()` |
| `ERROR` | `API_KEY_SET` | `INITIALIZING` | `initializeSessionCache()` |
| *Any State* | `LOGOUT` | `IDLE` | `clearAllData()`, `disconnectWebSocket()` |

### Implementation
```typescript
export class ServiceWorkerStateMachine {
  private currentState: ServiceWorkerState = ServiceWorkerState.IDLE;

  public async transition(event: ServiceWorkerEvent, data?: any): Promise<void> {
    const nextState = this.getNextState(event);

    if (nextState !== this.currentState) {
      console.log(`[StateMachine] ${this.currentState} --[${event}]--> ${nextState}`);
      
      await this.onStateExit(this.currentState, nextState);
      this.currentState = nextState;
      await this.onStateEnter(this.currentState, data);
    }
  }

  private getNextState(event: ServiceWorkerEvent): ServiceWorkerState {
    // Implement transition table logic
  }

  private async onStateEnter(state: ServiceWorkerState, data?: any): Promise<void> {
    // Run side effects for entering a state
  }
}
```

### Usage
```typescript
// Before: Scattered state management
if (apiKey) {
  initializationState.inProgress = true;
  await initializeSessionCache();
  initializationState.completed = true;
  connectWebSocket();
}

// After: Centralized state machine
stateMachine.transition('STARTUP');
// State machine handles all the logic
```

## Consequences

### Pros
- **Predictable Behavior**: Single `currentState` variable tells you exactly what state the system is in
- **Explicit Transitions**: State changes are explicit actions (`transition('WS_CONNECTED')`)
- **No Invalid States**: State machine ensures only valid transitions occur
- **Easy to Debug**: State transitions are logged and traceable
- **Easy to Test**: Can test each state and transition independently
- **Self-Documenting**: State diagram documents all possible states and transitions
- **Eliminates Race Conditions**: Single point of state management
- **Bulletproof**: Impossible to get into inconsistent state

### Cons
- **Initial Complexity**: Requires upfront design (state diagram, transition table)
- **Learning Curve**: Team needs to understand state machine pattern
- **Indirection**: One extra layer (though this is a benefit for maintainability)

### Neutral
- **Refactoring Required**: Need to remove old state flags and integrate state machine
- **Testing Strategy**: Tests need to be updated to work with state machine

## Comparison

### Before (Scattered State):
```typescript
// Multiple flags to check
if (initializationState.completed && websocketClient && !isPollingMode) {
  // Ready state
}

// Implicit state transitions
initializationState.inProgress = true;
await initializeSessionCache();
initializationState.completed = true;
connectWebSocket();
```

### After (State Machine):
```typescript
// Single source of truth
if (stateMachine.getCurrentState() === ServiceWorkerState.READY) {
  // Ready state
}

// Explicit state transitions
stateMachine.transition('STARTUP');
// State machine handles initialization and WebSocket connection
```

## State Diagram

```
┌──────┐
│ IDLE │ ◄──────────────────────────────┐
└──┬───┘                                 │
   │ STARTUP (with API key)              │
   │ API_KEY_SET                         │ LOGOUT
   ▼                                     │
┌──────────────┐                         │
│ INITIALIZING │                         │
└──┬───────┬───┘                         │
   │       │                             │
   │       │ INIT_FAILURE                │
   │       ▼                             │
   │    ┌───────┐                        │
   │    │ ERROR │────────────────────────┤
   │    └───────┘                        │
   │                                     │
   │ INIT_SUCCESS                        │
   ▼                                     │
┌──────┐                                 │
│ READY│◄────────────┐                  │
└──┬───┘             │                  │
   │                 │ WS_CONNECTED     │
   │ WS_DISCONNECTED │                  │
   ▼                 │                  │
┌──────────┐         │                  │
│ DEGRADED │─────────┴──────────────────┘
└──────────┘
```

## Related
- Implementation: `src/background/state-machine.ts`
- Integration: `src/background/index.ts`
- Related ADRs: ADR 0001 (Initialization Race Condition), ADR 0003 (Event Bus)
- Principles: State Machine Pattern, Finite State Machine (FSM)

