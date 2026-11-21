# Progress Log

## Session: 2026-11-21

### Current Status

- **Phase:** 1 complete; Phase 2 next. Daniel gave the go-ahead; execution handed to a new thread on Claude Opus 5.5
- **Started:** 2026-11-21
- **Branch:** `main` at `4841c92`; `js/`, `tests/` and `docs/` are unchanged since the audited commit `d701135`

### Actions Taken

- Ran the baseline suite and manifest check.
- Read `js/drive-sync.js` in full and the Drive integration in `js/background.js`.
- Built the two-device simulation (`plan/drive-sync-sim/harness.js`) and ran about 30 scenarios (`plan/drive-sync-sim/scenarios.js`, `plan/drive-sync-sim/debug2.js`, `plan/drive-sync-sim/debug3.js`).
- Recorded nine defects, two more found while planning (member-order and history-audit loops), and the lower-severity observations in `findings.md`.
- Wrote the phased fix plan in `task_plan.md`.

### Test Results

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| `npm test` (baseline, before any change) | all pass | 346 pass, 0 fail | pass |
| `npm run check:manifest` | `manifest_ok` | `manifest_ok` | pass |
| S01 idle re-sync on a default install | `noop` | `merged` every round, 12 Drive writes | defect D5 |
| S03 additive: deletion stays deleted locally | stays deleted | alias, rule, member and profile all restored | defect D6 |
| S04 empty profile survives | kept | removed from its own device | defect D2 |
| S05 profile name with colon | unchanged | `Work: dev` → `Work` with members ` dev:<id>` | defect D1 |
| S06 rule reorder and front insert | order kept | reorder reverted; new rule moved to end | defect D7 |
| S07 / S08 meta and active profile on two devices | merge | conflicts on `profileMeta`, `activeProfile` | defect D8 |
| S10 pull with a category missing on Drive | `pulled` | `"undefined" is not valid JSON`, rolled back on restart | defect D4 |
| S11 / S19 stale file ID | merge with the existing file | `pushed(initial_upload)`, Drive-only alias lost | defect D3 |
| debug2 f: history under additive, 6 cycles | bounded | 2,410 records on Drive, growing | defect D9 |
| debug3: History enabled, 6 idle syncs | `noop` | 6 Drive writes | defect D9b |
| debug3: profile member order | settles | `merged` forever, orders differ | defect D2b |
| S09 same-item conflict, both resolutions | resolves, converges | as expected | pass |
| S14 failed verification then restart | recovers, converges | as expected | pass |
| S15 concurrent writer mid-sync | re-merged | as expected | pass |
| S20 legacy v1 file | merged and upgraded | as expected | pass |

### Errors

| Error | Resolution |
|-------|------------|
| Moved `plan/drive-sync-sim/` and deleted `plan/drive-sync-defect-fix-plan.md` to consolidate into `.planning/`, not knowing both had been committed in `4841c92` | Moved the folder back and ran `git restore` on the one file; `git status` shows only `.planning/` untracked. Check `git log` before moving anything under `plan/` |
| Scenario S21 threw because my group fixture lacked `id`; corrected in `plan/drive-sync-sim/debug2.js` (g) | Fixture fixed; groups merge content correctly, order defect confirmed |

### Files created this session

- `.planning/2026-11-21-drive-sync-defect-fixes/` — `task_plan.md`, `findings.md`, `progress.md` (untracked)
- `plan/drive-sync-defect-fix-plan.md` and `plan/drive-sync-sim/` — written by this session, committed to `main` as `4841c92` by someone else
- `.planning/.active_plan` — written by `init-session.sh`

## Session: 2026-11-21 (execution thread)

### Phase 2 — regression net

- Branch `fix/drive-sync-merge-defects` from `main` at `4841c92`.
- `git mv plan/drive-sync-sim/harness.js tests/helpers/sync-sim.js`; repo root now from `__dirname`; the three `plan/drive-sync-sim/*.js` scripts require the new path.
- `tests/drive-sync-scenarios.test.js`: 20 tests, each ends with `assertSettled` (one more sync per device is `noop`, no Drive write).
- Defect-specific assertions run before the shared conflict and settle checks, so each test fails on its own defect.

| Test | Expected before fix | Actual before fix |
|------|--------------------|-------------------|
| `node --test tests/drive-sync.test.js` | green | 87 pass, 0 fail |
| `node --test tests/drive-sync-scenarios.test.js` | all fail | 0 pass, 20 fail |
| D5 default install | never noop | `A=merged B=merged` for 6 rounds |
| D1 colon names | `Work: dev` missing | `map["Work: dev"]` undefined |
| D2 empty profile | lost | "A lost the empty profile" |
| D2b member order | orders differ | `[1,2,3,0]` vs `[1,2,0,3]` |
| D3 stale id / duplicate delete | initial upload | `reason initial_upload` (both) |
| D4 pull / auto Use Drive | crash | `"undefined" is not valid JSON` / aliases empty |
| D3d malformed category | local wiped | aliases `{}` |
| D6 additive delete | restored on A | A aliases still has E3 |
| mirror deletes 1 of 3 aliases | (decision B) | `A=failsafe` every round; passes only after Phase 7 |
| D7 reorder / separate adds / groups | order lost | `[r1,r2,r3]`; `[r1,r2]` vs `[r2,r1]`; `[g1,g2,g3]` vs `[g2,g1,g3]` |
| D8 active profile / meta / payload | conflicts | `Options / activeProfile`, `Options / profileMeta`, `activeProfile` on Drive |
| D9 sorted cap / bounded | unsorted, growing | "history out of order"; 802 records at cycle 1 |
| D9b idle with History | writes | "A did not settle" |

