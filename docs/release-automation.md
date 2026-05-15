# Chrome Web Store release automation

Tag pushes (`v*`) trigger [`.github/workflows/release-chrome-web-store.yml`](../.github/workflows/release-chrome-web-store.yml), which runs manifest validation, tests, a permission-usage audit, build/bundle steps, then uploads a **draft** package to the Chrome Web Store. A human must still review and click **Publish** in the developer dashboard.

## One-time setup

### 1. Google Cloud OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. Enable **Chrome Web Store API** for that project.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
4. Application type: **Desktop app** (not Chrome extension, not Web application).
5. Copy the **Client ID** and **Client secret** from that Desktop client’s JSON download.
6. On the same Desktop client, add an **Authorized redirect URI**:
   - `http://127.0.0.1:8765/`
   - If you use another port via `CWS_OAUTH_PORT` or `--port`, add `http://127.0.0.1:PORT/` instead.

If you see **Error 400: invalid_request** or “Access blocked”, you are almost certainly using the wrong client type (for example the **Extensity-Plus Chrome extension** OAuth client). Create or select **Desktop app** credentials instead.

### 2. Refresh token (local only)

From the repository root:

```bash
CWS_CLIENT_ID="your-desktop-client-id" CWS_CLIENT_SECRET="your-desktop-client-secret" npm run cws:bootstrap
```

Or:

```bash
npm run cws:bootstrap -- --client-id "..." --client-secret "..."
```

The script starts a local callback on `http://127.0.0.1:8765/`, prints a consent URL, captures the redirect automatically, and prints a `refresh_token`. **Do not commit it.**

### 3. GitHub Actions secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|--------|--------|
| `CWS_EXTENSION_ID` | `gbojjphhdboeaafjdilfibonoflhgcde` |
| `CWS_CLIENT_ID` | OAuth Desktop client ID |
| `CWS_CLIENT_SECRET` | OAuth Desktop client secret |
| `CWS_REFRESH_TOKEN` | Output from `npm run cws:bootstrap` |

Publisher ID for dashboard links: `b2564181-7079-402e-8ca4-090a821f8141`.

### Public key note

The extension public key shown on the Chrome Web Store account page does **not** need a `"key"` field in `manifest.json` for published updates. Chrome already associates the correct key with the listing. Add `"key"` only if you need unpacked local installs to use the same extension ID as production.

## Releasing a new version

1. Bump versions (keeps `manifest.json` and `package.json` aligned):

   ```bash
   npm run release:bump
   ```

2. Commit the version bump.

3. Tag and push (tag must match `manifest.json` version, without the `v` prefix):

   ```bash
   git tag v4.0.3
   git push origin v4.0.3
   ```

4. Watch the **Release to Chrome Web Store** workflow in the Actions tab.

5. When it succeeds, open the package page, confirm permissions and listing details, then publish:

   [Chrome Web Store package editor](https://chrome.google.com/webstore/devconsole/b2564181-7079-402e-8ca4-090a821f8141/gbojjphhdboeaafjdilfibonoflhgcde/edit/package)

## What the workflow runs

1. Tag vs `manifest.json` version check
2. `npm run check:manifest`
3. `npm test`
4. Permission usage audit (`chrome.<permission>` must appear under `js/`, excluding `js/libs/`)
5. `make dist`
6. `npm run bundle:chrome-store`
7. Upload `artifacts/chrome-web-store/extensity-plus-v<version>.zip` as a CWS draft (`publish: false`)

Build artifacts from each run are stored as a GitHub Actions artifact named `cws-release-v<version>`.

## Rotating credentials

1. Create a new OAuth client or revoke the old token in Google Account permissions.
2. Re-run `npm run cws:bootstrap`.
3. Update `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and/or `CWS_REFRESH_TOKEN` in GitHub secrets.

## Troubleshooting

- **Error 400 invalid_request / Access blocked**: Use a **Desktop app** OAuth client, not Chrome extension or Web application. Add redirect URI `http://127.0.0.1:8765/` on that Desktop client. Re-download that client’s JSON for `client_id` / `client_secret`.
- **redirect_uri_mismatch**: The redirect URI in Google Cloud must exactly match what the script prints (including trailing slash and port).
- **Tag mismatch**: Ensure `git tag vX.Y.Z` matches `manifest.json` `"version": "X.Y.Z"`.
- **Permission audit failure**: Every entry in `permissions` / `optional_permissions` must be referenced as `chrome.<name>` in `js/` (not only in tests).
- **Upload failure**: Confirm all four `CWS_*` secrets are set and the Google account used for bootstrap owns the extension item.
