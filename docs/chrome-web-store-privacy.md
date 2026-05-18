# Chrome Web Store — privacy and permission disclosure

Copy-paste reference for the **Privacy** section when submitting **Extensity-Plus** (manifest version **4.2.3**). Each “Store text” block is written to stay under the **1,000 character** limit per field.

For OAuth and Drive setup (developers), see [google-drive-sync.md](./google-drive-sync.md). For release automation, see [release-automation.md](./release-automation.md).

## In-depth review notice (host permissions)

Chrome may show: *“Because of the host permission, your extension may require an in-depth review that will delay publishing.”*

That is expected when `host_permissions` includes `https://www.googleapis.com/*`. The extension uses that host **only** for optional Google Drive API calls after the user enables sync and signs in—not for general web browsing. Keep the **Host permission justification** factual and aligned with the text below.

---

## Permission audit (v4.2.3)

Declared in [`manifest.json`](../manifest.json):

| Permission / access | Required for release? | Used in code |
|---------------------|----------------------|--------------|
| `management` | Yes | List, enable, disable, uninstall extensions/apps; core product ([`js/background.js`](../js/background.js)). |
| `storage` | Yes | Profiles, settings, rules, history, logger, Drive token cache ([`js/storage.js`](../js/storage.js), UI pages). |
| `tabs` | Yes | Open dashboard/options/`chrome://` pages, URL-rule evaluation, toolbar-pin target tab ([`js/background.js`](../js/background.js), [`js/index.js`](../js/index.js)). |
| `alarms` | Yes | Reminder scheduling ([`js/reminders.js`](../js/reminders.js)); optional Drive sync interval ([`js/background.js`](../js/background.js)). |
| `notifications` | Yes | Reminder notifications only ([`js/reminders.js`](../js/reminders.js)). |
| `webNavigation` | Yes | `onHistoryStateUpdated` for URL rules on SPA/history navigations ([`js/background.js`](../js/background.js)). |
| `identity` | Yes | Google OAuth for optional Drive sync ([`js/drive-sync.js`](../js/drive-sync.js)). |
| `debugger` | Yes | Optional “pin to toolbar” automation on `chrome://extensions` ([`js/background.js`](../js/background.js)); **not** used for URL rules. |
| Host `https://www.googleapis.com/*` | Yes | Drive REST API `fetch` with user OAuth token ([`js/drive-sync.js`](../js/drive-sync.js)); scope `drive.appdata` only. |
| Optional host `https://chromewebstore.google.com/*` | User-granted | Public listing metadata fetch when user grants optional permission ([`js/background.js`](../js/background.js), Options/Dashboard/Profiles). |

**Conclusion:** All required permissions and the required host permission are used by shipped features. Removing any required permission would drop functionality unless the feature is removed from the product.

---

## Single purpose

**Store text:**

```
Extensity Plus helps you manage installed Chrome extensions and Chrome apps from one place. You can quickly enable or disable them, organize them into groups, save and apply profiles, and use URL rules to turn extensions on or off based on the site you are visiting. Optional features include reminders when an extension stays enabled, backup of selected settings to your Google Drive app folder when you turn sync on, and optional toolbar-pin assistance on the Chrome extensions page. The extension does not change web page content on sites you browse; it manages extensions according to your choices.
```

---

## Permission justifications

### alarms

**Store text:**

```
Required to schedule background tasks without keeping the service worker active at all times. Alarms power optional user-configured reminders (when an extension remains enabled longer than the delay you set) and optional periodic Google Drive sync when you enable automatic backup in Options.
```

### debugger

**Store text (replaces incorrect “URL rules” wording):**

```
Used only for the optional “pin to browser toolbar” feature when you choose automatic pin mode in Options. The extension briefly attaches the Chrome DevTools Protocol to the chrome://extensions details page for a specific extension to find and toggle Chrome’s built-in “Pin to toolbar” control. It does not attach to normal websites, read page content on sites you visit, or implement URL rules. If automatic pin fails or you choose manual mode, the extension opens the extensions page for you instead.
```

