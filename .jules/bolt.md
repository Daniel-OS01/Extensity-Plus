## 2024-05-24 - Deduplication Array Filter Objects

**Learning:** When using plain objects `{}` to deduplicate array values by keys (`seen[item]`), it not only incurs the overhead of callback functions inside `.filter()` but is also susceptible to prototype collision (e.g. `__proto__` or `constructor` strings) which can create bugs or silent data drops in deduplication logic.
**Action:** Always prefer ES6 `Set` with a standard `for` loop for `uniqueArray`-like operations to guarantee type distinction (1 vs '1'), prevent prototype issues, and gain significant iteration performance boosts.
## 2024-05-19 - [Knockout.js Array Performance in Loops]
**Learning:** Consolidating multiple array transformations (like `.map().filter()`) into a single `for` loop pass minimizes execution time by avoiding intermediate array allocations and allowing for early returns on direct matches (e.g., in `matchesExtension` search function).
**Action:** When working on performance-sensitive search or filtering logic, avoid chaining array methods. Use a single `for` loop, cache results conditionally, and use `return` early when possible.
## 2024-05-24 - Parallelized Chrome Alarm Clearing
**Learning:** Sequential `await` statements inside `for` loops used for Chrome API calls (like `chrome.alarms.clear`) represent a hidden I/O bottleneck in the background service worker, particularly when tearing down or rebuilding rule states.
**Action:** Always look for loops awaiting independent Chrome extension API calls and refactor them to use `Promise.all` with `Array.prototype.map()` for concurrent execution, which drastically cuts down total execution time.
## 2024-05-24 - O(N*M) Array Lookups in Loops
**Learning:** Calling `indexOf` repeatedly inside `.map()` or `for` loops for arrays like `alwaysOn` or `recentList` creates a hidden O(N*M) performance bottleneck, particularly for users with many installed extensions or profiles.
**Action:** Always refactor sequential array membership or index lookups inside iterative operations by caching the arrays into ES6 `Set` (for presence) or `Map` (for specific index) outside the loop to achieve O(N+M) time complexity.
