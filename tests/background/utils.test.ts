/**
 * Unit tests for context menu setup race condition fixes
 * Tests the idempotent guard pattern that prevents duplicate menu creation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chrome API is mocked globally in tests/setup.ts
declare const chrome: any;

// Import the module under test
let setupContextMenu: any;

// Mock the dependencies
const mockGetApiKey = vi.fn();

vi.mock('../../src/lib/logging', () => ({
  debugLogger: {
    general: vi.fn(),
    storage: vi.fn(),
    api: vi.fn(),
    notifications: vi.fn(),
    websocket: vi.fn()
  }
}));

vi.mock('../../src/lib/perf', () => ({
  performanceMonitor: {
    recordNotificationCreated: vi.fn(),
    recordNotificationFailed: vi.fn(),
    recordPushReceived: vi.fn(),
    recordWebSocketConnection: vi.fn(),
    recordHealthCheckSuccess: vi.fn(),
    recordHealthCheckFailure: vi.fn(),
    getQualityMetrics: vi.fn(() => ({ consecutiveFailures: 0 }))
  }
}));

vi.mock('../../src/app/session', () => ({
  sessionCache: {
    recentPushes: [],
    lastUpdated: 0,
    userInfo: null
  }
}));

vi.mock('../../src/app/reconnect', () => ({
  ensureConfigLoaded: vi.fn()
}));

vi.mock('../../src/lib/events/event-bus', () => ({
  globalEventBus: {
    emit: vi.fn()
  }
}));

vi.mock('../../src/background/state', () => ({
  getApiKey: mockGetApiKey,
  getAutoOpenLinks: vi.fn(() => false),
  getDeviceIden: vi.fn(),
  getDeviceNickname: vi.fn(),
  getNotificationTimeout: vi.fn(),
  setApiKey: vi.fn(),
  setDeviceIden: vi.fn(),
  setAutoOpenLinks: vi.fn(),
  setNotificationTimeout: vi.fn(),
  setDeviceNickname: vi.fn(),
  setPollingMode: vi.fn(),
  isPollingMode: vi.fn(() => false),
  setWebSocketClient: vi.fn(),
  WEBSOCKET_URL: 'wss://example.com/'
}));

describe('setupContextMenu - Idempotent Guard Pattern', () => {
  beforeEach(async () => {
    // Reset module state by re-importing
    vi.resetModules();
    
    // Re-import the module to get fresh state
    const module = await import('../../src/background/utils');
    setupContextMenu = module.setupContextMenu;
    
    // Mock chrome.contextMenus.removeAll to call callback immediately
    chrome.contextMenus.removeAll.mockImplementation((callback: () => void) => {
      // Simulate successful removal
      callback();
    });
    
    // Mock chrome.contextMenus.create to succeed
    chrome.contextMenus.create.mockImplementation(() => {
      // Simulate successful creation
    });
  });

  it('should create all four context menu items', () => {
    setupContextMenu();
    
    // Wait for async callback to complete
    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(chrome.contextMenus.create).toHaveBeenCalledTimes(4);
    
    // Verify all menu items were created with correct IDs
    const createCalls = chrome.contextMenus.create.mock.calls;
    const menuIds = createCalls.map((call: any[]) => call[0].id);
    
    expect(menuIds).toContain('push-link');
    expect(menuIds).toContain('push-page');
    expect(menuIds).toContain('push-selection');
    expect(menuIds).toContain('push-image');
  });

  it('should be idempotent - concurrent calls only execute once', async () => {
    // Simulate concurrent calls by calling setupContextMenu multiple times
    // The guard should prevent all but the first from executing
    
    // Make removeAll async to simulate real behavior
    let removeAllCallback: (() => void) | null = null;
    chrome.contextMenus.removeAll.mockImplementation((callback: () => void) => {
      removeAllCallback = callback;
    });
    
    // Call setupContextMenu three times concurrently
    setupContextMenu();
    setupContextMenu();
    setupContextMenu();
    
    // Only the first call should have triggered removeAll
    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    
    // Complete the removeAll operation
    if (removeAllCallback) {
      removeAllCallback();
    }
    
    // Even after completion, only one set of menus should be created
    expect(chrome.contextMenus.create).toHaveBeenCalledTimes(4);
  });

  it('should wait for removeAll to complete before creating menus', () => {
    let removeAllCompleted = false;
    let menusCreated = false;
    
    chrome.contextMenus.removeAll.mockImplementation((callback: () => void) => {
      // Simulate async removeAll
      setTimeout(() => {
        removeAllCompleted = true;
        callback();
      }, 10);
    });
    
    chrome.contextMenus.create.mockImplementation(() => {
      // Verify removeAll completed before create was called
      expect(removeAllCompleted).toBe(true);
      menusCreated = true;
    });
    
    setupContextMenu();
    
    // Wait for async operations
    return new Promise(resolve => {
      setTimeout(() => {
        expect(menusCreated).toBe(true);
        resolve(undefined);
      }, 50);
    });
  });

  it('should check chrome.runtime.lastError after removeAll', () => {
    const lastErrorMessage = 'Failed to remove menus';
    
    chrome.contextMenus.removeAll.mockImplementation((callback: () => void) => {
      // Simulate error in removeAll
      chrome.runtime.lastError = { message: lastErrorMessage };
      callback();
      delete chrome.runtime.lastError;
    });
    
    setupContextMenu();
    
    // removeAll should have been called
    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    
    // create should NOT have been called due to error
    expect(chrome.contextMenus.create).not.toHaveBeenCalled();
  });

  it('should check chrome.runtime.lastError after each create call', () => {
    const errors: string[] = [];
    
    chrome.contextMenus.create.mockImplementation((options: any) => {
      // Simulate error on second menu item
      if (options.id === 'push-page') {
        chrome.runtime.lastError = { message: 'Duplicate ID' };
        errors.push(options.id);
        // Error should be checked and cleared
        setTimeout(() => {
          delete chrome.runtime.lastError;
        }, 0);
      }
    });
    
    setupContextMenu();
    
    // All four create calls should have been attempted
    expect(chrome.contextMenus.create).toHaveBeenCalledTimes(4);
    
    // Error should have been encountered
    expect(errors).toContain('push-page');
  });

  it('should clear guard flag after completion', async () => {
    setupContextMenu();
    
    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Reset mocks
    chrome.contextMenus.removeAll.mockClear();
    chrome.contextMenus.create.mockClear();
    
    // Second call should now be able to execute (guard cleared)
    setupContextMenu();
    
    // Should have been called again
    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
  });

  it('should clear guard flag even on error', () => {
    chrome.contextMenus.removeAll.mockImplementation((callback: () => void) => {
      // Simulate error
      chrome.runtime.lastError = { message: 'Error' };
      callback();
      delete chrome.runtime.lastError;
    });
    
    setupContextMenu();
    
    // Reset mocks
    chrome.contextMenus.removeAll.mockClear();
    chrome.contextMenus.create.mockClear();
    
    // Mock successful removeAll for second call
    chrome.contextMenus.removeAll.mockImplementation((callback: () => void) => {
      callback();
    });
    
    // Second call should be able to execute (guard cleared after error)
    setupContextMenu();
    
    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
  });
});

/**
 * Unit tests for showPushNotification function
 * Tests notification creation for different push types including mirror notifications
 */
