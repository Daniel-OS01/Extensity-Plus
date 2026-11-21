# Findings & Decisions

## Requirements

From Daniel, 2026-11-21, about the Dashboard `Activity & Log` section:

- The layout looks bad and text overflows.
- There is no way to turn the log off. Log level `None` still logs.
- `Clear log` does not clear. `Copy log` copies nothing.
- Add an `Off` option to the Source and Result dropdowns.
- Add a checkbox or button that turns off all of Activity & Log.
- Look at other parts and pick up small wins.
- Do not overcomplicate. Good enough is the bar.

Answered in this session:

- `Off` in Source or Result hides activity rows on the page. Recording continues.
- `Clear` deletes both the activity history and the diagnostic log, after a confirm.

## Glossary

The page shows two different things under one heading. Every bug below comes from treating them as one.

| Term | Meaning | Stored in | Written by |
|------|---------|-----------|------------|
| Activity | Extension events: enabled, disabled, rule evaluation, Drive sync audit | `localState.eventHistory`, max 500 (`js/history-logger.js:3`) | Service worker only |
| Log | Diagnostic entries with a level (error, warn, info, debug) | `chrome.storage.local.extensityLog`, max 300 (`js/logger.js:5,7`) | `js/logger.js` in any page |
| Timeline | The merged, time-sorted list on the page | Not stored (`js/dashboard.js:1222`) | Dashboard |
| Recording | Master switch for both | Sync option `activityLogEnabled` (`js/storage.js:4`), mirrored to local storage by `logger.setEnabled` | Options page today |

## Research Findings

### R1. Log level `None` still logs

Three separate causes.

1. The level lives in memory per page. Only the dashboard ever reads the saved value (`js/dashboard.js:1168`). The service worker loads `logger.js` (`js/background.js:8`) and never calls `loadLevel`, so it always logs at the default `warn` (`js/logger.js:8,12`).
2. Nothing listens for a level change. A page that is already open keeps its old level.
3. Most rows on the page are Activity, which the level never governed. The `INFO merged` rows in the screenshot are Drive sync audit records (`js/background.js:1589-1606`), not Log entries.

### R2. `Clear log` does not clear

`clearLog` (`js/dashboard.js:1205-1211`) clears only the Log. No message exists to clear `eventHistory`, so every Activity row stays.

### R3. `Copy log` copies nothing

`copyLog` (`js/dashboard.js:1213-1220`) copies only Log entries. With no Log entries it writes an empty string. It gives no feedback and ignores a rejected clipboard promise.

### R4. Text overflows the card

`.event-meta.debug-line` (`styles/dashboard.css:116-120`) has no `overflow-wrap`. Long URLs and JSON are single unbroken tokens, and the flex children have no `min-width: 0`, so they push past the card edge.

### R5. Layout

- `select { width: 100% }` is global (`styles/options.css:94-106`). Inside the wrapping flex row each dropdown takes a full line, which produces the stacked filter block in the second screenshot.
- Rows use `flex-wrap` with `space-between` (`styles/dashboard.css:85-93`). The date lands beside the button on rule rows and below the details on others.
- Log rows and Activity rows order their columns differently (`dashboard.html:99-114`).
- Log rows show UTC time cut from the ISO string (`js/dashboard.js:1115`). Activity rows show local time (`js/dashboard.js:691`).
- Drive sync rows dump the whole audit JSON, mostly zero counts.
- `Open related rule` is a large primary button on every rule row.

### R6. No off switch on this page

The master switch exists only at `options.html:145`.

### Other defects found while reading

