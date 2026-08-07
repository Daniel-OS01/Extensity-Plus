## 2024-04-20 - Icon-Only Button Accessibility Pattern Verification
**Learning:** Adding `aria-label` to the interactive `<button>` wrappers and explicit `aria-hidden="true"` to the inner decorative FontAwesome `<i>` tags is a clean, non-disruptive accessibility enhancement for this codebase. It perfectly avoids layout shifts or CSS selector breakage (like accidentally triggering hover/active states that rely on direct parent-child relationships) that might occur if we changed the DOM structure itself.
**Action:** Always prefer this two-step attribute injection pattern for icon-only components in `index.html` to maintain CSS and logic parity while maximizing screen reader compatibility.

## 2024-05-18 - Refactoring interactive icons to buttons
**Learning:** Replaced `fa-gear` and `fa-trash-o` interactive icons with button wrappers using `aria-label` and `aria-hidden="true"` on the icons. Using a bare `<button>` tag with inline styles (`background:none; border:none; padding:0; cursor:pointer; color:inherit;`) is a great pattern because it provides native accessibility semantics and focus states while inheriting existing styles from its container.
**Action:** Use this exact `button` wrapper pattern with inline style resets for making interactive FontAwesome icons keyboard-accessible without having to hunt down and update the specific CSS rules of those icons.
