## 2024-05-24 - Deduplication Array Filter Objects

**Learning:** When using plain objects `{}` to deduplicate array values by keys (`seen[item]`), it not only incurs the overhead of callback functions inside `.filter()` but is also susceptible to prototype collision (e.g. `__proto__` or `constructor` strings) which can create bugs or silent data drops in deduplication logic.
**Action:** Always prefer ES6 `Set` with a standard `for` loop for `uniqueArray`-like operations to guarantee type distinction (1 vs '1'), prevent prototype issues, and gain significant iteration performance boosts.
## 2024-05-19 - [Knockout.js Array Performance in Loops]
**Learning:** Consolidating multiple array transformations (like `.map().filter()`) into a single `for` loop pass minimizes execution time by avoiding intermediate array allocations and allowing for early returns on direct matches (e.g., in `matchesExtension` search function).
**Action:** When working on performance-sensitive search or filtering logic, avoid chaining array methods. Use a single `for` loop, cache results conditionally, and use `return` early when possible.
## 2024-05-24 - Parallelized Chrome Alarm Clearing
**Learning:** Sequential `await` statements inside `for` loops used for Chrome API calls (like `chrome.alarms.clear`) represent a hidden I/O bottleneck in the background service worker, particularly when tearing down or rebuilding rule states.
**Action:** Always look for loops awaiting independent Chrome extension API calls and refactor them to use `Promise.all` with `Array.prototype.map()` for concurrent execution, which drastically cuts down total execution time.
## 2024-05-24 - O(1) Cache Sets for Array Index Lookups in Mapped Iterations

**Learning:** Using `Array.prototype.indexOf()` directly inside an iteration mapping like `Array.prototype.map()` creates an O(N^2) operation complexity for large lists. Specifically, looking up string properties within normalization callbacks introduces measurable slowdowns in high-frequency background scripts.
**Action:** When normalizing arrays against other lists, avoid O(N) inline methods (e.g., `.indexOf()`, `.includes()`). Pre-compute JS `Set` and `Map` objects prior to the iteration for rapid O(1) existence and position verification. Use `Map.set()` nested inside a `!Map.has()` check when migrating from `.indexOf()` to guarantee the captured index exactly matches the first sequence discovery.
