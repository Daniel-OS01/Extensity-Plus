## 2024-04-20 - Icon-Only Button Accessibility Pattern Verification
**Learning:** Adding `aria-label` to the interactive `<button>` wrappers and explicit `aria-hidden="true"` to the inner decorative FontAwesome `<i>` tags is a clean, non-disruptive accessibility enhancement for this codebase. It perfectly avoids layout shifts or CSS selector breakage (like accidentally triggering hover/active states that rely on direct parent-child relationships) that might occur if we changed the DOM structure itself.
**Action:** Always prefer this two-step attribute injection pattern for icon-only components in `index.html` to maintain CSS and logic parity while maximizing screen reader compatibility.

## 2024-05-24 - Profile Remove Icon Button
**Learning:** The `profiles.html` file had the identical a11y problem with its `<i>` delete buttons as `index.html`. Replacing `<i>` bindings with a wrapper `<button>` ensures identical interactive behavior, fixes the accessibility barrier for screen readers, and requires matching the custom classes (like `remove-profile`) strictly on the wrapper button so that styling (hover state color overrides) applies accurately.
**Action:** Continue applying the transparent wrapping `<button>` element with `aria-label` attribute and move existing Knockout.js events and wrapper classes to it when correcting interactive `<i>` elements.
