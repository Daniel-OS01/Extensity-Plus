# 🧪 Test invalid URL error path in isSupportedUrl

🎯 **What:** The `try...catch` block in `isSupportedUrl` (inside `js/url-rules.js`) caught errors thrown by the `URL` constructor but this error path was completely untested.
📊 **Coverage:** A new test case `assert.equal(root.ExtensityUrlRules.isSupportedUrl("not_a_valid_url"), false);` was added to `tests/browser-modules.test.js` to ensure the invalid URL string scenario correctly triggers the error path and returns `false`.
✨ **Result:** Increased test coverage for the error condition in URL parsing, improving confidence that malformed URLs are handled gracefully without throwing unhandled exceptions.
