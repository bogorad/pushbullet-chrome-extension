# Pushbullet for Chrome (Unofficial)

> A **Manifest V3** Chrome extension that brings Pushbullet pushes, mirrored notifications and SMS into your browser.  
> This project is **not affiliated with, endorsed by, or connected to Pushbullet Inc.**

---

## What it does

- ✅ Receive and display pushes (notes, links, files, SMS, mirrored notifications) in real-time
- ✅ Auto-decrypt **end-to-end encrypted** messages (SMS, copy-paste, mirrored notifications) when you supply your encryption password
- ✅ Push **outbound** notes, links or file attachments to any of your devices
- ✅ Optional **auto-open** of incoming links in a new tab
- ✅ Dark-theme **debug dashboard** (WebSocket health, push logs, performance metrics)
- ✅ Full **offline-first** cache – popup opens instantly even if the service worker is asleep
- ✅ Context-menu items (“Push this page”, “Push selection”, etc.)

---

## Current state (as of v 1.0.60)

| Feature                          | Status                                                    |
| -------------------------------- | --------------------------------------------------------- |
| Manifest V3 service worker       | ✅ stable                                                 |
| WebSocket real-time stream       | ✅ with exponential-backoff re-connect & polling fallback |
| End-to-end decryption            | ✅ AES-256-GCM (PBKDF2)                                   |
| Outbound pushes (note/link/file) | ✅                                                        |
| Notification deduplication       | ✅ last 1 000 pushes tracked                              |
| Debug / perf logging             | ✅ exportable JSON                                        |
| Unit tests                       | ✅ Vitest with 14 tests covering race conditions          |
| TypeScript                       | ✅ Full TypeScript migration complete                     |

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
 │   ├─ state.ts            Background state management
 │   └─ utils.ts            Context menus, notifications, icons
 ├─ app/
 │   ├─ session/            Session cache & initialization
 │   ├─ api/                Pushbullet API client
 │   └─ websocket/          Real-time WebSocket connection
 ├─ lib/
 │   ├─ crypto.ts           E2EE decrypt (AES-256-GCM, PBKDF2)
 │   └─ logging.ts          Debug logging infrastructure
 ├─ popup/                  Pop-up UI logic
 ├─ options/                Settings page
 ├─ debug-dashboard/        Live debug console
 └─ notification-detail/    Notification detail page

tests/
 ├─ setup.ts                Chrome API mocks
 ├─ app/
 │   └─ session.test.ts     Session initialization tests
 └─ background/
     └─ utils.test.ts       Context menu tests
```

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
