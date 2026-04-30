# Session Requests — 2026-03-29

## 1. Fix "Reserved profiles cannot be edited from popup rows." error on profiles page
Error message was shown when editing reserved-profile membership from the profiles page. The message also incorrectly said "from popup rows" even though the error can occur from any surface.
- Changed error message to "Reserved profiles cannot be edited."
- Later fully removed the restriction so reserved profiles (Always On, Favorites) can be edited from the profiles page.

## 2. Fix reversed toggle (dongle) icon in the popup
The toggle-all icon (`fa-toggle-on` / `fa-toggle-off`) was showing the wrong state relative to whether extensions were bulk-disabled.
- Reverted to correct logic: `any() ? "fa-toggle-off" : "fa-toggle-on"` (icon reflects current state).

## 3. Add active profile icon + name badge to the popup header
Show the currently active profile's icon and name beside the Extensity title link in the popup header.
- Added `activeProfileObj`, `activeProfileBadgeStyle`, `activeProfileIconClass`, `activeProfileName` computeds in `index.js`.
- Added `.active-profile-badge` span in `index.html` header.
- Added `.active-profile-badge` styles in `styles/index.css`.

## 4. Fix KSB "Uncaught [object Object]" error from ternary operators in data-sbind
Ternary `? :` operators used in `data-sbind` bindings for the new badge caused a KSB parse error (KSB does not support ternary expressions).
- Moved all ternary logic into ViewModel `ko.pureComputed` properties.

## 5. Fix "Reserved profiles cannot be edited." when adding extensions to Always On / Favorites from profiles page
The `updateExtensionProfileMembership` background handler blocked all `__`-prefixed profiles unconditionally. Reserved profiles are stored in the profile map and are legitimate editing targets.
- Removed the `__ prefix` guard from `background.js` entirely.

## 6. Set profiles page defaults: LTR direction, extension list panel on Right
- `profileLayoutDirection`: `"rtl"` → `"ltr"`
- `profileExtensionSide`: `"left"` → `"right"`
- `profileNameDirection` was already `"ltr"`.

## 7. Set full options defaults
Updated `syncDefaults` in `storage.js` to match the desired default configuration:

| Setting | Old default | New default |
|---|---|---|
| `appsFirst` | `false` | `true` |
| `dynamicSizing` | `false` | `true` |
| `enabledFirst` | `false` | `true` |
| `keepAlwaysOn` | `false` | `true` |
| `popupListStyle` | `"card"` | `"table"` |
| `popupProfileBadgeTextMode` | `"full"` | `"compact"` |
| `itemPaddingPx` | `10` | `0` |
| `itemPaddingXPx` | `12` | `0` |
| `itemSpacingPx` | `8` | `0` |
| `itemNameGapPx` | `10` | `0` |
| `showReserved` | `false` | `true` |
| `accentColor` | `""` | `"#4a90d9"` |
| `popupBgColor` | `""` | `"#1e2530"` |

## 8. Fix Item spacing, Item horizontal padding, and Icon/name gap not working; add Item vertical space
Three CSS variables were broken for the table row list style (the new default):

- `--item-name-gap` — `.table-row-main` had hardcoded `column-gap: 8px` instead of using the var. Fixed to `column-gap: var(--item-name-gap, 8px)`.
- `--item-spacing` — table row and flat row `li` overrides hardcoded `margin-bottom: 0`, bypassing the var. Fixed to `margin-bottom: var(--item-spacing, 0)`.
- `--item-padding-x` — already worked via `.table-row-main padding`, but was invisible with default value 0.

New **Item vertical space (px)** control added:
- Storage key: `itemVerticalSpacePx` (default `0`)
- CSS var: `--item-v-space`
- Applied via `calc(var(--item-padding-v, ...) + var(--item-v-space, 0px))` as vertical padding on all row types (card, flat, compact, table).
- Also applied as `margin-top` on all `ul.items li` rows.
- Set in `index.js`, `options.js`, `dashboard.js`.
- Input field added to options.html Appearance section.

## 9. Create this request log file
Created `.claude/plans/session-requests-2026-03-29.md` listing all requests from this session.
