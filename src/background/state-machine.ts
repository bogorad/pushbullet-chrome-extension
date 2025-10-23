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
import { updateExtensionTooltip, updateConnectionIcon } from './utils';

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
  RECONNECTING = 'reconnecting', // Attempting to restore real-time connection
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
  | 'ATTEMPT_RECONNECT'  // Health check triggered reconnect attempt
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

  private constructor(callbacks: StateMachineCallbacks) {
    this.callbacks = callbacks;
    debugLogger.general('INFO', '[StateMachine] Initialized', { initialState: this.currentState });
  }

  /**
   * Create a new state machine instance with hydrated state from storage
   *
   * This static factory method is the only way to create a ServiceWorkerStateMachine.
   * It reads the last known state from chrome.storage.local and initializes the
   * state machine with that state, ensuring continuity across service worker restarts.
   *
   * @param callbacks - The callbacks to use for state transitions
   * @returns A promise that resolves to a fully initialized state machine
   */
  public static async create(callbacks: StateMachineCallbacks): Promise<ServiceWorkerStateMachine> {
    const instance = new ServiceWorkerStateMachine(callbacks);

    try {
      const { lastKnownState } = await chrome.storage.local.get('lastKnownState');

      // --- START MODIFICATION ---
      // Clear terminal and transient states on extension reload
      // These states imply active connections that no longer exist after reload
      if (lastKnownState === ServiceWorkerState.ERROR) {
        debugLogger.general(
          "WARN",
          "[StateMachine] Hydrated to ERROR state. Reverting to IDLE to force re-initialization.",
        );
        instance.currentState = ServiceWorkerState.IDLE;
      } else if (
        lastKnownState === ServiceWorkerState.RECONNECTING ||
        lastKnownState === ServiceWorkerState.DEGRADED
      ) {
        // These states imply active connection attempts that are now stale after reload
        debugLogger.general(
          "INFO",
          "[StateMachine] Hydrated to transient state. Resetting to IDLE to re-establish connection.",
          {
            staleState: lastKnownState,
          },
        );
        instance.currentState = ServiceWorkerState.IDLE;
      } else if (
        lastKnownState &&
        Object.values(ServiceWorkerState).includes(lastKnownState)
      ) {
        instance.currentState = lastKnownState as ServiceWorkerState;
        debugLogger.general("INFO", "[StateMachine] Hydrated state from storage", {
          restoredState: instance.currentState,
        });
      }
      // --- END MODIFICATION ---
      else {
        debugLogger.general('INFO', '[StateMachine] No valid state in storage, using default', {
          initialState: instance.currentState
        });
      }
    } catch (error) {
      debugLogger.storage('ERROR', '[StateMachine] Failed to hydrate state, defaulting to IDLE', null, error as Error);
      instance.currentState = ServiceWorkerState.IDLE;
    }

    // After hydrating its state, the state machine is now the source of truth.
    // It is now its responsibility to set the initial UI to match its state.

    // 1. Update the tooltip.
    updateExtensionTooltip(instance.getStateDescription());

    // 2. Update the icon badge color.
    switch (instance.currentState) {
    case ServiceWorkerState.READY:
      updateConnectionIcon("connected");
      break;
    case ServiceWorkerState.INITIALIZING:
    case ServiceWorkerState.RECONNECTING:
      updateConnectionIcon("connecting");
      break;
    case ServiceWorkerState.DEGRADED:
      updateConnectionIcon("degraded");
      break;
    case ServiceWorkerState.ERROR:
    case ServiceWorkerState.IDLE:
      updateConnectionIcon("disconnected"); // Red
      break;
    }

    return instance;
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

    // STARTUP event handling: When service worker restarts, we need to re-initialize
    // if we have an API key, regardless of the current state. This handles the case
    // where the state machine was hydrated to READY/DEGRADED but the service worker
    // has restarted and needs to restore the session.
    if (event === 'STARTUP') {
      if (data?.hasApiKey) {
        // If we're already in INITIALIZING, stay there to avoid duplicate initialization
        if (this.currentState === ServiceWorkerState.INITIALIZING) {
          return ServiceWorkerState.INITIALIZING;
        }
        // From any other state, transition to INITIALIZING to restore session
        return ServiceWorkerState.INITIALIZING;
      } else {
        // No API key, go to IDLE
        return ServiceWorkerState.IDLE;
      }
    }

    switch (this.currentState) {
    case ServiceWorkerState.IDLE:
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
      if (event === 'ATTEMPT_RECONNECT') {
        return ServiceWorkerState.RECONNECTING;
      }
      break;

    case ServiceWorkerState.RECONNECTING:
      // Rule 1: If connection succeeds, go to READY (green).
      if (event === 'WS_CONNECTED') {
        return ServiceWorkerState.READY;
      }
      // Rule 2: If connection fails, go back to DEGRADED (cyan) to wait for the next attempt.
      if (event === 'WS_DISCONNECTED') {
        return ServiceWorkerState.DEGRADED;
      }
      // Rule 3: If it's a permanent error, go to ERROR (red).
      if (event === 'WS_PERMANENT_ERROR') {
        return ServiceWorkerState.ERROR;
      }
      break;

    case ServiceWorkerState.ERROR: {
      // ERROR state should allow recovery attempts
      switch (event) {
      case 'ATTEMPT_RECONNECT':
        // User manually triggered reconnect (e.g., from popup)
        return ServiceWorkerState.RECONNECTING;

      case 'API_KEY_SET':
        // User reconfigured API key - try initializing again
        return ServiceWorkerState.INITIALIZING;

      default:
        // Stay in ERROR state for all other events
        return ServiceWorkerState.ERROR;
      }
    }
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
      updateConnectionIcon("disconnected");  // Red
      // Clean slate - clear all data
      if (this.callbacks.onClearData) {
        await this.callbacks.onClearData();
      }
      if (this.callbacks.onDisconnectWebSocket) {
        this.callbacks.onDisconnectWebSocket();
      }
      break;

    case ServiceWorkerState.INITIALIZING:
      // The INITIALIZING state is now responsible for the "connecting" UI.
      updateConnectionIcon('connecting');
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
      updateConnectionIcon("connected");

      // Clear any stored error context when successfully reaching READY state
      try {
        await chrome.storage.local.remove('lastError');
        debugLogger.storage('DEBUG', 'Cleared lastError on successful recovery');
      } catch (e) {
        debugLogger.storage('WARN', 'Failed to clear lastError', null, e as Error);
      }

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
      // Directly update the icon to reflect the new state
      updateConnectionIcon('degraded');
      // Call the callback for consistency
      if (this.callbacks.onStartPolling) {
        this.callbacks.onStartPolling();
      }
      break;

    case ServiceWorkerState.RECONNECTING:
      // Update icon to yellow (connecting)
      updateConnectionIcon('connecting');
      // Now, actually start the connection attempt
      if (this.callbacks.onConnectWebSocket) {
        this.callbacks.onConnectWebSocket();
      }
      break;

    case ServiceWorkerState.ERROR: {
      // Update icon to red (disconnected)
      updateConnectionIcon('disconnected');

      // Store error context for debugging
      try {
        await chrome.storage.local.set({
          lastError: {
            timestamp: Date.now(),
            message: data?.error || 'Unknown error',
            previousState: previousState
          }
        });
      } catch (e) {
        debugLogger.storage('ERROR', 'Failed to store error context', null, e as Error);
      }

      // Show error notification
      if (this.callbacks.onShowError) {
        this.callbacks.onShowError('Service worker encountered an error');
      }

      // --- NEW: Automatic recovery attempt ---
      // Schedule automatic reconnection attempt after 30 seconds
      // This prevents the extension from being permanently stuck
      const RECOVERY_DELAY_MS = 30000; // 30 seconds

      chrome.alarms.create('auto-recovery-from-error', {
        delayInMinutes: RECOVERY_DELAY_MS / 60000
      });

      debugLogger.general('INFO', '[StateMachine] Scheduled automatic recovery', {
        delayMs: RECOVERY_DELAY_MS,
        currentState: this.currentState
      });

      break;
    }
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
    case ServiceWorkerState.RECONNECTING:
      return 'Reconnecting - Attempting to restore real-time connection';
    case ServiceWorkerState.ERROR:
      return 'Error - Unrecoverable error occurred';
    default:
      return 'Unknown state';
    }
  }
}

