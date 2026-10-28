# Opt-in Jev disambiguation fallback (1.5.28)

- Added opt-in Jev (TypeSafe) fallback for ambiguous verification codes only.
- Live docs pinned model `jev-1.14.0`, endpoint `POST https://api.typesafe.ai/v1/systemone`, one Choice question.
- Ambiguous definition: zero keyword-qualified codes but numeric candidates exist, OR more than one distinct qualified candidate. Exactly one qualified candidate is unambiguous and never calls Jev.
- Jev API key stored in `chrome.storage.local` only (`jevApiKey`), password field in options, presence enables feature. No separate toggle.
- State sent to Jev: message body only. Candidates: distinct numeric candidate strings plus `__none__` no-match. Response choice validated against supplied candidates.
- Seam: `extractVerificationCodeWithJevFallback` in `src/lib/verification-code-jev.ts`; wired via `getPushVerificationCodeAsync` in `src/background/utils.ts`, used in `showPushNotification` and the notification button handler in `src/background/index.ts`. Sync `extractVerificationCode`/`getPushVerificationCode` unchanged for other callers (e.g. notification-detail).
- Manifest: added host permission `https://api.typesafe.ai/*` only, required for service-worker fetch to TypeSafe.
- Timeout 8s via AbortController, no retries, fail closed to local result. Key/header/full SMS never logged.
- Tests: 241 passed (35 files) after addition; new mocked-fetch tests cover no-key/unambiguous no-fetch, ambiguous pick, no-match null, HTTP error/timeout/garbage fail-closed, local-only storage, options round-trip. No real Jev API call made.
- Bead: pushbullet-chrome-extension-fqp (open, P3). Version bumped 1.5.27 -> 1.5.28. Build dist/ reverted.
