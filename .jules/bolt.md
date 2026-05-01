## 2024-05-24 - Deduplication Array Filter Objects

**Learning:** When using plain objects `{}` to deduplicate array values by keys (`seen[item]`), it not only incurs the overhead of callback functions inside `.filter()` but is also susceptible to prototype collision (e.g. `__proto__` or `constructor` strings) which can create bugs or silent data drops in deduplication logic.
**Action:** Always prefer ES6 `Set` with a standard `for` loop for `uniqueArray`-like operations to guarantee type distinction (1 vs '1'), prevent prototype issues, and gain significant iteration performance boosts.
## 2024-05-19 - [Knockout.js Array Performance in Loops]
**Learning:** Consolidating multiple array transformations (like `.map().filter()`) into a single `for` loop pass minimizes execution time by avoiding intermediate array allocations and allowing for early returns on direct matches (e.g., in `matchesExtension` search function).
**Action:** When working on performance-sensitive search or filtering logic, avoid chaining array methods. Use a single `for` loop, cache results conditionally, and use `return` early when possible.
## 2024-05-24 - Parallelized Chrome Alarm Clearing
**Learning:** Sequential `await` statements inside `for` loops used for Chrome API calls (like `chrome.alarms.clear`) represent a hidden I/O bottleneck in the background service worker, particularly when tearing down or rebuilding rule states.
**Action:** Always look for loops awaiting independent Chrome extension API calls and refactor them to use `Promise.all` with `Array.prototype.map()` for concurrent execution, which drastically cuts down total execution time.
## 2024-05-18 - Replacing `indexOf` loop lookups with `Set` and `Map` cache inside `normalizeExtensions`
**Learning:** Found an $O(N \times M)$ performance bottleneck within `js/background.js` `normalizeExtensions` loop, where repeated array `.indexOf` checks on `alwaysOn`, `favorites`, `toolbarPins`, and `recentList` arrays were performed on each iterated `item` object. The complexity grew quadratically with the number of extensions and the size of these arrays.
**Action:** Applied performance optimization pattern to replace sequential `.indexOf` inside a loop with a `Set` (for presence checks) and a `Map` (for index caching) constructed outside the loop. This change reduces the time complexity from $O(N \times M)$ to $O(N + M)$ and saves execution time when formatting the extensions list. Next time, always search for repeated array lookups in loop iterations, as converting to hash-based checks offers high impact for low complexity.
