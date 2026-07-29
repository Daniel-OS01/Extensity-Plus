## 2024-05-24 - Deduplication Array Filter Objects

**Learning:** When using plain objects `{}` to deduplicate array values by keys (`seen[item]`), it not only incurs the overhead of callback functions inside `.filter()` but is also susceptible to prototype collision (e.g. `__proto__` or `constructor` strings) which can create bugs or silent data drops in deduplication logic.
**Action:** Always prefer ES6 `Set` with a standard `for` loop for `uniqueArray`-like operations to guarantee type distinction (1 vs '1'), prevent prototype issues, and gain significant iteration performance boosts.
## 2024-05-19 - [Knockout.js Array Performance in Loops]
**Learning:** Consolidating multiple array transformations (like `.map().filter()`) into a single `for` loop pass minimizes execution time by avoiding intermediate array allocations and allowing for early returns on direct matches (e.g., in `matchesExtension` search function).
**Action:** When working on performance-sensitive search or filtering logic, avoid chaining array methods. Use a single `for` loop, cache results conditionally, and use `return` early when possible.
## 2024-05-24 - Parallelized Chrome Alarm Clearing
**Learning:** Sequential `await` statements inside `for` loops used for Chrome API calls (like `chrome.alarms.clear`) represent a hidden I/O bottleneck in the background service worker, particularly when tearing down or rebuilding rule states.
**Action:** Always look for loops awaiting independent Chrome extension API calls and refactor them to use `Promise.all` with `Array.prototype.map()` for concurrent execution, which drastically cuts down total execution time.
## $(date +%Y-%m-%d) - Optimize O(N) Array Lookups in Extension Normalization

**Learning:** During extension normalization in `js/background.js`, multiple `Array.prototype.indexOf()` lookups nested inside an array `.map()` create a quadratic $O(N \times M)$ performance bottleneck. Converting the arrays (`alwaysOn`, `favorites`, `toolbarPins`) to `Set`s and using `Set.prototype.has()`, along with converting the `recentList` to a `Map` to retain original indices, turns these lookups into $O(1)$ operations, achieving an $O(N + M)$ overall time complexity and yielding significant execution speedups (measured at ~86%).
**Action:** Always prefer pre-computing `Set`s and `Map`s for membership and index lookup inside iteration loops to prevent redundant traversals, particularly when processing potentially large data collections like extension metadata. When replacing `indexOf()` with a `Map` to keep track of index order, ensure you emulate the `indexOf` behavior by wrapping the `Map.set()` call inside a `!Map.has()` check.
