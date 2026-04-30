# Extensity 2.0 Plan

## Goals

- Keep the MV3 + Knockout.js architecture instead of rewriting the extension.
- Preserve the fast popup-first UX while moving heavy CRUD and reporting into a dashboard page.
- Centralize all extension state mutations in the background service worker.
- Support import/export, aliases, groups, URL rules, reminders, and better profile management.
- Add a reproducible local build and CI pipeline.
- Provide a polished, fully dark-mode-aware UI across all four pages.

## Constraints That Shaped The Plan

- `chrome.commands` is static, so profile shortcuts cannot be created dynamically per user.
- `chrome.storage.sync` has quota limits, so large collections cannot safely live there.
- Attribution like `manual`, `profile`, `rule`, `bulk`, `undo`, and `import` cannot be inferred reliably from passive listeners alone.
- Google Drive sync requires OAuth manifest configuration and explicit user authorization, so it should not be treated as a free storage toggle.
- KSB (knockout-secure-binding) replaces the standard KO binding provider. It has specific known constraints:
  - The ternary operator `? :` is not supported inside `data-sbind` expressions — use ViewModel `pureComputed`s instead.
  - Hyphenated CSS class names in `css: {}` object bindings are not supported — use unhyphenated names (e.g. `active` not `active-profile`).
  - Inline `function(){...}` definitions inside `data-sbind` are not supported.
  - Function calls with string arguments inside `visible:` and `css:{}` bindings may not track observable dependencies correctly — replace with explicit `ko.pureComputed` properties on the ViewModel.

## Architecture Direction

### Background Ownership

- `js/background.js` is the single owner of extension enable/disable operations.
- UI pages call the background through a message API instead of toggling extension state directly.
- Undo history, reminders, usage counters, and event history are updated from the same mutation path.
- This means every history entry carries a `source` field that correctly identifies how it was triggered.

### Storage Split

- `chrome.storage.sync` stores lightweight settings and profile state.
- `chrome.storage.local` stores large or device-specific collections: aliases, groups, URL rules, undo state, history, and usage counters.
- `js/migration.js` handles additive migrations and moves quota-sensitive data out of sync storage when needed.

### Sync Defaults Schema (`js/storage.js`)

The `syncDefaults` object defines all settings stored in `chrome.storage.sync`. The `OptionsCollection` class in `js/engine.js` auto-creates a `ko.observable` for every key in this object, so any new key added here is immediately available as `options.<key>` in all four pages without additional wiring.

Current keys (after the popup, dashboard, and settings follow-up rounds):

```
activeProfile, appsFirst, colorScheme, contrastMode, driveSync, dynamicSizing,
enabledFirst, enableReminders, debugHistoryVerbose, extensionIconSizePx, fontSizePx,
groupApps, keepAlwaysOn, lastDriveSync, localProfiles, migration, migration_2_0_0,
migration_popupListStyle, profileDisplay, profileExtensionSide, profileLayoutDirection,
profileMeta, profileNameDirection, popupActionRowLayout, popupHeaderIconSize,
popupListStyle, popupMainPaddingPx, popupProfileBadgeSingleWordChars,
popupProfileBadgeTextMode, popupProfilePillShowIcons, popupProfilePillSingleWordChars,
popupProfilePillTextMode, popupScrollbarMode, popupTableActionPanelPosition,
popupWidthPx, reminderDelayMinutes, searchBox, showAlwaysOnBadge, showHeader,
showOptions, showPopupSort, showPopupVersionChips, showProfilesExtensionMetadata,
showReserved, sortMode, itemPaddingPx, itemPaddingXPx, itemNameGapPx,
itemSpacingPx, itemVerticalSpacePx, urlRuleDisableOnClose, urlRuleTimeoutMinutes,
viewMode, accentColor, popupBgColor, fontFamily
```

Note: `fontSize` and `spacingScale` (string enums) were removed in Round 2 and replaced with numeric pixel-based settings. Later rounds expanded popup settings further with profile-pill modes, gutter/scrollbar controls, header icon size, URL-rule timing settings, and profile-direction settings.

### UI Surface Split

