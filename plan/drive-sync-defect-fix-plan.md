# Drive Sync — Defect Fix Plan

Written 2026-11-21 against `main` at `d701135` (v4.7.4). Every defect below was reproduced with a
two-device simulation that loads the real `js/background.js` against a fake Drive
(`plan/drive-sync-sim/`). Nothing in `js/` has been changed yet.

## Goal

Two devices that sync must end up with the same data, keep it intact, and then go quiet.

Done means:

1. Each defect has a scenario test that fails before its fix and passes after.
2. After any scenario, one more sync on every device returns `noop` and writes nothing to Drive.
3. `npm test` and `npm run check:manifest` pass, and no existing test is weakened.

## Scope rules

- Almost all changes are in `js/drive-sync.js`. The Drive file format stays at `2.0.0`; old files
  and old baselines remain readable with no migration.
- No new UI, settings, or dependencies. One new message type (`SAVE_PROFILES`).
- The unused two-way merge functions (`mergeAliases`, `buildMergedEnvelope`, `detectConflicts`, …)
  stay; removing them is a separate cleanup.

## Decisions I made (say if you disagree)

| # | Decision | Why |
|---|---|---|
| A | When both devices reorder rules or groups differently, the order already on Drive wins, with no prompt. | Any rule that prefers "my" order makes the devices rewrite Drive forever. |
| B | Percentage failsafe rules only apply once at least 5 items would be deleted or replaced. Empty-replacement and 1,000-deletion rules are unchanged. | Today renaming 1 of 2 aliases pauses automatic sync. |
| C | `syncMode`, `localProfiles` and `syncProfilesPartial` stop travelling through Drive. | They describe how this browser uses `chrome.storage.sync`, not a user preference shared across devices. |
| D | No automatic repair of profiles already damaged by the colon bug. | A repair would be guesswork; affected members are easy to spot (they are not 32-letter IDs). |

## Step 0 — Regression net first

- Move `plan/drive-sync-sim/harness.js` to `tests/helpers/sync-sim.js` (resolve the repo root from
  `__dirname`).
- Add `tests/drive-sync-scenarios.test.js` with one test per defect below, plus a shared
  "settles to noop" assertion. Run it and confirm each new test fails for the expected reason.

## Step 1 — Crashes and data loss (defects 1–5)

**1a. Pull crash on a missing category (defect 4).** `mergeEnvelopeAfterSync`
(`js/drive-sync.js:1288-1297`) calls `clone(undefined)` when the applied envelope lacks an enabled
category. Skip categories the envelope does not contain, leaving their baseline untouched.

**1b. Profile item keys (defects 1, 2, 5).** In `categoryItemMap` / `categoryDataFromItemMap`
(`:718-729`, `:766-779`):

- Add one `profile:<name>` item per profile, so a profile exists independently of its members.
  This keeps empty profiles, including the three reserved ones, and is what lets sync reach `noop`.
- Parse `member:` keys by splitting on the last `:`. Extension IDs never contain a colon; profile
  names can.
- Emit member lists sorted, both when rebuilding and in `buildCategoryData` (`:224-229`). Member
  order has no meaning, and unsorted lists make two devices rewrite Drive indefinitely.
- Guard non-array member lists instead of throwing.

Expect one extra Drive write on the first sync after upgrade (the reserved profiles get recorded).

**1c. Stale file ID (defect 3).** In `runSyncDrive` (`:2447-2456`):

- If the remembered file returns 404 and discovery found a different file, read that file instead
  of treating the run as an initial upload.
- Whenever the file actually read is not the one this device last synced with, clear
  `baselineCategories` for the run. The baseline describes a different file, so using it would
  misread missing items as deletions.
- `selectDriveSyncFile` (`js/background.js:2268`) clears the baseline for the same reason.

**1d. Malformed remote data.** In `buildThreeWayEnvelope`, treat a remote category that fails
`isApplicableCategoryData` as absent, so a corrupt file cannot empty a device under the mirror
policy.

## Step 2 — Order and history (defects 7, 9)

**2a. One order-merge helper for URL rules and groups.** Today the merged order is "baseline
first", which reverts reorders and moves front-inserted rules to the end
(`:843`, `:780-795`). Add `mergeOrder(base, local, remote)`:

- Primary order is the local one if only this device reordered, otherwise the Drive one
  (decision A).
- Items that exist only on the other side are inserted after their nearest preceding neighbour,
  or at the front if they had none. This preserves the popup's "insert draft rule at the top".

Use it for the `urlRules` array and for `groups.groupOrder`.

