# Security & Architecture Audit Report

This document outlines the findings of a holistic audit of the Pushbullet Chrome Extension codebase. It highlights critical security vulnerabilities, architectural concerns, logic flaws, and maintainability issues.

## 1. DOM XSS via Naive HTML Sanitization
**Severity**: [Critical]
**Description**: The `setHTML` utility uses a weak regular expression (`/<script\b.../gi`) to sanitize HTML before assigning it to `innerHTML`. This approach fails to neutralize non-script XSS vectors, such as `<img src=x onerror=alert(1)>` or `javascript:` URIs. If an attacker crafts a malicious push message and this function is utilized, they could execute arbitrary JavaScript in the context of the extension, compromising API keys and user data.
**Location**: `src/lib/ui/dom.ts`, lines 62-66
**Fix**: Replace the unsafe regex with a dedicated sanitization library like `DOMPurify`, or strictly use `textContent` when displaying untrusted data.

```typescript
// Replace:
export function setHTML(element: HTMLElement, html: string): void {
  const sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  element.innerHTML = sanitized;
}

// With DOMPurify:
import DOMPurify from 'dompurify';
export function setHTML(element: HTMLElement, html: string): void {
  element.innerHTML = DOMPurify.sanitize(html);
}
```

## 2. Plaintext Storage of E2EE Password
**Severity**: [High]
**Description**: The End-to-End Encryption password (`ENCRYPTION_PASSWORD_KEY`) falls back to being stored in plaintext in `chrome.storage.local` on browsers where `sessionStorage` is unavailable. Storing cryptographic keys unencrypted on disk exposes them to local extraction and potential leakage through device backups or filesystem vulnerabilities.
**Location**: `src/infrastructure/storage/storage.repository.ts`, lines 268-281
**Fix**: Never fall back to persistent disk storage for sensitive encryption keys. If `sessionStorage` is unavailable, keep the key in memory or prompt the user per session.

```typescript
async setEncryptionPassword(password: string | null): Promise<void> {
  const sessionStorage = this.getSessionStorage();
  if (password === null) {
    await sessionStorage?.remove([ENCRYPTION_PASSWORD_KEY]);
    await chrome.storage.local.remove([ENCRYPTION_PASSWORD_KEY]);
  } else if (sessionStorage) {
    await sessionStorage.set({ [ENCRYPTION_PASSWORD_KEY]: password });
    // Clean up any legacy plaintext data
    await chrome.storage.local.remove([ENCRYPTION_PASSWORD_KEY]);
  } else {
    // Instead of writing to local storage, throw or fallback to an in-memory variable
    throw new Error('Secure session storage is not available in this browser context.');
  }
}
```

## 3. Race Condition in Auto-Open MRU State
**Severity**: [Medium]
**Description**: The `markOpened` function reads the Most Recently Used (MRU) state asynchronously from storage, modifies it, and saves it back. During rapid offline synchronization or concurrent WebSocket events, multiple pushes can trigger `markOpened` simultaneously. This causes their state updates to overlap and overwrite each other, leading to data loss, corrupted `maxOpenedCreated` markers, and duplicate tabs opening for the same push.
**Location**: `src/infrastructure/storage/opened-mru.repository.ts`, lines 26-38
**Fix**: Implement a Mutex (e.g., using `navigator.locks` or an async lock utility) to serialize read-modify-write operations on the MRU storage.

```typescript
// Ensure mutually exclusive access to the MRU storage update
export async function markOpened(iden: string, created: number): Promise<void> {
  await navigator.locks.request('mru_update_lock', async () => {
    const mru = await loadMRU();
    if (!mru.idens.includes(iden)) {
      mru.idens.unshift(iden);
      if (mru.idens.length > MRU_CAP) mru.idens.length = MRU_CAP;
    }
    if (Number.isFinite(created) && created > mru.maxOpenedCreated) {
      mru.maxOpenedCreated = created;
    }
    await saveMRU(mru);
  });
}
```

## 4. "God Object" Architectural Violation
**Severity**: [Medium]
**Description**: The background script entry file `src/background/index.ts` is over 1,800 lines long and handles almost every responsibility in the extension: message routing, alarm handling, notification clicks, context menus, and upload error orchestration. This violates the Single Responsibility Principle, making the codebase fragile, hard to test, and difficult to maintain.
**Location**: `src/background/index.ts`
**Fix**: Extract discrete responsibilities into domain-specific modules. For instance, pull the 700-line `onMessage` listener block into a dedicated `src/background/messaging.ts` router, and move Chrome event registrations to separate controller files.

```typescript
// Refactored index.ts (Entry Point)
import { registerMessageHandlers } from './messaging';
import { registerAlarms } from './alarms';
import { registerContextMenus } from './menus';
import { registerNotifications } from './notifications';

// Delegate to domain-specific modules
registerMessageHandlers();
registerAlarms();
registerContextMenus();
registerNotifications();
```

## 5. Missing `rel="noopener noreferrer"` on External Links
**Severity**: [Low]
**Description**: When rendering pushes containing URLs, the extension creates anchor tags with `target="_blank"` but does not set `rel="noopener noreferrer"`. This exposes the `window.opener` context to the newly opened page, presenting a theoretical risk if the target link is malicious or hijacked.
**Location**: `src/popup/index.ts`, lines 640-647
**Fix**: explicitly add `rel="noopener noreferrer"` to dynamically generated link elements.

```typescript
if (url) {
  const urlEl = document.createElement("a");
  urlEl.href = url as string;
  urlEl.target = "_blank";
  urlEl.rel = "noopener noreferrer"; // Add this line
  urlEl.className = "push-url";
  urlEl.textContent = url || '';
  pushItem.appendChild(urlEl);
}
```
