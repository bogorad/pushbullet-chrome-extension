/**
 * Service Worker State Machine
 * 
 * This module implements a State Machine Pattern to centralize all service worker
 * lifecycle logic. Instead of scattered state flags (initializationState.inProgress,
 * isPollingMode, etc.), we have a single, explicit state machine.
 * 
 * Benefits:
 * - Predictable behavior (single currentState variable)
 * - Explicit transitions (transition('WS_CONNECTED'))
 * - No invalid states (state machine ensures only valid transitions)
 * - Easy to debug (state transitions are logged)
 * - Easy to test (can test each state and transition independently)
 * 
 * See ADR 0005 for full design documentation.
 */

import { debugLogger } from '../lib/logging';
import { updateExtensionTooltip } from './utils';

/**
 * Service Worker States
 * 
 * These represent all possible states the service worker can be in.
 */
export enum ServiceWorkerState {
  IDLE = 'idle',                 // Fresh start, no API key
  INITIALIZING = 'initializing', // API key present, fetching session data
  READY = 'ready',               // Authenticated, WebSocket connected
  DEGRADED = 'degraded',         // Authenticated, using polling fallback
  ERROR = 'error',               // Permanent, unrecoverable error
}

/**
 * Service Worker Events
 * 
 * These are the events that can trigger state transitions.
 */
export type ServiceWorkerEvent =
  | 'STARTUP'            // onInstalled or onStartup
  | 'API_KEY_SET'        // User saves a new API key
  | 'INIT_SUCCESS'       // Session data successfully fetched
  | 'INIT_FAILURE'       // Session data fetching failed
  | 'WS_CONNECTED'       // WebSocket connected successfully
  | 'WS_DISCONNECTED'    // WebSocket disconnected (transient error)
  | 'WS_PERMANENT_ERROR' // WebSocket disconnected (permanent error)
  | 'LOGOUT';            // User logged out

/**
 * State Machine Callbacks
 * 
 * These callbacks are called when entering/exiting states.
 * They allow the state machine to trigger side effects without
 * being tightly coupled to the background script.
 */
export interface StateMachineCallbacks {
  onInitialize?: (data?: any) => Promise<void>;
  onConnectWebSocket?: () => void;
  onStartPolling?: () => void;
  onStopPolling?: () => void;
  onShowError?: (error: string) => void;
  onClearData?: () => Promise<void>;
  onDisconnectWebSocket?: () => void;
}

/**
 * Service Worker State Machine
 * 
 * Manages the lifecycle of the service worker through explicit states and transitions.
 */
export class ServiceWorkerStateMachine {
  private currentState: ServiceWorkerState = ServiceWorkerState.IDLE;
  private callbacks: StateMachineCallbacks;

  constructor(callbacks: StateMachineCallbacks) {
    this.callbacks = callbacks;
    debugLogger.general('INFO', '[StateMachine] Initialized', { initialState: this.currentState });
  }

  /**
   * Get the current state
   */
  public getCurrentState(): ServiceWorkerState {
    return this.currentState;
  }

  /**
   * Check if in a specific state
   */
  public isInState(state: ServiceWorkerState): boolean {
    return this.currentState === state;
  }

  /**
   * Transition to a new state based on an event
   * 
   * @param event - The event that triggers the transition
   * @param data - Optional data to pass to the state entry handler
   */
  public async transition(event: ServiceWorkerEvent, data?: any): Promise<void> {
    const nextState = this.getNextState(event, data);

    if (nextState !== this.currentState) {
      debugLogger.general('INFO', `[StateMachine] Transition`, {
        from: this.currentState,
        event,
        to: nextState
      });

      // Run exit actions for the old state
      await this.onStateExit(this.currentState, nextState);

      // Change state
      const previousState = this.currentState;
      this.currentState = nextState;

      // Run entry actions for the new state
      await this.onStateEnter(this.currentState, previousState, data);

      // ICON PERSISTENCE FIX: Persist state to storage so icon badge survives service worker restarts
      // This ensures users always see the correct extension state (error, connected, etc.)
      // even after Chrome shuts down the service worker or the browser is restarted
      try {
        await chrome.storage.local.set({
          lastKnownState: this.currentState,
          lastKnownStateDescription: this.getStateDescription()
        });
        debugLogger.storage('DEBUG', '[StateMachine] Persisted new state to storage', { state: this.currentState });
      } catch (error) {
        debugLogger.storage('ERROR', '[StateMachine] Failed to persist state', null, error as Error);
      }
    } else {
      debugLogger.general('DEBUG', `[StateMachine] No transition`, {
        state: this.currentState,
        event
      });
    }
  }