describe('showPushNotification - Notification Creation', () => {
  let showPushNotification: any;

  beforeEach(async () => {
    // Reset module state by re-importing
    vi.resetModules();
    
    // Mock chrome.runtime.getURL for icon URL generation
    chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://fake-id/${path}`);
    
    // Mock chrome.notifications.create to return a promise that resolves
    chrome.notifications.create.mockImplementation(() => Promise.resolve('notification-id'));
    
    // Re-import the module to get fresh state
    const module = await import('../../src/background/utils');
    showPushNotification = module.showPushNotification;
    
    // Clear mock history for chrome.notifications.create
    chrome.notifications.create.mockClear();
  });

  it('should create a basic notification for a note push', async () => {
    // Arrange
    const push = { type: 'note', title: 'Test Note', body: 'This is a test' };

    // Act
    await expect(showPushNotification(push)).resolves.not.toThrow();

    // Assert
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [notificationId, notificationOptions] = chrome.notifications.create.mock.calls[0];
    
    expect(notificationOptions.type).toBe('basic');
    expect(notificationOptions.title).toBe('Test Note');
    expect(notificationOptions.message).toBe('This is a test');
    expect(notificationOptions.iconUrl).toBeDefined();
  });

  it('should create a basic notification for a link push', async () => {
    // Arrange
    const push = { type: 'link', title: 'Test Link', url: 'https://example.com' };

    // Act
    await showPushNotification(push);

    // Assert
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [notificationId, notificationOptions] = chrome.notifications.create.mock.calls[0];
    
    expect(notificationOptions.type).toBe('basic');
    expect(notificationOptions.title).toBe('Test Link');
    expect(notificationOptions.message).toBe('https://example.com');
    expect(notificationOptions.iconUrl).toBeDefined();
  });

  it('should create a basic notification for a mirror push', async () => {
    // Arrange
    const push = { 
      type: 'mirror', 
      title: 'Mirrored Title', 
      application_name: 'TestApp', 
      body: 'Mirrored body' 
    };

    // Act
    await showPushNotification(push);

    // Assert
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [notificationId, notificationOptions] = chrome.notifications.create.mock.calls[0];
    
    expect(notificationOptions.type).toBe('basic');
    expect(notificationOptions.title).toBe('TestApp: Mirrored Title');
    expect(notificationOptions.message).toBe('Mirrored body');
    expect(notificationOptions.iconUrl).toBeDefined();
  });

  it('should use application_name for a mirror push if title is missing', async () => {
    // Arrange
    const push = { 
      type: 'mirror', 
      application_name: 'TestApp', 
      body: 'Mirrored body' 
    };

    // Act
    await showPushNotification(push);

    // Assert
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [notificationId, notificationOptions] = chrome.notifications.create.mock.calls[0];
    
    expect(notificationOptions.title).toBe('TestApp');
    expect(notificationOptions.message).toBe('Mirrored body');
    expect(notificationOptions.iconUrl).toBeDefined();
  });

  it('should use default title for a mirror push if both title and application_name are missing', async () => {
    // Arrange
    const push = { 
      type: 'mirror', 
      body: 'Mirrored body' 
    };

    // Act
    await showPushNotification(push);

    // Assert
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [notificationId, notificationOptions] = chrome.notifications.create.mock.calls[0];
    
    expect(notificationOptions.title).toBe('Notification');
    expect(notificationOptions.message).toBe('Mirrored body');
    expect(notificationOptions.iconUrl).toBeDefined();
  });

  it('should create a basic notification for a file push', async () => {
    // Arrange
    const push = { 
      type: 'file', 
      file_name: 'test.jpg', 
      file_type: 'image/jpeg',
      body: 'A test image' 
    };

    // Act
    await showPushNotification(push);

    // Assert
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [notificationId, notificationOptions] = chrome.notifications.create.mock.calls[0];
    
    expect(notificationOptions.type).toBe('basic');
    expect(notificationOptions.title).toBe('New File: test.jpg');
    expect(notificationOptions.message).toBe('A test image');
    expect(notificationOptions.iconUrl).toBeDefined();
  });

  it('should handle MMS-style file push with title', async () => {
    // Arrange
    const push = { 
      type: 'file', 
      title: 'MMS Image',
      body: 'Check out this image',
      file_type: 'image/jpeg' 
    };

    // Act
    await showPushNotification(push);

    // Assert
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [notificationId, notificationOptions] = chrome.notifications.create.mock.calls[0];
    
    expect(notificationOptions.title).toBe('MMS Image');
    expect(notificationOptions.message).toBe('Check out this image');
    expect(notificationOptions.iconUrl).toBeDefined();
  });

  it('should handle encrypted pushes', async () => {
    // Arrange
    const push = { 
      type: 'note',
      encrypted: true,
      ciphertext: 'encrypted content'
    };

    // Act
    await showPushNotification(push);

    // Assert
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [notificationId, notificationOptions] = chrome.notifications.create.mock.calls[0];
    
    expect(notificationOptions.type).toBe('basic');
    expect(notificationOptions.title).toBe('Pushbullet');
    expect(notificationOptions.message).toContain('encrypted push');
    expect(notificationOptions.iconUrl).toBeDefined();
  });

  it('should store push data in notificationDataStore when provided', async () => {
    // Arrange
    const push = { type: 'note', title: 'Test Note', body: 'Test body' };
    const notificationDataStore = new Map();

    // Act
    await showPushNotification(push, notificationDataStore);

    // Assert
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const [notificationId] = chrome.notifications.create.mock.calls[0];
    
    expect(notificationDataStore.has(notificationId)).toBe(true);
    expect(notificationDataStore.get(notificationId)).toBe(push);
  });

  it('should generate unique notification IDs', async () => {
    // Arrange
    const push1 = { type: 'note', title: 'First Note', body: 'First body' };
    const push2 = { type: 'note', title: 'Second Note', body: 'Second body' };

    // Act
    await showPushNotification(push1);
    await showPushNotification(push2);

    // Assert
    expect(chrome.notifications.create).toHaveBeenCalledTimes(2);
    const [notificationId1] = chrome.notifications.create.mock.calls[0];
    const [notificationId2] = chrome.notifications.create.mock.calls[1];
    
    expect(notificationId1).not.toBe(notificationId2);
  });
});

