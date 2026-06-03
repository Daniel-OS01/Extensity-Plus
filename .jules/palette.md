## 2024-04-20 - Icon-Only Button Accessibility Pattern Verification
**Learning:** Adding `aria-label` to the interactive `<button>` wrappers and explicit `aria-hidden="true"` to the inner decorative FontAwesome `<i>` tags is a clean, non-disruptive accessibility enhancement for this codebase. It perfectly avoids layout shifts or CSS selector breakage (like accidentally triggering hover/active states that rely on direct parent-child relationships) that might occur if we changed the DOM structure itself.
**Action:** Always prefer this two-step attribute injection pattern for icon-only components in `index.html` to maintain CSS and logic parity while maximizing screen reader compatibility.

## 2024-05-18 - Replacing Interactive Icons with Buttons
**Learning:** Some interactive icons (`<i class="fa" data-sbind="click: ...">`) exist without `<button>` wrappers. Replacing them with `<button>` elements with `style="background:none; border:none; padding:0; cursor:pointer; color:inherit;"` makes them accessible to keyboard users while preserving layout and hover states.
**Action:** Convert clickable icon-only `<i>` tags into proper `<button>` elements with `aria-label`.

## 2024-05-18 - Replacing Interactive Icons with Buttons
**Learning:** Some interactive icons (`<i class="fa" data-sbind="click: ...">`) exist without `<button>` wrappers. Replacing them with `<button>` elements with `style="background:none; border:none; padding:0; cursor:pointer; color:inherit;"` makes them accessible to keyboard users while preserving layout and hover states.
**Action:** Convert clickable icon-only `<i>` tags into proper `<button>` elements with `aria-label`.
