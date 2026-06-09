## 2024-05-24 - Deduplication Array Filter Objects

**Learning:** When using plain objects `{}` to deduplicate array values by keys (`seen[item]`), it not only incurs the overhead of callback functions inside `.filter()` but is also susceptible to prototype collision (e.g. `__proto__` or `constructor` strings) which can create bugs or silent data drops in deduplication logic.
**Action:** Always prefer ES6 `Set` with a standard `for` loop for `uniqueArray`-like operations to guarantee type distinction (1 vs '1'), prevent prototype issues, and gain significant iteration performance boosts.
## 2024-05-19 - [Knockout.js Array Performance in Loops]
**Learning:** Consolidating multiple array transformations (like `.map().filter()`) into a single `for` loop pass minimizes execution time by avoiding intermediate array allocations and allowing for early returns on direct matches (e.g., in `matchesExtension` search function).
**Action:** When working on performance-sensitive search or filtering logic, avoid chaining array methods. Use a single `for` loop, cache results conditionally, and use `return` early when possible.
## 2024-05-24 - Parallelized Chrome Alarm Clearing
**Learning:** Sequential `await` statements inside `for` loops used for Chrome API calls (like `chrome.alarms.clear`) represent a hidden I/O bottleneck in the background service worker, particularly when tearing down or rebuilding rule states.
**Action:** Always look for loops awaiting independent Chrome extension API calls and refactor them to use `Promise.all` with `Array.prototype.map()` for concurrent execution, which drastically cuts down total execution time.
## 2024-06-12 - Consolidate Array Manipulations in Background Script
**Learning:** In heavily used background script operations (like `runToggleAll` or `runApplyProfile` which iterate over all extensions), chaining `.filter().map()` operations creates unnecessary intermediate array allocations, slowing down the processing of extension states.
**Action:** Replace multiple chained array transformations (`.filter().map()`) with a single `for` loop that evaluates conditions and pushes the needed results directly. This avoids allocating extra arrays in memory and speeds up execution significantly on large profiles.
## 2024-06-12 - CI Environment Variables for Chrome Web Store bundle
**Learning:** The GitHub Actions CI flow (`codex-build-and-bundle-smoke.yml`) uses `make dist` which copies `manifest.json`. However, `make dist` itself does not replace the OAuth client ID placeholders required by `npm run bundle:chrome-store`. The dummy environment variables (`EXTENSITY_DRIVE_CLIENT_ID` and `EXTENSITY_DRIVE_WEB_CLIENT_ID`) and their corresponding scripts (`drive:set-client-id`, `drive:set-web-client-id`) must be executed explicitly in the CI configuration *before* `make dist` is run, so that the updated files are copied to the `dist` folder.
**Action:** Always verify if CI scripts require specific placeholder replacements and make sure to explicitly provide dummy values using `run: export VAR=... && npm run script` inside the GitHub Actions YAML before invoking the build command.
