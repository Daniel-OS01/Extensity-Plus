# Google Drive Sync — Unified Remediation Plan
**Extensity Plus** · merged from 4 implementation plans (A–D) + 3 static QA reviews (QA‑1..3) · target: next 4.5.x release

---

## 0. Source map & conventions

| Label | Source doc | Character |
|---|---|---|
| **Plan A** | Doc 1 | Incremental merge fix (union + timestamp resolver), schema, modal, security pass |
| **Plan B** | Doc 2 | Scoped `keep_local`/`keep_remote` fix, `files.get` metadata, typed-error failsafe |
| **Plan C** | Doc 3 | Conflict-pause architecture, Drive-side backups + undo, MV3 alarm fallback, errors-only logging |
| **Plan D** | Doc 4 | Concurrency lock, compare-and-swap, `saveBackup` callback, Floccus thresholds, migration marker, audit log |
| **QA‑1** | Doc 5 | Root-cause analysis: dead conflict path, clock-dependence, deletion ambiguity |
| **QA‑2** | Doc 6 | Concrete deletion-resurrection repro, feedback-loop warning, docs contradiction, implementation ordering |
| **QA‑3** | Doc 7 | Git-history grounding (4.4.0→4.5.0, commit 73e421d), duplicate-file finding, transaction-durability finding, acceptance criteria |