- Popup (`index.html`): fast browsing, toggling, sorting, filtering, undo, applying profiles, profile badge display.
- Profiles page (`profiles.html`): profile rename, selection, layout, bulk delete, editing profile membership, extension list sorting.
- Dashboard (`dashboard.html`): aliases, groups, URL rules, history, and import/export via tabs.
- Options page (`options.html`): layout, sorting, appearance (px values), reminders, backup, shortcut guidance.

### Dynamic Theming Approach

Rather than body CSS classes for sizing, all popup dimensions are controlled via CSS custom properties set imperatively from the ViewModel:

```js
// In js/index.js — reactive CSS var application
ko.computed(function() {
  var style = document.documentElement.style;
  style.setProperty("--font-size", self.opts.fontSizePx() + "px");
  style.setProperty("--item-padding-v", self.opts.itemPaddingPx() + "px");
  style.setProperty("--item-padding-v-adjust", Math.max(self.opts.itemPaddingPx(), 0) + "px");
  style.setProperty("--item-padding-x", self.opts.itemPaddingXPx() + "px");
  style.setProperty("--item-name-gap", self.opts.itemNameGapPx() + "px");
  style.setProperty("--item-spacing", self.opts.itemSpacingPx() + "px");
  style.setProperty("--item-v-space", self.opts.itemVerticalSpacePx() + "px");
  style.setProperty("--item-v-space-adjust", Math.max(self.opts.itemVerticalSpacePx(), 0) + "px");
  style.setProperty("--extension-icon-size", self.opts.extensionIconSizePx() + "px");
  style.setProperty("--popup-main-padding-x", self.opts.popupMainPaddingPx() + "px");
  style.setProperty("--popup-width", self.opts.popupWidthPx() + "px");
});
```

The options, profiles, and dashboard pages call a non-reactive `applyCssVars(options)` function inside `applyState` to apply the same variables on page load. Popup body classes carry the rest of the layout choices such as list style, header icon density, scrollbar mode, table-row action-panel position, and profile-pill mode.

Dark mode uses CSS variables for all surface colors. Three additional variables (`--header-bg`, `--btn-bg`, `--input-bg`) cover the popup header, sort toolbar, and search bar — the areas that previously used hardcoded `rgba(255,255,255,...)` values. Full dark mode coverage requires these variables to be defined in both `@media (prefers-color-scheme: dark)` and `body.dark-mode` selectors.

### Profile Badge Architecture

Each `ExtensionModel` in `js/engine.js` carries a `profileBadges` observable array:

```js
self.profileBadges = ko.observableArray([]);
```

In `js/index.js` `applyState`, after profiles and extensions are loaded, a `profileMap` is computed that maps each extension ID to a list of badge objects:

```js
{ name: profile.short_name(), colorClass: "profile-color-N" }
```

Five rotating color classes (`profile-color-0` through `profile-color-4`) use distinct `border-left-color` values so badges from different profiles are visually distinguishable on both light and dark backgrounds. The color index is assigned by profile position in the sorted list, skipping reserved profiles.

### Dashboard Tab Architecture

The dashboard uses a tab system to show one section at a time. The `visible:` binding in KSB may not correctly track observable dependencies when the value is a function call expression (e.g. `visible: isTab('groups')`). The correct pattern is to expose explicit `ko.pureComputed` booleans per tab:

```js
self.historyTab = ko.pureComputed(function() { return self.activeTab() === "history"; });
self.groupsTab  = ko.pureComputed(function() { return self.activeTab() === "groups"; });
// etc.
```

Then reference them directly in bindings: `visible: historyTab`, `css:{selected: historyTab}`. This pattern should be used any time a KSB `visible` or `css` binding needs a reactive boolean derived from an observable comparison.

## Public Contracts

### Background Message API

- `GET_STATE`
- `SET_EXTENSION_STATE`
- `TOGGLE_ALL`
- `APPLY_PROFILE`
- `UNDO_LAST`
- `SAVE_ALIAS`
- `SAVE_GROUPS`
- `SAVE_URL_RULES`
- `IMPORT_BACKUP`
- `EXPORT_BACKUP`
- `SYNC_DRIVE`
- `OPEN_DASHBOARD`

### Operation Context

