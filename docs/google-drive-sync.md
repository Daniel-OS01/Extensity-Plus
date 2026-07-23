# Google Drive Sync

Extensity-Plus can back up and restore selected extension data to your Google account using the Drive **appDataFolder** scope. This is separate from Chrome `storage.sync` (browser sync).

## Credential model

Google binds a **Chrome Extension** OAuth client to one extension runtime ID. Use separate public client IDs for:

- The unpacked development build's current runtime ID. Unpacked IDs can change with the browser profile or load path. The Dashboard is authoritative; a July 23, 2026 diagnostic showed `cpemjpdfipoemlejopilgllndgfnppjk`, but do not assume it remains stable.
- The live Chrome Web Store item: `gbojjphhdboeaafjdilfibonoflhgcde`.

Do not add a `key` field to `manifest.json`. The source manifest deliberately keeps a placeholder so a checkout never silently favors one runtime ID. Build-time injection writes only the generated `dist/manifest.json`.

Client IDs are public configuration. A browser extension must never receive, store, log, or commit an OAuth `client_secret`. The scripts accept several secret-free JSON layouts for convenience, but JSON layout can prove only syntax—not Google Cloud client type, runtime-ID binding, consent-screen state, or redirect registration. Confirm those properties live in the `gglcloud` project.

## Local unpacked setup

1. Enable the Google Drive API in the `gglcloud` Google Cloud project.
2. Run `npm run build` once and load the generated `dist/` directory unpacked.
3. Open **Dashboard → Sync Status** and record the displayed **Extension ID**.
4. In Google Cloud, create or select one OAuth client with application type **Chrome Extension**, bound only to that exact runtime ID.
5. Copy `config/drive-oauth-client-id.local.example` to the gitignored `config/drive-oauth-client-id.local` and place only that public client ID on its first non-comment line.
6. Run `npm run drive:validate`. This rebuilds `dist/` and strictly validates the packaged Chrome client syntax.
7. Reload `dist/`, click **Test connection**, authorize interactively if prompted, then run create/read/update smoke tests with **Sync now**, **Pull**, and **Push**.

If the unpacked runtime ID changes, create or select the matching ID-bound client, update the local file, and rebuild. A local text file cannot verify Google Cloud registration, so the removed `--validate-ids` flow is not a substitute for this live check.

## Chrome Web Store release setup

The published Store item is live at `gbojjphhdboeaafjdilfibonoflhgcde`. Create a separate **Chrome Extension** OAuth client bound only to that Store ID.

Configure its public client ID as the GitHub `main` environment variable `vars.EXTENSITY_DRIVE_CLIENT_ID`. The release workflow:

1. Fails if that variable is absent.
2. Injects it through `EXTENSITY_DRIVE_CLIENT_ID` while building.
3. Strictly validates `dist/manifest.json`.
4. Refuses to bundle unless the packaged value exactly matches the supplied variable.

The workflow never prints the value. Existing Chrome Web Store upload credentials such as `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN` are separate and remain GitHub Actions secrets.

For a local packaging rehearsal, provide the intended public Store client without committing it:

```sh
EXTENSITY_DRIVE_CLIENT_ID='<store-bound-client-id>' npm run build
EXTENSITY_DRIVE_CLIENT_ID='<store-bound-client-id>' npm run bundle:chrome-store
```

## Optional Brave Web fallback

Chrome-only builds and releases leave `js/drive-oauth-config.js` at its placeholder and do not require a Web client. For a Brave-enabled build:

1. Create a **Web application** OAuth client.
2. Add the exact `chrome.identity.getRedirectURL("drive")` URI shown for each supported runtime.
3. Put its public client ID in gitignored `config/drive-oauth-web-client-id.local`, or set GitHub environment variable `vars.EXTENSITY_DRIVE_WEB_CLIENT_ID` for release builds.
4. Run `npm run drive:validate:web` to require both packaged clients.

Never download or paste the Web application's `client_secret` into this repository. Chrome-only validation uses `npm run drive:validate`; it must pass while the optional Web value remains a placeholder.

When Brave selects the Web fallback, a valid Web client saved in **Dashboard → Sync Status** is sufficient at runtime even if the source manifest still contains the safe Chrome-client placeholder. Chrome continues to require a matching `oauth2.client_id` in its built manifest.

## Validation commands

- `npm run check:manifest` validates the placeholder-safe source tree.
- `npm run drive:validate` builds and requires the Chrome client in `dist/`.
- `npm run drive:validate:web` additionally requires the optional Brave Web client.
- `node scripts/validate-manifest.js --manifest-path <path> --web-config-path <path> --require-drive-client` validates an explicit build tree.
- `EXTENSITY_DRIVE_OAUTH_JSON=/path/to/oauth.json npm run check:manifest` compares a secret-free JSON client ID with the manifest. Any root or nested `client_secret` is rejected.

These are offline checks only. Final acceptance requires both the unpacked installation and the installed Store item to authorize and complete create/read/update operations against Drive.

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
| “Drive sync is not configured” in Chrome | Build with a Chrome Extension client ID that matches the current runtime ID. |
| “Drive sync is not configured” in Brave even though the Web client is saved | Reload a build containing the Web-fallback configuration fix, then refresh Sync Status. Brave does not require the source manifest's Chrome-client placeholder to be replaced. |
| “OAuth client rejected / invalid client type” | You likely used Desktop OAuth credentials. Create a **Chrome extension** OAuth client and use its `client_id`. |
| “Custom URI scheme is not supported on Chrome apps” in Brave | Configure the **Web application** OAuth fallback and add the two `chromiumapp.org/drive` redirect URIs. |
| Sign-in loop / 401 | Remove the extension from [Google Account permissions](https://myaccount.google.com/permissions) and sync again. |
| Auto-sync fails with auth-needed status | Click **Sync now** once to complete interactive sign-in; background auto-sync then resumes. |
| Multiple same-name sync files exist | **Test connection** reports the duplicate count and selects the newest modification deterministically. It never deletes duplicates automatically. |
| Want one side to win outright | Automatic **Sync now** always merges. Use **Push** or **Pull** to force a whole-category overwrite. |
| History sync is slow/large | Leave **History** unchecked (default). |

## Security policy

- Do **not** store or commit OAuth `client_secret` values in extension source, docs, or chat logs.
- Drive sync for Chrome uses `oauth2.client_id` + `chrome.identity.getAuthToken`.
- Drive sync for Brave fallback uses a Web application client ID + `chrome.identity.launchWebAuthFlow`.
- The browser extension only needs the Web client ID. Keep the Web client secret out of the repo and do not paste it into `config/drive-oauth-web-client-id.local`.
- Desktop OAuth credentials are for CWS automation flows only (see `docs/release-automation.md`), not extension Drive sync.
- Each Drive request has a 15-second attempt timeout and at most three attempts for network failures, HTTP 429, and supported transient 5xx responses. Initial creation reuses one generated Drive file ID so an ambiguous retry cannot create a second file.
