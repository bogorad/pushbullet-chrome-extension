# Pushbullet for Chrome (Unofficial)

> A **Manifest V3** Chrome extension that brings Pushbullet pushes, mirrored notifications and SMS into your browser.  
> This project is **not affiliated with, endorsed by, or connected to Pushbullet Inc.**

---

## What it does

- ✅ Receive and display pushes (notes, links, files, SMS, mirrored notifications) in real-time
- ✅ Auto-decrypt **end-to-end encrypted** messages (SMS, copy-paste, mirrored notifications) when you supply your encryption password
- ✅ Push **outbound** notes, links or file attachments to any of your devices
- ✅ Optional **auto-open** of incoming links in a new tab
- ✅ Dark-theme **debug dashboard** with live logs, performance metrics, state inspection, and data export
- ✅ Full **offline-first** cache – popup opens instantly even if the service worker is asleep
- ✅ Context-menu items (“Push this page”, “Push selection”, etc.)
- ✅ **State machine architecture** for predictable lifecycle management
- ✅ **Persistent logging** that survives service worker restarts (5,000 entries)
- ✅ **SMS notification formatting** with proper sender display

---

## Current state (as of v 1.0.3)

| Feature                          | Status                                                    |
| -------------------------------- | --------------------------------------------------------- |
| Manifest V3 service worker       | ✅ stable with state machine architecture                 |
| WebSocket real-time stream       | ✅ with exponential-backoff re-connect & polling fallback |
| End-to-end decryption            | ✅ AES-256-GCM (PBKDF2)                                   |
| Outbound pushes (note/link/file) | ✅                                                        |
| Notification deduplication       | ✅ last 1,000 pushes tracked                              |
| Debug / perf logging             | ✅ exportable JSON with persistent storage                |
| Unit tests                       | ✅ Vitest with 14 tests covering race conditions          |
| TypeScript                       | ✅ Full TypeScript migration complete                     |
| SMS notification formatting      | ✅ properly displays sender and message content           |
| Persistent logging               | ✅ logs survive service worker restarts (5,000 entries)   |
| State machine lifecycle          | ✅ predictable state transitions and error handling       |
| Extension icon tooltip           | ✅ shows current state machine state on hover             |

---

## Install from source

