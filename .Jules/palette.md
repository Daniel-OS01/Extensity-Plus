## 2026-04-04 - Accessible icon-only buttons
**Learning:** Found that multiple action buttons and links using FontAwesome icons in index.html lack text content or aria-labels, making them completely inaccessible to screen readers. Specifically, the top header icons (Undo, Dashboard, Options, Profiles) and action icons within list items (Settings, Disable, etc.).
**Action:** Always add explicit aria-labels to icon-only interactive elements and set aria-hidden='true' on the icon elements.
