## 2024-10-24 - [Medium] Weak random number generation
**Vulnerability:** Weak random number generation was found in `makeId` used to create IDs.
**Learning:** `Math.random()` was used which is not cryptographically secure and can lead to predictable IDs.
**Prevention:** Always use `crypto.getRandomValues()` for generating random identifiers, especially when used for secure purposes like unique IDs.
