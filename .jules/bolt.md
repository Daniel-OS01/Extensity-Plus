## 2026-04-03 - [uniqueArray Array Deduplication using ES6 Set]
**Learning:** [Using an object (`{}`) with `.filter()` for array deduplication risks prototype key collisions (e.g., if a string like `"__proto__"` is passed) and is slower than utilizing a standard `for` loop with an ES6 `Set`.]
**Action:** [Next time an array of simple primitives (like extension IDs or strings) needs to be deduplicated, prioritize using a `Set` combined with a `for` loop to eliminate prototype vulnerability and achieve better runtime performance without significant cost to code readability.]
