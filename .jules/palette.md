## 2024-04-20 - Icon-Only Button Accessibility Pattern Verification
**Learning:** Adding `aria-label` to the interactive `<button>` wrappers and explicit `aria-hidden="true"` to the inner decorative FontAwesome `<i>` tags is a clean, non-disruptive accessibility enhancement for this codebase. It perfectly avoids layout shifts or CSS selector breakage (like accidentally triggering hover/active states that rely on direct parent-child relationships) that might occur if we changed the DOM structure itself.
**Action:** Always prefer this two-step attribute injection pattern for icon-only components in `index.html` to maintain CSS and logic parity while maximizing screen reader compatibility.

## 2024-05-25 - Search Input Accessibility and Affordance
**Learning:** For standalone inputs without explicit `<label>` tags (like search boxes next to an icon), we must provide both a visual affordance via the `placeholder` attribute and an accessible name for screen readers via `aria-label`. Adjacent decorative icons must also be explicitly hidden using `aria-hidden="true"` to prevent redundancy or confusion for assistive tech.
**Action:** Always check standalone `<input>` elements for both `placeholder` and `aria-label`, and hide neighboring contextual icons.
