# Extensity Plus Improvement Roadmap

This file is a backlog of follow-up improvements after the implemented 2.0 popup, profiles, rules, history, and dashboard rounds. It is intentionally future-looking. It should not re-list work that is already live in the repo.

Already shipped and therefore omitted here:
- popup flat, compact, and table list styles
- popup profile button label modes, including `full`, `compact`, and `icons_only`
- popup content padding and popup scrollbar controls
- popup header icon size, recent-sort default, and version-chip default toggles
- profile layout switch on the Profiles page
- RTL-safe profile naming fields
- dashboard history source/result filters
- dashboard dry-run URL rule tester and overlap inspection
- dashboard jump from history rows to the related rule
- Chrome Web Store permission banners on Dashboard, Options, and Profiles

Each item below is still pending. The wording reflects the current codebase so future plans start from the real product state.

## How to Read This Doc

- `Idea`: The proposed improvement.
- `Current state`: What the project already does today.
- `Proposal`: The likely shape of the follow-up change.
- `Why it matters`: The user-facing value if it ships.
- `Likely touchpoints`: The modules most likely to change.
- `Effort`: Rough implementation size.
- `Priority`: Planning signal, not a commitment.

## Popup UX

### 1. Popup Density And Metadata Presets

- `Idea`: Add a few higher-level appearance presets for the popup instead of only low-level spacing controls.
- `Current state`: Users can already choose grid or list mode, list style (`card`, `flat`, `compact`, `table`), icon size, content padding, scrollbar mode, profile-pill mode, and expanded action row layout.
- `Proposal`: Add presets such as `Minimal`, `Balanced`, and `Detailed` that set coherent defaults across the existing popup controls and optionally surface more metadata such as aliases, profile badges, or rule hints.
- `Why it matters`: The popup already has many controls; presets would make customization faster and less trial-and-error.
- `Likely touchpoints`: `index.html`, `js/index.js`, `options.html`, `js/options.js`, `js/storage.js`, `styles/index.css`.
- `Effort`: Medium.
- `Priority`: Medium.

### 2. Better Empty, Loading, And Search States

- `Idea`: Replace silent or sparse popup states with explicit status messaging.
- `Current state`: Popup search, profile filtering, and loading work, but the UI still leans on blank space when a list is empty or a filter removes all matches.
- `Proposal`: Add compact helper text for loading, no matches, and empty profile states, plus a clear-search action when relevant.
- `Why it matters`: Users can tell whether the popup is still loading, filtered to zero, or genuinely has nothing to show.
- `Likely touchpoints`: `index.html`, `js/index.js`, `styles/index.css`.
- `Effort`: Small.
- `Priority`: Medium.

### 3. Keyboard-First Popup Navigation Polish

- `Idea`: Complete the popup keyboard flow and surface the shortcuts in-product.
- `Current state`: Arrow-key row navigation exists for popup rows, chevrons expand rows, and search autofocus already works.
- `Proposal`: Add slash-to-focus-search, escape-to-clear-search, enter-to-toggle on the selected row, and a compact shortcut hint panel.
- `Why it matters`: The popup is the highest-frequency surface; better keyboard support improves both speed and accessibility.
- `Likely touchpoints`: `index.html`, `js/index.js`, `styles/index.css`.
- `Effort`: Medium.
- `Priority`: High.

## Profiles

### 4. Favorites And Always On Management Polish

- `Idea`: Make reserved profiles easier to inspect and compare.
- `Current state`: `Always On` and `Favorites` are editable from the Profiles page and already benefit from the newer layout controls, but they still behave like lightly-special-cased lists rather than richer management views.
- `Proposal`: Add counts, overlap indicators, and quick filtering such as `show overlap with current profile` or `show extensions missing from active state`.
- `Why it matters`: Reserved profiles are core workflow tools and should be easier to reason about than normal named profiles.
- `Likely touchpoints`: `profiles.html`, `js/profiles.js`, `styles/options.css`, `js/storage.js`.
- `Effort`: Medium.
- `Priority`: Medium.

### 5. Profile Diff Before Apply Or Save

- `Idea`: Show a compact enable/disable diff before applying a profile or overwriting one.
- `Current state`: Profiles can be applied and edited, but the user does not get a pre-action summary of what will change.
- `Proposal`: Compare the target profile with the current enabled set and show concise `Enabling` / `Disabling` summaries in the popup and Profiles page before the action commits.
- `Why it matters`: Diff previews make profile actions safer when many extensions are involved.
- `Likely touchpoints`: `profiles.html`, `js/profiles.js`, `index.html`, `js/index.js`, `js/background.js`, `js/engine.js`.
- `Effort`: Medium.
- `Priority`: Medium.

## Dashboard And Data

### 6. History Grouping, Search, And Session View