### Phase 3 — crashes and data loss

- `js/drive-sync.js`: `sortedProfileMap` (sorted member lists in the local payload and the rebuild); `profile:<name>` items; `member:` keys split on the last colon; non-array member lists tolerated; malformed remote category treated as absent in `buildThreeWayEnvelope`; `mergeEnvelopeAfterSync` skips categories missing or malformed in the applied envelope; `runSyncDrive` reads the discovered file when the remembered ID is gone and clears the baseline whenever the file read is not the one last synced.
- `js/background.js` `selectDriveSyncFile`: clears `baselineCategories`.
- Test refinements so each test pins one defect: D5 adds a rule on A only (rules on both devices loop on D7 order); D2 no longer sets a profile colour (a colour on one device hits the D8 `Options / profileMeta` conflict). Both cases remain covered by the D7 and D8 tests.

| Gate | Result |
|------|--------|
| Fix set aside (`git apply -R`), scenario file | D5, D1, D2, D2b, D3 ×2 fail (D3d failed before in Phase 2) |
| Fix restored, scenario file | 7 pass / 13 fail; D5, D1, D2, D2b, D3 ×2, D3d pass |
| D4 ×2 | own assertions pass; fail only at final `assertSettled` (B has History on → D9b, Phase 4c) |
| `node --test tests/drive-sync.test.js` | 87 pass, 0 fail |

### Phase 4 — order and history

