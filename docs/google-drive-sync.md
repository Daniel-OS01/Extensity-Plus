# Google Drive Sync

Extensity-Plus can back up and restore selected extension data to your Google account using the Drive **appDataFolder** scope. This is separate from Chrome `storage.sync` (browser sync).

## Setup (developers)

1. Open [Google Cloud Console](https://console.cloud.google.com/) (this project uses the `gglcloud` project per `docs/release-automation.md`).
2. Enable the **Google Drive API**.
3. Create an OAuth client of type **Chrome extension** (not Desktop app).
4. Register both extension IDs on the same client:
   - Local unpacked build: `kjpdgpbbmmnickeingbbhkldeeeklnhj`
   - Chrome Web Store build: `gbojjphhdboeaafjdilfibonoflhgcde`
5. Set the client ID in `manifest.json`:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/drive.appdata"
  ]
}
```

6. For Brave, configure a separate OAuth client of type **Web application**. Brave can reject the Chrome extension flow with “Custom URI scheme is not supported on Chrome apps”, so Drive sync falls back to `chrome.identity.launchWebAuthFlow()` with a `chromiumapp.org` redirect.

Add these **Authorized redirect URIs** to the Web application client:

- `https://kjpdgpbbmmnickeingbbhkldeeeklnhj.chromiumapp.org/drive`
- `https://gbojjphhdboeaafjdilfibonoflhgcde.chromiumapp.org/drive`

The Web application client currently used for local Brave fallback is:

- `775277874801-b0imosndrdirkc8n27nho7af3s16q1lv.apps.googleusercontent.com`

Then set the Web client ID in `js/drive-oauth-config.js` using local config:

- Copy `config/drive-oauth-web-client-id.local.example` → `config/drive-oauth-web-client-id.local`
- Paste your **Web application** OAuth client ID (one line)
- Run `npm run drive:apply-web-local`
- If you want to force Brave/Web flow for local testing, set `drivePreferWebAuth: true` in `js/drive-oauth-config.js` or in your generated local config.

For local development and release workflows, this repo supports a safe placeholder default plus explicit client-id injection:

- Set a real client id directly:
  - `npm run drive:set-client-id -- --client-id <chrome-extension-client-id>`
- Or use a gitignored local file (recommended for dev):
  - Copy `config/drive-oauth-client-id.local.example` → `config/drive-oauth-client-id.local`
  - Paste your Chrome extension client ID (one line)
  - `npm run drive:apply-local`
- Validate the registered extension IDs:
  - Copy `config/drive-extension-ids.local.example` → `config/drive-extension-ids.local`
  - Keep both the local and store extension IDs in that file
  - `npm run drive:validate`
- Or reset to repo-safe placeholder:
  - `npm run drive:set-client-id -- --reset`
- `make dist` will automatically use `config/drive-oauth-client-id.local` and `config/drive-oauth-web-client-id.local` when they exist and patch the build copy in `dist/`.
- CI/release builds can provide `EXTENSITY_DRIVE_CLIENT_ID` and `EXTENSITY_DRIVE_WEB_CLIENT_ID` instead of local files.

When validating release builds, run strict manifest checks:

- `npm run check:manifest` (dev-friendly; placeholder allowed)
- `npm run check:manifest:strict-drive` (release-safe; fails on Chrome Extension or Web fallback placeholders)
- `npm run bundle:chrome-store` fails fast if either Drive OAuth client ID still uses its placeholder.

Optional guard for JSON input:

- `EXTENSITY_DRIVE_OAUTH_JSON=/path/to/oauth.json npm run check:manifest`
- If the JSON uses an `installed` block (Desktop OAuth), validation fails for Drive sync.

5. Reload the extension. The first sync prompts for Google sign-in.

## Using sync (end users)

Open **Options → Google Drive Sync**:

- **Enable automatic Google Drive sync** — background sync on a timer (minimum 15 minutes).
- The Google Drive Sync section shows the current extension ID and whether the build is local or store.
- Choose categories: Options, Profiles, Aliases, Groups, URL rules, History.
- **Sync now** — performs an item-level merge with Drive. Groups, URL rules, aliases, profiles, history, and options are combined and de-duplicated across both sides, so items that exist only locally or only on Drive are preserved rather than overwritten. Where the same item changed on both sides, the more recently updated side wins (ties keep the local value).
- **Push to Drive** / **Pull from Drive** — force one direction. These are explicit whole-category overwrites: **Push** replaces the Drive copy with local data, **Pull** replaces local data with the Drive copy. Use them when you deliberately want one side to win.

The Dashboard **Import / Export** tab exposes the same sync actions.

The Dashboard **Sync Status** tab now also includes a Drive sync card with the current extension ID, install type, auth path, last sync timestamp, remote file ID, and a direct `Open Google Drive` action.

## Conflicts

Automatic **Sync now** no longer stops on divergence. When the same category changed on both the local device and Drive since the last successful merge, sync merges the two sides item by item — combining and de-duplicating groups, rules, aliases, profiles, history, and options — so no side's unique items are lost. For an individual item that changed on both sides, the more recently updated side wins (ties keep the local value).

If you want one side to overwrite the other outright, use the explicit whole-category overrides instead of the automatic merge:

- **Push to Drive** / **Keep this device** — replace the Drive copy with local data.
- **Pull from Drive** / **Use Drive copy** — replace local data with the Drive copy.
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
| “Custom URI scheme is not supported on Chrome apps” in Brave | Configure the **Web application** OAuth fallback and add the two `chromiumapp.org/drive` redirect URIs. |
| Sign-in loop / 401 | Remove the extension from [Google Account permissions](https://myaccount.google.com/permissions) and sync again. |
| Auto-sync fails with auth-needed status | Click **Sync now** once to complete interactive sign-in; background auto-sync then resumes. |
| Want one side to win outright | Automatic **Sync now** always merges. Use **Push** or **Pull** to force a whole-category overwrite. |
| History sync is slow/large | Leave **History** unchecked (default). |

## Security policy

- Do **not** store or commit OAuth `client_secret` values in extension source, docs, or chat logs.
- Drive sync for Chrome uses `oauth2.client_id` + `chrome.identity.getAuthToken`.
- Drive sync for Brave fallback uses a Web application client ID + `chrome.identity.launchWebAuthFlow`.
- The browser extension only needs the Web client ID. Keep the Web client secret out of the repo and do not paste it into `config/drive-oauth-web-client-id.local`.
- Desktop OAuth credentials are for CWS automation flows only (see `docs/release-automation.md`), not extension Drive sync.
