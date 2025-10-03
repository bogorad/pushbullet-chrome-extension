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
vi.mock('../../src/lib/logging', () => ({
  debugLogger: {
    general: vi.fn(),
    storage: vi.fn(),
    api: vi.fn()
  }
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

