# Plan: Extensity Plus — Round 3 Fixes + Enhancements

## Context

Round 2 is complete. User has tested the result and identified new issues and requested new features based on screenshots showing:

- Options page has white input/select backgrounds in dark mode (hardcoded `#fff` not using CSS vars)
- Dashboard tab buttons appear to not switch sections (all sections visible simultaneously — KSB `visible: isTab(...)` reactivity issue)
- Dashboard spacing/colors look wrong (hardcoded light-mode colors not overridden in dark)
- Profiles page layout: user wants extensions list on LEFT, profile management on RIGHT (currently swapped)
- Profiles: sort options needed for extension list (by alpha, popular, profile count)
- Item padding minimum should be 0 to allow zero-spacing layout
- History tab should display clearly (fix tab system first, then improve history row display)
- Separate deliverable: 10–20 improvement suggestions

---

## Fix 1: Options page — dark mode input/select backgrounds

**File:** `styles/options.css`

**Root cause:** `input[type="text"], input[type="number"], input[type="file"], select` all have `background: #fff` hardcoded. `#menu a` has `background: rgba(255,255,255,0.86)` hardcoded. Neither adapts to dark mode.

**Fix:** Replace hardcoded backgrounds with CSS variables.

```css
/* replace background: #fff in the existing selector */
input[type="text"],
input[type="number"],
input[type="file"],
select {
  background: var(--panel);
  color: inherit;
  /* other existing rules unchanged */
}
```

For `#menu a`, add overrides inside the existing dark-mode blocks:

```css
/* Inside both @media (prefers-color-scheme: dark) body:not(.light-mode) and body.dark-mode */
#menu a {
  background: var(--accent-soft);
  color: var(--accent);
}
```

---

## Fix 2: Options page — allow item padding = 0

**File:** `options.html`

Change `min="2"` → `min="0"` on the `itemPaddingPx` input so users can fully remove vertical padding.

---

## Fix 3: Dashboard tab system — KSB visibility bug

**Root cause:** `visible: isTab('history')` uses a function call expression inside a KSB binding. KSB may not correctly track the `activeTab` observable dependency when it's accessed through a plain function call, causing sections to never hide/show reactively.

**Fix:** Replace `isTab` function call approach with explicit `ko.pureComputed` properties per tab in `DashboardViewModel`, then use observable references (not calls) in HTML bindings.

**`js/dashboard.js`** — add to `DashboardViewModel` (after `self.activeTab` declaration):

```js
self.historyTab = ko.pureComputed(function() { return self.activeTab() === "history"; });
self.groupsTab  = ko.pureComputed(function() { return self.activeTab() === "groups"; });
self.rulesTab   = ko.pureComputed(function() { return self.activeTab() === "rules"; });
self.aliasesTab = ko.pureComputed(function() { return self.activeTab() === "aliases"; });
self.dataTab    = ko.pureComputed(function() { return self.activeTab() === "data"; });
```

**`dashboard.html`** — update tab buttons and sections:

```html
<!-- buttons: replace isTab('...') with the new observable names -->
<button data-sbind="click: showTabHistory, css:{selected: historyTab}">History</button>
<button data-sbind="click: showTabGroups,  css:{selected: groupsTab}">Groups</button>
<button data-sbind="click: showTabRules,   css:{selected: rulesTab}">URL Rules</button>
<button data-sbind="click: showTabAliases, css:{selected: aliasesTab}">Aliases</button>
<button data-sbind="click: showTabData,    css:{selected: dataTab}">Import / Export</button>

<!-- sections: replace isTab('...') with observable -->
<section class="dashboard-section" data-sbind="visible: historyTab">...</section>
<section class="dashboard-section" data-sbind="visible: groupsTab">...</section>
<section class="dashboard-section" data-sbind="visible: rulesTab">...</section>
<section class="dashboard-section" data-sbind="visible: aliasesTab">...</section>
<section class="dashboard-section" data-sbind="visible: dataTab">...</section>
```

Keep `self.isTab` function in the ViewModel so existing code does not break.

---

## Fix 4: Dashboard — dark mode hardcoded colors

**File:** `styles/dashboard.css`

Replace all hardcoded light-mode colors with CSS variable equivalents:

| Current | Replace with |
|---------|-------------|
| `color: #365f92` (h2, h3) | `color: var(--accent)` |
| `color: #5e6c7d` (.event-meta) | `color: var(--muted)` |
| `background: #f7f9fc` (.extension-grid label, .alias-list .card-row) | `background: var(--surface)` |
| `border: 1px solid #d2dcea` (same elements) | `border: 1px solid var(--border)` |

Also: `.dashboard-tabs button.selected` uses `background: #1f4f86` — update to `background: var(--accent)`.

---

## Fix 5: Dashboard — improve history row display

**File:** `dashboard.html` (history section template only)

Add the `event` type (enabled/disabled) as a visible badge alongside the existing fields.

Use `data-sbind="attr:{class: $parent.eventBadgeClass(event)}"` — add `eventBadgeClass` to ViewModel:

```js
self.eventBadgeClass = function(event) {
  return "event-badge event-" + (event || "unknown");
};
```

```html
<li>
  <span data-sbind="attr:{class: $parent.eventBadgeClass(event)}, text: event"></span>
  <span class="event-name" data-sbind="text: extensionName"></span>
  <span class="event-meta" data-sbind="text: triggeredBy"></span>
  <span class="event-meta" data-sbind="text: $parent.formatHistoryDate(timestamp)"></span>
</li>
```

