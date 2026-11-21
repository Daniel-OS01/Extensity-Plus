# Findings & Decisions

Audit of Google Drive sync on `main` at `d701135` (v4.7.4), 2026-11-21. Line numbers refer to that
commit. All file paths are relative to the repo root.

## Requirements

- Fix every defect below; prefer the smallest change that removes the root cause.
- Add small improvements only where they are cheap and local. No new UI, settings or dependencies.
- Keep the Drive file format at `2.0.0`; old files and baselines must stay readable.

## How the defects were found

- Baseline: `npm test` 346/346, `npm run check:manifest` → `manifest_ok`. Existing tests are mostly
  unit tests on hand-built envelopes.
- `plan/drive-sync-sim/harness.js` loads the real `js/background.js` and all modules into one vm sandbox per device,
  each with its own in-memory `chrome.storage`, sharing one fake Drive that tracks file versions.
  Devices are driven through the real message API, using the same preview/confirm sequence as
  `js/engine.js:1018-1062`.
- Reproduce: `node plan/drive-sync-sim/scenarios.js` (all) or `node plan/drive-sync-sim/scenarios.js S05` (one). `plan/drive-sync-sim/debug2.js`
  and `plan/drive-sync-sim/debug3.js` hold the follow-up checks.

## What already works

First upload, two-device merge, one-sided edits, edits to different items, same-item conflict with
Keep this device / Use Drive copy, concurrent writer between read and write (re-merged), failed
post-write verification (journal kept, restart recovers), duplicate-file detection, v1 upgrade.

## Defects and fixes

### D1 — Profile names containing `:` are corrupted (scenario S05)

- Evidence: `Work: dev` with two members becomes profile `Work` with members ` dev:<id>` on both
  devices and on Drive, on the first sync.
- Cause: item key `member:<name>:<id>` is split on every colon (`js/drive-sync.js:722`, `:770-772`).
- Fix: split on the last colon. Extension IDs never contain one; profile names can.

### D2 — Empty profiles are deleted; D5 — sync never reaches `noop` (S04, S01, debug2 a/d)

- Evidence: a profile with no members vanishes from its own device. On a default install every
  sync returns `merged`, because `__always_on`, `__base`, `__favorites` are usually empty; with all
  three non-empty the same run settles to `noop`.
- Consequences of D5: every run rewrites local state and `chrome.storage.sync`, appends a history
  record, and takes a backup. After three idle syncs the three-deep ring holds identical
  snapshots, so **Undo last sync** restored nothing.
- Cause: a profile is represented only by its member items (`:718-729`, `:766-779`).
- Fix: add one `profile:<name>` item per profile; rebuild creates the profile from it.
- First sync after upgrade writes Drive once (reserved profiles get recorded). Expected.

### D2b — Profile member order makes devices rewrite Drive forever (debug3)

- Evidence: A adds member 3, B adds member 0 → A holds `[1,2,3,0]`, B `[1,2,0,3]`, every sync
  `merged` on both.
- Fix: member order has no meaning, so emit member lists sorted, in the rebuild and in
  `buildCategoryData` (`:224-229`). Guard non-array member lists instead of throwing.

### D3 — Stale file ID overwrites Drive without merging (S11, S19)

- Evidence: device remembers file X; X is gone, file Y exists. The run reports
  `pushed(initial_upload)` and replaces Y with local data. An alias that existed only on Drive was
  lost. The documented duplicate fix (delete one file from the conflict panel) triggers this on the
  other device.
- Cause: a 404 on the remembered ID leaves `remoteEnvelope` null while `remoteFile` falls back to
  the discovered file (`:2448-2450`), and the no-remote path uploads local (`:2514`).
- Fix: on 404 with a different discovered file, read that file. Whenever the file read is not the
  one this device last synced with, clear `baselineCategories` for the run, because the baseline
  describes another file and would misread missing items as deletions. `selectDriveSyncFile`
  (`js/background.js:2268`) clears it too.

### D4 — Pull crashes after writing local data (S10, S10b)

- Evidence: Drive file lacks a category this device has enabled (History on here only). Pull fails
  with `"undefined" is not valid JSON` after `savePatches`; the journal stays; the next restart
  rolls the pull back and leaves `transaction_recovered`. The automatic "Use Drive" strategy hits
  the same crash and then blocks further automatic runs.