1. Clone or download this repo
2. `npm install` (installs dependencies including TypeScript, esbuild, Vitest)
3. `npm run build` (compiles TypeScript to JavaScript)
4. `npm test` (optional – runs unit tests)
5. `npm run lint` (optional – should return clean)
6. Chrome ▸ `chrome://extensions` ▸ **Developer mode** ON ▸ **Load unpacked** ▸ select the repo folder
7. Click the new toolbar icon, paste your **Access Token** (from [Pushbullet settings](https://www.pushbullet.com/#settings/account)) and set a **device nickname**.

---

## First run checklist

- [ ] Access Token saved (encrypted at rest with a trivial XOR obfuscation – Chrome storage is already encrypted)
- [ ] Device registered automatically (appears in your Pushbullet device list)
- [ ] Optional: enter your **E2EE password** in ▸ Options ▸ “End-to-End Encryption” if you want incoming SMS / mirrored notifications to be decrypted
- [ ] Optional: enable **Auto-open links**, tweak **notification timeout**, or turn on **debug mode** in Options

---

## Usage tips

| Where           | What                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Toolbar pop-up  | Send notes/links/files, see 10 most recent pushes                                              |
| Right-click     | “Push this page / link / selection / image”                                                    |
| Notification    | Click to open the popup; links automatically open in a new tab if you enabled “Auto-open”      |
| Debug dashboard | “🐛 Debug Dashboard” button inside the pop-up – exports logs, WebSocket metrics, error summary |

---

## Architecture snapshot

```
src/
 ├─ background/
 │   ├─ index.ts            MV3 service worker entry point
 │   ├─ state-machine.ts    State machine for lifecycle management
 │   ├─ state.ts            Background state management
 │   └─ utils.ts            Context menus, notifications, icons, tooltips
 ├─ app/
 │   ├─ session/            Session cache & initialization
 │   ├─ api/                Pushbullet API client
 │   ├─ ws/                 Real-time WebSocket connection
 │   ├─ notifications/      Notification handling and deduplication
 │   └─ reconnect/          WebSocket reconnection logic
 ├─ lib/
 │   ├─ crypto/             E2EE decrypt (AES-256-GCM, PBKDF2)
 │   ├─ logging/            Debug logging with persistent storage
 │   ├─ perf/               Performance monitoring
 │   ├─ monitoring/         WebSocket state and initialization tracking
 │   ├─ events/             Event bus for component communication
 │   ├─ security/           Message validation and security
 │   └─ ui/                 UI utility functions
 ├─ infrastructure/
 │   └─ storage/            Storage repository pattern
 ├─ types/
 │   └─ domain.ts           TypeScript type definitions
 ├─ popup/                  Pop-up UI logic
 ├─ options/                Settings page
 ├─ debug-dashboard/        Live debug console with export functionality
 └─ notification-detail/    Notification detail page

tests/
 ├─ setup.ts                Chrome API mocks
 ├─ app/
 │   └─ session.test.ts     Session initialization tests
 └─ background/
     └─ utils.test.ts       Context menu tests
```

---

## Key Architectural Features

### State Machine Lifecycle Management
The extension uses a finite state machine to manage the service worker lifecycle, ensuring predictable behavior and eliminating race conditions:

- **States**: `IDLE`, `INITIALIZING`, `READY`, `DEGRADED`, `ERROR`
- **Explicit Transitions**: All state changes are logged and traceable
- **Single Source of Truth**: One `currentState` variable eliminates scattered state flags
- **Automatic Fallback**: Transitions to `DEGRADED` state with polling when WebSocket fails
- **Tooltip Integration**: Extension icon tooltip shows current state on hover

See [ADR 0005](docs/adr/0005-service-worker-state-machine.md) for detailed design decisions.

### Persistent Logging
Debug logs survive service worker restarts and browser crashes:

- **Circular Buffer**: Stores last 5,000 log entries in `chrome.storage.local`
- **Periodic Flush**: Logs flushed to storage every minute via Chrome alarms
- **Rehydration**: Previous session's logs loaded on startup
- **Export Functionality**: Debug dashboard can export logs as JSON or formatted text
- **Reverse Chronological**: Newest logs appear first in the debug dashboard

### Intelligent Polling Fallback
The extension automatically switches between WebSocket and polling based on connection health:

- **Primary**: WebSocket for real-time push delivery
- **Fallback**: Polling activates only when state machine enters `DEGRADED` state
- **Automatic Recovery**: Returns to WebSocket when connection is restored
- **No Redundancy**: Polling stops immediately when WebSocket reconnects

### SMS Notification Formatting
Mirrored SMS notifications are properly formatted for clarity:

- **Sender Display**: Shows "SMS: [Sender Name/Number]"
- **Visual Distinction**: Blue left border in popup UI
- **Consistent Formatting**: Same display in both desktop notifications and popup

---

## Testing

This project includes comprehensive unit tests for race condition fixes:

```bash
npm test              # Run all tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

See [README-TESTING.md](README-TESTING.md) for detailed testing documentation.

## Contribute

- **Code style**: `npm run lint` (ESLint + TypeScript)
- **Type checking**: `npm run typecheck`
- **Testing**: `npm test` – please add tests for new features
- **Pull requests**: include tests and ensure all checks pass
- **Big items on the wish-list**:
  – CI that packages a `.zip` ready for Chrome Web-Store
  – More comprehensive test coverage
  – E2E tests for critical user flows

---

## License

MIT – see LICENSE file (or lack thereof – add one if you fork).

---

Enjoy your pushes! 🚀
