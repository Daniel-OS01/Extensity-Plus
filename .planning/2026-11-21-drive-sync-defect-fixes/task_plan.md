# Task Plan: Drive Sync Defect Fixes

## Goal

Two devices that sync through Google Drive end up with the same data, keep it intact, and then go quiet (`noop`), with all nine audited defects fixed and covered by regression tests.

## Next Step

None in this plan. Daniel decides on merging `fix/drive-sync-merge-defects` and runs the manual two-browser checklist in `progress.md`.

## Current Phase

All phases complete (branch `fix/drive-sync-merge-defects` at `c5ae84f`)

## Phases

Fix design, line anchors and evidence for every item are in `findings.md`. One commit per phase.
Gate for every phase: the new scenario tests for that phase fail before the fix and pass after,
and `node --test tests/drive-sync.test.js` stays green.

### Phase 1: Audit and plan

- [x] Simulate two devices against a fake Drive with the real `js/background.js` (`plan/drive-sync-sim/`)
- [x] Reproduce and record nine defects plus two found while planning (`findings.md`)
- [x] Design the smallest fix for each; record decisions A–D
- **Status:** complete

### Phase 2: Regression net

- [x] Branch `fix/drive-sync-merge-defects` from `main`
- [x] `plan/drive-sync-sim/harness.js` → `tests/helpers/sync-sim.js` (repo root from `__dirname`)
- [x] `tests/drive-sync-scenarios.test.js`: one test per defect + shared "settles to noop" check
- [x] Run it; confirm each new test fails for the expected reason
- **Status:** complete

### Phase 3: Crashes and data loss (defects 1–5)

- [x] 3a Pull crash: skip categories missing from the applied envelope in `mergeEnvelopeAfterSync`
- [x] 3b Profiles: `profile:<name>` existence item, split `member:` keys on the last colon, sorted member lists
- [x] 3c Stale file ID: read the file that exists; clear the baseline when the file identity changed
- [x] 3d Malformed remote category is treated as absent
- **Status:** complete

### Phase 4: Order and history (defects 7, 9)

- [x] 4a `mergeOrder` helper for the URL-rules array and `groups.groupOrder`
- [x] 4b History goes through the existing `mergeHistory`; exempt it from the failsafe; no baseline
- [x] 4c Skip the audit record when only `history` changed
- **Status:** complete

### Phase 5: Options payload (defect 8)

- [x] Strip `activeProfile`, `profileMeta`, `migration*`, `syncMode`, `localProfiles`, `syncProfilesPartial`
- [x] Apply the same strip to incoming data (`categoryItemMap`, `applyCategoryToPatches`)
- **Status:** complete

### Phase 6: "Never delete" matches its label (defect 6)

- [x] `buildThreeWayEnvelope` returns `localEnvelope` alongside `envelope`
- [x] Additive: delete-versus-edit is no longer a conflict
- [x] `runSyncDrive` uses `localEnvelope` for `localDiffers`, the local summary and `savePatches`
- **Status:** complete

### Phase 7: Small wins

- [x] Keep Drive categories this device has unchecked instead of stripping them
- [x] Failsafe floor of 5 items for the percentage rules (no existing fixture was affected)
- [x] Recovery-notice text for `transaction_recovered` / `transaction_recovery_missing_backup`
- [x] `SAVE_PROFILES` message so profile-editor saves trigger change sync
- [x] `testDriveConnection` dry-run uses the three-way conflict list
- [x] `docs/google-drive-sync.md` matches the new behaviour
- **Status:** complete

### Phase 8: Final verification

- [x] Fresh-context review (GPT-6.2 Astra, high) against `findings.md`; 6 bugs + 2 weak tests, all fixed in `c5ae84f`
- [x] `node --test tests/drive-sync-scenarios.test.js` — all pass, each ends in `noop`
- [x] `npm test` and `npm run check:manifest`
- [x] Read the branch diff in full (against merge base `4841c92`); only planned files changed
- [x] Hand Daniel the manual two-browser checklist (cannot be simulated)
- **Status:** complete

## Key Questions

1. Decisions A–D: Daniel said "execute plan" on 2026-11-21 without objecting to any of them, so they stand as written.
2. Are there real profiles with a colon in the name already damaged on his devices? (Decision D: no auto-repair.)

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| A. If both devices reorder rules or groups differently, the order already on Drive wins, no prompt | Any rule that prefers "my" order makes the devices rewrite Drive forever |
| B. Percentage failsafe rules apply only once 5+ items would be deleted or replaced | Renaming 1 of 2 aliases pauses automatic sync today; empty-replacement and 1,000-item rules stay |
| C. `syncMode`, `localProfiles`, `syncProfilesPartial` stop travelling through Drive | They describe how one browser uses `chrome.storage.sync`; least sure about `syncMode` |
| D. No automatic repair of profiles already damaged by the colon bug | A repair would be guesswork; damaged members are easy to spot (not 32-letter IDs) |
| Drive file format stays `2.0.0`, no migration | Old files and baselines stay readable; item keys are recomputed from data each run |
| Leave the unused two-way merge functions in place | Removing them and their tests is a separate cleanup |
| Named plan under `.planning/`, root `task_plan.md` untouched | The root files belong to an earlier, superseded OAuth task |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| Removed committed files under `plan/` while consolidating (they had been committed in `4841c92`) | 1 | Restored to `HEAD`; planning files now reference `plan/drive-sync-sim/` in place |
| Inline Python heredoc in Git Bash failed to parse (`unexpected EOF`) | 1 | Used the Edit tool and scratch scripts instead |
| Another session switched the shared checkout to `main` mid-task (and once committed onto this branch, then moved its commit to `main` itself) | 1 | Branch intact; finished in worktree `.claude/worktrees/drive-sync-merge-defects`, left the main checkout on `main` |
| Edit tool rewrote every line of `js/drive-sync.js` to CRLF (committed blob mixes CRLF and LF), diff showed 2,580 lines | 1 | Scratch `fix_eol.py` restores each unchanged line's original ending; diff back to real changes only. Run it after every edit to `js/` |

## Notes

- Not changing: first-sync option conflicts on a fresh device, Undo-last-sync semantics, the Cancel-only failsafe pause.
- Never weaken an existing test to get green. Failsafe fixtures change only because decision B changes the specified behaviour.
- No commit, push, or PR beyond the feature-branch commits without being asked.
