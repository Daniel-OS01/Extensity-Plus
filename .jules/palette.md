## 2024-04-20 - Icon-Only Button Accessibility Pattern Verification
**Learning:** Adding `aria-label` to the interactive `<button>` wrappers and explicit `aria-hidden="true"` to the inner decorative FontAwesome `<i>` tags is a clean, non-disruptive accessibility enhancement for this codebase. It perfectly avoids layout shifts or CSS selector breakage (like accidentally triggering hover/active states that rely on direct parent-child relationships) that might occur if we changed the DOM structure itself.
**Action:** Always prefer this two-step attribute injection pattern for icon-only components in `index.html` to maintain CSS and logic parity while maximizing screen reader compatibility.

## 2024-05-18 - Replacing Interactive Icons with Buttons
**Learning:** Some interactive icons (`<i class="fa" data-sbind="click: ...">`) exist without `<button>` wrappers. Replacing them with `<button>` elements with `style="background:none; border:none; padding:0; cursor:pointer; color:inherit;"` makes them accessible to keyboard users while preserving layout and hover states.
**Action:** Convert clickable icon-only `<i>` tags into proper `<button>` elements with `aria-label`.

## 2024-06-03 - CI OAuth Validation Fix
**Learning:** To prevent the Chrome Web Store bundle script from failing in CI workflows (like `codex-build-and-bundle-smoke.yml`), dummy environment variables for `EXTENSITY_DRIVE_CLIENT_ID` and `EXTENSITY_DRIVE_WEB_CLIENT_ID` must be provided to the `make dist` step. These dummy values must conform to the Google OAuth format (e.g., '123-abc.apps.googleusercontent.com') to pass regex validation in `scripts/set-drive-oauth-client-id.js`.
**Action:** When adding dummy credentials for CI workflows, always use format-compliant strings rather than arbitrary placeholders.
