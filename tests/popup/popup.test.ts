// tests/popup/popup.test.ts

// Import necessary tools
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'

// Chrome API is mocked globally in tests/setup.ts
declare const chrome: any

// Mock the storage repository dependency
vi.mock('src/infrastructure/storage/storage.repository', () => ({
  storageRepository: {
    setApiKey: vi.fn(),
    setDeviceNickname: vi.fn(),
    setDeviceIden: vi.fn(),
    getScrollToRecentPushes: vi.fn().mockResolvedValue(false),
    removeScrollToRecentPushes: vi.fn()
  }
}))

// Read the HTML file content from the disk once
const { default: popupHtml } = await vi.importActual('/popup.html?raw')

describe('Popup UI and Logic', () => {
  beforeAll(() => {
    // Set up the DOM once for all popup tests
    document.body.innerHTML = popupHtml
  })

  beforeEach(() => {
    // Reset all mocks to ensure tests don't interfere with each other
    vi.resetAllMocks()
  })

  afterAll(() => {
    // Clean up the DOM after all tests
    document.body.innerHTML = ''
  })

  // --- TEST CASE 1: Unauthenticated User ---
  it('should show the login section if the user is not authenticated', async () => {
    // ARRANGE: Set up our mocks BEFORE running the script.
    // We will tell the mocked chrome API how to respond.
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.action === 'getSessionData') {
        // Simulate the background script responding that the user is not logged in.
        callback({ isAuthenticated: false })
      }
    })

    // ACT: Import the popup module and call init
    const { init } = await vi.importActual('../../src/popup/index.ts') as { init: () => void }
    init()

    // ASSERT: Check if the DOM is in the correct state.
    const loginSection = document.getElementById('login-section')
    const mainSection = document.getElementById('main-section')

    expect(loginSection!.style.display).toBe('block')
    expect(mainSection!.style.display).toBe('none')
  })

  // --- TEST CASE 2: Authenticated User ---
  it('should show the main section if the user is authenticated', async () => {
    // ARRANGE:
    const mockSession = {
      isAuthenticated: true,
      userInfo: { name: 'Test User', email: 'test@example.com' },
      devices: [],
      recentPushes: [],
      autoOpenLinks: true,
      deviceNickname: 'Chrome'
    }

    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.action === 'getSessionData') {
        callback(mockSession)
      }
    })

    // ACT: Import the popup module and call init
    const { init } = await vi.importActual('../../src/popup/index.ts') as { init: () => void }
    init()

    // ASSERT:
    const loginSection = document.getElementById('login-section')
    const mainSection = document.getElementById('main-section')
    const userNameElement = document.getElementById('user-name')

    expect(mainSection!.style.display).toBe('block')
    expect(loginSection!.style.display).toBe('none')
    expect(userNameElement!.textContent).toBe('Test User')
  })
})