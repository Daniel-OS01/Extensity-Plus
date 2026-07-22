# Findings: Google Drive Sync

> **Superseded:** Credential conclusions in this May 2026 investigation are historical. Current guidance requires one Chrome Extension OAuth client per runtime ID and lives in `docs/google-drive-sync.md`.

## OAuth Client Files Provided

| File | client_id | Has client_secret? | Type |
|------|-----------|-------------------|------|
| `client_secret_775277874801-utc8udm5lbnhcsov2973vsqt13llbhgs...json` | `775277874801-utc8udm5lbnhcsov2973vsqt13llbhgs.apps.googleusercontent.com` | YES | **Desktop app — cannot be used** |
| `client_secret_775277874801-n4ph90um5g8m74lpakifo48ignrs7va7...json` | `775277874801-n4ph90um5g8m74lpakifo48ignrs7va7.apps.googleusercontent.com` | NO | Possibly Chrome extension — needs GCP verification |

**Chrome extension OAuth clients exported from GCP have NO `client_secret`.**
The current script in `set-drive-oauth-client-id.js` rejects all `"installed"` blocks, including
Chrome extension clients. This needs to be fixed to discriminate by presence of `client_secret`.

## Extension IDs

| Environment | Extension ID |
|-------------|-------------|
| Local unpacked (Brave) | `kjpdgpbbmmnickeingbbhkldeeeklnhj` |
| Chrome Web Store (pending) | `gbojjphhdboeaafjdilfibonoflhgcde` |

One Chrome extension OAuth client in GCP can serve both IDs if both are registered under
the same client. `chrome.identity.getAuthToken()` automatically uses the running extension's ID.

## GCP Project

- Project name: `gglcloud`
- Project number: `775277874801`
- Both credential files belong to this project.

## Current manifest.json oauth2 block

```json
"oauth2": {
  "client_id": "775277874801-n4ph90um5g8m74lpakifo48ignrs7va7.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/drive.appdata"]
}
```

→ Resolved. Drive sync is now wired to the Chrome extension client_id.

## How `chrome.identity.getAuthToken` works with extensions

- It ONLY works with OAuth clients of type "Chrome extension" created in GCP.
- The client does NOT use `client_secret` — authentication is tied to the extension's ID.
- Multiple extension IDs (e.g., local + store) can be registered on a single Chrome extension OAuth client.
- The token is scoped to the currently running extension's ID automatically.

## What `set-drive-oauth-client-id.js` does today (and the bug)

The script extracts `client_id` from a JSON file. It currently rejects ANY JSON with an
`"installed"` key:

```js
if (parsed && parsed.installed) {
  fail("Desktop OAuth credentials detected (`installed` block)...");
}
```

GCP exports Chrome extension OAuth clients with `"installed"` in older console versions —
though typically GCP now shows "chrome_app" type. The safer discriminator is:
- `client_secret` present → Desktop app → REJECT
- `installed` but NO `client_secret` → likely Chrome extension → ACCEPT and extract client_id

## drive-sync.js: What's already implemented

- Token acquisition via `chrome.identity.getAuthToken()` with interactive flag
- 401 handling: clears cached token and re-throws as `auth` code
- `invalid_client` error → specific user message about Chrome extension client requirement
- Conflict detection with category-level timestamps
- Push / Pull / bidirectional merge
- Category-level sync flags (disable history by default)
- Auto-sync via `chrome.alarms` (min 15 minutes)
- Envelope versioning (`ENVELOPE_VERSION = "1.0.0"`)

## drive-sync.js: What's missing for robustness

1. **No retry on 5xx or network errors** — a single transient failure fails the whole sync
2. **No token refresh on 401 within a retry loop** — it clears the token but doesn't retry the request
3. **No extension environment info** — `getDriveSyncStatus()` doesn't return `extensionId` or `installType`

## background.js: Auto-sync alarm

- Alarm name: `extensity-drive-auto-sync`
- Re-scheduled after every successful sync
- Minimum interval: 15 minutes
- On auth failure: saves `driveAuthStatus: "needs_interactive_sign_in"` — user must run manual sync once

## Storage split for Drive sync

| Key | Store | Purpose |
|-----|-------|---------|
| `driveSync` | sync | Toggle: enabled/disabled |
| `driveAutoSyncIntervalMinutes` | sync | Interval in minutes |
| `driveSyncCategories` | sync | Per-category flags |
| `lastDriveSync` | sync | Timestamp of last successful sync |
| `lastDriveSyncError` | sync | Error payload from last failure |
| `drivePendingConflict` | sync | Conflict payload awaiting resolution |
| `driveAuthStatus` | sync | `authorized` / `needs_interactive_sign_in` / `error` |
| `driveSyncMeta` | local | `{ fileId, categoryTimestamps, lastMergedAt }` |

## GCP steps needed (user action required)

Resolved. The Chrome extension OAuth client is confirmed, and both extension IDs are captured in `config/drive-extension-ids.local.example` for validation.

## Key constraints

- `chrome.storage.sync` quota: tight. Drive sync metadata that could be large lives in `local`.
- KSB (knockout-secure-binding): no ternary operator in `data-sbind`. Use ViewModel computeds.
- IIFE pattern required for all `js/` files — they expose namespace on `root` (alias for `self`).
- `background.js` is the only owner of extension enable/disable mutations.
