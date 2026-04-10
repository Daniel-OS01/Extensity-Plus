## 2024-05-24 - Deduplication Array Filter Objects

**Learning:** When using plain objects `{}` to deduplicate array values by keys (`seen[item]`), it not only incurs the overhead of callback functions inside `.filter()` but is also susceptible to prototype collision (e.g. `__proto__` or `constructor` strings) which can create bugs or silent data drops in deduplication logic.
**Action:** Always prefer ES6 `Set` with a standard `for` loop for `uniqueArray`-like operations to guarantee type distinction (1 vs '1'), prevent prototype issues, and gain significant iteration performance boosts.
## 2024-05-24 - Observable Caching & Single-Pass Transformations

**Learning:** Invoking Knockout.js observables (like `self.profiles.items()`) repeatedly inside loops (e.g. `self.ext.extensions().forEach`) causes significant overhead by re-evaluating the observable unnecessarily. Combined with `.filter(...).map(...)` chains, it introduces multiple intermediate array allocations that degrade performance for long lists.
**Action:** When working with observables in loop-heavy logic, always cache the current value (e.g. `var cachedProfiles = self.profiles.items();`) prior to iterating. Replace `.filter().map()` chains with a single `for` loop pass to minimize allocations and execution time.
