# Options auto-save on change with top-right toast

- Implemented options-local toast (`src/options/toast.ts`): fixed top-right
  `#toast-container`, `showToast(type, text)`, max 3 stacked, success/info
  auto-hide 3s, error persists with close button. Correct class contract
  (`.toast` + `.toast-success|error|info`), `role=status` + `aria-live`.
- Replaced all `showStatus()` calls in options with toasts; removed bottom
  `#status-message` element and its CSS (palette reused for toast styles).
- Nickname auto-save: 500ms debounced `input`, immediate commit on
  `change`/pending-`blur`; trimmed; empty rejected with error toast, no save.
  Deleted Update nickname button.
- Converted handlers (notification timeout, auto-open links x2, only-this-device,
  encryption password on change only, debug mode, Jev verify-gated flow) to toast
  on success and failure. `SETTINGS_CHANGED` senders (auto-open links,
  only-this-device) and nickname now await the background `{success}` response
  and report local-save vs background-sync results separately.
- Deleted `#save-settings` button and `saveAllSettings()`; all controls save
  independently.
- Tests: new `tests/options/toast.test.ts` (5), 5 new tests in
  `tests/options/options.test.ts` (Save All batch test replaced), extended
  `tests/scripts/dist-jev-shipped.test.ts` (+3). Full suite: 38 files,
  267 tests green. Typecheck, lint, build clean. dist/ rebuilt and kept.
- Version 1.5.31 -> 1.5.32 via `scripts/bump-patch.cjs`.
- Out of scope, untouched: Reset partial coverage, debug load path, default
  inconsistencies, popup `showStatus`, `src/lib/ui/dom.ts`.
