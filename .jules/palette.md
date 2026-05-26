## 2024-04-20 - Icon-Only Button Accessibility Pattern Verification
**Learning:** Adding `aria-label` to the interactive `<button>` wrappers and explicit `aria-hidden="true"` to the inner decorative FontAwesome `<i>` tags is a clean, non-disruptive accessibility enhancement for this codebase. It perfectly avoids layout shifts or CSS selector breakage (like accidentally triggering hover/active states that rely on direct parent-child relationships) that might occur if we changed the DOM structure itself.
**Action:** Always prefer this two-step attribute injection pattern for icon-only components in `index.html` to maintain CSS and logic parity while maximizing screen reader compatibility.

## 2026-05-26 - Standalone Input Accessibility
**Learning:** Standalone inputs without explicit `<label>` tags (such as search boxes) require both a `placeholder` attribute for visual affordance and an `aria-label` for screen readers to ensure accessibility. Furthermore, adjacent decorative icons must be explicitly hidden using `aria-hidden="true"`.
**Action:** Always verify that standalone inputs like search bars have both `placeholder` and `aria-label` attributes, and explicitly hide accompanying non-interactive icons to prevent redundant or confusing screen reader announcements.