  /**
   * Determine the next state based on current state and event
   * 
   * This implements the state transition table from ADR 0005.
   */
  private getNextState(event: ServiceWorkerEvent, data?: any): ServiceWorkerState {
    // LOGOUT can happen from any state
    if (event === 'LOGOUT') {
      return ServiceWorkerState.IDLE;
    }

    switch (this.currentState) {
      case ServiceWorkerState.IDLE:
        if (event === 'STARTUP') {
          // Only transition to INITIALIZING if we have an API key
          return data?.hasApiKey ? ServiceWorkerState.INITIALIZING : ServiceWorkerState.IDLE;
        }
        if (event === 'API_KEY_SET') {
          return ServiceWorkerState.INITIALIZING;
        }
        break;

      case ServiceWorkerState.INITIALIZING:
        if (event === 'INIT_SUCCESS') {
          return ServiceWorkerState.READY;
        }
        if (event === 'INIT_FAILURE') {
          return ServiceWorkerState.ERROR;
        }
        break;

      case ServiceWorkerState.READY:
        if (event === 'WS_DISCONNECTED') {
          return ServiceWorkerState.DEGRADED;
        }
        if (event === 'WS_PERMANENT_ERROR') {
          return ServiceWorkerState.ERROR;
        }
        break;

      case ServiceWorkerState.DEGRADED:
        if (event === 'WS_CONNECTED') {
          return ServiceWorkerState.READY;
        }
        if (event === 'WS_PERMANENT_ERROR') {
          return ServiceWorkerState.ERROR;
        }
        break;

      case ServiceWorkerState.ERROR:
        if (event === 'API_KEY_SET') {
          return ServiceWorkerState.INITIALIZING;
        }
        break;
    }

    // No valid transition found, stay in current state
    return this.currentState;
  }

  /**
   * Handle entering a new state
   * 
   * This is where side effects happen (calling callbacks).
   */
  private async onStateEnter(
    state: ServiceWorkerState,
    previousState: ServiceWorkerState,
    data?: any
  ): Promise<void> {
    debugLogger.general('DEBUG', `[StateMachine] Entering state`, { state, previousState });

    // Update extension tooltip to show current state
    updateExtensionTooltip(this.getStateDescription());

    switch (state) {
      case ServiceWorkerState.IDLE:
        // Clean slate - clear all data
        if (this.callbacks.onClearData) {
          await this.callbacks.onClearData();
        }
        if (this.callbacks.onDisconnectWebSocket) {
          this.callbacks.onDisconnectWebSocket();
        }
        break;

      case ServiceWorkerState.INITIALIZING:
        // Start initialization process
        if (this.callbacks.onInitialize) {
          try {
            await this.callbacks.onInitialize(data);
            // Initialization succeeded - transition to READY
            await this.transition('INIT_SUCCESS');
          } catch (error) {
            // Initialization failed - transition to ERROR
            debugLogger.general('ERROR', '[StateMachine] Initialization failed', null, error as Error);
            await this.transition('INIT_FAILURE');
          }
        }
        break;

      case ServiceWorkerState.READY:
        // Stop polling if we were in DEGRADED mode
        if (previousState === ServiceWorkerState.DEGRADED && this.callbacks.onStopPolling) {
          this.callbacks.onStopPolling();
        }
        // Connect WebSocket if coming from INITIALIZING
        if (previousState === ServiceWorkerState.INITIALIZING && this.callbacks.onConnectWebSocket) {
          this.callbacks.onConnectWebSocket();
        }
        break;

      case ServiceWorkerState.DEGRADED:
        // When we ENTER the DEGRADED state, we start polling
        debugLogger.general('WARN', 'Entering DEGRADED state. Starting polling fallback.');
        chrome.alarms.create('pollingFallback', { periodInMinutes: 1 });
        // Call the callback for consistency
        if (this.callbacks.onStartPolling) {
          this.callbacks.onStartPolling();
        }
        break;

      case ServiceWorkerState.ERROR:
        // Show error notification
        if (this.callbacks.onShowError) {
          this.callbacks.onShowError('Service worker encountered an error');
        }
        break;
    }
  }

  /**
   * Handle exiting a state
   * 
   * Optional cleanup logic when leaving a state.
   */
  private async onStateExit(
    state: ServiceWorkerState,
    nextState: ServiceWorkerState
  ): Promise<void> {
    debugLogger.general('DEBUG', `[StateMachine] Exiting state`, { state, nextState });

    // When we EXIT the DEGRADED state, we must stop polling
    if (state === ServiceWorkerState.DEGRADED) {
      debugLogger.general('INFO', 'Exiting DEGRADED state. Stopping polling fallback.');
      chrome.alarms.clear('pollingFallback');
      if (this.callbacks.onStopPolling) {
        this.callbacks.onStopPolling();
      }
    }
  }

  /**
   * Get a human-readable description of the current state
   */
  public getStateDescription(): string {
    switch (this.currentState) {
      case ServiceWorkerState.IDLE:
        return 'Idle - No API key configured';
      case ServiceWorkerState.INITIALIZING:
        return 'Initializing - Fetching session data';
      case ServiceWorkerState.READY:
        return 'Ready - Connected via WebSocket';
      case ServiceWorkerState.DEGRADED:
        return 'Degraded - Using polling fallback';
      case ServiceWorkerState.ERROR:
        return 'Error - Unrecoverable error occurred';
      default:
        return 'Unknown state';
    }
  }
}

