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
  fetchDevices: vi.fn().mockResolvedValue([{ iden: 'device1' }]),
  fetchRecentPushes: vi.fn().mockResolvedValue([]),
  fetchIncrementalPushes: vi.fn().mockResolvedValue([]),
  fetchDisplayPushes: vi.fn().mockResolvedValue([]),
  fetchChats: vi.fn().mockResolvedValue([]),
  registerDevice: vi.fn().mockResolvedValue({ iden: 'device123' })
}));

// Mock the storage repository
vi.mock('../../src/infrastructure/storage/storage.repository', () => ({
  storageRepository: {
    getApiKey: vi.fn().mockResolvedValue('test-api-key-123'),
    getDeviceIden: vi.fn().mockResolvedValue('device-iden-456'),
    getDeviceNickname: vi.fn().mockResolvedValue('Test Chrome'),
    getAutoOpenLinks: vi.fn().mockResolvedValue(true),
    getNotificationTimeout: vi.fn().mockResolvedValue(5000),
    getLastModifiedCutoff: vi.fn().mockResolvedValue(1),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    setDeviceIden: vi.fn().mockResolvedValue(undefined),
    setDeviceNickname: vi.fn().mockResolvedValue(undefined),
    setAutoOpenLinks: vi.fn().mockResolvedValue(undefined),
    setNotificationTimeout: vi.fn().mockResolvedValue(undefined),
    setLastModifiedCutoff: vi.fn().mockResolvedValue(undefined)
  }
}));

describe('initializeSessionCache - Race Condition Prevention', () => {
  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    vi.resetModules();

    // Re-import the module to get fresh state
    const module = await import('../../src/app/session/index');
    initializeSessionCache = module.initializeSessionCache;
    sessionCache = module.sessionCache;

    // Reset session cache
    sessionCache.isAuthenticated = false;
    sessionCache.userInfo = null;
    sessionCache.devices = [];
    sessionCache.recentPushes = [];

    // Reset storage repository mocks to default values
    const { storageRepository } = await import('../../src/infrastructure/storage/storage.repository');
    vi.spyOn(storageRepository, 'getApiKey').mockResolvedValue('test-api-key-123');
    vi.spyOn(storageRepository, 'getDeviceIden').mockResolvedValue('device-iden-456');
    vi.spyOn(storageRepository, 'getDeviceNickname').mockResolvedValue('Test Chrome');
    vi.spyOn(storageRepository, 'getAutoOpenLinks').mockResolvedValue(true);
    vi.spyOn(storageRepository, 'getNotificationTimeout').mockResolvedValue(5000);
    vi.spyOn(storageRepository, 'getLastModifiedCutoff').mockResolvedValue(null);
  });

  it('should complete initialization successfully on first call', async () => {
    const result = await initializeSessionCache('test-source');

    expect(result).toBe('test-api-key-123');
    expect(sessionCache.isAuthenticated).toBe(true);
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
    expect(sessionCache.isAuthenticated).toBe(true);

    // Verify storage repository methods were only called once (proving promise reuse)
    const { storageRepository } = await import('../../src/infrastructure/storage/storage.repository');
    expect(storageRepository.getApiKey).toHaveBeenCalledTimes(1);
  });

  it('should return null on subsequent calls after completion', async () => {
    const firstResult = await initializeSessionCache('first-call');
    expect(firstResult).toBe('test-api-key-123');
    expect(sessionCache.isAuthenticated).toBe(true);

    // Second call should return null (already initialized)
    const secondResult = await initializeSessionCache('second-call');
    expect(secondResult).toBeNull();

    // State should remain authenticated
    expect(sessionCache.isAuthenticated).toBe(true);
  });

  it('should clear promise and allow retry after initialization failure', async () => {
    // Re-import to get fresh mocks
    const { storageRepository } = await import('../../src/infrastructure/storage/storage.repository');

    // Mock storage to fail on first call, succeed on second
    let callCount = 0;
    vi.spyOn(storageRepository, 'getApiKey').mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('Storage error'));
      } else {
        return Promise.resolve('test-api-key-retry');
      }
    });

    // First call should fail
    await expect(initializeSessionCache('first-attempt')).rejects.toThrow('Storage error');

    // State should be reset (not authenticated)
    expect(sessionCache.isAuthenticated).toBe(false);

    // Second call should succeed (promise was cleared)
    const retryResult = await initializeSessionCache('retry-attempt');
    expect(retryResult).toBe('test-api-key-retry');
    expect(sessionCache.isAuthenticated).toBe(true);
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
    
    // Session should be authenticated
    expect(sessionCache.isAuthenticated).toBe(true);
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

