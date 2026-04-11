## 2024-05-24 - Deduplication Array Filter Objects

**Learning:** When using plain objects `{}` to deduplicate array values by keys (`seen[item]`), it not only incurs the overhead of callback functions inside `.filter()` but is also susceptible to prototype collision (e.g. `__proto__` or `constructor` strings) which can create bugs or silent data drops in deduplication logic.
**Action:** Always prefer ES6 `Set` with a standard `for` loop for `uniqueArray`-like operations to guarantee type distinction (1 vs '1'), prevent prototype issues, and gain significant iteration performance boosts.
## 2024-05-24 - Deduplication Array Filter Objects
**Learning:** When using plain objects `{}` to deduplicate array values by keys (`seen[item]`), it not only incurs the overhead of callback functions inside `.filter()` but is also susceptible to prototype collision (e.g. `__proto__` or `constructor` strings) which can create bugs or silent data drops in deduplication logic.
**Action:** Always prefer ES6 `Set` with a standard `for` loop for `uniqueArray`-like operations to guarantee type distinction (1 vs '1'), prevent prototype issues, and gain significant iteration performance boosts.

## $(date +%Y-%m-%d) - Array map/filter elimination in Hot Paths
**Learning:** In Knockout `computed` contexts that run repeatedly (e.g., live text search executing per keystroke, per item), chaining `[...].filter(Boolean).map(...)` incurs heavy intermediate array allocations and nested callback execution. This puts measurable pressure on the garbage collector.
**Action:** Replace functional array chaining with a single array initialization and sequential `if/push` statements to coalesce iterations into a single pass and eliminate intermediate allocations on hot search paths.