- `Errors only` drops every Activity row, including Activity errors such as a Drive conflict (`js/dashboard.js:1240-1242`).
- Live Log updates stop once the shared log reaches 300 entries: `newList.slice(oldList.length)` returns nothing when both lists are the same length (`js/dashboard.js:1187`).
- A Log entry written by the dashboard itself is added twice, once by `subscribe` (`js/dashboard.js:1172`) and once by the storage listener (`js/dashboard.js:1182`).
- Activity rows do not update while the page is open.
- The tab button says `History` while the heading and the Options page say `Activity & Log`.
- The Source dropdown lists six sources. Drive sync rows carry others (`periodic`, `recovery`, and whatever `js/background.js:1771` passes), so they can never be selected.
- Status messages render at the top of the page (`dashboard.html:41-42`). Feedback for a button far down a long list is off screen.
- Up to 800 rows render at once.

### Constraints checked

- `storage.saveSyncOptions` accepts a partial object (`js/storage.js:496-502`), so the dashboard can save `{ activityLogEnabled }` alone without persisting unsaved Drive fields.
- `saveOptions` in the service worker already calls `applyRuntimeOptions`, which calls `logger.setEnabled` (`js/background.js:42-49,1846-1849`).
- KSB has no ternary. Labels that depend on state need ViewModel computeds.
- `window.confirm` is already used for destructive actions (`js/profiles.js:456,471`).
- No `.secondary` button style exists. A `.danger` variant exists only for popup and profiles buttons.
- `js/logger.js` is copied to `dist/` by the `js` directory copy. It is not in the Makefile `JS=` minify list, so it ships unminified. Harmless.
- Drive sync merges the `history` category as a union by id (`js/drive-sync.js:357-381`). The category is off by default (`js/drive-sync.js:16`). With it on, cleared Activity returns from Drive on the next sync.
- Branch `fix/drive-sync-merge-defects` is unmerged and touches `js/drive-sync.js` and `js/background.js`. This work does not touch `js/drive-sync.js`.

### UI guidance used (ui-ux-pro-max, `ux` domain)

- Long tokens: `overflow-wrap: anywhere` plus `min-inline-size: 0` on the flex or grid child. Do not use `word-break: break-all`.
- Truncation: collapse long content with an expand control.
- Feedback: confirm a completed action with a brief message that clears itself.

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Fix in place: `dashboard.html`, `js/dashboard.js`, `styles/dashboard.css`, `js/logger.js`, one new service worker message | Smallest change that fixes every reported item. No new files, so no Makefile or manifest change |
| `logger.js` loads its saved level and enabled flag itself and listens to `chrome.storage.onChanged` | One fix covers the service worker, the dashboard and the Options page |
| New message `CLEAR_ACTIVITY_LOG` handled by the service worker | The service worker is the single owner of state changes. The dashboard must not write `eventHistory` directly |
| `Off` in Source or Result is a view filter | Daniel's answer. These dropdowns are already filters |
| One `Clear` button with a confirm | Daniel's answer |
| Recording switch is a button with `role="switch"` and a click handler, saving `{ activityLogEnabled }` only | A subscription on the option would fire on every `applyState`. A partial save leaves unsaved Drive fields alone |
| Copy and Clear feedback appears beside the buttons and clears after about 3 seconds | The page-level message is off screen on a long list |
| Row details go inside a collapsed `<details>` element | Removes the overflow and the noise without losing data. No script needed |
| Not handled: cleared Activity returning through Drive `history` sync | Off by default. A real fix needs a synced cut-off time. Stated as a residual risk |
| No `CONTEXT.md` or ADR created | The glossary above is enough for this change. No decision here is hard to reverse |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| None | |

## Resources

- Screenshots: `C:\Users\Daniel\.t3\userdata\attachments\520af998-73f7-4615-bbaf-055940569e9d-d4a8e115-6e0f-4a69-8f0a-f182a576bf14.png` (rows), `...-e79767fb-c65b-4681-a545-8d8e93cd9e39.png` (filters)
- Existing logger test: `tests/browser-modules.test.js:3619`
- Dashboard pure helpers under test: `window.ExtensityDashboardInternals` (`js/dashboard.js:1310`), used at `tests/browser-modules.test.js:564`
- Message handler tests: `tests/message-api.test.js`