**2b. History is a rolling log, not a set of items.** Route the `history` category through the
existing, already-tested `mergeHistory` (`:357`): union by id, sorted by timestamp, newest 500.
No conflicts, no deletion policy, no baseline stored. Exempt `history` from
`findFailsafeViolation`, since turnover is normal for a log.

**2c. Stop sync from logging itself into a loop.** With History enabled, every sync appends an
audit record, which makes the next sync non-idle (reproduced: 6 idle syncs, 6 Drive writes). In
`runSyncDrive` (`:2646`), skip the audit record when the only category that changed was `history`.

## Step 3 — Options payload (defect 8)

Extend the stripped-key list used by `buildOptionsCategoryPayload` (`:49-52`, `:207-214`):

- `activeProfile` — which profile is applied is per-device state.
- `profileMeta` — already synced by the Profiles category; syncing it twice causes false conflicts.
- `migration` and every `migration_*` key — a marker from a newer device would make an older one
  skip its own migration after updating.
- `syncMode`, `localProfiles`, `syncProfilesPartial` (decision C).

Apply the same strip to incoming data: in `categoryItemMap` for `options`, and in
`applyCategoryToPatches` (`:1115`). Without that, an older device's file would still write these
keys locally, and a pulled file could switch `driveSync` settings on this device.

## Step 4 — "Never delete" does what its label says (defect 6)

The setting promises that deletions stay on the device that made them. Today one merged result is
applied to both sides, so the item comes back locally.

- `buildThreeWayEnvelope` returns a second envelope, `localEnvelope`. It differs from `envelope`
  only under the additive policy, for items this device deleted that Drive still has: Drive keeps
  them, the device stays without them.
- Under additive, delete-versus-edit is no longer reported as a conflict; the outcome is already
  determined.
- `runSyncDrive` uses `localEnvelope` for `localDiffers`, the local change summary and
  `savePatches`. The Drive write and the baseline keep using `envelope`.
- Mirror policy, push, pull and initial upload are unchanged (both envelopes are identical).

The existing test "the default additive policy keeps an item deleted on only one side" stays true
for `envelope`; add the assertion that `localEnvelope` omits the item.

## Step 5 — Small wins

- **Keep categories this device does not sync.** Before writing, copy any category present in the
  Drive file but unchecked here into the outgoing envelope, instead of stripping it.
- **Failsafe floor** (decision B) in `findFailsafeViolation` (`:954-962`). Failsafe fixtures in
  `tests/drive-sync.test.js` that rely on fewer than 5 deletions need larger fixtures.
- **Recovery notice text.** Add `transaction_recovered` and `transaction_recovery_missing_backup`
  to `describeDrivePendingConflict` (`:1012`); the UI currently shows a generic fallback.
- **Profile editor triggers change sync.** Add a `SAVE_PROFILES` message that saves and calls
  `touchDriveCategories(["profiles"])`; `js/profiles.js:589` uses it instead of writing storage
  directly. Add the type to `EXPECTED_MESSAGE_TYPES` in `tests/message-api.test.js`.
- **Honest connection test.** The dry-run in `testDriveConnection` (`:2284`) uses the old
  timestamp check; use the three-way conflict list so it matches what a real sync would do.
- **Docs.** `docs/google-drive-sync.md`: deletions propagate only under mirror, order conflicts
  resolve to the Drive copy, the failsafe floor, and the keys that no longer sync.

## Step 6 — Final verification

1. `node --test tests/drive-sync-scenarios.test.js` — all scenarios pass, each ends in `noop`.
2. `npm test` and `npm run check:manifest`.
3. `git --no-pager diff` read in full; only the files named above changed.
4. Manual check on two real browsers (cannot be simulated): authorize, sync both, rename an alias
   on one, delete a rule on the other, confirm both settle and **Undo last sync** restores the
   previous state.

## Order and size

One branch (`fix/drive-sync-merge-defects`), one commit per step, in the order above. Steps 1–3
are independent of each other; step 4 builds on the item-map changes in 1b and 2a. Rough size:
about 200 changed lines in `js/drive-sync.js`, 25 in `js/background.js`, a handful in
`js/profiles.js` and `js/engine.js`, plus tests and docs.

## Not changing

- A fresh second device still asks which copy to keep when options differ; with no baseline that
  is the safe answer.
- **Undo last sync** semantics. Once sync reaches `noop`, the backup ring stops filling with
  identical snapshots, which fixes the case where undo restored nothing.
- The failsafe pause still offers only Cancel; overriding means adjusting the setting.
