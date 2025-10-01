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

## Current state (as of v 1.0.26)

| Feature                          | Status                                                    |
| -------------------------------- | --------------------------------------------------------- |
| Manifest V3 service worker       | ✅ stable                                                 |
| WebSocket real-time stream       | ✅ with exponential-backoff re-connect & polling fallback |
| End-to-end decryption            | ✅ AES-256-GCM (PBKDF2)                                   |
| Outbound pushes (note/link/file) | ✅                                                        |
| Notification deduplication       | ✅ last 1 000 pushes tracked                              |
| Debug / perf logging             | ✅ exportable JSON                                        |
| Unit tests                       | ❌ (contributors welcome)                                 |
| TypeScript                       | ❌ (plain JS for now)                                     |

---

## Install from source

1. Clone or download this repo
2. `npm install` (installs ESLint only)
3. `npm run lint` (optional – should return clean)
4. Chrome ▸ `chrome://extensions` ▸ **Developer mode** ON ▸ **Load unpacked** ▸ select the repo folder
5. Click the new toolbar icon, paste your **Access Token** (from [Pushbullet settings](https://www.pushbullet.com/#settings/account)) and set a **device nickname**.

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
src/                        (proposed – still flat in repo)
 ├─ background.js           MV3 service worker (≈ 1 000 lines – needs modularising)
 ├─ js/crypto.js            E2EE decrypt (AES-256-GCM, PBKDF2)
 ├─ js/popup.js             Pop-up UI logic
 ├─ js/options.js           Settings page
 ├─ js/debug-dashboard.js   Live debug console
 ├─ css/*.css               Themed styles
 └─ *.html                  Pop-up, options, debug pages
```

---

## Contribute

- **Code style**: `npm run lint` (ESLint, no semicolons, 2-spaces)
- **Pull requests**: please add a short note of what you tested manually (unit-test infra coming later)
- **Big items on the wish-list**:  
  – TypeScript migration  
  – Jest or Vitest unit tests  
  – CI that packages a `.zip` ready for Chrome Web-Store

---

## License

MIT – see LICENSE file (or lack thereof – add one if you fork).

---

Enjoy your pushes! 🚀
