// tests/background/state-machine.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Import the classes we are testing
import { ServiceWorkerStateMachine, ServiceWorkerState } from '../../src/background/state-machine'

// Import the logger so we can mock it
import * as logging from '../../src/lib/logging'

// Mock the utility function that updates the UI
vi.mock('../../src/background/utils', () => ({
  updateExtensionTooltip: vi.fn(),
  updateConnectionIcon: vi.fn()
}))

describe('ServiceWorkerStateMachine', () => {
  let logSpy: any // This will be our spy on the logger
  let mockCallbacks: any // Mock callbacks for the state machine

  beforeEach(() => {
    // Create a spy on the 'general' method of the debugLogger.
    // This lets us watch what it's being called with, without actually logging.
    logSpy = vi.spyOn(logging.debugLogger, 'general')

    // Create mock functions for the state machine's side-effects.
    mockCallbacks = {
      onInitialize: vi.fn().mockResolvedValue(undefined),
      onConnectWebSocket: vi.fn(),
      onStartPolling: vi.fn(),
      onStopPolling: vi.fn(),
      onShowError: vi.fn(),
      onClearData: vi.fn().mockResolvedValue(undefined),
      onDisconnectWebSocket: vi.fn()
    }
  })

  it('should transition from READY to DEGRADED on a WebSocket disconnect and log the transition', async () => {
    // =================================================================
    // ARRANGE: Create the state machine and get it into the READY state.
    // =================================================================

    // Create a new instance of the state machine with our mock callbacks.
    const stateMachine = await ServiceWorkerStateMachine.create(mockCallbacks)

    // Simulate the startup and connection flow to reach the READY state.
    await stateMachine.transition('API_KEY_SET')
    await stateMachine.transition('INIT_SUCCESS') // This will call onInitialize
    await stateMachine.transition('WS_CONNECTED')

    // Verify we are in the correct starting state.
    expect(stateMachine.getCurrentState()).toBe(ServiceWorkerState.READY)

    // Clear the log spy's history to ignore the logs from the setup steps.
    logSpy.mockClear()

    // =================================================================
    // ACT: Trigger the event that caused the bug.
    // =================================================================

    // Simulate the WebSocket disconnecting.
    await stateMachine.transition('WS_DISCONNECTED')

    // =================================================================
    // ASSERT: Verify the new state and the log output.
    // =================================================================

    // 1. Assert that the internal state is now DEGRADED.
    expect(stateMachine.getCurrentState()).toBe(ServiceWorkerState.DEGRADED)

    // 2. Assert that the logger was called with the correct transition message.
    //    This is the key verification step.
    expect(logSpy).toHaveBeenCalledWith(
      'INFO',                                     // The log level
      '[StateMachine] Transition',                // The message
      {                                           // The contextual data object
        from: ServiceWorkerState.READY,
        event: 'WS_DISCONNECTED',
        to: ServiceWorkerState.DEGRADED
      }
    )

    // 3. (Bonus) Assert that the correct side-effect was triggered.
    //    This confirms that polling would have started.
    expect(mockCallbacks.onStartPolling).toHaveBeenCalled()
  })
})