## 2024-05-18 - JSON Parsing limits

**Vulnerability:** DoS due to Stack Overflow in `readCategoryFromJsonObject` / `JSON.parse` during Chrome Web Store parsing.
**Learning:** The background script fetches Chrome Web Store metadata and parses `ld+json` blobs dynamically, which isn't protected from arbitrary depth recursively triggering a stack overflow.
**Prevention:** Implemented size limitations, visit counters, and recursion depth limits within the parsing recursive function.
