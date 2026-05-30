## 2024-04-20 - Icon-Only Button Accessibility Pattern Verification
**Learning:** Adding `aria-label` to the interactive `<button>` wrappers and explicit `aria-hidden="true"` to the inner decorative FontAwesome `<i>` tags is a clean, non-disruptive accessibility enhancement for this codebase. It perfectly avoids layout shifts or CSS selector breakage (like accidentally triggering hover/active states that rely on direct parent-child relationships) that might occur if we changed the DOM structure itself.
**Action:** Always prefer this two-step attribute injection pattern for icon-only components in `index.html` to maintain CSS and logic parity while maximizing screen reader compatibility.

## 2024-05-18 - Standalone Input Accessibility Pattern
**Learning:** For standalone inputs without explicit `<label>` tags (such as search boxes), it is crucial to provide both a `placeholder` attribute for visual affordance and an `aria-label` attribute for screen readers. Adjacent decorative icons must be explicitly hidden using `aria-hidden="true"` to prevent redundant or confusing screen reader announcements.
**Action:** Always ensure standalone inputs have both `placeholder` and `aria-label` attributes, and that any adjacent decorative icons are explicitly hidden from assistive technologies.
