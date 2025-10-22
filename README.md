# Pushbullet for Chrome with SMS Reception (Unofficial)

A modern, feature-rich Chrome extension for Pushbullet built with Manifest V3 architecture. Send and receive pushes, view mirrored notifications (including SMS messages), and interact with your Pushbullet account and friends directly from your browser.

> **Note:** This project is not affiliated with, endorsed by, or connected to Pushbullet Inc.

---

## Features

### Core Functionality
- **Send Pushes** - Share notes, links, and files to your devices or Pushbullet friends
- **Receive Pushes** - Get real-time notifications for incoming pushes via WebSocket connection
- **SMS Reception** - View and reply to SMS messages from your computer (requires Android device)
- **Friend Messaging** - Send pushes directly to your Pushbullet contacts
- **Mirror Notifications** - Receive mirrored Android notifications in Chrome
- **Context Menu Integration** - Right-click to instantly push links, images, selected text, or current page

### Advanced Features
- **Auto-Open Links** - Automatically open link pushes in background tabs (configurable in settings)
- **End-to-End Encryption** - Support for encrypted pushes with password-based decryption
- **Intelligent Reconnection** - Automatic WebSocket reconnection with health monitoring
- **Fallback Polling** - Seamlessly switches to polling mode during network issues
- **State Machine Architecture** - Robust lifecycle management for service worker reliability
- **Instant Loading** - IndexedDB hydration provides ~100ms popup loading (vs 2.5s) with seamless background refresh

### Developer Tools
- **Debug Dashboard** - Comprehensive diagnostics interface (click 🐛 icon in popup)
  - Real-time WebSocket connection status and state machine monitoring
  - Complete log browser with category and level filtering
  - Performance metrics (connection uptime, latency, notification processing)
  - MV3 lifecycle statistics (service worker restarts, recovery times)
  - Error tracking with critical error highlighting
  - Configuration management and system info viewer
  - Export logs as JSON or text for bug reporting

- **Persistent Logging** - All debug logs stored in IndexedDB, survive service worker restarts
- **Performance Monitoring** - Track WebSocket health, notification processing, and API latency
- **Error Tracking** - Automatic error categorization and stack trace collection

---

## Installation

### From Source

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/pushbullet-chrome-extension.git
   cd pushbullet-chrome-extension
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build
   ```

4. **Load in Chrome**
   - Open Chrome and navigate to `chrome://extensions`
   - Enable "Developer mode" (toggle in top-right corner)
   - Click "Load unpacked"
   - Select the `dist/` directory from the project