### identity

**Store text:**

```
Required for optional Google Drive backup and restore that you enable in Options. The chrome.identity API obtains an OAuth access token so the extension can call Google Drive with the drive.appdata scope—read and write only your extension’s private app data folder on Drive. Sign-in is user-initiated. We do not use identity to track you across sites or to access Google services beyond Drive backup for data you choose to sync.
```

### management

**Store text:**

```
This is the core permission. It allows the extension to read the list of installed extensions and Chrome apps, read whether each is enabled, and enable, disable, or uninstall them when you use the popup, dashboard, profiles, or URL rules. Without management, the extension cannot perform its primary purpose.
```

### notifications

**Store text:**

```
Used only for optional extension reminders. If you enable reminders in Options and leave an extension enabled past your configured delay, a scheduled alarm may show a simple system notification suggesting you review whether you still need that extension enabled. The extension does not use notifications for ads or unrelated messaging.
```

### storage

**Store text:**

```
Required to save your extension profiles, groups, aliases, URL rules, undo history, usage counters, event history, reminder queue, optional Drive sync state, and UI preferences. Lightweight settings and profiles may use chrome.storage.sync where appropriate; larger or unbounded data uses chrome.storage.local. Data stays on your device and signed-in Chrome sync unless you explicitly use Google Drive backup.
```

### tabs

**Store text:**

```
Necessary to open, focus, or query browser tabs when you use the manager—for example opening the dashboard or options page, the Chrome extensions manager (chrome://extensions), keyboard shortcut settings, launching a Chrome app, or evaluating URL rules against the active tab’s URL. Tab access is used to carry out actions you request, not to monitor browsing for unrelated purposes.
```

### webNavigation

**Store text:**

```
Used together with tab events to detect URL changes that do not always fire a full page load, such as single-page applications that update the address with history.pushState. That allows URL rules to enable or disable extensions on the site you are actually viewing. The extension does not use webNavigation to collect browsing history for third parties.
```

### Host permission justification (`https://www.googleapis.com/*`)

**Store text:**

```
The extension requests https://www.googleapis.com/* only for optional Google Drive backup and restore when you enable sync in Options and complete Google sign-in. Authorized HTTPS requests send your OAuth bearer token to Google Drive API endpoints to read and write a private app-data file containing only the categories of extension data you select (for example profiles, aliases, or settings). The extension does not use this host permission to access arbitrary websites you visit or to read normal web page content. Chrome may review host permissions more closely; this host is the API origin required for Drive fetch calls in the extension.
```

### Optional host permission (`https://chromewebstore.google.com/*`)

Use this if the form asks about **optional** host access (declared as `optional_host_permissions` in the manifest).

**Store text:**

```
If you grant optional access to the Chrome Web Store, the extension may fetch public extension listing pages to show description or category metadata for extensions you have installed, to help you organize them in the UI. This permission is optional and only used when you enable or use Web Store metadata features. Requests are standard HTTPS fetches to public listing URLs; your Google account password is not sent to the Web Store for those requests.
```

---

## Data practices (summary for your privacy policy page)

Use or adapt on your public privacy policy / store listing if needed:

- **Local data:** Profiles, groups, rules, and preferences are stored in Chrome storage on your device (and may sync via Chrome’s built-in sync for eligible keys).
- **Google Drive (optional):** Only if you enable sync; uses OAuth and `drive.appdata` only.
- **Web Store metadata (optional):** Only if you grant optional host permission; fetches public listing HTML.
- **No sale of personal data:** The extension is a local management tool; it does not operate a backend that collects browsing history for advertising.

---

## Checklist before submit

- [ ] Single purpose text matches actual features (manage extensions, profiles, URL rules, optional Drive/reminders/pin).
- [ ] `debugger` justification does **not** mention URL rules.
- [ ] `identity` and **host** (`googleapis.com`) justifications are filled in.
- [ ] `notifications` text reflects reminders only (not profile-applied or sync-error toasts unless you add those features later).
- [ ] Manifest version in the store package matches the tag/version you are publishing.
