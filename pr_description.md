💡 What
Replaced sequential `indexOf()` lookups on arrays (`alwaysOn`, `favorites`, `toolbarPins`, `recentList`) inside the `items.map()` loop in `normalizeExtensions` with ES6 `Set` and `Map` instance caches initialized outside the loop.

🎯 Why
Using `indexOf()` inside `.map()` results in an $O(N \times M)$ time complexity, causing a performance bottleneck as the size of the arrays increases. By caching presence and indices in $O(1)$ lookup structures, we reduce this to an efficient $O(N + M)$ time complexity.

📊 Impact
Dramatically speeds up state building via `normalizeExtensions` by executing faster presence and index checks, reducing main thread blocking time.

🔬 Measurement
Run `pnpm test` and `pnpm run check:manifest` to ensure all functionality works as intended. Code behaves functionally identically to before but completes map operations faster.
