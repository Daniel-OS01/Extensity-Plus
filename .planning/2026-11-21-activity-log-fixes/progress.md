# Progress Log

## Session: 2026-11-21

### Current Status

- **Phase:** 6 complete except the manual checklist, which Daniel owes.
- **Started:** 2026-11-21

### Actions Taken

- Created this plan directory with `init-session.sh "Activity Log Fixes"`. The active plan pointer moved from `2026-11-21-drive-sync-defect-fixes` (all phases complete) to this plan.
- Read `dashboard.html`, `js/dashboard.js`, `js/logger.js`, `js/history-logger.js`, the logging and options paths in `js/background.js`, `js/storage.js` `saveSyncOptions`, `js/drive-sync.js` `mergeHistory`, `styles/dashboard.css`, `styles/options.css`, the `Makefile`, and the logger test.
- Traced the six reported problems to causes and recorded them in `findings.md`.
- Asked Daniel two questions. Answers: `Off` hides rows; `Clear` deletes everything.
- Wrote `task_plan.md`.
- No product code changed. No commit made.

### Phase 2 (branch `fix/activity-log`)

- Plan approved by Daniel. Branch `fix/activity-log` created from `main` at 13d6e67.
- Tests written first: logger level `none`, saved level and enabled flag on load, storage change listener, `buildTimelineText`, `buildLogRows`, `CLEAR_ACTIVITY_LOG` handler (captured through the `chrome.runtime.onMessage` listener because `handleMessage` is not exported).
- Before the fix: 6 of the new tests failed. The level `none` test passed already: `shouldLog` was right; the bug was that no page except the dashboard loaded the saved level.
- `js/logger.js` loads level and enabled flag at start and listens to `chrome.storage.onChanged`.
- `js/background.js` `clearActivityLog` and `CLEAR_ACTIVITY_LOG`; `js/engine.js` `ExtensityApi.clearActivityLog`.
- `js/dashboard.js`: `buildLogRow`, `buildLogRows`, `buildTimelineText` moved to module level and exported; Clear asks first and calls the service worker; Copy copies the shown timeline with status beside the buttons; the log list rebuilds from storage on every change; the dashboard follows a level saved elsewhere.
- Decision: Clear does not go through `performAction`, because that calls `applyState`, which rebuilds the group, rule and alias editors and drops unsaved edits. A new `applyHistory` refreshes only the Activity rows.
- `docs/extensity-2.0-plan.md` message list left unchanged: it is not a complete list.

### Phase 3

- Tests first: `filterHistoryRows` (all, specific, off), `buildTimeline` (Errors only keeps Activity errors), `buildTimelineEmptyMessage`, and a source check that the switch sends only `{ activityLogEnabled: next }` and both dropdowns have `Off`. All 4 failed before the change.
- Recording switch in the section heading: `role="switch"`, `aria-checked` and label from computeds. It updates `options.activityLogEnabled` locally on success instead of calling `applyState`, for the same reason as Clear.
- Activity rows carry `isError` (`event === "error"`, used by Drive conflict and failsafe audits).
- The empty state is one computed message: recording off, nothing matches the filters, or nothing recorded yet.

### Phase 4

- Tests first: `buildHistoryRow` (rule link, details without `rule=`, `isError`), `summarizeDriveDebug` (no changes, mixed counts, conflicts, malformed JSON, empty), log rows in local time, and `buildTimelineText` rewritten to use real `buildLogRows` and `buildHistoryRow` output. 4 failed before the change.
- Log and Activity rows now share one field set (`badgeClass`, `badgeText`, `title`, `source`, `formattedDate`, `details`), so the page has one row template and Copy has one line format.
- `buildLogRows` test updated from `.message` to `.title`: the field was renamed by this phase's spec (one row shape), not to get to green.
- Drive sync rows show `Drive sync: <status>` and `<direction>: <categories that changed>`. Malformed debug text is shown as stored.
- CSS: two toolbar rows, `width: auto` dropdowns, grid rows, wrapped details, `button.secondary` and `button.danger`, a 700px breakpoint. The unused `.history-action` and `.history-filters` rules were removed.

### Phase 5

