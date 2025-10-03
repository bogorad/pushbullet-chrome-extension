/**
 * Unit tests for session initialization race condition fixes
 * Tests the promise singleton pattern that prevents concurrent initialization errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chrome API is mocked globally in tests/setup.ts
declare const chrome: any;

// Import the module under test
// Note: We need to reset the module state between tests
let initializeSessionCache: any;
let sessionCache: any;
let initializationState: any;

// Mock the dependencies
vi.mock('../../src/lib/logging', () => ({
  debugLogger: {
    general: vi.fn(),
    storage: vi.fn(),
    api: vi.fn()
  }
}));

vi.mock('../../src/app/api/client', () => ({
  fetchUserInfo: vi.fn().mockResolvedValue({ name: 'Test User', email: 'test@example.com' }),
  fetchDevices: vi.fn().mockResolvedValue([]),
  fetchRecentPushes: vi.fn().mockResolvedValue([]),
  registerDevice: vi.fn().mockResolvedValue({ iden: 'device123' })
}));

describe('initializeSessionCache - Race Condition Prevention', () => {
  beforeEach(async () => {
    // Reset module state by re-importing
    vi.resetModules();
    
    // Re-import the module to get fresh state
    const module = await import('../../src/app/session/index');
    initializeSessionCache = module.initializeSessionCache;
    sessionCache = module.sessionCache;
    initializationState = module.initializationState;
    
    // Reset initialization state
    initializationState.inProgress = false;
    initializationState.completed = false;
    initializationState.error = null;
    initializationState.timestamp = null;
    
    // Mock chrome.storage.sync.get to return a valid API key
    chrome.storage.sync.get.mockImplementation((keys, callback) => {
      callback({
        apiKey: 'test-api-key-123',
        deviceIden: 'device-iden-456',
        autoOpenLinks: true,
        deviceNickname: 'Test Chrome',
        notificationTimeout: 5000
      });
    });
  });

  it('should complete initialization successfully on first call', async () => {
    const result = await initializeSessionCache('test-source');
    
    expect(result).toBe('test-api-key-123');
    expect(initializationState.completed).toBe(true);
    expect(initializationState.inProgress).toBe(false);
    expect(initializationState.error).toBeNull();
  });

  it('should return same promise when called concurrently (race condition test)', async () => {
    // Simulate concurrent calls by calling initializeSessionCache multiple times
    // before the first one completes
    const promise1 = initializeSessionCache('source-1');
    const promise2 = initializeSessionCache('source-2');
    const promise3 = initializeSessionCache('source-3');

    // Wait for all to complete
    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

    // All should have the same result (this proves they shared the same initialization)
    expect(result1).toBe('test-api-key-123');
    expect(result2).toBe('test-api-key-123');
    expect(result3).toBe('test-api-key-123');

    // Initialization should be completed
    expect(initializationState.completed).toBe(true);
    expect(initializationState.inProgress).toBe(false);

    // Verify chrome.storage.sync.get was only called once (proving promise reuse)
    expect(chrome.storage.sync.get).toHaveBeenCalledTimes(1);
  });

  it('should return null on subsequent calls after completion', async () => {
    // First call completes initialization
    const firstResult = await initializeSessionCache('first-call');
    expect(firstResult).toBe('test-api-key-123');
    expect(initializationState.completed).toBe(true);
    
    // Second call should return null (already initialized)
    const secondResult = await initializeSessionCache('second-call');
    expect(secondResult).toBeNull();
    
    // State should remain completed
    expect(initializationState.completed).toBe(true);
    expect(initializationState.inProgress).toBe(false);
  });

  it('should clear promise and allow retry after initialization failure', async () => {
    // Mock storage to fail on first call
    let callCount = 0;
    chrome.storage.sync.get.mockImplementation((keys, callback) => {
      callCount++;
      if (callCount === 1) {
        // First call fails
        throw new Error('Storage error');
      } else {
        // Second call succeeds
        callback({
          apiKey: 'test-api-key-retry',
          deviceIden: 'device-iden-retry',
          autoOpenLinks: true,
          deviceNickname: 'Test Chrome',
          notificationTimeout: 5000
        });
      }
    });
    
    // First call should fail
    await expect(initializeSessionCache('first-attempt')).rejects.toThrow('Storage error');
    
    // State should be reset (not in progress, not completed)
    expect(initializationState.inProgress).toBe(false);
    expect(initializationState.completed).toBe(false);
    expect(initializationState.error).toBeTruthy();
    
    // Second call should succeed (promise was cleared)
    const retryResult = await initializeSessionCache('retry-attempt');
    expect(retryResult).toBe('test-api-key-retry');
    expect(initializationState.completed).toBe(true);
  });

  it('should prevent "Initialization already in progress" errors via promise reuse', async () => {
    // This test verifies the fix for the original bug
    // Before the fix, concurrent calls would throw "Initialization already in progress"
    // After the fix, they should return the same promise
    
    // Start first initialization (don't await yet)
    const firstPromise = initializeSessionCache('concurrent-1');
    
    // Immediately start second initialization while first is in progress
    const secondPromise = initializeSessionCache('concurrent-2');
    
    // Both should succeed without throwing
    const results = await Promise.all([firstPromise, secondPromise]);
    
    expect(results[0]).toBe('test-api-key-123');
    expect(results[1]).toBe('test-api-key-123');
    
    // No errors should have been thrown
    expect(initializationState.error).toBeNull();
  });

  it('should handle state setters correctly when provided', async () => {
    const mockSetters = {
      setApiKey: vi.fn(),
      setDeviceIden: vi.fn(),
      setAutoOpenLinks: vi.fn(),
      setDeviceNickname: vi.fn(),
      setNotificationTimeout: vi.fn()
    };
    
    await initializeSessionCache('test-with-setters', undefined, mockSetters);
    
    // Verify setters were called with correct values
    expect(mockSetters.setApiKey).toHaveBeenCalledWith('test-api-key-123');
    expect(mockSetters.setDeviceIden).toHaveBeenCalledWith('device-iden-456');
    expect(mockSetters.setAutoOpenLinks).toHaveBeenCalledWith(true);
    expect(mockSetters.setDeviceNickname).toHaveBeenCalledWith('Test Chrome');
    expect(mockSetters.setNotificationTimeout).toHaveBeenCalledWith(5000);
  });

  it('should call connectWebSocket function when provided', async () => {
    const mockConnectWebSocket = vi.fn();
    
    await initializeSessionCache('test-with-websocket', mockConnectWebSocket);
    
    // Verify WebSocket connection was initiated
    expect(mockConnectWebSocket).toHaveBeenCalled();
  });
});

