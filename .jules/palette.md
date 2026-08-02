## 2024-04-20 - Icon-Only Button Accessibility Pattern Verification
**Learning:** Adding `aria-label` to the interactive `<button>` wrappers and explicit `aria-hidden="true"` to the inner decorative FontAwesome `<i>` tags is a clean, non-disruptive accessibility enhancement for this codebase. It perfectly avoids layout shifts or CSS selector breakage (like accidentally triggering hover/active states that rely on direct parent-child relationships) that might occur if we changed the DOM structure itself.
**Action:** Always prefer this two-step attribute injection pattern for icon-only components in `index.html` to maintain CSS and logic parity while maximizing screen reader compatibility.
## 2024-08-02 - Icon-Only Options Button Accessibility
**Learning:** Wrapping interactive `<i>` elements like the "Options" gear icon in semantic `<button type="button">` wrappers improves keyboard and screen reader accessibility without breaking existing layout when combined with an inline style reset and updating CSS hover selectors.
**Action:** Consistently apply this pattern (button wrapper + inline reset + aria-label) to all interactive FontAwesome icons that act as standalone buttons.
