## 2024-05-24 - [Reverse Tabnabbing Vulnerability via target="_blank"]
**Vulnerability:** External anchor links using `target="_blank"` without `rel="noopener noreferrer"`.
**Learning:** External links opening in a new tab without explicit `noopener` attributes expose the extension to potential reverse tabnabbing vulnerabilities, where a compromised external site could manipulate the extension page via the `window.opener` reference, leading to potential phishing or XSS, despite modern browser mitigation defaults.
**Prevention:** Always explicitly include `rel="noopener noreferrer"` whenever `target="_blank"` is used on an anchor tag.
