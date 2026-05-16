## 2024-05-24 - Deprecated clipboard fallback
**Vulnerability:** Use of deprecated `document.execCommand('copy')`.
**Learning:** In this Manifest V3 extension, clipboard operations should exclusively use the modern `navigator.clipboard.writeText` API; the deprecated `document.execCommand('copy')` fallback is prohibited to ensure security and compliance with Manifest V3 standards.
**Prevention:** Always use `navigator.clipboard.writeText` for clipboard operations without a `document.execCommand` fallback.
