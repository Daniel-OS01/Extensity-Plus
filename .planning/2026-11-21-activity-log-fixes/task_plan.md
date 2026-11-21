# Task Plan: Activity & Log Fixes

## Goal

The Dashboard `Activity & Log` section can be turned off, cleared and copied, respects the log level everywhere, and shows compact rows that never overflow the card.

## Next Step

Daniel runs the manual checklist in a loaded unpacked build, then decides on merging `fix/activity-log`.

## Current Phase

Phases 2 to 6 complete on branch `fix/activity-log`. Only the manual checklist is left.

## Design

Evidence and line anchors for every item are in `findings.md`.

### Approaches considered

| Approach | Trade-off | Verdict |
|----------|-----------|---------|
| A. Fix in place: the dashboard page, `logger.js`, one new service worker message | Smallest change. No new files | Chosen |
| B. Split into two tabs, Activity and Log | Clearest separation, but a larger rewrite of the page and its bindings | Rejected: over scope |
| C. Dashboard-only fix, clearing `eventHistory` straight from the page | No service worker change, but breaks the rule that the service worker owns every state change | Rejected |

### Target layout

```
Activity & Log                                              Recording [ On ]

Show   Source [All v]   Result [All v]   [ ] Errors only
Log    Level  [Warn v]                    Copied 42 entries   [Copy] [Clear]

ENABLED   max PayBack Reminder     rule: g2a.com (www)      rule    11/19/2026, 8:50 PM
          > Details
INFO      Drive sync: merged, no changes                    periodic 11/8/2026, 1:40 AM
          > Details
WARN      drive_api_retry                                   log     11/8/2026, 1:39 AM

Showing 100 of 412   [Show more]
```

- Every row uses one grid: badge, title, source, time. Details sit on a second line, collapsed.
- The rule name is a small link that opens the rule. It replaces the large `Open related rule` button.
- Below 700px the toolbar and the row stack into one column.

### Behaviour

| Control | Effect |
|---------|--------|
| Recording switch | Saves `activityLogEnabled`. Off stops both Activity and Log from being saved, on every page. Same setting as the Options checkbox |
| Source or Result set to `Off` | Hides Activity rows on this page. Nothing is deleted. Recording continues |
| Log level | Threshold for Log entries. `None` records no Log entries, in the service worker too |
| Errors only | Shows Log errors and Activity errors |
| Copy | Copies the rows currently shown, oldest first, and reports the count beside the button |
| Clear | After a confirm, deletes the Activity history and the Log on this device |

## Phases

One commit per phase. Gate for every phase: `npm test` and `npm run check:manifest` pass. Baseline on `main` today: 346 tests, all passing.

### Phase 1: Discovery and design

- [x] Trace the six reported problems to their causes (`findings.md` R1 to R6)
- [x] Settle the two open choices with Daniel (`Off` hides rows; `Clear` deletes everything)
- [x] Write this plan
- **Status:** complete

### Phase 2: Bugs (level, clear, copy)

- [x] `js/logger.js`: on load, read the saved level and enabled flag. Add a `chrome.storage.onChanged` listener for the `local` area that updates the in-memory level and enabled flag. Keep the existing guards for a missing `chrome` API.
- [x] `js/background.js`: add `clearActivityLog()` that saves `eventHistory: []`, calls `logger.clearEntries()` and `logger.clearShared()`, and returns `buildState()`. Route it from a new `CLEAR_ACTIVITY_LOG` case in `handleMessage`.
- [x] `js/engine.js`: add `ExtensityApi.clearActivityLog`.
- [x] `js/dashboard.js`: `clearLog` asks `window.confirm`, then calls the new API through `performAction` and empties `logEntries`.
- [x] `js/dashboard.js`: add a pure `buildTimelineText(rows)`. `copyLog` copies `unifiedTimeline()` through it, reports `Copied N entries` or `Nothing to copy`, and reports a clipboard failure as an error.
- [x] `js/dashboard.js`: add `logActionStatus`, shown beside the buttons and cleared after about 3 seconds.
- [x] `js/dashboard.js`: rebuild `logEntries` from the new stored list on every `extensityLog` change, and remove the `subscribe` push. This fixes the stall at 300 entries and the doubled dashboard entries.
- [x] Tests in `tests/browser-modules.test.js`: level `none` records nothing; a stored level is picked up on load; a storage change updates level and enabled flag; `buildTimelineText` covers both row types and an empty list.
- [x] Test in `tests/message-api.test.js`: `CLEAR_ACTIVITY_LOG` empties `eventHistory`.
- [x] Add `CLEAR_ACTIVITY_LOG` to the message list in `docs/extensity-2.0-plan.md` if that list is meant to be complete. Skipped: the list is not complete (no `SAVE_OPTIONS`, most Drive messages), so it was left unchanged.
- **Gate:** each new test fails before its fix and passes after.
- **Status:** complete

### Phase 3: Off controls

- [x] `dashboard.html`: add the Recording switch to the section heading: a button with `role="switch"`, `aria-checked` and a computed label.
- [x] `js/dashboard.js`: `toggleRecording` flips the value and calls `ExtensityApi.saveOptions({ activityLogEnabled: next })`. Only that key is sent.
- [x] `dashboard.html`: add `Off` to the Source and Result dropdowns.
- [x] `js/dashboard.js`: move the filter into a pure `filterHistoryRows(rows, source, result)` that returns no rows when either value is `off`.
- [x] `js/dashboard.js`: `Errors only` keeps Activity rows whose event is an error.
- [x] `dashboard.html`: three empty states: recording is off, no rows match the filters, nothing recorded yet.
- [x] Tests: `filterHistoryRows` for `all`, a specific value, and `off`.
- **Status:** complete