- `Idea`: Build on the new history filters with better grouping and faster investigation tools.
- `Current state`: Dashboard History already supports source/result filters, richer row details, debug entries, and jumping to a related rule.
- `Proposal`: Add grouped timestamps or sessions, text search, and a clearer distinction between manual actions, profile applies, and debug-only rule evaluations.
- `Why it matters`: Once history volume grows, filters alone are not enough to explain what happened during a browsing session.
- `Likely touchpoints`: `dashboard.html`, `js/dashboard.js`, `styles/dashboard.css`, `js/history-logger.js`.
- `Effort`: Medium.
- `Priority`: High.

### 7. More Actions From History Rows

- `Idea`: Let users act directly from history beyond the existing `Open related rule` path.
- `Current state`: Rule-linked history rows can already jump back to the corresponding rule editor.
- `Proposal`: Add actions such as `Apply this profile again`, `Create profile from this state`, or `Re-run rule test with this URL` when the row metadata supports it.
- `Why it matters`: History should help recovery and iteration, not only diagnosis.
- `Likely touchpoints`: `dashboard.html`, `js/dashboard.js`, `js/background.js`, `profiles.html`, `js/profiles.js`.
- `Effort`: Medium.
- `Priority`: Medium.

### 8. Trend Summaries And Empty-State Guidance

- `Idea`: Add lightweight summary cards and setup guidance across dashboard tabs.
- `Current state`: The dashboard already exposes history, groups, rules, aliases, import/export, and the permission banner, but low-data states still feel bare once the main setup actions are complete.
- `Proposal`: Add summaries such as `Most toggled this week`, `Most used profile`, `No aliases yet`, and `No rules configured`, with links into the relevant editing surface.
- `Why it matters`: This makes the dashboard more useful for first-run and low-history users.
- `Likely touchpoints`: `dashboard.html`, `js/dashboard.js`, `styles/dashboard.css`, `js/storage.js`.
- `Effort`: Small.
- `Priority`: Medium.

## Automation And Sync

### 9. Import Preview And Restore Diff

- `Idea`: Preview backup contents before applying an import.
- `Current state`: JSON import/export already exists in the dashboard, but restore is still high-impact and opaque.
- `Proposal`: Parse the selected backup, validate it, and show a summary of adds, replacements, and version warnings before mutating local state.
- `Why it matters`: Import becomes safer and easier to audit across devices or dated backups.
- `Likely touchpoints`: `dashboard.html`, `js/dashboard.js`, `js/import-export.js`, `js/storage.js`, `js/background.js`.
- `Effort`: Medium.
- `Priority`: High.

### 10. Reminder Snooze And Quiet Hours

- `Idea`: Make reminder prompts deferable and less intrusive.
- `Current state`: Reminder scheduling exists, but there is no snooze flow or time-window suppression.
- `Proposal`: Add per-reminder snooze actions and a quiet-hours option that suppresses reminder surfacing without deleting queued items.
- `Why it matters`: Reminders are only useful if users can trust them not to interrupt at the wrong moment.
- `Likely touchpoints`: `js/reminders.js`, `js/background.js`, `js/storage.js`, `options.html`, `js/options.js`, `dashboard.html`.
- `Effort`: Medium.
- `Priority`: Medium.

### 11. Drive Sync Health And Real Sync Enablement

- `Idea`: Turn the current Drive sync boundary into a trustworthy, understandable feature.
- `Current state`: The UI exposes sync actions and status fields, but `js/drive-sync.js` is still a guarded stub because OAuth is not configured in this build. The Chrome Web Store permission banner is already handled separately and should not be conflated with real Drive sync readiness.
- `Proposal`: First expose clearer stub/disabled messaging and diagnostics in the dashboard and options UI. If OAuth is later added, extend that same surface with last-success, last-error, and pending-change reporting.
- `Why it matters`: Users should not mistake the current stub for a fully working backup channel.
- `Likely touchpoints`: `js/drive-sync.js`, `js/background.js`, `js/storage.js`, `dashboard.html`, `js/dashboard.js`, `options.html`.
- `Effort`: Medium.
- `Priority`: Medium.

## Accessibility And Internationalization

### 12. Focus Ring Preview And Contrast-Safe Appearance Controls

- `Idea`: Show how focus and selection states look under the current appearance settings.
- `Current state`: Theme-related options and CSS variables exist, but users cannot preview keyboard focus visibility before saving settings.
- `Proposal`: Add a small preview strip in Options that renders focused buttons, selected tabs, and hovered rows using the active tokens.
- `Why it matters`: Appearance customization becomes safer for keyboard users and high-contrast themes.
- `Likely touchpoints`: `options.html`, `styles/options.css`, `js/options.js`, `styles/index.css`, `styles/dashboard.css`.
- `Effort`: Medium.
- `Priority`: Medium.

### 13. Keyboard-Only Flow Audit Across All Surfaces

