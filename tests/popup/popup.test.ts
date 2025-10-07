// tests/popup/popup.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Import the HTML content of the popup to simulate the DOM
const popupHtml = fs.readFileSync(path.resolve('popup.html'), 'utf8')

// Mock the modules our popup depends on
vi.mock('src/infrastructure/storage/storage.repository')
vi.mock('src/lib/ui/dom')

describe('Popup UI and Logic', () => {
  beforeEach(() => {
    // 1. Set up the DOM
    // Load the popup's HTML into the test environment
    document.body.innerHTML = popupHtml

    // 2. Dynamically import the popup script
    // This ensures the script runs *after* the DOM is ready
    // and we get a fresh instance for each test.
    import('./src/popup/index.ts')

    // 3. Reset all mocks to ensure test isolation
    vi.resetAllMocks()
  })

  afterEach(() => {
    // Clean up the DOM and mocks after each test
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  // ... Our tests will go here ...
})