### Phase 4: Layout and overflow

- [x] `dashboard.html`: regroup the toolbar into a `Show` row (Source, Result, Errors only) and a `Log` row (Level, status text, Copy, Clear). Wrap each label and control as one unit.
- [x] `dashboard.html`: one column order for both row types: badge, title, source, time, then details.
- [x] `dashboard.html`: put the details text in `<details><summary>Details</summary>...</details>`.
- [x] `dashboard.html`: replace the `Open related rule` button with a small rule-name link.
- [x] `js/dashboard.js`: move row building into a pure `buildHistoryRow(record)`. For `action === "drive_sync"`, add `summarizeDriveDebug`: list only categories with a non-zero count, or `no changes`.
- [x] `js/dashboard.js`: Log rows use the same local time format as Activity rows.
- [x] `styles/dashboard.css`: toolbar dropdowns get `width: auto` with a minimum width. Rows become a grid `auto minmax(0, 1fr) auto auto`. Details get `overflow-wrap: anywhere` and `min-width: 0`. Add `button.secondary` and `button.danger` variants; Copy is secondary, Clear is danger. Add a rule for widths under 700px.
- [x] Tests: `buildHistoryRow` and `summarizeDriveDebug`, including malformed debug JSON.
- **Status:** complete

### Phase 5: Small wins

Each item is independent. Drop any of them without affecting the rest.

- [x] Rename the `History` tab button to `Activity & Log`.
- [x] Human labels in the Result dropdown (`Turned on`, `Turned off`, `No match`). Values stay the same.
- [x] Build the Source dropdown from the sources present in the data, so Drive sync rows can be filtered.
- [x] Render the first 100 rows with a `Show more` button and a `Showing N of M` line.
- [x] Refresh Activity rows when `eventHistory` changes in storage. Update the rows only, not the whole page state, so unsaved editors in other tabs are untouched.
- [x] Add `alt` text to the header icon in `dashboard.html`. Used `alt=""`: the icon sits beside the visible text `Extensity-Plus`, so it is decorative.
- [x] Apply `button.secondary` to the lesser buttons in Import / Export and Sync Status, where nine and eight equal buttons sit in one row.
- [x] Add `logger.js` to the Makefile `JS=` list so it is minified like the rest. Run `make dist` to confirm.
- **Status:** complete

### Phase 6: Verification and review

- [x] `npm test` and `npm run check:manifest`
- [x] `git --no-pager diff` read line by line; every changed file belongs to this task
- [ ] Manual checklist below, in a loaded unpacked build (owed: needs Daniel in Chrome or Brave)
- [x] Record results in `progress.md`
- **Status:** complete except the manual checklist

## Manual checklist

No automated browser tests exist, so these need a person in Chrome or Brave.

| Step | Expected |
|------|----------|
| Set Log level to `None`, trigger a Drive sync retry or reload the extension | No new Log rows |
| Change the level with the Options page open in a second tab | Both pages follow the new level without a reload |
| Turn Recording off, toggle an extension | No new Activity row. The Options checkbox shows unchecked |
| Set Source to `Off` | Activity rows disappear. Log rows stay. Setting it back restores them |
| Click Copy with rows shown, paste into a text editor | The visible rows, oldest first. `Copied N entries` appears beside the button |
| Click Clear and accept | The list empties and stays empty after a reload |
| Open a row with a long AliExpress URL | Text wraps inside the card. No horizontal scroll |
| Narrow the window below 700px | Toolbar and rows stack. Nothing is cut off |
| Tab through the toolbar with the keyboard | Every control is reachable and shows focus. The switch announces on or off |

## Residual risks

- With Drive sync of the `history` category turned on (off by default), cleared Activity returns from Drive on the next sync. Not handled here.
- Log entries written in the first milliseconds after a page or the service worker starts use the default level (`warn`, recording on) until the saved values load.
- Clipboard write needs the page to be focused. Not verifiable from the test suite.
- Branch `fix/drive-sync-merge-defects` was merged into `main` during this work. `fix/activity-log` merges into it with no conflicts, and the merged tree passes 395 tests.
- Race: an extension change that is already running when Clear is clicked can write the old Activity rows back. Mutations in `background.js` read, wait on `chrome.management`, then write, and nothing serialises them. The shared log has the same read, modify and write race. Not fixed here.
- The Options page saves its whole options object. If it is open while Recording is turned off on the dashboard, a later save there writes `activityLogEnabled: true` back. The dashboard now follows the change; the Options page does not.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Fix in place, no new files | Smallest change that covers every reported item |
| `logger.js` syncs its own level and enabled flag | One fix for every page and the service worker |
| `CLEAR_ACTIVITY_LOG` handled by the service worker | Single owner of state changes |
| `Off` in Source or Result hides rows only | Daniel, 2026-11-21 |
| One `Clear` button, with a confirm | Daniel, 2026-11-21 |
| Recording switch saves only `activityLogEnabled` | Avoids persisting unsaved Drive fields from the same page |
| Details collapsed in `<details>` | Fixes overflow and noise with no script |

## Errors Encountered

| Error | Resolution |
|-------|------------|
| None | |
