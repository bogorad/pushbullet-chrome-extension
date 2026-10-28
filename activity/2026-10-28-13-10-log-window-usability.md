# Log window usability

Decision: Improve the primary log surface only (`debug-dashboard.html` + `src/debug-dashboard/index.ts`). Popup only opens that dashboard. No new framework or virtualization library.

Change: Added pure helper `src/debug-dashboard/log-view.ts` (combined category/level/text filter, 1000-line render cap, relative time, near-bottom check, text export, prefs parsing) and `tests/debug-dashboard/log-view.test.ts`. Dashboard now has combined filters, follow-tail with jump-to-bottom, copy/download filtered `.log`/`.json`, clear (existing header button) plus showing X of Y counts, relative timestamps with absolute title, wrap and density toggles, and localStorage persistence of filter/wrap/density prefs. Render order is chronological so newest is at bottom. Bumped patch version to 1.5.25. Bead: pushbullet-chrome-extension-p4t.

Reason: Logs were newest-first, unfiltered export only, no counts, no follow-tail, and no persisted view prefs. Bounded fragment render keeps auto-refresh cheap.
