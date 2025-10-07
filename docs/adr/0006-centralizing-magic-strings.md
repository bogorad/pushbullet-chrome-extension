# ADR 0006: Centralizing Magic Strings with Enums and Constants

## Status

Accepted

## Context

The codebase currently uses "magic strings" (hardcoded string literals) for critical, repeated values. This is prevalent in several areas:

1.  **Chrome Message Actions**: Actions like `'getSessionData'`, `'apiKeyChanged'`, and `'sendPush'` are defined as raw strings in both the sender (`popup.ts`) and the receiver (`background.ts`).
2.  **Push Types**: Push types such as `'sms_changed'`, `'mirror'`, and `'note'` are used as strings in filtering logic (`background.ts`) and notification handlers (`utils.ts`).
3.  **Storage Keys**: Keys for `chrome.storage` like `'apiKey'` and `'deviceRegistrationInProgress'` are hardcoded in multiple locations.

This practice introduces several problems:

- **Typo-Prone**: A simple typo in a string literal (e.g., `'getSessiongData'`) will not be caught by the TypeScript compiler and will lead to silent failures that are difficult to debug.
- **Difficult to Refactor**: If an action name or key needs to be changed, a developer must perform a project-wide, case-sensitive search-and-replace, which is risky and error-prone.
- **No Single Source of Truth**: The set of all possible values is not defined in one place, making it hard to know what actions or types are available without searching the entire codebase.
- **Poor Developer Experience**: There is no IDE autocompletion for these literal values.

**Example (Message Actions):**

```typescript
// src/popup/index.ts
chrome.runtime.sendMessage({ action: 'getSessionData' }, ...);

// src/background/index.ts
if (message.action === 'getSessionData') {
  // ... handle it
}
```

## Decision

We will eliminate magic strings by centralizing them into TypeScript `enums` and `const` objects, located in `src/types/domain.ts`. This creates a single, type-safe source of truth.

### 1. For Chrome Message Actions

We will create a `MessageAction` enum.

**Implementation (`src/types/domain.ts`):**

```typescript
export enum MessageAction {
  GET_SESSION_DATA = "getSessionData",
  API_KEY_CHANGED = "apiKeyChanged",
  LOGOUT = "logout",
  SEND_PUSH = "sendPush",
  REFRESH_SESSION = "refreshSession",
  SETTINGS_CHANGED = "settingsChanged",
  UPDATE_DEVICE_NICKNAME = "updateDeviceNickname",
  // ... and all others
}
```

**Usage:**

```typescript
// Before
chrome.runtime.sendMessage({ action: "getSessionData" });

// After
import { MessageAction } from "../types/domain";
chrome.runtime.sendMessage({ action: MessageAction.GET_SESSION_DATA });
```

### 2. For Push Types

We will create a `PushType` enum.

**Implementation (`src/types/domain.ts`):**

```typescript
export enum PushType {
  NOTE = "note",
  LINK = "link",
  FILE = "file",
  MIRROR = "mirror",
  DISMISSAL = "dismissal",
  SMS_CHANGED = "sms_changed",
}
```

**Usage:**

```typescript
// Before
const displayableTypes = ['mirror', 'note', 'link', 'sms_changed'];
if (push.type === 'sms_changed') { ... }

// After
import { PushType } from '../types/domain';
const displayableTypes = [PushType.MIRROR, PushType.NOTE, PushType.LINK, PushType.SMS_CHANGED];
if (push.type === PushType.SMS_CHANGED) { ... }
```

### 3. For Storage Keys

We will create a `const` object for storage keys. An enum is also possible, but a simple const object is lighter and sufficient.

**Implementation (`src/types/domain.ts`):**

```typescript
export const StorageKeys = {
  API_KEY: "apiKey",
  DEVICE_IDEN: "deviceIden",
  DEVICE_NICKNAME: "deviceNickname",
  ENCRYPTION_PASSWORD: "encryptionPassword",
  // ... and all others
} as const;
```

## Consequences

### Pros

- **Type Safety**: The TypeScript compiler will now throw an error if a typo is made, eliminating a major source of silent bugs.
- **IDE Autocompletion**: Developers will get autocompletion suggestions (e.g., `MessageAction.`), improving speed and accuracy.
- **Single Source of Truth**: All possible values are defined in one place (`src/types/domain.ts`), making the system self-documenting.
- **Safe Refactoring**: Renaming an enum member in an IDE will automatically and safely update all its usages across the entire project.

### Cons

- **Initial Refactoring Effort**: There is an upfront cost to find and replace all existing magic strings throughout the codebase.
- **Slightly More Verbose**: The code becomes slightly more verbose (e.g., `MessageAction.GET_SESSION_DATA` vs. `'getSessionData'`), but this is a worthwhile trade-off for the massive increase in safety and maintainability.

### Neutral

- **Establishes a Convention**: This decision establishes a clear pattern that all developers must follow for new actions, types, or keys, promoting long-term consistency.