- Cause: `clone(remoteCategory && remoteCategory.data)` with `undefined` (`:1296`).
- Fix: skip categories the applied envelope does not contain; leave their baseline untouched.

### D6 — "Never delete" restores deletions on the device that made them (S03 additive)

- Evidence: deleting an alias, a URL rule, a profile member and a whole profile on A; after sync
  all four are back on A. Default policy.
- Contract: the settings hint (`js/options.js:343-346`) says "Deletions stay on the device where
  you made them. Nothing is ever removed from another device by a sync."
- Cause: one merged result is applied to both sides (`:867-872`).
- Fix: `buildThreeWayEnvelope` returns `localEnvelope` as well. It differs from `envelope` only
  under additive, for items this device deleted (present in baseline, absent locally) that Drive
  still has: Drive keeps them, the device stays without them. Under additive, delete-versus-edit
  stops being a conflict because the outcome is determined. `runSyncDrive` uses `localEnvelope`
  for `localDiffers`, the local summary and `savePatches`; the Drive write and the baseline use
  `envelope`. Stable on repeat: baseline has the item, local does not, Drive does → same decision,
  nothing to write.
- Existing test "the default additive policy keeps an item deleted on only one side" stays true
  for `envelope`; add the assertion that `localEnvelope` omits the item.

### D7 — Rule and group order is not synced (S06, debug2 b/g)

- Evidence: reorder `[r3,r1,r2]` is reverted to `[r1,r2,r3]`; a rule inserted at the front (the
  popup draft flow, `js/dashboard.js:740`) moves to the end. Two devices with different orders
  rewrite Drive on every sync. Group order behaves the same.
- Why it matters: a later URL rule overrides an earlier one.
- Cause: merged order is "baseline keys first" (`:843`), groups keep only the local order
  (`:780-792`).
- Fix: `mergeOrder(base, local, remote)`. Primary order is local if only this device reordered
  (compared on the ids both lists share), otherwise the Drive order (decision A). Ids that exist
  only on the other side are inserted after their nearest preceding neighbour, or at the front if
  they had none.

### D8 — Per-device and duplicated options cause false conflicts (S07, S08)

- Evidence: applying different profiles on two devices → conflict "Options / activeProfile";
  recolouring different profiles on two devices → conflict "Options / profileMeta".
- Cause: the Options payload carries `activeProfile` and a second copy of `profileMeta`
  (`:49-52`, `:207-214`).
- Fix: strip `activeProfile`, `profileMeta`, `migration` and every `migration_*` key, plus
  `syncMode`, `localProfiles`, `syncProfilesPartial` (decision C). Apply the strip to incoming data
  too, in `categoryItemMap` for `options` and in `applyCategoryToPatches` (`:1115`); otherwise an
  older device's file still writes these keys locally, and a pulled file can change `driveSync`
  settings here.
- `localProfiles` / `syncProfilesPartial` decide where profile memberships are read from
  (`js/storage.js:587-598`) and are recomputed by `saveProfiles`, so they are storage mechanics.

### D9 — History grows without bound on Drive and loses its order (S17, debug2 f)

- Evidence: under additive, Drive history went 400 → 2,410 records over six cycles (~175 KB) and
  keeps growing. Merged history is not in timestamp order; the dashboard assumes array order is
  chronological (`js/dashboard.js:670`), and the 500-record cap trims by array position.
- Fix: history is a rolling log. Route it through the existing `mergeHistory` (`:357`): union by
  id, sort by timestamp, newest 500. No conflicts, no deletion policy, no baseline. Exempt
  `history` from `findFailsafeViolation`, since turnover is normal for a log.

### D9b — With History enabled, every sync makes the next one non-idle (debug3)

- Evidence: one device, six idle syncs, six Drive writes.
- Cause: each successful run appends a `drive_sync` audit record (`:2646`), which is itself new
  history to upload.
- Fix: skip the audit record when the only category that changed was `history`.

## Lower-severity observations and their handling