5. **Configure**
   - Click the Pushbullet extension icon in your toolbar
   - Enter your Access Token from [Pushbullet Account Settings](https://www.pushbullet.com/#settings/account)
   - Provide a nickname for your browser (e.g., "Chrome on Laptop")

---

## Usage

### Toolbar Popup
Click the extension icon to access the main interface:
- **Send Tab** - Create and send notes, links, or files
- **Send To Dropdown** - Choose specific devices or friends:
  - Select "All My Devices" to broadcast
  - Select individual devices (e.g., "iPhone", "Chrome")
  - Select friends (prefixed with "F:", e.g., "F: John Doe")
- **Recent Pushes** - View your 10 most recent pushes

### Context Menu
Right-click on any page element for quick push actions:
- **Push this link** - Share links directly
- **Push this page** - Share the current page URL
- **Push selected text** - Share highlighted text as a note
- **Push this image** - Share image URLs

### Notifications
- Incoming pushes appear as native Chrome notifications
- Click notifications to open push details
- SMS messages show contact photos when available
- Mirrored Android notifications display app icons

### Debug Dashboard
Access comprehensive diagnostics:
1. Click the 🐛 icon in the popup
2. **Logs Tab** - View all extension activity with filters
3. **Performance Tab** - Monitor WebSocket health and metrics
4. **Errors Tab** - Review error summaries and stack traces
5. **Config Tab** - View current configuration and system info
6. **Export** - Download logs for troubleshooting (JSON or text format)

---

## Architecture

### Manifest V3 Compliance
Built with Chrome's latest extension architecture:
- Service worker-based background script (no persistent background pages)
- Event-driven architecture with global event bus
- State machine for lifecycle management
- Keepalive mechanisms to maintain WebSocket connections

### Key Components
- **Background Service Worker** - Manages WebSocket connections, push handling, and notifications
- **State Machine** - Handles service worker lifecycle transitions (ACTIVE, DEGRADED, ERROR states)
- **Session Manager** - Maintains user session data (devices, chats, recent pushes)
- **WebSocket Client** - Real-time push delivery with automatic reconnection
- **Storage Layer** - IndexedDB for persistent logs and session cache, chrome.storage for settings
- **Debug System** - Comprehensive logging with persistent storage and dashboard UI

### Data Flow
1. User authenticates with API key
2. Session initialized (fetch user info, devices, chats, recent pushes)
3. WebSocket connection established for real-time pushes
4. Incoming pushes processed, decrypted (if E2E encrypted), and displayed
5. State machine monitors connection health, switches to polling if needed
6. Session data persisted to IndexedDB, survives service worker restarts

### Performance Optimizations
- **IndexedDB Hydration** - Session data cached in IndexedDB eliminates 2-3 second service worker wake-up delays
- **Race Condition Prevention** - Singleton promise pattern prevents duplicate initialization attempts
- **Background Refresh** - Fresh data fetched in background while cached data serves immediate UI requests
- **Cache Freshness** - 5-minute TTL with automatic background updates for data consistency

---

## Building from Source

### Prerequisites
- Node.js (v16 or later)
- npm or yarn

### Build Commands

**Development build** (watch mode with source maps):
```bash
npm run dev
```

**Production build** (optimized, minified):
```bash
npm run build
```

**Run tests**:
```bash
npm test
```

**Lint code**:
```bash
npm run lint
```

**Type check**:
```bash
npm run type-check
```

### Project Structure
```
src/
├── background/         # Service worker and state machine
├── popup/              # Main UI popup
├── options/            # Settings page
├── debug-dashboard/    # Developer diagnostics dashboard
├── app/
│   ├── api/           # Pushbullet API client
│   ├── session/       # Session management
│   ├── ws/            # WebSocket client
│   └── notifications/ # Notification handling
├── infrastructure/
│   └── storage/       # IndexedDB and chrome.storage
├── lib/
│   ├── logging/       # Debug logging system
│   ├── perf/          # Performance monitoring
│   ├── monitoring/    # WebSocket health monitoring
│   ├── crypto/        # E2E encryption
│   └── events/        # Event bus
└── types/             # TypeScript type definitions
```

---

## Configuration

### Settings (Options Page)
Access via popup → ⚙️ icon:
- **Auto-Open Links** - Automatically open link pushes in background tabs
- **Notification Timeout** - How long notifications remain visible (seconds)
- **Device Nickname** - Name shown to other Pushbullet clients
- **Encryption Password** - Password for decrypting E2E encrypted pushes

### Debug Configuration (Debug Dashboard)
Access via popup → 🐛 icon → Config tab:
- **Enable/Disable Logging** - Toggle debug log collection
- **Log Categories** - Filter by WEBSOCKET, NOTIFICATIONS, API, etc.
- **Log Level** - Set minimum level (DEBUG, INFO, WARN, ERROR)
- **Max Log Entries** - Limit log buffer size (default: 1000)

---

## Troubleshooting

### WebSocket Not Connecting
1. Open Debug Dashboard (🐛 icon)
2. Check "State Machine" status in Performance tab
3. Verify API key in settings
4. Check browser console for errors
5. Try "Refresh Session" in popup

### No Notifications Appearing
1. Check Chrome notification permissions for the extension
2. Verify system notifications are enabled in OS settings
3. Check Debug Dashboard → Logs tab for errors
4. Ensure "Do Not Disturb" is disabled

### SMS Not Showing
1. Verify Android device is connected to Pushbullet
2. Check SMS permissions are granted on Android device
3. Enable SMS mirroring in Pushbullet Android app settings
4. Check Debug Dashboard for "sms_changed" push events

### Friends Not Appearing in Dropdown
1. Verify you have Pushbullet friends (add them on pushbullet.com)
2. Try "Refresh Session" in popup
3. Check Debug Dashboard → Logs for "Chats loaded successfully"
4. Rebuild extension: `npm run build` and reload

### Service Worker Inactive
This is normal Manifest V3 behavior. The service worker:
- Wakes on events (alarms, messages, notifications)
- Maintains WebSocket with keepalive alarms (every 30 seconds)
- Persists state to IndexedDB before sleeping

### Export Debug Logs
If issues persist:
1. Open Debug Dashboard (🐛 icon)
2. Click "Export JSON" or "Export Text"
3. Share logs when reporting issues on GitHub

---

## Privacy & Security

### Data Storage
- **API Key** - Stored locally in `chrome.storage.local` (not synced, plain text)
- **Session Data** - Cached in IndexedDB (devices, chats, recent pushes)
- **Debug Logs** - Stored locally in IndexedDB (last 5,000 entries)
- **Settings** - Stored in `chrome.storage.local`

### Security Measures
- End-to-end encryption support for sensitive pushes (password-based)
- Message sender validation prevents external script injection
- XSS protection via Content Security Policy and input sanitization
- Image URLs validated against trusted domains (Pushbullet, Google)
- No data sent to third parties (only communicates with Pushbullet API)

### Permissions Required
- `storage` - Save settings and session data
- `notifications` - Show push notifications
- `alarms` - Keep service worker alive, periodic health checks
- `contextMenus` - Right-click push actions
- Host permissions for `api.pushbullet.com` and `stream.pushbullet.com`

---

## Development

### Testing
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Debug Logging
Enable comprehensive logging:
1. Open Debug Dashboard (🐛 icon in popup)
2. Toggle "Enable Debug Logging" switch
3. Select log categories to monitor
4. Set log level (DEBUG for verbose output)

### Hot Reload Development
```bash
npm run dev
```
This watches for file changes and rebuilds automatically. Reload the extension in Chrome after builds complete.

---

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## Credits

- Built with TypeScript, Webpack, and Chrome Extension APIs
- Uses Pushbullet's official API (unofficial client)
- Inspired by the need for a modern, MV3-compliant Pushbullet extension

---

## Changelog

### Version 1.3.42 (Current)
- **Performance Boost** - IndexedDB hydration eliminates 2-3s popup loading delays (~100ms instant loading)
- **Race Condition Fixes** - Singleton promise pattern prevents duplicate initialization
- **Background Refresh** - Seamless data updates while serving cached content
- **Cache Management** - 5-minute TTL with automatic freshness checks

### Version 2.0.0
- **Major Rewrite** - Full Manifest V3 migration
- **Friends Support** - Send pushes to Pushbullet contacts
- **Debug Dashboard** - Comprehensive diagnostics and logging UI
- **State Machine** - Robust service worker lifecycle management
- **Persistent Logging** - IndexedDB storage for debug logs
- **Improved Reconnection** - Intelligent health monitoring and fallback polling
- **Performance Metrics** - Track WebSocket, notifications, and API latency
- **E2E Encryption** - Support for password-based encrypted pushes
- **Enhanced Notifications** - Contact photos for SMS, app icons for mirrored notifications
- **Error Tracking** - Automatic categorization and stack trace collection

### Version 1.x (Legacy)
- Original Manifest V2 implementation
- Basic push sending and receiving
- SMS reception support
