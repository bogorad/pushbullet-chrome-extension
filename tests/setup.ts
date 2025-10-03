/**
 * Vitest setup file for Chrome Extension API mocking
 * This file runs before all tests to set up the global chrome object
 */

import { vi } from 'vitest';

// Create a comprehensive Chrome API mock
const createChromeMock = () => {
  const listeners = {
    onMessage: [] as any[],
    onInstalled: [] as any[],
    onStartup: [] as any[]
  };

  return {
    runtime: {
      onMessage: {
        addListener: vi.fn((callback: any) => listeners.onMessage.push(callback)),
        removeListener: vi.fn((callback: any) => {
          const index = listeners.onMessage.indexOf(callback);
          if (index > -1) listeners.onMessage.splice(index, 1);
        }),
        hasListener: vi.fn((callback: any) => listeners.onMessage.includes(callback)),
        hasListeners: vi.fn(() => listeners.onMessage.length > 0),
        callListeners: (...args: any[]) => listeners.onMessage.forEach(cb => cb(...args)),
        clearListeners: () => { listeners.onMessage.length = 0; }
      },
      onInstalled: {
        addListener: vi.fn((callback: any) => listeners.onInstalled.push(callback)),
        removeListener: vi.fn((callback: any) => {
          const index = listeners.onInstalled.indexOf(callback);
          if (index > -1) listeners.onInstalled.splice(index, 1);
        }),
        hasListener: vi.fn((callback: any) => listeners.onInstalled.includes(callback)),
        hasListeners: vi.fn(() => listeners.onInstalled.length > 0),
        callListeners: (...args: any[]) => listeners.onInstalled.forEach(cb => cb(...args)),
        clearListeners: () => { listeners.onInstalled.length = 0; }
      },
      onStartup: {
        addListener: vi.fn((callback: any) => listeners.onStartup.push(callback)),
        removeListener: vi.fn((callback: any) => {
          const index = listeners.onStartup.indexOf(callback);
          if (index > -1) listeners.onStartup.splice(index, 1);
        }),
        hasListener: vi.fn((callback: any) => listeners.onStartup.includes(callback)),
        hasListeners: vi.fn(() => listeners.onStartup.length > 0),
        callListeners: (...args: any[]) => listeners.onStartup.forEach(cb => cb(...args)),
        clearListeners: () => { listeners.onStartup.length = 0; }
      },
      lastError: undefined as { message: string } | undefined
    },
    storage: {
      sync: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
        clear: vi.fn()
      }
    },
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn(),
      update: vi.fn(),
      remove: vi.fn()
    },
    tabs: {
      create: vi.fn(),
      query: vi.fn(),
      sendMessage: vi.fn()
    },
    notifications: {
      create: vi.fn(),
      clear: vi.fn()
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn()
    }
  };
};

// Assign the mocked chrome object to the global scope
(global as any).chrome = createChromeMock();

// Reset all mocks before each test to ensure test isolation
beforeEach(() => {
  // Recreate chrome mock for each test
  (global as any).chrome = createChromeMock();
});

