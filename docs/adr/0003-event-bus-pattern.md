# ADR 0003: Event Bus Pattern for Component Decoupling

## Status
Accepted

## Context
The `WebSocketClient` class was tightly coupled to the background script through a `setHandlers` method. The background script had to pass in handler functions that directly manipulated its state:

```typescript
// Tight coupling - WebSocketClient knows about background script functions
websocketClient.setHandlers({
  onConnected: () => {
    stopPollingMode();
    updateConnectionIcon('connected');
  },
  onDisconnected: () => {
    updateConnectionIcon('disconnected');
  },
  onPush: async (push) => {
    // Complex logic directly in handler
  },
  // ... more handlers
});
```

This created several problems:
1. **Tight Coupling**: WebSocketClient needed to know about specific background script functions
2. **Hard to Test**: Testing WebSocketClient required mocking all handler functions
3. **Inflexible**: Adding new listeners required modifying WebSocketClient
4. **Single Listener**: Only one component could listen to WebSocket events
5. **Unclear Dependencies**: Not obvious what the WebSocketClient depends on

## Decision
We will implement an **Event Bus Pattern** to decouple components through event-driven architecture.

### Architecture:
1. **Event Bus**: Create a simple event bus class with `on`, `off`, `emit` methods
2. **Global Singleton**: Export a single `globalEventBus` instance
3. **WebSocketClient Emits**: WebSocketClient emits events instead of calling handlers
4. **Background Listens**: Background script listens for events via event bus

### Implementation:
```typescript
// Event Bus (src/lib/events/event-bus.ts)
class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): void {
    // Register listener
  }

  emit(event: string, data?: any): void {
    // Call all listeners
  }
}

export const globalEventBus = new EventBus();
```

### Usage:
```typescript
// WebSocketClient emits events (doesn't know who's listening)
globalEventBus.emit('websocket:connected');
globalEventBus.emit('websocket:push', push);

// Background script listens (doesn't know who's emitting)
globalEventBus.on('websocket:connected', () => {
  stopPollingMode();
  updateConnectionIcon('connected');
});

globalEventBus.on('websocket:push', async (push) => {
  // Handle push
});
```

### Events Defined:
- `websocket:connected` - WebSocket connection established
- `websocket:disconnected` - WebSocket connection closed
- `websocket:state` - Connection state changed (for popup)
- `websocket:push` - Push received
- `websocket:tickle:push` - Push tickle received
- `websocket:tickle:device` - Device tickle received
- `websocket:polling:check` - Should check polling mode
- `websocket:polling:stop` - Should stop polling mode

## Consequences

### Pros
- **Decoupling**: Components don't need to know about each other
  - WebSocketClient doesn't know about `updateConnectionIcon`
  - Background doesn't know about WebSocketClient internals
- **Flexibility**: Easy to add/remove listeners without modifying emitter
  - Multiple components can listen to the same event
  - New listeners can be added without changing WebSocketClient
- **Testability**: Easy to test components in isolation
  - Can test WebSocketClient by listening for events
  - Can test background by emitting events
- **Clear Communication**: Events document the component's public API
- **Single Responsibility**: Each component only responsible for its own behavior

### Cons
- **Indirection**: One extra layer between components
- **Debugging**: Event flow can be harder to trace than direct function calls
- **No Type Safety**: Event data is `any` type (could be improved with TypeScript generics)
- **Memory Leaks**: Need to remember to remove listeners (though we use singleton, so less of an issue)

### Neutral
- **Learning Curve**: Team needs to understand event-driven architecture
- **Event Naming**: Need conventions for event names (we use `namespace:action` pattern)

## Comparison

### Before (Tight Coupling):
```typescript
// WebSocketClient knows about background functions
websocketClient.setHandlers({
  onConnected: () => updateConnectionIcon('connected'),
  onPush: (push) => handlePush(push)
});
```

### After (Event-Driven):
```typescript
// WebSocketClient just announces what happened
globalEventBus.emit('websocket:connected');
globalEventBus.emit('websocket:push', push);

// Background decides what to do
globalEventBus.on('websocket:connected', () => updateConnectionIcon('connected'));
globalEventBus.on('websocket:push', (push) => handlePush(push));
```

## Related
- Implementation: `src/lib/events/event-bus.ts`
- WebSocketClient: `src/app/ws/client.ts`
- Background Script: `src/background/index.ts`
- Principles: Observer Pattern, Publish-Subscribe Pattern, Inversion of Control

