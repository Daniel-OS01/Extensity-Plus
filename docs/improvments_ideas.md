
---

## Improvement Suggestions (10–20)

These are NOT part of this implementation — they are ideas for future development.

1. **Quick-access Favorites row in popup** — Pin up to 5 extensions as "Favorites" shown in a persistent row at the top of the popup regardless of search/sort, so the most-used tools are always one click away.

2. **Per-extension notes / labels** — Let users attach a short text note to any extension (e.g. "enable only for work"). Shown as a tooltip on hover or as a secondary line under the name.

3. **Profile auto-apply based on time of day** — User sets "Work profile 9 AM–6 PM weekdays, Casual profile evenings." Background service worker reads `chrome.alarms` to switch profiles automatically.

4. **Extension health indicators** — Show a small warning badge when an extension hasn't been used in N days (configurable), has been disabled for a long time, or its permissions are unusually broad. Helps users clean up stale installs.

5. **One-click "focus mode"** — A single button that disables all non-essential extensions (everything not in Always On) and sets a timer; after the timer, extensions restore automatically.

6. **Keyboard-driven popup navigation** — Full keyboard shortcuts: number keys 1–9 toggle nth extension in list, `/` focuses search box. Currently arrow keys work but letter shortcuts are missing.

7. **Profile diff view** — Before applying a profile, show a compact diff: "Enabling: X, Y, Z — Disabling: A, B, C" so the user sees exactly what will change before committing.

8. **Import from Chrome extension groups** — Chrome 112+ ships its own extension groups. Detect these and offer to import them as Extensity profiles.

9. **Extension icon grid view in popup** — A dense "icon only" view mode (16×16 icons in a grid) for power users with many extensions. Clicking opens a tooltip with name + toggle.

10. **Search shortcut in popup** — Pressing `/` from anywhere in the popup jumps focus to the search box without clicking.

11. **Profile schedule — auto-switch on calendar events** — Integrates with Google Calendar (read-only) via OAuth. When a calendar event starts, auto-apply a mapped profile. When it ends, restore the previous one.

12. **Extension groups with collapse** — In the popup, groups collapse/expand with a toggle, letting users hide rarely-used groups to reduce scroll.

13. **Usage heatmap in Dashboard** — A simple heatmap showing how many extension toggles happened per day over the last 90 days. Helps users understand their workflow patterns.

14. **Undo history sidebar in popup** — Show the last 3 actions in a mini undo stack (not just one). Each shows what changed and can be individually undone.

15. **Sync profiles across devices via Drive** — Completing the Drive sync stub would make profiles, aliases, and groups available on all Chrome instances signed into the same Google account.

16. **Extension tags / custom categories** — Let users define their own tags (e.g. "Design", "Dev", "Privacy") and assign multiple tags to extensions. The popup can then filter by tag.

17. **Badge count on Extensity icon** — Show a small badge on the toolbar icon when a URL rule is currently active, so the user knows the rule engine has altered their extension set.

18. **Always On sub-groups** — Allow sub-groups within Always On (e.g. "Always On — Work", "Always On — Personal") that can be toggled as a unit without affecting the global toggle.

19. **Export / share a profile as a URL** — Encode a profile (list of extension IDs) as a URL-safe base64 string. User can share a "dev setup" link. Recipient imports it into their own Extensity.

20. **Permission audit view** — For each extension, show a summary of the permissions it has requested. Let users sort or filter by permission scope to identify privacy/security heavy extensions.
