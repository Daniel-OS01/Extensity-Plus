## 2024-04-01 - Interactive Element Wrapper Labels
**Learning:** The popup UI components (like header icons) previously relied on `title` attributes placed directly on decorative child `<i>` tags for screen reader descriptions. This is an accessibility anti-pattern. Assistive technologies often announce the `<a>` or `<button>` first, missing the inner `title`.
**Action:** When adding or auditing icon-only action links, place the descriptive label (`aria-label`) on the interactive wrapper (`<a>` or `<button>`) and explicitly hide the purely decorative icons using `aria-hidden="true"`.