Conventions:
- Repo is **4.5.0**; do not retrofit 4.4.0 labeling (QA‑1 scope note, QA‑3 §10). Assign to the next release.
- Every phase = an independently shippable PR with `npm test` + `npm run check:manifest` green.
- All existing status strings (`merged`, `pushed`, `pulled`, `resolved_local`, `resolved_remote`, `noop`, `cancelled`) and merge-function contracts are preserved; new statuses (`conflict`, `failsafe`) are **additive only** (Plan C's compatibility rule, adopted globally).

---

## 1. Consolidated root causes

Deduplicated across all seven documents. **Confidence** reflects how many independent sources converged on the finding (the three QA reviews were performed independently).

| # | Root cause | Sources | Severity | Confidence |
|---|---|---|---|---|
| RC1 | **Dead conflict path.** `detectConflicts()` output is computed then discarded; nothing ever sets `drivePendingConflict` or returns `status:"conflict"`. The conflict panels in options/dashboard are unreachable dead code, and `syncDriveNow()` contains consumer branches for a status that is never produced. | QA‑1 §1.1, QA‑2 §3, Plans C/D | High | ✅ 3 independent reviews |
| RC2 | **Timestamp seeding bug.** `buildEnvelope` defaults a missing `categoryTimestamps` entry to `nowMs()`, so untouched local categories are treated as freshly modified — they outrank genuinely edited remote data and generate spurious conflicts. | Plans A, B, D; QA‑1 §1.3 | **Critical** | ✅ 4 sources |
| RC3 | **Coarse, clock-dependent conflict granularity.** One `Date.now()` timestamp per category arbitrates every item in it; device clock skew shifts outcomes; two edits to *different* items in one category collide as a whole-category conflict. | QA‑1 §1.3, QA‑2 §1, QA‑3 §1 | High | ✅ 3 reviews |
| RC4 | **Deletions resurrect.** Unconditional unions (profile membership, aliases, URL rules, groups, history) + no tombstones make "deleted here" indistinguishable from "never received here." QA‑2 repro: `Work:[A,B]` → device 1 removes B, device 2 adds C → merge yields `[A,B,C]`. | QA‑1 §1.4, QA‑2 §1, QA‑3 §1 | **Critical** | ✅ 3 reviews + repro |
| RC5 | **Cross-device read-modify-write race.** `syncDrive` downloads, merges, then issues an unconditional media `PATCH` via `updateDriveFile`. No revision/version check; `remoteDiffers` only compares the *locally downloaded* envelope against the computed result, proving nothing about Drive's current state. Second device's write between read and upload is silently clobbered. | QA‑1 §1.2, QA‑2 §2, QA‑3 §2; Plan D | **Critical** | ✅ 4 sources |
| RC6 | **Same-client reentrancy.** No in-flight guard on `syncDrive`; overlapping triggers can interleave two read-modify-write cycles in one client. | Plan D only | High | ⚡ single source — verify in code |
| RC7 | **Whole-envelope conflict resolution.** `keep_local`/`keep_remote` reportedly apply the chosen side to the *entire envelope*, clobbering legitimate one-sided changes in non-conflicting categories. | Plan B only | **Critical** (once RC1 fixed) | ⚠️ single source; not corroborated by QA reviews — verify in code before Phase 1.2 |
| RC8 | **Destructive operations unguarded.** `push`/`pull`/`keep_*` run with no snapshot, no preview/confirmation, no failsafe threshold. They are designed as unconditional overwrites. | QA‑1 §1.5, QA‑3 §3 §7; all plans add guards | **Critical** | ✅ |
| RC9 | **Non-transactional write ordering.** Remote write precedes local patch application; partial failure leaves the two sides divergent, with the next run treating remote as authoritative. Success status is reported before post-write verification or durable baseline persistence. | QA‑2 §6, QA‑3 §8 | High | ✅ 2 reviews |
| RC10 | **Trigger gaps + loop risk.** No change-based or startup sync; periodic alarm lacks an initial `delayInMinutes`; behavior hard-coded to merge. A naïve change listener would loop: sync-applied local patches would re-trigger sync. | QA‑2 §4 §5, QA‑3 §6 | High | ✅ |
| RC11 | **Metadata gaps + duplicate files.** `findDriveFile` requests only `id,name,modifiedTime` (no `size`/`version`), takes `files[0]` without ordering or duplicate detection; steady-state status has no authoritative remote metadata (only *Test connection* fetches it). | Plans B/C/D; QA‑2 §2, QA‑3 §4 | Medium | ✅ |
| RC12 | **Docs contradict target behavior.** `docs/google-drive-sync.md` claims sync "no longer stops on divergence" and that unique items are never lost — both wrong for the required pause-and-resolve workflow and for deletion scenarios. Version text says 4.4.0 vs. repo 4.5.0. | QA‑2 §8, QA‑3 §10 | Low | ✅ |
| RC13 | **No errors-only diagnostics surface.** Logger defaults to `warn`, sync emits info-level chatter, caught errors collapse into generic uncoded strings. | Plan C, QA‑2 §7 | Medium | ✅ |

---

## 2. Adjudications — where the plans disagree

| Topic | Positions | **Ruling** | Rationale |
|---|---|---|---|
| **Conflict handling** | Plan A: wire `resolveConflictByTimestamp` → silent newer-wins auto-merge. Plans C/D + all QA: pause with `drivePendingConflict` + `conflict` status. | **Pause on two-sided divergence; auto-merge one-sided changes.** Newer-wins survives only as (a) the documented per-item tie-break *inside* an item-level merge, and (b) an explicit user choice in the modal. | The ticket requirement (reflected in all three QA reviews) is pause-and-resolve. Silent timestamp resolution is also clock-skew fragile (RC3). |
| **Backup location** | Plan C: versioned JSON in Drive `appDataFolder` + retention. Plans A/D: snapshots in `chrome.storage.local`. | **`chrome.storage.local` primary** (Plan D's `saveBackup` callback pattern); Drive-side versioned backup deferred/optional. | Local snapshots work offline, don't consume Drive API quota, and don't depend on the very transport being protected. Snapshotting *both* envelopes pre-write covers both overwrite directions. Quota is real — `storage.local` ≈ 10 MB (5 MB before Chrome 114) — so cap retention at N=3 and size-guard via `estimatePayloadBytes`. |
| **Schema shape & naming** | Plans A/B: `syncStrategy` + nested `syncTriggers{}`. Plans C/D: flat `driveSync*`-prefixed keys. | **Flat, `drive`-prefixed keys** (Plan D's set). | Distinct from the unrelated legacy `syncMode` (Plan C's point); flat keys fit the existing `normalizeEnum` / allow-list / `OptionsCollection` auto-binding patterns without special-casing nested objects. |
| **Strategy enum values** | A/B: `local_to_remote` / `remote_to_local`. C/D: `overwrite_remote` / `overwrite_local`. | **`merge` \| `overwrite_remote` \| `overwrite_local`**. | Names the destructive intent explicitly; parallels Floccus's "Overwrite server / Overwrite browser" vocabulary users may recognize. |
| **Conflict payload transport** | Plan B: new `GET_DRIVE_CONFLICT_DETAILS` message. Plans C/D: extend `GET_DRIVE_SYNC_STATUS` additively. | **Extend existing status message additively.** | Fewer contract changes, no `tests/message-api.test.js` churn unless payload size forces a split. |
| **Pending-conflict persistence** | Plan C: persist via `saveSyncOptions`. | **Store in `driveSyncMeta` / `chrome.storage.local`.** | A pending conflict is *device-local* state. If `saveSyncOptions` lands in `chrome.storage.sync`, it risks the ~100 KB / 8 KB-per-item quota **and** — worse — would propagate one device's conflict state to every other device. |
| **Union merges** | Plan A extends unions (`mergeProfileMaps`); Plan C calls unions "non-destructive, leave unchanged." QA‑1/2/3: unions ARE the deletion bug. | **Keep unions short-term (Phase 1), replace with tombstoned three-way merge in Phase 4.** | Interim, losing adds is worse than resurrecting deletes; but unions are not "non-destructive" — they destroy deletion *intent*. Plan A's union fix is correct as a stopgap, wrong as an endpoint. |
| **Concurrency approach** | Plan D: read version → re-check before write → bounded re-merge retries. | **Adopt, but label best-effort and pair with post-write verification + Phase 4 convergent merge.** | Drive API v3 exposes no documented atomic precondition (no `If-Match` on `files.update`, unlike GCS's `ifGenerationMatch`), so a residual race window between re-check and PATCH remains. ⚡ |
| **Failsafe scope** | A/B/D: deletion threshold only. QA‑3: also guard abnormal additions/replacement. | **MVP: deletion % + absolute count. Fast-follow: addition guard.** | Floccus itself shipped exactly this evolution — deletion failsafe at 20% OR 1000 items, later extended with an `AdditionFailsafe` (kicking in at ≥20 adds). QA‑3's instinct is validated by upstream. ✅ |
| **Implementation order** | QA‑2: item-level revisions *first*. This plan: safety rails first. | **Rails (Phase 0) → correctness (1) → config/UI (2–3) → tombstones (4).** | QA‑2 is right that triggers/UI must not ship before concurrency + failsafes. But the tombstone rewrite is the longest, riskiest change — landing snapshots, lock, failsafe, and journal *first* de-risks the rewrite itself. QA‑2's core constraint is preserved: nothing that increases write frequency ships before the guards. |

---

## 3. Phased implementation

### Phase 0 — Safety rails (land before touching merge logic)

**0.1 In-flight lock** *(Plan D; RC6)*
Module-level promise guard at the top of `syncDrive`: if a run is active, await/return it. Clear in a `finally` so failures never wedge future syncs. `runAutoDriveSync` / `syncDriveNow` in `js/background.js` serialize through it naturally.

**0.2 Pre-write snapshots + undo** *(Plans A/C/D; RC8)*
- New optional `saveBackup` callback passed from `js/background.js` (Plan D's shape — keeps the existing `savePatches`/`saveDriveMeta`/`saveSyncOptions` context contract and its test assertions untouched).
- Snapshot the side(s) about to be replaced: merge → both envelopes; push → pre-write remote; pull → pre-write local. Store under `driveSyncBackups` in `chrome.storage.local`, ring buffer N=3, each entry size-checked with `estimatePayloadBytes` (10 MB local quota).
- Reuse `ExtensityImportExport.buildBackupEnvelope` (Plan D) so snapshots are restorable through the existing import/export surface.
- Restore helper + background message → powers the "Undo last sync" control (Plan C) in Phase 3.

**0.3 Failsafe deletion guard** *(Plans A/B/D; QA‑3 §7; RC8)*
- Before any write (remote **or** local patches): per-category item-count comparison vs. prior state. Block when deletions exceed threshold — default **20% OR 1000 items** (matches Floccus's shipped threshold).
- Typed error with `.code`, following the `preflightSyncSet` convention (Plan B); surfaced via `lastDriveSyncError`/`recordSyncError`; additive status `"failsafe"` with `{category, counts, percentage}` details (Plan D).
- Explicit overrides bypass it: forced push/pull, or a confirmed conflict-modal resolution.
- Fast-follow (post-MVP): addition/replacement guard, per QA‑3 and upstream Floccus's `AdditionFailsafe`.

**0.4 Transaction journal + post-write verification** *(QA‑2 §6, QA‑3 §8; RC9)*
- Persist `driveSyncTxn` `{phase, snapshotRefs, expectedRemoteVersion}` to `chrome.storage.local` before the remote write.
- Canonical order: compute result → snapshot (0.2) → failsafe check (0.3) → journal → write remote → **verify** (`files.get` version/modifiedTime; optional content-hash) → apply local patches → advance `lastMergedAt`/`categoryTimestamps` → clear journal.
- Startup with a dangling journal ⇒ reconcile: re-verify remote; re-apply or roll back local from snapshot.
- `merged`/`pushed`/`pulled` are only reported *after* verification (QA‑3's "truthful status" criterion).

**0.5 Audit trail** *(Plan D)*
Emit an event per sync outcome via `ExtensityHistory.createEventRecord`/`appendHistory` (existing 500-record ring buffer), routed through a background callback: `{trigger, direction, strategy, status, conflictSummary, failsafeOutcome}`.

---

### Phase 1 — Correctness fixes within the current data model

**1.1 Timestamp seeding** *(Plans A/B/D; QA‑1 §1.3; RC2)*
- `buildEnvelope`: missing `categoryTimestamps` entry ⇒ **0** (unknown/oldest), never `nowMs()`.
- `bumpCategoryTimestamp` (from `touchDriveCategories`) remains the *sole* "newer" marker; audit every mutation path in `js/background.js` calls it (Plan A).
- Initial-push path (no remote file) still stamps real times (Plan D's caveat).
- **Gap in all four plans — add a migration:** seed existing installs' category timestamps to `lastMergedAt` (or once-now) so long-standing local data isn't classed "oldest" against any trivial remote edit after upgrade.

**1.2 Scoped conflict resolution** *(Plan B; RC7)*
First **verify in code** (single-source finding). If confirmed: `keep_local`/`keep_remote` apply the chosen side *only* to categories reported by `detectConflicts`; non-conflicting categories continue through the normal per-item merge; assemble one envelope; `mergeEnvelopeAfterSync` advances stamps for both groups.

**1.3 Conflict pause** *(Plans C/D; QA‑1 §1.1, QA‑2 §3; RC1)*
- Non-interactive `sync` with two-sided divergence in a category ⇒ **no write**. Persist `drivePendingConflict` into `driveSyncMeta` (`chrome.storage.local` — see adjudication):
  ```
  { categories: [{key, label, localUpdatedAt, remoteUpdatedAt, localCount, remoteCount}],
    file: {id, size, modifiedTime, version},
    localSummary: {bytes, updatedAt},
    detectedAt, trigger }
  ```
- Return additive status `"conflict"` — `syncDriveNow`'s existing dormant branches finally execute (QA‑1's observability note).
- One-sided changes keep auto-merging (safe).
- Explicit resolutions (`keep_local` / `keep_remote` / `merge` / `cancel`) are the **only** paths that clear the payload (Plan C).
- Every trigger (periodic / change / startup) is a no-op while a pending conflict exists or the lock is held (Plans C/D).

**1.4 Best-effort optimistic concurrency** *(Plan D; RC5)*
- Extend `findDriveFile`/`downloadDriveFile` fields to `id,name,modifiedTime,size,version`; add a steady-state `files.get` on the known-fileId path (Plan B — it currently fetches no metadata).
- Before `updateDriveFile`: re-fetch metadata; if version differs from the one used for the merge → re-download, re-merge, retry (bounded, 2–3) → then typed error.
- `push`/`pull`/`keep_*` skip the re-merge (explicit-override intent) but still pass through the lock, snapshot, and failsafe.
- **Documented limitation:** Drive v3 has no atomic write precondition, so this narrows but does not close the race. Closure comes from 0.4's post-write verification + Phase 4's convergent merge.

**1.5 Duplicate remote files** *(QA‑2 §2, QA‑3 §4; RC11)*
`files.list` ordered by `modifiedTime desc`; on >1 match, select newest, record duplicates in status, offer consolidation. (Note: `appDataFolder` deletions are permanent — surface before cleaning.)

**1.6 Loop suppression** *(QA‑3 §6; RC10)*
Wrap sync-applied local writes in an origin flag so `touchDriveCategories` / the change trigger ignore them. Belt-and-braces with the Phase 2 debounce and the Phase 0 lock.

---

### Phase 2 — Configuration schema, strategy & triggers

**2.1 `syncDefaults` additions** (`js/storage.js`, flat `drive*` keys):

| Key | Type / values | Default |
|---|---|---|
| `driveSyncStrategy` | `merge` \| `overwrite_remote` \| `overwrite_local` | `merge` |
| `driveSyncOnStartup` | bool | `false` |
| `driveChangeBasedSync` | bool | `false` |
| `driveTimeBasedSync` | bool (gates `driveAutoSyncIntervalMinutes`) | `true` |
| `driveFailsafeEnabled` | bool | `true` |
| `driveFailsafeThresholdPercent` | number, clamp 1–100 | `20` |

`normalizeOptionState` in `js/options.js`: `normalizeEnum` for the strategy, boolean coercion, numeric clamping (Plans B/D); mirror in `js/dashboard.js` if it normalizes separately.

**2.2 Migration** *(Plan D)*
Marker-gated `migration_driveSyncStrategies` in `js/migration.js`, invoked from the background migration bootstrap: back-fill defaults, preserve current auto-sync behavior, and perform the Phase 1.1 timestamp seeding. Update `tests/storage-schema.test.js` required-key/quota assertions.

**2.3 Strategy → direction mapping** *(all plans)*
`runAutoDriveSync` reads the strategy: `merge`→`sync`, `overwrite_remote`→`push`, `overwrite_local`→`pull`. Manual *Sync now / Push / Pull* remain explicit one-off overrides (Plan A). Overwrite strategies still snapshot + failsafe unless overridden through confirmation (Plan D).

**2.4 Triggers** — all funnel through `runAutoDriveSync`; all skip on pending conflict or held lock:
- **Periodic:** gate `rescheduleDriveSyncAlarm` on `driveTimeBasedSync` (plus existing `driveSync` flag); keep the 15-min minimum; add an initial `delayInMinutes` and clamp invalid upper bounds (QA‑2 §5).
- **Startup:** `chrome.runtime.onStartup` / `onInstalled` / SW bootstrap → one run when enabled.
- **Change-based:** debounce in memory **plus a one-shot `chrome.alarms` fallback** so an MV3 service-worker teardown can't swallow the debounce (Plan C — adopt). Scheduled from `touchDriveCategories`, excluding sync-origin writes (1.6).

**2.5 Metadata through status** *(Plans B/C/D)*
Extend `detectConflicts`/`syncDrive` results and `GET_DRIVE_SYNC_STATUS` additively with remote `{size, modifiedTime, version}` + local `{bytes (estimatePayloadBytes), updatedAt}`. No new message type unless payload size demands one; if any message contract changes, update `tests/message-api.test.js` (Plan B).

---

### Phase 3 — Conflict modal & settings UI

**3.1 Shared blocking modal** replacing `.drive-conflict-panel` in `options.html` + `dashboard.html`, via the `<template>` + mount pattern from `index.html` (Plan C) — no modal primitive exists, build from scratch (Plan B). Content: per-category rows (label, formatted local vs. remote timestamps), remote file size + modifiedTime vs. local serialized size + updatedAt, failsafe impact note. Wording must **not** conflate "Keep Local" with a safe action — it overwrites Drive (QA‑1 §3).

**3.2 Actions:** *Merge · Keep Local (overwrites Drive) · Keep Remote (overwrites this device) · Cancel* → existing `RESOLVE_DRIVE_CONFLICT` values plus `merge`, extending `resolveDriveConflict` in `js/background.js` as needed (Plan D). This now operates correctly thanks to 1.2's scoping fix (Plan B).

**3.3 Knockout mechanics:** visibility/summary/badges via `ko.pureComputed` — **no ternaries in `data-sbind`** (KSB constraint, Plan C). Auto-open when status polling reports a pending conflict; close on resolution.

**3.4 Settings card:** strategy `<select>`, three trigger checkboxes, failsafe toggle + threshold, interval input gated by time-based; description computeds mirroring `syncModeDescription` (Plan B); **Undo last sync** button bound to the 0.2 restore message (Plan C).

**3.5 Styling & a11y:** `.modal-overlay`/`.modal` in `styles/options.css` + dashboard CSS; reuse `--accent`/`--panel`/`--border`/`--danger` custom props; light/dark; monospace for timestamps/sizes per the `.debug-line` convention; scoped "Modern Developer" treatment (Plan C). Accessibility: `role="dialog"`, `aria-modal`, focus trap, `Esc` = cancel (QA‑1 §3).

---

### Phase 4 — Deletion semantics: per-item revisions + tombstones *(the structural fix)*

Why: unions resurrect deletions (RC4, QA‑2's repro) and category timestamps can't arbitrate per-item edits (RC3). None of Plans A–D actually fix this.

**4.1 Envelope schema v2:** per item `{rev, deletedAt?}` (monotonic counter or updatedAt); keep per-category `updatedAt` for cheap change detection. Migration from v1 stamps `rev = lastMergedAt`; reader tolerates v1 remote envelopes (QA‑3 acceptance: v1 migrates without loss).

**4.2 Three-way merge vs. baseline** (`lastMergedAt` snapshot or per-item base revs):
- Present one side + tombstone other → tombstone wins if newer than base (deletion propagates).
- Both edited → per-item newer-wins, **tie → local** — document the rule in code comments (Plan C).
- Category-level conflict pause narrows to genuinely irreconcilable divergence; Plan C's `mergeOptions`/profile-`meta` hardening (scalar divergence ⇒ conflict) folds in here.

**4.3 Tombstone GC:** purge after ~90 days or M entries; accept the small post-GC resurrection window, documented.

**4.4 Payoff:** merges become convergent, so the residual 1.4 race can no longer cause silent data loss — only transient re-merges.

Sequencing: largest single item; can start after Phase 1 in parallel with 2–3. **If it slips a release, `docs/google-drive-sync.md` must state the deletion limitation explicitly** (QA‑2 §8).

---

### Phase 5 — Diagnostics

- **5.1** Structured sync errors: `.code` on every failure path; `recordSyncError` persists code + message.
- **5.2** Dashboard **"Errors only"** filter on the Activity/Log view (`level === "error"`), leaving level controls intact (Plan C). Interpretation of the "errors only" requirement (QA‑2 §7): the *user-facing error surface* is errors-only; verbose leveled logging stays available opt-in — don't gut `ExtensityLogger`.

---

### Phase 6 — Test matrix

Extend `tests/drive-sync.test.js` (+ `sync-mode`, `sync-storage`, `storage-schema`, `message-api` where touched), keeping the existing `node --test` + stubbed-Chrome fixture patterns and **all** existing status/merge assertions:

1. Timestamp seeding: untouched local category no longer outranks a genuinely newer remote one (Plans B/D).
2. Legacy-install migration seeds timestamps (this plan's addition).
3. Profile-collision survival: item added locally survives merge with an older sync payload (Plan A).
4. Scoped resolution: resolving one category preserves one-sided changes in others — no whole-envelope overwrite (Plan B).
5. Conflict pause: pending payload populated, **no write occurs**, payload cleared only by explicit resolutions (Plans C/D).
6. Concurrency lock: overlapping `syncDrive` calls serialize into one run (Plan D).
7. CAS: remote version change between read and write triggers re-merge; bounded retries then typed error (Plan D). Harness must model **revision-advancing** fetch stubs — the current fixtures return one fixed file (QA‑3 §9).
8. Post-write verify + journal: simulated partial failure (remote written, local patch fails) recovers on next startup (QA‑3 §8).
9. Failsafe: empty-over-nonempty blocked; shrink > threshold blocked; normal growth allowed; explicit override allowed (Plans B/D).
10. Snapshot: created pre-write for each destructive op; restore round-trips (Plans A/C/D).
11. Strategy mapping ×3 (`merge`/`overwrite_remote`/`overwrite_local`) (Plan D).
12. Trigger gating: periodic off when disabled; startup fires once; change-based debounces, is suppressed for sync-origin writes, and pauses on conflict.
13. Duplicate remote files: newest selected, duplicates surfaced.
14. **Deletion propagation (Phase 4):** QA‑2's `[A,B]`-minus-B repro encoded as a test — no resurrection.
15. Multi-device interleaving scenario asserting **final state on both sides**, not just returned status (QA‑3 acceptance criterion).

---

### Phase 7 — Security posture & documentation

- **7.1 Audit** `manifest.json`, `js/drive-oauth-config.js`, injector scripts (`scripts/set-drive-*-client-id.js`): public client IDs only, never a `client_secret`; secrets stay in gitignored `config/*.local` (Plan A). Tokens confined to `chrome.identity` + short-lived `chrome.storage.local` caching; the new `files.get` calls reuse the in-memory token (Plan B).
- **7.2 Rewrite `docs/google-drive-sync.md`:** strategies, triggers, conflict modal, failsafe, backups/undo, corrected merge/timestamp semantics; **delete** the contradicting claims ("no longer stops on divergence", "unique items never lost" — QA‑2 §8); troubleshooting for the new failsafe error codes (Plan B); honest statement of deletion semantics per Phase 4 status.
- **7.3 Version:** ship on the 4.5.x line; reconcile any 4.4.0-labeled product text (QA‑3 §10).

---

## 4. Mistakes & weak points in the source plans

1. **Plan A's `resolveConflictByTimestamp` wiring contradicts the requirement.** Silent newer-wins auto-resolution is exactly what all three QA reviews say must *stop*; it's also clock-skew fragile (RC3). Salvage it only as the per-item tie-break inside Phase 4's merge.
2. **Plan A's `mergeProfileMaps` union fix trades one loss mode for another.** It stops adds being clobbered but *institutionalizes* deletion resurrection — QA‑2's repro is precisely a union failure. Plan C compounds this by calling unions "non-destructive." Acceptable interim, wrong endpoint.
3. **Plans A and B contain zero concurrency handling.** Neither the cross-device race (RC5) nor same-client reentrancy (RC6) appears — arguably the most severe silent-loss vector after the merge bugs. Only Plan D addresses it.
4. **Plan C's backup-to-`appDataFolder` couples recovery to the failing transport.** If Drive writes are the thing going wrong, the backup write shares the failure domain — and doubles API traffic. Local snapshots are the right primary.
5. **Plan C's pending-conflict persistence via `saveSyncOptions` is risky.** If that path writes `chrome.storage.sync`, a fat payload threatens the 8 KB-per-item / ~100 KB quota, and device-local conflict state would *sync to other devices* — actively wrong. Plan C even warns against large data in sync storage elsewhere, so this is internally inconsistent.
6. **Plan D's CAS is presented as stronger than it can be.** Drive v3 exposes no atomic precondition on `files.update`, so re-check-then-PATCH leaves a residual window. Needs post-write verification + convergent merges to be safe, not just bounded retries. ⚡
7. **Plan D's zero-seeding needs an upgrade migration nobody specified.** Seeding missing timestamps to 0 is correct, but existing installs with real data and no timestamps would classify *everything* as oldest after upgrade; seed to `lastMergedAt` in `migration_driveSyncStrategies`.
8. **RC7 (whole-envelope resolution) rests on Plan B alone.** Three independent QA reviews read the same code and didn't flag it — verify before building Phase 1.2 on it. ⚠️
9. **Plans A/B/D's change trigger has a feedback-loop hole.** They hook the debounce into `touchDriveCategories`; if sync-applied patches also touch categories, sync triggers itself. Only QA‑3 flags this; only origin-suppression (1.6) closes it.
10. **Plans A–D all miss duplicate Drive files** (`files[0]` selection — QA‑2/QA‑3) and **under-specify transactional ordering/verification** (QA‑3 §8): "merged" is currently reported before durability.
11. **Plan A's Phase 1 uses an option introduced in its own Phase 2** (failsafe gate) — minor sequencing wrinkle; use a constant default until the option lands.
12. **QA‑2's ordering (tombstones first) is defensible but risk-inverted.** The rails in Phase 0 are cheap, independent, and de-risk the tombstone rewrite; its core constraint (no new triggers/UI before guards) is preserved here.
13. **Nested `syncTriggers{}` (Plans A/B)** frictions against the existing flat `normalizeEnum`/allow-list persistence patterns — minor, resolved by adjudication.

---

## 5. Acceptance criteria *(adapted from QA‑3, extended)*

The work is done only when all of the following hold:

1. Compatible local and remote changes converge to the same **verified** state on both devices.
2. Intentional deletions propagate; nothing is unconditionally resurrected (Phase 4).
3. A remote change during a sync cannot be silently overwritten (lock + CAS + verify + convergent merge).
4. Forced push/pull display remote size + modifiedTime and require confirmation.
5. Strategy, startup, change-based, and time-based sync are independently configurable.
6. Automatic triggers are coalesced, survive MV3 service-worker suspension, and cannot self-loop.
7. Failsafe violations block destructive writes in **both** directions, with explicit override.
8. Duplicate Drive files are detected and surfaced, never arbitrarily selected.
9. `merged`/`pushed`/`pulled` are reported only after post-write verification and durable baseline persistence.
10. v1 envelopes and existing settings migrate without silent loss.
11. Tests assert **final state on both sides**, not merely returned statuses.
12. No secrets in the codebase; tokens via `chrome.identity` only.

---

## Appendix — verified external facts underpinning this plan

- **Floccus failsafe:** threshold reduced to **20% OR 1000 bookmarks**; later extended with an `AdditionFailsafe` (≥20 additions) — Plan D's numbers check out, and QA‑3's "guard additions too" matches upstream's own evolution. ✅ *(floccus CHANGELOG)*
- **`chrome.storage.local`:** ~**10 MB** quota (5 MB before Chrome 114), liftable via `unlimitedStorage`. **`chrome.storage.sync`:** ~**100 KB total, 8 KB per item**. Drives the backup-retention cap and the pending-conflict-location ruling. ✅ *(Chrome developer docs)*
- **Drive API v3 concurrency:** no documented conditional-write precondition on `files.update` (contrast GCS's `ifGenerationMatch`); optimistic checks are best-effort. ⚡ *(absence in official v2→v3 guide and API surface)*