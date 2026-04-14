## 2024-05-24 - Secure Random IDs
**Vulnerability:** Weak random ID generation using `Math.random()`.
**Learning:** `Math.random()` is predictable and not suitable for security-sensitive unique identifiers, such as IDs for entities.
**Prevention:** Use `crypto.getRandomValues()` for cryptographically secure random number generation when creating identifiers or tokens.