Add to `dashboard.css`:

```css
.event-badge {
  border-radius: 6px;
  font-size: 11px;
  font-weight: bold;
  padding: 1px 6px;
  text-transform: uppercase;
}

.event-enabled  { background: rgba(42, 173, 124, 0.15); color: #2aad7c; }
.event-disabled { background: rgba(178, 67, 67, 0.12);  color: var(--danger); }
```

---

## Fix 6: Profiles page — swap layout (extensions LEFT, profiles RIGHT)

**Files:** `profiles.html`, `styles/options.css`

Currently `.sidebar` (profile list) is first in DOM (left column); `.extensions` (extension checklist) is in the right column. User wants the opposite.

**`profiles.html`:** Swap `.sidebar` and `.extensions` divs so `.extensions` comes first in DOM.

**`styles/options.css`** — update grid column sizes:

```css
body.profiles-landscape #profiles {
  grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
}
```

(was `minmax(260px, 320px) minmax(0, 1fr)`)

---

## Fix 7: Profiles — extension sort options

**Files:** `js/profiles.js`, `profiles.html`

**`js/profiles.js`** — add to `ProfilesViewModel`:

```js
self.extSortMode     = ko.observable("alpha");
self.profileCountMap = ko.observable({});

// In applyState, after self.profiles.applyState(...):
var countMap = {};
self.profiles.items().forEach(function(profile) {
  if (!profile.reserved()) {
    profile.items().forEach(function(extId) {
      countMap[extId] = (countMap[extId] || 0) + 1;
    });
  }
});
self.profileCountMap(countMap);

// Sorted computed:
self.sortedExtensions = ko.pureComputed(function() {
  var mode = self.extSortMode();
  var items = self.ext.extensions().slice();
  var countMap = self.profileCountMap();
  if (mode === "popular") {
    return items.sort(function(a, b) { return b.usageCount() - a.usageCount(); });
  }
  if (mode === "recent") {
    return items.sort(function(a, b) { return b.lastUsed() - a.lastUsed(); });
  }
  if (mode === "profileCount") {
    return items.sort(function(a, b) {
      return (countMap[b.id()] || 0) - (countMap[a.id()] || 0);
    });
  }
  return items.sort(function(a, b) {
    return a.displayName().toUpperCase().localeCompare(b.displayName().toUpperCase());
  });
});

// Per-mode active computeds (KSB-safe — no === in binding expressions):
self.sortIsAlpha        = ko.pureComputed(function() { return self.extSortMode() === "alpha"; });
self.sortIsPopular      = ko.pureComputed(function() { return self.extSortMode() === "popular"; });
self.sortIsRecent       = ko.pureComputed(function() { return self.extSortMode() === "recent"; });
self.sortIsProfileCount = ko.pureComputed(function() { return self.extSortMode() === "profileCount"; });

// Setters:
self.setSortAlpha        = function() { self.extSortMode("alpha"); };
self.setSortPopular      = function() { self.extSortMode("popular"); };
self.setSortRecent       = function() { self.extSortMode("recent"); };
self.setSortProfileCount = function() { self.extSortMode("profileCount"); };
```

**`profiles.html`** — replace `foreach: ext.extensions` with `foreach: sortedExtensions`, add sort controls in `.extensions` header:

```html
<div class="sort-modes">
  <button type="button" data-sbind="click: setSortAlpha,        css:{active: sortIsAlpha}">A-Z</button>
  <button type="button" data-sbind="click: setSortPopular,      css:{active: sortIsPopular}">Popular</button>
  <button type="button" data-sbind="click: setSortRecent,       css:{active: sortIsRecent}">Recent</button>
  <button type="button" data-sbind="click: setSortProfileCount, css:{active: sortIsProfileCount}">Profiles</button>
</div>
```

---

## Files to modify

| File | Change |
|------|--------|
| `styles/options.css` | Fix input/select background to `var(--panel)`; fix `#menu a` dark mode background; update landscape grid column order |
| `options.html` | Change `itemPaddingPx` min from `2` to `0` |
| `js/dashboard.js` | Add 5 explicit tab computeds; add `eventBadgeClass` method |
| `dashboard.html` | Update tab buttons + section `visible` bindings; improve history row template |
| `styles/dashboard.css` | Replace hardcoded colors with CSS vars; add `.event-badge`, `.event-enabled`, `.event-disabled` |
| `profiles.html` | Swap `.sidebar` and `.extensions` order; update `foreach` to `sortedExtensions`; add sort buttons |
| `js/profiles.js` | Add `extSortMode`, `profileCountMap`, `sortedExtensions`, sort setters, sort isActive computeds |

---

## Verification

1. `npm test` — all 5 tests pass
2. `npm run check:manifest` — valid
3. Manual: Options page in dark mode — inputs and selects show dark background, not white
4. Manual: Options page — set Item padding to 0, save, open popup — items have no vertical padding
5. Manual: Dashboard — click Groups tab, verify only Groups section appears
6. Manual: Dashboard — click each tab, verify correct section shows, active tab highlighted
7. Manual: Dashboard in dark mode — section headings use accent color (not hardcoded blue)
8. Manual: Dashboard history tab — rows show event badge ("enabled"/"disabled") with color
9. Manual: Profiles page — extension list on left, profile list on right
10. Manual: Profiles page — click "Popular" sort, verify extension list reorders by usageCount