Each state-changing action carries context shaped like:

```js
{
  source: "manual" | "profile" | "rule" | "bulk" | "undo" | "import" | "sync",
  profileId: string | undefined,
  ruleId: string | undefined
}
```

### History Entry Shape

Each history record produced by `js/history-logger.js`:

```js
{
  event: "enabled" | "disabled",
  extensionId: string,
  extensionName: string,
  id: string,          // e.g. "history-<timestamp>-<random>"
  profileId: string | null,
  ruleId: string | null,
  timestamp: number,
  triggeredBy: "manual" | "bulk" | "profile" | "rule" | "undo" | "import"
}
```

History is capped at 500 records. Pruning removes oldest first.

### Backup Envelope

```js
{
  version: "2.0.0",
  exportedAt: number,
  settings,
  profiles,
  aliases,
  groups,
  groupOrder,
  urlRules,
  localState
}
```

## Planned Phases

### Phase 1: Foundation — Complete

- `package.json`, dev dependencies, `Makefile` build.
- `js/storage.js`, `js/background.js`, `js/migration.js`.

### Phase 2: State Ownership And Migration — Complete

- All extension toggles routed through background service worker.
- Storage split implemented. Quota-sensitive data in local.

### Phase 3: Popup Core UX — Complete

- List/grid view, alpha/popular/recent sorting, alias search, always-on badge, high-contrast, keyboard navigation, undo.

### Phase 4: Profiles And Options — Complete

- Profile rename, bulk delete, layout selection, options card.

### Phase 5: Dashboard And Data Tools — Complete

- `dashboard.html`, aliases, groups, URL rules, history, import/export.

### Phase 6: URL Rules, History, And Reminders — Complete

- URL rule evaluation in background, attributed history logging, reminder scheduling.

### Phase 7: Drive Backup — Deferred

- API boundary in place. Full implementation deferred until OAuth configuration is ready.

### Phase 8: UI Polish And Dark Mode (Round 1) — Complete

- Popup redesign: wider pill profile strips, profile badge display, profile color cycling.
- CSS custom property theming system.
- Dark mode coverage for header, toolbar, search bar via `--header-bg`, `--btn-bg`, `--input-bg`.

### Phase 9: Appearance Controls And Layout Fixes (Round 2) — Complete

- Replaced string-enum appearance options with numeric pixel inputs.
- Removed sidebar layout that truncated extension names.
- Profiles converted to horizontal pill strip in popup.
- Profile badges with 5-color cycling in popup extension rows.
- `applyCssVars` added to options, profiles, and dashboard pages.

### Phase 10: Dashboard, Rules, And Settings Stabilization (Round 3) — Complete

- Dashboard tab visibility now uses explicit pureComputeds.
- Popup/settings spacing and icon-size controls are wired through CSS variables.
- URL rule close/timeout handling and history metadata were stabilized.
- Dashboard history now carries richer rule/debug context.

### Phase 11: Rule Analysis And Dashboard Debugging (Round 4) — Complete

- Shared rule-analysis path added so dashboard dry-run testing uses the same precedence logic as live rule evaluation.
- Added non-mutating background rule testing for sample URLs.
- Dashboard can filter history and jump from rule-linked history rows back to the rules editor.
- Docs/status files updated to reduce stale pending language.

### Phase 12: Popup Density Defaults And Permission Banner Expansion (Round 5) — Complete

- Added popup header icon size, popup main-padding, and popup scrollbar settings.
- Added popup profile-button `icons_only` mode and denser popup defaults.
- Extended Chrome Web Store permission banners across Dashboard, Options, and Profiles.
- Fixed popup gutter, scrollbar targeting, and table-row chevron direction follow-up issues.

## Definition Of Done

- `make dist` builds a packaged extension locally.
- CI validates the manifest, runs unit tests, and builds the distribution artifact.
- The repo can generate a Chrome Web Store submission bundle.
- The popup, options page, profiles page, and dashboard share one consistent state model through the background service worker.
- All four pages render correctly in dark mode without hardcoded light-mode colors.
- Dashboard tab system switches sections reliably.
- Dashboard rule testing reflects the same URL-rule precedence logic used by live background evaluation.
