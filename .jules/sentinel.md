## 2024-05-18 - Missing noopener noreferrer on target="_blank" links
**Vulnerability:** Reverse tabnabbing vulnerability due to missing `rel="noopener noreferrer"` on anchor tags using `target="_blank"`.
**Learning:** `index.html` contained several `<a>` tags with `target="_blank"` without the corresponding `rel` attribute, which could potentially allow the newly opened tab to manipulate the original page via `window.opener`.
**Prevention:** Always include `rel="noopener noreferrer"` when adding `target="_blank"` links to ensure isolation and security.
