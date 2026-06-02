## 2024-04-20 - Icon-Only Button Accessibility Pattern Verification
**Learning:** Adding `aria-label` to the interactive `<button>` wrappers and explicit `aria-hidden="true"` to the inner decorative FontAwesome `<i>` tags is a clean, non-disruptive accessibility enhancement for this codebase. It perfectly avoids layout shifts or CSS selector breakage (like accidentally triggering hover/active states that rely on direct parent-child relationships) that might occur if we changed the DOM structure itself.
**Action:** Always prefer this two-step attribute injection pattern for icon-only components in `index.html` to maintain CSS and logic parity while maximizing screen reader compatibility.

## 2024-05-15 - Standalone Input Search Box Accessibility Pattern
**Learning:** For standalone inputs without explicit `<label>` tags (such as search boxes), providing both a `placeholder` attribute (for visual users) and an `aria-label` attribute (for screen readers) is a critical accessibility requirement. Furthermore, any adjacent decorative icons (like FontAwesome search icons) must be explicitly hidden from screen readers using `aria-hidden="true"` to prevent confusing and redundant announcements.
**Action:** Always apply `placeholder`, `aria-label`, and `aria-hidden="true"` (on adjacent icons) when building or modifying standalone search or input fields.
