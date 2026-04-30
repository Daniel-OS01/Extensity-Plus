# Extensity 2.0 Status

## What Was Implemented

### Foundation And Build

- Added `package.json` and `package-lock.json` with local `sass` and `uglify-js` dev dependencies.
- Updated `Makefile` to use project-managed tools and package `dashboard.html`.
- Updated `BUILD.md` and root `README.md` to match the current build and packaging flow.

### Manifest And Background

- Upgraded `manifest.json` to `2.0.0`.
- Switched the MV3 service worker to `js/background.js`.
- Added permissions for `alarms`, `contextMenus`, `management`, `notifications`, `storage`, `tabs`, and `webNavigation`.
- Added static commands for toggle-all and profile cycling.

### Storage And Migration

- Added `js/storage.js` for promise-based storage access and sync/local defaults.
- Reworked `js/migration.js` to handle legacy migration plus additive 2.0 storage migration.
- Moved quota-sensitive feature data to local storage.

### Popup

- Added popup list/grid mode.
- Added alpha, popularity, and recent-use sorting.
- Added alias-aware searching.
- Added always-on badges and high-contrast styling.
- Added keyboard navigation and undo support.

### Profiles And Options

- Added profile rename on the profiles page.
- Added selection and bulk delete for profiles.
- Added profile layout mode selection.
- Added options for view mode, sort mode, contrast mode, reminders, dashboard access, and shortcut guidance.

### Dashboard And Data Tools

- Added `dashboard.html`, `js/dashboard.js`, and `styles/dashboard.css`.
- Added aliases editing.
- Added groups editing and membership assignment.
- Added URL rules editing.
- Added event history view.
- Added JSON import/export and CSV export.

### Automation Features

- Added URL rule matching logic in `js/url-rules.js`.
- Added history creation and capping logic in `js/history-logger.js`.
- Added reminder queue and alarm helpers in `js/reminders.js`.
- Added a Drive sync boundary in `js/drive-sync.js`.

### CI And Release Automation

- Added `.github/workflows/ci.yml`.
- Added `.github/workflows/chrome-web-store-bundle.yml`.
- Added `scripts/validate-manifest.js`.
- Added `scripts/create-chrome-store-bundle.js`.
- Added unit tests for pure modules under `tests/`.

---

## Round 1 — UI Polish And Dark Mode

Applied after initial 2.0 launch. Addressed visual regressions and added polish across all pages.

### Popup (`index.html`, `styles/index.css`)

- Replaced sidebar layout with horizontal pill strip for profiles above the extension list.
- Widened popup from 320px to a CSS-variable-controlled `var(--popup-width, 380px)`.
- Added `ProfileModel.isActive` observable set imperatively in `applyState` so the active profile pill is highlighted without N² reactive dependencies.
- Added profile badge display inside each extension row (right side, `.item-actions` area). Each badge shows the short profile name with a thick left border in one of 5 rotating colors (`profile-color-0` through `profile-color-4`).
- Profile badge computation builds a `profileMap` in `applyState`: extension ID → array of `{name, colorClass}` objects. Skips reserved profiles (`__always_on`, `__favorites`).
- Added `ExtensionModel.profileBadges` observable array to `js/engine.js`.

### Dark Mode — Header And Toolbar

- Introduced CSS variables `--header-bg`, `--btn-bg`, `--input-bg` in `styles/index.css`.
- Light defaults: semi-transparent white values.
- Dark mode overrides: dark navy/slate values (`#1c2540`, `rgba(30,45,70,0.85)`, `rgba(26,34,52,0.95)`).
- Applied `var(--header-bg)` to `#header`, sort toolbar, and search bar — eliminating the hardcoded `rgba(255,255,255,...)` values that caused a white header in dark mode.

### CSS Custom Property Theming

- Added reactive `ko.computed` in `js/index.js` that sets `--font-size`, `--item-padding-v`, `--item-spacing`, `--popup-width` whenever options change.
- Extension items use `padding: var(--item-padding-v, 10px) 12px` and `margin-bottom: var(--item-spacing, 8px)`.
- Body uses `font-size: var(--font-size, 12px)` and `width: var(--popup-width, 380px)`.

---

## Round 2 — Appearance Controls And Layout Fixes

Applied after Round 1 user review. Three specific problems were fixed.

### Appearance Replaced String Enums With Pixel Values

**`js/storage.js`**

Removed:
- `fontSize: "normal"`
- `spacingScale: "normal"`

Added:
- `fontSizePx: 12`
- `itemPaddingPx: 10`
- `itemSpacingPx: 8`
- `popupWidthPx: 380`

Because `OptionsCollection` auto-derives observables from `syncDefaults`, these keys are immediately usable as `options.fontSizePx`, `options.itemPaddingPx`, etc. in all page bindings.

**`options.html`**

Replaced the Appearance card's two `<select>` dropdowns (`spacingScale`, `fontSize`) with four `<input type="number">` fields for `fontSizePx`, `itemPaddingPx`, `itemSpacingPx`, and `popupWidthPx`.

**`js/options.js`**

Removed `applyPreset` dispatch method. Replaced three wrapper functions with direct px-value setters:

- Compact: `fontSizePx(11)`, `itemPaddingPx(6)`, `itemSpacingPx(4)`
- Default: `fontSizePx(12)`, `itemPaddingPx(10)`, `itemSpacingPx(8)`
- Comfortable: `fontSizePx(13)`, `itemPaddingPx(14)`, `itemSpacingPx(12)`

Added `applyCssVars(options)` function and called it inside `applyState`.

