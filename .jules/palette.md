## 2024-04-20 - Icon-Only Button Accessibility Pattern Verification
**Learning:** Adding `aria-label` to the interactive `<button>` wrappers and explicit `aria-hidden="true"` to the inner decorative FontAwesome `<i>` tags is a clean, non-disruptive accessibility enhancement for this codebase. It perfectly avoids layout shifts or CSS selector breakage (like accidentally triggering hover/active states that rely on direct parent-child relationships) that might occur if we changed the DOM structure itself.
**Action:** Always prefer this two-step attribute injection pattern for icon-only components in `index.html` to maintain CSS and logic parity while maximizing screen reader compatibility.

## 2026-07-09 - Inline style reset hover conflict resolution
**Learning:** When converting icon-only tags to accessible buttons and applying an inline style reset (e.g. `color:inherit;`), CSS hover rules targeting the new element fail to apply because the inline style has higher specificity.
**Action:** Append `!important` to the CSS hover state rule (e.g., `color: var(--accent) !important;`) to ensure the interactive visual feedback properly overrides the inline inherited color.
