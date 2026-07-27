## 2024-07-27 - Added accessibility attributes to standalone search input
**Learning:** Found that standalone search inputs without explicit <label> tags (like the one in index.html) lack visual placeholders and aria-labels for screen readers. The search icon adjacent to it must also be hidden from screen readers.
**Action:** When adding search boxes or similar standalone inputs, ensure they have an aria-label, a visual placeholder, and explicitly hide any adjacent decorative icons using aria-hidden='true'.