| Observation | Handling |
|---|---|
| A device with a category unchecked strips it from the Drive file (S16, debug2 c) | Phase 7: copy unchecked categories through from the Drive file before writing |
| 20% failsafe trips on tiny lists: 1 of 2 aliases renamed pauses automatic sync; 1 of 4 rules deleted under mirror blocks manual sync (S12, S12b) | Phase 7, decision B |
| Profile editor saves bypass the background (`js/profiles.js:589`), so "Sync after local changes" never fires for them (S22) | Phase 7: `SAVE_PROFILES` message + `touchDriveCategories(["profiles"])`; add to `EXPECTED_MESSAGE_TYPES` in `tests/message-api.test.js` |
| Malformed remote category (array for an object) wiped local aliases under mirror with failsafe off (S23) | Phase 3d |
| Recovery notice shows a generic fallback; `transaction_recovered` has no text (`:1012`) | Phase 7 |
| `testDriveConnection` dry-run uses the old timestamp check (`:2284`) | Phase 7 |
| `docs/google-drive-sync.md:80` says one-sided deletions propagate; only true under mirror | Phase 7 |
| Fresh second device conflicts on any option that differs (debug2 e) | Not changing: with no baseline, asking is the safe answer |
| Undo last sync, then sync: the undo propagates to the other device as an edit (S13) | Not changing |
| Failsafe pause offers only Cancel; no override in the UI | Not changing |

## Found during execution (outside the plan, not fixed)

| Observation | Note |
|---|---|
| `js/drive-sync.js` is committed with mixed line endings (1,542 CRLF of 2,804 lines at `4841c92`) | Any whole-file rewrite shows as a full-file diff. Edits on this branch preserve each line's original ending |
| Another session has uncommitted changes to `README.md` and `images/*` in this checkout | Left untouched; never staged on this branch |
| Old-version devices still split `member:` keys on every colon | Only new devices are fixed; a mixed fleet can still damage colon names on the old device |

## Review findings (GPT-6.2 Astra, fresh context) and handling

| Finding | Handling (`c5ae84f`) |
|---|---|
| A first sync whose data already matches returns `noop` before saving the baseline/file ID; a later additive delete is undone | On `noop` with a remote file, save `mergeEnvelopeAfterSync` meta when it changed (no Drive write) |
| Equal history timestamps sort differently per device, Drive rewritten forever | `mergeHistory` breaks ties by id |
| Additive: a profile deleted here comes back when another device adds a member | `localEnvelope` drops members/meta of profiles whose `profile:` item this device deleted |
| Last-colon split moves memberships already damaged by the old bug (against decision D) | Member keys are `member:` + JSON `[name, id]`; internal only, file format unchanged. Supersedes the plan's "split on the last colon" with the same intent |
| Repeated pulls of an old/partial file never `noop` | Pull compares against `buildPulledLocalEnvelope` (data as applied) |
| `SAVE_PROFILES` without a map wipes profiles | Handler throws without a profiles map |
| Stale-ID and history-cap tests too weak | Strengthened; stale-ID test shown to fail with baseline clearing disabled |


## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Fix inside the item-map layer (`categoryItemMap` / `categoryDataFromItemMap`) | Baselines store category data, not item keys, so new keys need no migration |
| Two result envelopes instead of tombstones for additive deletes | Needs no format change and is stable against the existing baseline |
| Reuse `mergeHistory` rather than extend the three-way merge | Already written and tested; matches how `history-logger.js` truncates |
| Scenario tests drive the real background through messages | The unit tests passed while all of the above was broken |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Empty-profile defect masked every other "never settles" check | Re-ran those checks with the three reserved profiles non-empty (`plan/drive-sync-sim/debug2.js`, `plan/drive-sync-sim/debug3.js`) |

## Resources

- Simulation: `plan/drive-sync-sim/` (`harness.js`, `scenarios.js`, `debug2.js`, `debug3.js`)
- Sync engine: `js/drive-sync.js`; integration: `js/background.js:1445-1805`, `:2174-2317`
- UI call sequence: `js/engine.js:1018-1062`; settings text: `options.html:176-184`
- Feature doc: `docs/google-drive-sync.md`
- Earlier single-file version of this plan: `plan/drive-sync-defect-fix-plan.md` (committed in `4841c92`). `task_plan.md` is the working copy; if the two disagree, `task_plan.md` wins.