- `Idea`: Make popup, Profiles, Options, and Dashboard fully usable without a mouse.
- `Current state`: Popup row navigation is partly keyboard-friendly, but the rest of the extension has not had a complete keyboard audit.
- `Proposal`: Audit tab order, focus visibility, enter/space activation, escape behavior, and list navigation across all pages, then document the supported paths.
- `Why it matters`: This closes accessibility gaps and makes frequent actions faster for advanced users.
- `Likely touchpoints`: `index.html`, `profiles.html`, `options.html`, `dashboard.html`, `js/index.js`, `js/profiles.js`, `js/options.js`, `js/dashboard.js`.
- `Effort`: Medium.
- `Priority`: High.

### 14. Screen-Reader Labels And Live Announcements

- `Idea`: Improve semantics and spoken feedback for state-changing actions.
- `Current state`: The UI has buttons, badges, and toggles, but it does not consistently announce results such as `profile applied` or `extension disabled`.
- `Proposal`: Add stronger labels, ARIA relationships where needed, and a lightweight live-region pattern for major actions.
- `Why it matters`: Screen-reader users should be able to understand what changed without guessing from icon-only controls.
- `Likely touchpoints`: `index.html`, `profiles.html`, `dashboard.html`, `options.html`, `js/index.js`, `js/profiles.js`, `js/dashboard.js`.
- `Effort`: Medium.
- `Priority`: Medium.

### 15. Locale-Aware Formatting And Direction Handling

- `Idea`: Standardize localized dates, counts, and mixed-direction text behavior.
- `Current state`: History rows already use `toLocaleString()`, and RTL handling now exists for profile name fields, but formatting remains page-specific.
- `Proposal`: Centralize helpers for localized timestamps and counters, and extend field-level direction handling to aliases and other user-entered labels where needed.
- `Why it matters`: This reduces formatting drift and improves mixed-language readability across the extension.
- `Likely touchpoints`: `js/dashboard.js`, `js/profiles.js`, `js/index.js`, `profiles.html`, `dashboard.html`, `styles/options.css`.
- `Effort`: Small.
- `Priority`: Medium.

## Engineering Quality And Release

### 16. Automated Browser Smoke Test Matrix

- `Idea`: Add a small browser-level smoke suite for the main extension surfaces.
- `Current state`: The repo has browser-module tests and manifest/package validation, but not automated real-browser coverage for popup and page interactions.
- `Proposal`: Add a narrow smoke matrix that opens popup, Options, Profiles, and Dashboard and verifies the highest-risk interactions render and switch correctly.
- `Why it matters`: This catches UI regressions that pure module tests cannot see.
- `Likely touchpoints`: `tests/browser-modules.test.js`, browser automation scripts, `package.json`, `index.html`, `profiles.html`, `options.html`, `dashboard.html`.
- `Effort`: Large.
- `Priority`: High.

### 17. Visual Regression Screenshot Checklist

- `Idea`: Add a repeatable screenshot review step for major UI surfaces.
- `Current state`: CSS-heavy changes still rely mostly on manual visual review.
- `Proposal`: Define a compact screenshot matrix for popup list/grid modes, Options light/dark, Profiles landscape/portrait, and Dashboard rule/history views.
- `Why it matters`: Small layout or theme regressions are easier to catch in screenshots than in code review.
- `Likely touchpoints`: screenshot tooling, CI scripts, `styles/index.css`, `styles/options.css`, `styles/dashboard.css`.
- `Effort`: Medium.
- `Priority`: High.

### 18. Docs Hardening And Source-Of-Truth Cleanup

- `Idea`: Keep backlog, status, and architecture docs aligned after each round lands.
- `Current state`: The status docs were recently cleaned up, but this backlog needed the same pass because it still listed shipped work as pending.
- `Proposal`: Add a lightweight doc review step to each round so shipped items move into `docs/extensity-2.0-status.md` and are removed or rewritten here.
- `Why it matters`: Planning drift wastes time and makes the real product harder to understand.
- `Likely touchpoints`: `docs/extensity-2.0-status.md`, `docs/extensity-2.0-plan.md`, `.claude/plans/*.md`.
- `Effort`: Small.
- `Priority`: Medium.

### 19. State Contract Tests For Storage, Migration, And Import/Export

- `Idea`: Expand compatibility tests around persisted state.
- `Current state`: The repo already has tests for several defaults and migration behaviors, including popup list style migration and rule-analysis paths.
- `Proposal`: Add broader contract coverage for new settings, backup envelopes, and migration expectations so future UI controls do not silently drift across storage boundaries.
- `Why it matters`: Preference flags are easy to add and easy to break unless the storage contract is tested end-to-end.
- `Likely touchpoints`: `js/storage.js`, `js/migration.js`, `js/import-export.js`, `js/background.js`, `tests/browser-modules.test.js`.
- `Effort`: Medium.
- `Priority`: High.

## Notes For Future Planning

The next implementation plan should pick a narrow slice from this backlog, define acceptance criteria, and verify the relevant module boundaries before code changes begin. This file should stay short enough that shipped work is removed promptly instead of accumulating as stale “future” ideas.
