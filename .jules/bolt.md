## 2024-03-24 - Do not hallucinate properties on domain models
**Learning:** Be very careful to use the domain models actually defined and passed inside Knockout observables when making changes. Knockout `pureComputed` values and functions inside models might be named similarly but might not exist or might behave differently than intended when moved to a different context.
**Action:** Always manually check domain model properties explicitly using `grep` or `cat` instead of guessing what exists on objects like `ExtensionModel`.
