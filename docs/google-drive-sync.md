# Google Drive Sync

Extensity-Plus can back up and restore selected extension data to your Google account using the Drive **appDataFolder** scope. This is separate from Chrome `storage.sync` (browser sync).

## Setup (developers)

1. Open [Google Cloud Console](https://console.cloud.google.com/) (this project uses the `gglcloud` project per `docs/release-automation.md`).
2. Enable the **Google Drive API**.
3. Create an OAuth client of type **Chrome extension** (not Desktop app).
4. Add your extension ID and set the client ID in `manifest.json`:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/drive.appdata"
  ]
}
```

For local development and release workflows, this repo supports a safe placeholder default plus explicit client-id injection:

- Set a real client id directly:
  - `npm run drive:set-client-id -- --client-id <chrome-extension-client-id>`
- Or use a gitignored local file (recommended for dev):
  - Copy `config/drive-oauth-client-id.local.example` → `config/drive-oauth-client-id.local`
  - Paste your Chrome extension client ID (one line)
  - `npm run drive:apply-local`
- Or reset to repo-safe placeholder:
  - `npm run drive:set-client-id -- --reset`

When validating release builds, run strict manifest checks:

- `npm run check:manifest` (dev-friendly; placeholder allowed)
- `npm run check:manifest:strict-drive` (release-safe; fails on placeholder)

Optional guard for JSON input:

- `EXTENSITY_DRIVE_OAUTH_JSON=/path/to/oauth.json npm run check:manifest`
- If the JSON uses an `installed` block (Desktop OAuth), validation fails for Drive sync.

5. Reload the extension. The first sync prompts for Google sign-in.

## Using sync (end users)

Open **Options → Google Drive Sync**:

- **Enable automatic Google Drive sync** — background sync on a timer (minimum 15 minutes).
- Choose categories: Options, Profiles, Aliases, Groups, URL rules, History.
- **Sync now** — merge with Drive when possible; prompts if both sides changed.
- **Push to Drive** / **Pull from Drive** — force one direction.

The Dashboard **Import / Export** tab exposes the same sync actions.

## Conflicts

If the same category changed locally and on Drive since the last successful merge, sync stops and asks you to:

- **Keep this device** — upload local data to Drive.
- **Use Drive copy** — overwrite local data for selected categories.
- **Cancel** — no changes.

## Storage details

- Remote file: `extensity-plus-sync.json` in the Drive app data folder (hidden from the user’s Drive UI).
- Local metadata: `driveSyncMeta` in `chrome.storage.local` (timestamps, file id).
- Settings: `driveSync`, `driveSyncCategories`, `driveAutoSyncIntervalMinutes`, `lastDriveSync`, `drivePendingConflict` in `chrome.storage.sync`.

## Troubleshooting

| Symptom | Action |
|--------|--------|
| “Drive sync is not configured” | Set a real `oauth2.client_id` in `manifest.json`. |
| “OAuth client rejected / invalid client type” | You likely used Desktop OAuth credentials. Create a **Chrome extension** OAuth client and use its `client_id`. |
| Sign-in loop / 401 | Remove the extension from [Google Account permissions](https://myaccount.google.com/permissions) and sync again. |
| Auto-sync fails with auth-needed status | Click **Sync now** once to complete interactive sign-in; background auto-sync then resumes. |
| Sync always conflicts | Run **Push** or **Pull**, or resolve the conflict panel once. |
| History sync is slow/large | Leave **History** unchecked (default). |

## Security policy

- Do **not** store or commit OAuth `client_secret` values in extension source, docs, or chat logs.
- Drive sync for the extension uses only `oauth2.client_id` + `chrome.identity`.
- Desktop OAuth credentials are for CWS automation flows only (see `docs/release-automation.md`), not extension Drive sync.