- All eight items done; none skipped.
- Tests first: `buildSourceOptions`, `buildPagingSummary`, a page wiring check (tab label, Result labels, Source from data, Show more, header `alt`, `eventHistory` storage refresh), and a Makefile check that every `js/*.js` file is in `JS=`. All 4 failed before the change.
- The Phase 3 test that looked for two static `Off` options now checks the Result dropdown only; Source's `Off` comes from `buildSourceOptions` and has its own test.
- Header icon uses `alt=""`: it is decorative beside the visible product name.
- `eventHistory` changes in storage refresh the Activity rows only, through `applyHistory`.
- Copy copies every row that matches the filters, not only the first 100 rendered.
- `make dist` run in WSL (no `make` on Windows): build and zip succeeded; `dist/js/logger.js` minified from 6865 to 2719 bytes. The `dist/` folder was deleted afterwards.
- Observation: `main` moved during this session. `fix/drive-sync-merge-defects` was merged into `main` as `4d07966`. This branch is still based on `13d6e67`.

### Phase 6

- Read `git --no-pager diff 13d6e67 HEAD` (the branch base). `git diff main` is no longer a clean view because `main` moved to `4d07966` during the session; against `main` it would also show the Drive sync merge in reverse.
- Changed files: `Makefile`, `dashboard.html`, `js/background.js`, `js/dashboard.js`, `js/engine.js`, `js/logger.js`, `styles/dashboard.css`, `tests/browser-modules.test.js`, `tests/message-api.test.js`. All belong to this task. `js/drive-sync.js` untouched.
- `git merge-tree --write-tree main HEAD`: no conflicts. Tests on that merged tree in a temporary worktree: 395 pass, 0 fail; `manifest_ok`. Worktree removed.
- A fresh read-only reviewer was given the spec and the diff.
- Reviewer found: (1) a bug: a level change from storage was saved again, so two quick changes could bounce between pages forever; (2) another open dashboard kept a stale Recording value; (3) a race between Clear and an extension change already running; (4) default level and recording during startup; (5) some tests check source text only.
- Fixed 1 with `shouldSaveLogLevel`, which skips a level already in the logger. The new test failed with the fix set aside. Fixed 2 in the dashboard: it follows the `activityLogEnabled` key mirrored into local storage. 3 and 4 are listed as residual risks. 5 stays as is: there is no Knockout harness, so the VM wiring can only be checked from source.
- Manual checklist not run: it needs Daniel in Chrome or Brave.

### Test Results

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm test` on `main`, before any change | All pass | 346 pass, 0 fail | Pass |
| Phase 2 new tests with the fix set aside | Fail | 6 fail (level `none` characterization passes) | Pass |
| Phase 2 `npm test` | All pass | 352 pass, 0 fail | Pass |
| Phase 2 `npm run check:manifest` | ok | `manifest_ok` | Pass |
| Phase 3 new tests with the change set aside | Fail | 4 fail | Pass |
| Phase 3 `npm test` | All pass | 356 pass, 0 fail | Pass |
| Phase 3 `npm run check:manifest` | ok | `manifest_ok` | Pass |
| Phase 4 new tests before the change | Fail | 4 fail | Pass |
| Phase 4 `npm test` | All pass | 359 pass, 0 fail | Pass |
| Phase 4 `npm run check:manifest` | ok | `manifest_ok` | Pass |
| Phase 5 new tests before the change | Fail | 4 fail | Pass |
| Phase 5 `npm test` | All pass | 363 pass, 0 fail | Pass |
| Phase 5 `npm run check:manifest` | ok | `manifest_ok` | Pass |
| Phase 5 `make dist` (WSL) | Builds | `dist/dist.zip` 1434212 bytes, `logger.js` minified | Pass |
| Branch merged onto current `main` (`4d07966`), `npm test` | All pass | 395 pass, 0 fail | Pass |
| Same merged tree, `npm run check:manifest` | ok | `manifest_ok` | Pass |
| Review fix test with the fix set aside | Fail | 1 fail | Pass |
| Final `npm test` | All pass | 364 pass, 0 fail | Pass |
| Final `npm run check:manifest` | ok | `manifest_ok` | Pass |

### Errors

| Error | Resolution |
|-------|------------|
| `assert.deepEqual(buildLogRows(undefined), [])` failed: array from the VM sandbox is a different realm | Wrapped in `normalize`, as other tests do |
| Editing `styles/dashboard.css` rewrote all its line endings (the file is stored with mixed CRLF and LF), giving a 600-line diff | Restored from `HEAD` and re-applied the edit with a helper that keeps each file's line endings |
| `summarizeDriveDebug` threw in the test: `instanceof SyntaxError` fails across the VM sandbox realm | Check `error.name === "SyntaxError"`, which works in both |
