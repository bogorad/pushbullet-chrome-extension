// tests/popup/popup.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Chrome API is mocked globally in tests/setup.ts
declare const chrome: any

// Import the HTML content of the popup to simulate the DOM
const popupHtml = fs.readFileSync(path.resolve('popup.html'), 'utf8')

// Mock the modules our popup depends on
vi.mock('src/infrastructure/storage/storage.repository', () => ({
  storageRepository: {
    setApiKey: vi.fn(),
    setDeviceNickname: vi.fn(),
    setDeviceIden: vi.fn(),
    getApiKey: vi.fn(),
    getScrollToRecentPushes: vi.fn(),
    removeScrollToRecentPushes: vi.fn()
  }
}))
vi.mock('src/lib/ui/dom', () => ({
  getElementById: vi.fn((id) => document.getElementById(id))
}))

describe('Popup UI and Logic', () => {
  beforeEach(() => {
    // 1. Set up the DOM
    // Load the popup's HTML into the test environment
    document.body.innerHTML = popupHtml

    // 2. Reset all mocks to ensure test isolation
    vi.resetAllMocks()
  })

  afterEach(() => {
    // Clean up the DOM and mocks after each test
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  describe('Initial Rendering', () => {
    it('should show the loading section initially', async () => {
      // ARRANGE: Set up DOM
      document.body.innerHTML = popupHtml

      // ACT: Import the popup script, which calls init and shows loading
      await import('./../../src/popup/index.ts')

      // ASSERT:
      expect(document.getElementById('loading-section')!.style.display).toBe('flex')
      expect(document.getElementById('login-section')!.style.display).toBe('none')
      expect(document.getElementById('main-section')!.style.display).toBe('none')
    })
  })

  // ... More tests can be added later ...
})