- `js/drive-sync.js`: `arrayItemKeys` (ordered keys, shared with `categoryItemMap`), `mergeOrder` (decision A), `orderedCategoryData` for URL rules and `groupOrder`; history merged by `mergeHistory` inside `buildThreeWayEnvelope`, no history baseline stored, history skipped by `findFailsafeViolation`; `runSyncDrive` skips the audit record when only `history` changed.
- The rebuilt rule array goes through `clone()` so it is a plain JSON array like before; without that, `drive-sync.test.js` "keep_remote preserves compatible local additions" failed on a vm-realm prototype mismatch (same values). No existing test changed.
- D9b test now expects one history-only run after the first real sync (it uploads that sync's audit record) and then `noop`; a real sync's audit record can only reach Drive on the next run.

| Gate | Result |
|------|--------|
| Phase 4 diff set aside, D4/D7/D9 tests | 0 pass / 8 fail (D4 ×2 at settle, D7 ×3 order, D9 ×2, D9b busy for 6 rounds) |
| Restored, scenario file | 15 pass / 5 fail (D6, mirror/decision B, D8 ×3 remain) |
| `node --test tests/drive-sync.test.js` | 87 pass, 0 fail |

### Phase 5 — options payload

- `js/drive-sync.js`: `DRIVE_NON_SYNCED_OPTION_KEYS`; `buildOptionsCategoryPayload` also drops them and every `migration_*` key; the same function now filters incoming options in `categoryItemMap` and `applyCategoryToPatches` (so a pulled file cannot set Drive-sync settings or these keys here).

| Gate | Result |
|------|--------|
| Before (Phase 4 run) | D8 ×3 fail: `Options / activeProfile`, `Options / profileMeta`, `activeProfile is in the Drive options` |
| After, scenario file | 18 pass / 2 fail (D6, mirror/decision B) |
| `node --test tests/drive-sync.test.js` | 87 pass, 0 fail |
| `npm test` | 366 tests, 364 pass, 2 fail (the same two scenarios) |

### Phase 6 — "never delete" keeps local deletions

- `js/drive-sync.js` `buildThreeWayEnvelope`: also returns `localEnvelope`; under additive an item deleted here (baseline has it, local does not) is left out of `localEnvelope` while `envelope` keeps Drive's copy; delete-versus-edit is no longer a conflict under additive. `runSyncDrive` uses `localResultEnvelope` for `localDiffers`, the local change summary and `savePatches`; Drive write and baseline still use `envelope`.
- `tests/drive-sync.test.js` "the default additive policy keeps an item deleted on only one side": added the assertion the plan names (`localEnvelope` omits `B`); existing assertions unchanged.
- New scenario: delete on A + edit on B under additive → no conflict, A stays without, B and Drive keep the edit.

| Gate | Result |
|------|--------|
| Phase 6 diff set aside: D6 scenarios ×2; the strengthened unit test | 0/2 pass; unit test fails (`localEnvelope` undefined) |
| Restored | D6 ×2 pass; `drive-sync.test.js` 87/87; both files 107 pass / 1 fail (mirror/decision B) |
| `git apply` rewrote line endings during the set-aside | re-ran `fix_eol.py`; diff content identical to the saved patch |

### Phase 7 — small wins

- `js/drive-sync.js`: `withUnsyncedRemoteCategories` (push and merge carry Drive categories this device does not sync); `DRIVE_FAILSAFE_MIN_ITEMS = 5` for both percentage rules (decision B); `describeDrivePendingConflict` texts for `transaction_recovered` and `transaction_recovery_missing_backup`; `testDriveConnection` dry run uses `buildThreeWayEnvelope(...).conflicts` with the same baseline rule as a real sync.
- `js/background.js` `SAVE_PROFILES` → `saveProfileEdits` (saves, `touchDriveCategories(["profiles"])`); `js/engine.js` `ExtensityApi.saveProfiles`; `js/profiles.js` save goes through it. `tests/message-api.test.js` `EXPECTED_MESSAGE_TYPES` gains `SAVE_PROFILES` (planned).
- `docs/google-drive-sync.md`: failsafe floor and history exemption, unchecked categories, deletion policies, order, history log, unsynced options, edit-versus-delete, missing remembered file, recovery notice.
- No existing failsafe fixture needed changing: `npm test` stayed green with the floor, so decision B changed no existing test.

| Gate | Result |
|------|--------|
| Six Phase 7 scenarios (incl. mirror) before fix | 0 pass / 6 fail: Aliases stripped; periodic paused; `Unhandled Drive conflict reason: transaction_recovered`; `Unsupported message type: SAVE_PROFILES`; `Conflicts in: Aliases` (failsafe for mirror) |
| Phase 7 js diff set aside | same 6 fail; restored → pass; diff content identical to saved patch |
| scenario + drive-sync + message-api files | 138 pass, 0 fail |
| `npm test` | 372 tests, 372 pass, 0 fail |

### Phase 8 — final verification (in progress)

| Check | Result |
|------|--------|
| `node --test tests/drive-sync-scenarios.test.js` | 26 tests, 26 pass, 0 fail; every scenario ends in `assertSettled` |
| `npm test` | 372 tests, 372 pass, 0 fail |
| `npm run check:manifest` | `manifest_ok` |
| `git diff --ignore-cr-at-eol 4841c92..HEAD` read in full | 12 files, all planned: `js/drive-sync.js`, `js/background.js`, `js/engine.js`, `js/profiles.js`, `docs/google-drive-sync.md`, `tests/drive-sync-scenarios.test.js`, `tests/drive-sync.test.js` (+1 assertion), `tests/message-api.test.js` (+`SAVE_PROFILES`), `tests/helpers/sync-sim.js` (moved), 3 × `plan/drive-sync-sim/*.js` (require path) |
| Diff base | `4841c92` (merge base), not `main`: another session added `924820d` (README screenshots) to `main` after the branch was cut |
| Fresh-context review | delegated to GPT-6.2 Astra (Codex, high effort) with `findings.md` and the diff only; pending |

### Phase 8 — review fixes and final gate

- Another session checked out `main` in the shared checkout mid-phase; branch was intact at `a04e9d7`. Work finished in worktree `.claude/worktrees/drive-sync-merge-defects` (removed afterwards).
- Review fixes committed as `c5ae84f` (see `findings.md` "Review findings").

| Gate | Result |
|------|--------|
| Review fixes set aside, scenario file | 24 pass / 8 fail: the 8 new or strengthened tests |
| Baseline clearing disabled, strengthened stale-ID test | fails |
| `node --test tests/drive-sync-scenarios.test.js` | 32 pass, 0 fail; each ends in `assertSettled` |
| `npm test` | 378 tests, 378 pass, 0 fail |
| `npm run check:manifest` | `manifest_ok` |
| `git diff --ignore-cr-at-eol 4841c92..c5ae84f` | 12 files, 1086+/39-, all planned |

### Manual two-browser checklist (real OAuth and Drive; cannot be simulated)

Two Chrome profiles (or Chrome + Brave) signed into the same Google account, this build loaded unpacked in both, Drive sync on, History off unless a step says otherwise.

1. Sync A, then B, then A again. The third sync and one more on B show no change, and the Drive file version does not move.
2. On A create an empty profile and a profile named `Work: dev` with two extensions; sync A, then B. B shows both profiles unchanged.
3. On A reorder URL rules and add one at the top; sync A, then B. B shows the same order.
4. Apply different profiles on A and B, and recolour different profiles; sync both. No conflict prompt; each keeps its own active profile; both colours arrive on both.
5. Never delete (default): delete an alias and a profile on A; sync A, then B. A stays without them; B keeps them.
6. On B uncheck Aliases and sync. Aliases are still there on A after A syncs.
7. On B choose Pull from Drive twice. The second preview shows nothing to do.
8. Edit a profile in the Profiles page on A with "Sync after local changes" on; within about a minute Drive sync runs on its own.
9. Dashboard → Sync Status → Test connection on A after editing different aliases on A and B: the dry run reports no conflicts.
10. Turn History on in both, sync each a few times: after one follow-up sync per device it goes quiet.