/**
 * Unit tests for performWebSocketHealthCheck function
 * Tests the new reconnection logic that uses periodic health checks instead of one-shot alarms
 */
describe('performWebSocketHealthCheck - Reconnection Logic', () => {
  let performWebSocketHealthCheck: any;
  let mockWsClient: any;
  let mockConnectFn: any;

  beforeEach(async () => {
    // Reset module state by re-importing
    vi.resetModules();

    // Re-import the module to get fresh state
    const module = await import('../../src/background/utils');
    performWebSocketHealthCheck = module.performWebSocketHealthCheck;

    // Create fresh mocks for each test
    mockWsClient = {
      isConnected: vi.fn(),
      isConnectionHealthy: vi.fn()
    };
    mockConnectFn = vi.fn();

    // Reset getApiKey mock to default (null)
    const { getApiKey } = await import('../../src/background/state');
    (getApiKey as any).mockReturnValue(null);
  });

  it('should check health when WebSocket is connected and healthy', async () => {
    // Arrange
    mockWsClient.isConnected.mockReturnValue(true);
    mockWsClient.isConnectionHealthy.mockReturnValue(true);
    const { getApiKey } = await import('../../src/background/state');
    (getApiKey as any).mockReturnValue('test-api-key');

    // Act
    performWebSocketHealthCheck(mockWsClient, mockConnectFn);

    // Assert
    expect(mockWsClient.isConnectionHealthy).toHaveBeenCalledTimes(1);
    expect(mockConnectFn).not.toHaveBeenCalled();
  });

  it('should emit disconnected event when WebSocket is connected but unhealthy', async () => {
    // Arrange
    mockWsClient.isConnected.mockReturnValue(true);
    mockWsClient.isConnectionHealthy.mockReturnValue(false);
    const { getApiKey } = await import('../../src/background/state');
    (getApiKey as any).mockReturnValue('test-api-key');
    const { globalEventBus } = await import('../../src/lib/events/event-bus');

    // Act
    performWebSocketHealthCheck(mockWsClient, mockConnectFn);

    // Assert
    expect(mockWsClient.isConnectionHealthy).toHaveBeenCalledTimes(1);
    expect(globalEventBus.emit).toHaveBeenCalledWith('websocket:disconnected');
    expect(mockConnectFn).not.toHaveBeenCalled();
  });

  it('should do nothing when WebSocket is disconnected and no API key', () => {
    // Arrange
    mockWsClient.isConnected.mockReturnValue(false);
    // getApiKey is already mocked to return null

    // Act
    performWebSocketHealthCheck(mockWsClient, mockConnectFn);

    // Assert
    expect(mockConnectFn).not.toHaveBeenCalled();
  });

  it('should call connectFn when WebSocket is disconnected but has API key', async () => {
    // Arrange
    mockWsClient.isConnected.mockReturnValue(false);
    // Mock getApiKey to return a key
    const { getApiKey } = await import('../../src/background/state');
    (getApiKey as any).mockReturnValue('test-api-key');

    // Act
    performWebSocketHealthCheck(mockWsClient, mockConnectFn);

    // Assert
    expect(mockConnectFn).toHaveBeenCalledTimes(1);
  });

  it('should call connectFn when WebSocket client is null but has API key', async () => {
    // Arrange
    // Mock getApiKey to return a key
    const { getApiKey } = await import('../../src/background/state');
    (getApiKey as any).mockReturnValue('test-api-key');

    // Act
    performWebSocketHealthCheck(null, mockConnectFn);

    // Assert
    expect(mockConnectFn).toHaveBeenCalledTimes(1);
  });

  it('should call connectFn when WebSocket client is undefined but has API key', async () => {
    // Arrange
    // Mock getApiKey to return a key
    const { getApiKey } = await import('../../src/background/state');
    (getApiKey as any).mockReturnValue('test-api-key');

    // Act
    performWebSocketHealthCheck(undefined, mockConnectFn);

    // Assert
    expect(mockConnectFn).toHaveBeenCalledTimes(1);
  });
});