**`js/dashboard.js`**

Removed stale class toggles (`spacing-compact`, `font-small`, etc.) from `applyThemeClasses`. Added `applyCssVars` function and call in `applyState`.

**`js/profiles.js`**

Removed stale class toggles from `bodyClass` computed. `applyCssVars` called on body class application.

### Extension Name Truncation Fixed

Removed `<div id="content-main">` sidebar wrapper from `index.html`. Extension list now spans full popup width. Profiles occupy a horizontal pill strip above extensions, not a 120px left column.

Removed from `styles/index.css`:
- `#content { display: flex }` sidebar container rule
- `#profiles { flex: 0 0 120px }` fixed narrow column rule
- `#content-main { flex: 1 1 0 }` right panel rule

---

## Round 3 — Popup, Rules, History, And Settings Stabilization

Applied after the earlier 2.0 UI rounds. This round fixed several user-facing regressions and tightened the dashboard diagnostics flow.

### Popup And Appearance

- Fixed reversed per-extension toggle icons so the popup dongles reflect the current enabled state.
- Added active profile badge display in the popup header.
- Extended popup spacing controls with working negative compaction behavior for vertical spacing and padding.
- Added extension icon size control and preserved expanded action row layout selection.

### URL Rules And History

- Fixed repeated URL-rule close handling and delayed auto-disable scheduling by preserving per-tab rule application metadata.
- Expanded history records with `action`, `result`, `ruleName`, `tabId`, URL, and previous/next state details.
- Added debug-only rule evaluation, timeout scheduling, and close-triggered history entries.
- Removed the invalid install-time optional permission request and kept Chrome Web Store permission behind explicit user actions instead.

### Dashboard And Rules UX

- Tightened the URL Rules editor layout with collapsed searchable enable/disable lists and compact selection summaries.
- Improved Dashboard History readability with richer detail formatting.
- Removed duplicated debug-history settings UI in Options.

## Round 4 — Rule Analysis And Docs Cleanup

Applied after the stabilization round to make rule behavior easier to inspect without mutating extension state.

### Rule Analysis

- Added a shared URL-rule analysis path in `js/url-rules.js` so dry-run inspection uses the same precedence logic as live evaluation.
- Added a background `TEST_URL_RULES` message path for non-mutating rule testing.
- Added a dashboard rule tester that shows matched rules, final extension outcomes, and override chains.
- Added a dashboard jump from history rows back to the related rule editor card.

### History Filters

- Added dashboard filters for history source and result categories.
- Rendered rule-related rows with clearer result chips and preserved related rule metadata for drill-down.

### Documentation Cleanup

- Moved stale “pending” language out of the main status doc for already-shipped dashboard and settings fixes.
- Kept the backlog and architecture docs as planning references instead of treating them as the live implementation status.

## Round 5 — Popup Density Defaults And Multi-Page Permission Banner

Applied after the rule-analysis round to tighten the default popup experience and make Chrome Web Store access requests more discoverable.

### Popup Controls And Defaults

- Added popup header icon size control.
- Added popup content padding and popup scrollbar controls.
- Added popup profile-button `icons_only` mode in addition to `full` and `compact`.
- Changed fresh-default popup settings to a denser baseline:
  - `sortMode = "recent"`
  - `showPopupVersionChips = false`
  - `popupHeaderIconSize = "compact"`
  - `popupScrollbarMode = "invisible"`
  - `popupProfilePillTextMode = "icons_only"`
  - `popupTableActionPanelPosition = "below_name"`
  - `dynamicSizing = false`

### Permission Banner Coverage

- Added the Chrome Web Store permission banner to Options and Profiles in addition to Dashboard.
- Banner visibility now depends on actual permission state and stays visible until the permission is granted.

### Popup Layout Follow-Up

- Fixed table-row chevron direction so collapsed rows point left and expanded rows point down.
- Reworked popup gutter and full-bleed row layout so list rows and expanded action panels adapt correctly to `popupMainPaddingPx`.
- Applied popup scrollbar modes to the real popup scroll surface instead of relying on a body-only style hook.

---

## What Changed From The Original Idea

- URL rules are evaluated in the background with `tabs` and `webNavigation` instead of a blanket content script.
- Dynamic "user-configurable profile shortcuts" were replaced by static Chrome commands plus shortcut guidance.
- Large state is not forced into `chrome.storage.sync`.
- Drive sync is scaffolded but not fully enabled because OAuth configuration is still missing.
- String-enum appearance options (`fontSize`, `spacingScale`) were replaced with numeric pixel values to give users direct control.
- Sidebar layout in the popup was removed to prevent extension name truncation.
- Optional Chrome Web Store permission is requested from visible UI surfaces, not automatically on install, because Chrome blocks that flow without a user gesture.

## What Is Still Deferred

### Full Google Drive Backup

The current code exposes the interface and guard rails, but it does not provide a working OAuth-backed upload/download implementation.

### Browser-Level Validation

Unit tests cover pure logic. Build validation covers manifest and packaging. Manual browser validation is still needed for:

- popup interaction and visual layout
- Chrome command behavior
- real alarm/notification flows
- live URL-rule behavior across tabs and SPA navigation
- extension management permission behavior in Chrome itself

## Current Risk Notes

- The branch changed a large surface area across multiple rounds. End-to-end manual testing in Chrome is required before release.
- The build and packaging flows are verified locally and in GitHub Actions, but that is not a substitute for loading the unpacked extension and exercising all UI surfaces.
- Additional browser-level validation is still needed for the new dashboard rule tester, history filters, and live URL-rule behavior in Chrome.
