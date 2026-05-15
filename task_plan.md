# Task Plan: Robust Google Drive Sync

## Goal

Make Drive sync work reliably from both the local unpacked extension and the Chrome Web Store version, with automatic extension-ID detection, retry/fallback robustness, and correct OAuth client wiring.

**Acceptance criteria:**
- Sync works with the local extension ID (`kjpdgpbbmmnickeingbbhkldeeeklnhj`)
- Same code + same OAuth client ID works from the store (`gbojjphhdboeaafjdilfibonoflhgcde`)
- Background retry on transient failures (5xx, network error) without user intervention
- UI surfaces the current extension ID and environment (local vs store) in sync status
- `getDriveSyncStatus()` includes `extensionId` and `installType` fields
- No duplicate OAuth client IDs needed — one Chrome extension client with both IDs registered
- `set-drive-oauth-client-id.js` correctly accepts Chrome extension OAuth clients
- Tests pass for all changed logic

---

## Context / Key Findings

See `findings.md` for full details. Critical points:

- **Both uploaded JSON files are Desktop OAuth clients** — `client_secret` present in the first,
  and both use the `"installed"` block. Chrome extension OAuth clients look similar but have
  **no `client_secret`**. The current script incorrectly rejects both on `"installed"` alone.
- `drive-sync.js` is complete and sound. The only missing piece is the correct OAuth client_id.
- `chrome.runtime.id` already gives the running extension ID. `chrome.management.getSelf()` gives `installType`.
- The Google Cloud project is `gglcloud` (project number `775277874801`). Both IDs are in that project.
- Local ID: `kjpdgpbbmmnickeingbbhkldeeeklnhj` | Store ID (pending): `gbojjphhdboeaafjdilfibonoflhgcde`

---

## Phases

### Phase 1 — Fix OAuth client detection in tooling [ ] in_progress
**Files:** `scripts/set-drive-oauth-client-id.js`, `docs/google-drive-sync.md`

The current script rejects ALL `"installed"` block JSONs, including Chrome extension OAuth clients
that GCP exports with that key. The real discriminator is presence of `client_secret`:
- Desktop app: has `client_secret`
- Chrome extension: no `client_secret`

Changes:
1. Replace `if (parsed.installed)` rejection with smarter check:
   - If `client_secret` present → reject with Desktop client message
   - If `installed` but no `client_secret` → treat as Chrome extension client, extract client_id
2. Add `--validate-ids` flag to check registered extension IDs in config
3. Update `config/drive-oauth-client-id.local.example` with both extension IDs and guidance
4. Update docs to explain GCP Chrome extension client creation and multi-ID registration

### Phase 2 — Retry + backoff for transient failures [ ] pending
**Files:** `js/drive-sync.js`

Add robustness around `driveApiRequest`:
1. Retry up to 3× on 5xx responses with exponential backoff (1s, 2s, 4s)
2. Retry on `TypeError` (network error, service worker restart) with same backoff
3. On 401 inside retry: clear token and re-get before next attempt (token refresh)
4. Add `DRIVE_MAX_RETRIES` and `DRIVE_RETRY_BASE_DELAY_MS` constants at module top

Also: add `retryDriveApiRequest(token, path, options)` wrapper that wraps `driveApiRequest`.

### Phase 3 — Extension ID auto-detection in sync status [ ] pending
**Files:** `js/drive-sync.js`, `js/background.js`

1. Add `getExtensionEnvironment()` in `drive-sync.js`:
   - Uses `chrome.management.getSelf()` if available, falls back gracefully
   - Returns `{ extensionId, installType }` where `installType` is `'development'|'normal'|'unknown'`
2. Extend `getDriveSyncStatus()` return to include `extensionId` and `installType`
3. In `background.js` `loadDriveContext()`: attach `extensionId` and `installType` from environment
4. Expose on `root.ExtensityDriveSync` namespace

### Phase 4 — UI feedback for environment and auth state [ ] pending
**Files:** `js/options.js`, `options.html`

1. Show extension ID and environment (Local / Store) in the Drive sync section
2. Distinguish "not configured" vs "needs sign-in" vs "ready" with clearer labels
3. Conflict panel: show category labels and timestamps from conflict data
4. Auto-refresh sync status on `SYNC_REMOTE_UPDATE` message

### Phase 5 — Build pipeline for local vs store client IDs [ ] pending
**Files:** `Makefile`, `scripts/`, `config/`

1. `make dist` should apply `config/drive-oauth-client-id.local` if present, else keep placeholder
2. `npm run bundle:chrome-store` should fail if placeholder still set (use strict check)
3. Add `npm run drive:validate` that checks the configured client_id is not placeholder
4. Document the two-environment workflow: local file → local testing; CI env var → store builds

### Phase 6 — Tests [ ] pending
**Files:** `tests/drive-sync.test.js`

1. Test `retryDriveApiRequest`: verify 3 retries on 5xx, no retry on 4xx
2. Test token refresh on 401 inside retry loop
3. Test `getExtensionEnvironment()` with mocked `chrome.management.getSelf`
4. Test `getDriveSyncStatus()` includes `extensionId` and `installType`
5. Run full test suite to confirm no regressions

---

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|

---

## Open Questions
- Does the second credential (`775277874801-n4ph90um5g8m74lpakifo48ignrs7va7`) have no `client_secret`
  because it IS a Chrome extension OAuth client, or because the JSON was incomplete on export?
  → Need user to verify in GCP Console → Credentials → check the client type.
- If it IS a Chrome extension client: does it have the extension IDs registered?
  → Need user to add both local and store IDs in GCP if not already present.
