/**
 * Event Bus Pattern
 * 
 * This module implements a simple event bus for decoupling components.
 * Components can emit events without knowing who (if anyone) is listening.
 * 
 * Benefits:
 * - Decoupling: Components don't need to know about each other
 * - Flexibility: Easy to add/remove listeners
 * - Testability: Easy to test components in isolation
 * 
 * Example:
 * ```typescript
 * // Component A emits an event
 * globalEventBus.emit('user:login', { userId: 123 });
 * 
 * // Component B listens for the event
 * globalEventBus.on('user:login', (data) => {
 *   console.log('User logged in:', data.userId);
 * });
 * ```
 */

/**
 * Listener function type
 * Can receive optional data of any type
 */
type Listener = (data?: any) => void;

/**
 * Event Bus Class
 * 
 * Manages event listeners and event emission.
 * Uses a Map to store listeners for each event type.
 */
class EventBus {
  /**
   * Map of event names to sets of listener functions
   * Using Set ensures each listener is only registered once
   */
  private listeners = new Map<string, Set<Listener>>();

  /**
   * Register a listener for an event
   * 
   * @param event - Event name (e.g., 'websocket:connected')
   * @param listener - Function to call when event is emitted
   * 
   * @example
   * ```typescript
   * globalEventBus.on('websocket:connected', () => {
   *   console.log('WebSocket connected!');
   * });
   * ```
   */
  on(event: string, listener: Listener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  /**
   * Remove a listener for an event
   * 
   * @param event - Event name
   * @param listener - Listener function to remove
   * 
   * @example
   * ```typescript
   * const handler = () => console.log('Connected');
   * globalEventBus.on('websocket:connected', handler);
   * globalEventBus.off('websocket:connected', handler);
   * ```
   */
  off(event: string, listener: Listener): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
      // Clean up empty sets
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event to all registered listeners
   * 
   * @param event - Event name
   * @param data - Optional data to pass to listeners
   * 
   * @example
   * ```typescript
   * globalEventBus.emit('websocket:message', { 
   *   type: 'push', 
   *   data: { title: 'Hello' } 
   * });
   * ```
   */
  emit(event: string, data?: any): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      // Call each listener with the data
      eventListeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          // Log errors but don't stop other listeners
          console.error(`Error in event listener for '${event}':`, error);
        }
      });
    }
  }

  /**
   * Register a one-time listener for an event
   * The listener will be automatically removed after being called once
   * 
   * @param event - Event name
   * @param listener - Function to call when event is emitted
   * 
   * @example
   * ```typescript
   * globalEventBus.once('websocket:connected', () => {
   *   console.log('Connected for the first time!');
   * });
   * ```
   */
  once(event: string, listener: Listener): void {
    const onceWrapper = (data?: any) => {
      listener(data);
      this.off(event, onceWrapper);
    };
    this.on(event, onceWrapper);
  }

  /**
   * Remove all listeners for an event
   * If no event is specified, removes all listeners for all events
   * 
   * @param event - Optional event name. If not provided, clears all listeners
   * 
   * @example
   * ```typescript
   * // Remove all listeners for a specific event
   * globalEventBus.removeAllListeners('websocket:connected');
   * 
   * // Remove all listeners for all events
   * globalEventBus.removeAllListeners();
   * ```
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get the number of listeners for an event
   * 
   * @param event - Event name
   * @returns Number of listeners registered for the event
   * 
   * @example
   * ```typescript
   * const count = globalEventBus.listenerCount('websocket:connected');
   * console.log(`${count} listeners registered`);
   * ```
   */
  listenerCount(event: string): number {
    const eventListeners = this.listeners.get(event);
    return eventListeners ? eventListeners.size : 0;
  }

  /**
   * Get all event names that have listeners
   * 
   * @returns Array of event names
   * 
   * @example
   * ```typescript
   * const events = globalEventBus.eventNames();
   * console.log('Events with listeners:', events);
   * ```
   */
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }
}

/**
 * Global Event Bus Instance
 * 
 * This is a singleton instance that the whole extension can use.
 * Import this in any module that needs to emit or listen for events.
 * 
 * @example
 * ```typescript
 * import { globalEventBus } from './lib/events/event-bus';
 * 
 * // Emit an event
 * globalEventBus.emit('user:action', { action: 'click' });
 * 
 * // Listen for an event
 * globalEventBus.on('user:action', (data) => {
 *   console.log('User action:', data.action);
 * });
 * ```
 */
export const globalEventBus = new EventBus();

/**
 * Event Bus Class Export
 * 
 * Export the class for testing purposes or if you need to create
 * multiple event bus instances (though the global singleton is recommended)
 */
export { EventBus };

