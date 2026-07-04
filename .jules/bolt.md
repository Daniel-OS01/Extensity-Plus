## 2024-05-24 - Deduplication Array Filter Objects

**Learning:** When using plain objects `{}` to deduplicate array values by keys (`seen[item]`), it not only incurs the overhead of callback functions inside `.filter()` but is also susceptible to prototype collision (e.g. `__proto__` or `constructor` strings) which can create bugs or silent data drops in deduplication logic.
**Action:** Always prefer ES6 `Set` with a standard `for` loop for `uniqueArray`-like operations to guarantee type distinction (1 vs '1'), prevent prototype issues, and gain significant iteration performance boosts.
## 2024-05-19 - [Knockout.js Array Performance in Loops]
**Learning:** Consolidating multiple array transformations (like `.map().filter()`) into a single `for` loop pass minimizes execution time by avoiding intermediate array allocations and allowing for early returns on direct matches (e.g., in `matchesExtension` search function).
**Action:** When working on performance-sensitive search or filtering logic, avoid chaining array methods. Use a single `for` loop, cache results conditionally, and use `return` early when possible.
## 2024-05-24 - Parallelized Chrome Alarm Clearing
**Learning:** Sequential `await` statements inside `for` loops used for Chrome API calls (like `chrome.alarms.clear`) represent a hidden I/O bottleneck in the background service worker, particularly when tearing down or rebuilding rule states.
**Action:** Always look for loops awaiting independent Chrome extension API calls and refactor them to use `Promise.all` with `Array.prototype.map()` for concurrent execution, which drastically cuts down total execution time.
## 2026-07-04 - Optimize O(N) Array Lookups in Iteration Blocks
**Learning:** Repeatedly using `Array.prototype.indexOf()` on configuration arrays (like `alwaysOn`, `favorites`, `recentList`) inside a `.map()` or `.filter()` loop scaling with the total number of extensions creates an O(N * M) complexity bottleneck.
**Action:** Pre-compute ES6 `Set` and `Map` objects from these arrays before iteration blocks to upgrade O(N) lookups to O(1), ensuring `Map` logic accurately mirrors `indexOf` by strictly recording the first occurrence.
## 2026-07-04 - CI Environment Variables in Workflows
**Learning:** CI workflows utilizing `make dist` and `npm run bundle:chrome-store` fail immediately if the `EXTENSITY_DRIVE_CLIENT_ID` and `EXTENSITY_DRIVE_WEB_CLIENT_ID` environment variables are not supplied, even in smoke tests where dummy values are acceptable.
**Action:** Ensure both variables are explicitly declared in the `env` blocks for these build steps in all relevant GitHub Actions workflows (`codex-build-and-bundle-smoke.yml`, `release-chrome-web-store.yml`).
