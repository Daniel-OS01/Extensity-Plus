## 2026-04-01 - Object keys deduplication risk with __proto__
**Learning:** Using POJOs (`var seen = {}`) for array deduplication without `Object.create(null)` can result in missing `"__proto__"` values (as the key check matches the inherited property), causing a silent prototype bug in extension-ids arrays.
**Action:** Always favor ES6 `Set` paired with a simple `for`-loop iteration over `.filter` with POJOs for both correctness (prototype safety) and a 2x performance increase on large lists.
