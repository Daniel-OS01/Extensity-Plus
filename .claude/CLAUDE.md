# CLAUDE.md — Claude Code Rules
# Place this file at the root of your project, or at .claude/CLAUDE.md.
# Claude Code reads this file as context before making any edits.
# Keep rules specific and concise — vague rules are followed less consistently.
# For path-specific rules, create additional files in .claude/rules/.

---

## Claude Code-Specific Notes

- This file is loaded as context, not enforced configuration. Be specific — general statements
  are easy for Claude to rationalize away in edge cases.
- Do not rely on auto memory for important project rules. Put stable rules here.
- Use /init to generate a starter file for a new project, but review it before trusting it.
- If behavior seems inconsistent, check whether the right CLAUDE.md files are being loaded.
- For large projects with multiple components, consider .claude/rules/ subdirectory files
  to scope rules to specific paths or file types.

---

## Why These Rules Exist

AI coding assistants are powerful but predictably flawed. They may:
- Claim a fix is done before verifying it actually works
- Invent a function or API they don't actually know
- Add "helpful" changes that break something unrelated
- Add defensive fallback code that hides real problems instead of fixing them

These rules are designed to prevent exactly those failure modes.
They prioritize correctness over speed, and explicitness over convenience.

---

## 0. Before Writing Any Code

Do all of these before touching a single file:

1. Read the relevant files and any CLAUDE.md files in their directories first.
   Do not guess what is already there.
2. Search the codebase for related logic before writing new code. Use rg (ripgrep).
   If it already exists, reuse or extend it — never duplicate it.
3. For a bug fix: reproduce the problem first, or clearly describe the failing case.
   Do not attempt a fix you cannot describe.
4. For new functionality: write out what "done" looks like (acceptance criteria)
   before writing any code.
5. When uncertain about anything: inspect the codebase instead of inventing patterns.
   Never fabricate APIs, file paths, function names, or behaviors.

---

## 1. Scope Control

- Keep changes minimal in scope. Only touch files and logic the task actually requires.
- Do not minimize line count artificially. If the correct fix needs 30 lines, write 30 lines.
- Do not modify files unrelated to the current task.
- Do not revert or undo changes made in a previous session unless explicitly asked.
- If the correct fix requires touching multiple connected files, do so and explain why.
- If you notice a real problem somewhere else, report it as an observation.
  Never fix it silently without being asked.

---

## 2. Verification Before Claiming Completion

Never say a task is done unless you have verified it. Verification means at least one of:
- Running the project's test suite and seeing it pass
- Running the project's lint or type-check command and seeing it pass
- Running the code and observing the expected behavior directly
- Tracing through the changed code path explicitly and confirming it is correct

If the project defines test or lint commands, run them before finishing — always.
If the project has no automated checks, say so explicitly.
State what would need to be manually tested and what the expected result should be.
When verification is partial, say exactly what was verified and what was not.

---

## 3. Never Invent What You Have Not Verified

Before calling any library function, using any API endpoint, or referencing any file path:
- Verify it exists by reading the installed source, checking type stubs, or running a quick test.
- If you cannot verify it, say so explicitly. Do not guess.

Priority order for understanding a library:
1. Installed source (.venv, node_modules) — most authoritative, read this directly
2. Type stubs or .d.ts files
3. Official documentation
4. Training data — least reliable; treat as starting hypothesis, not confirmed fact

---

## 4. Code Style

### Language
- Comments in English only.
- Follow DRY (Don't Repeat Yourself), KISS (Keep It Simple), YAGNI (You Aren't Gonna Need It).
- Match the existing code style — naming conventions, formatting, file organization.
  Exception: if existing style conflicts with the safety, typing, or verification rules here,
  these rules take priority. Style follows the repo; architecture does not drift with it.

### Functional Preference
- Prefer functional programming over OOP.
- Use OOP classes only for connectors and interfaces to external systems
  (API clients, database adapters, service wrappers).
- Keep pure logic separate from side effects.
  Pure logic transforms data and returns a result with no external effects.
  Side effects (file I/O, database writes, API calls) belong at system boundaries.

### Functions
- Write small, single-purpose functions. One function does one thing.
- Never modify a function's input parameters. Create new values instead.

  Bad (mutates the input):
    items.append(new_item)
    return items

  Good:
    return [*items, new_item]

- Avoid boolean mode parameters that switch what a function fundamentally does.

  Bad:
    process(data, use_fast_mode=True)

  Good:
    process_fast(data)
    process_normal(data)

  If multiple modes are required, use an explicit enum or tagged union.

### Imports
- All imports at the top of the file.
- Three groups separated by a blank line: stdlib, third-party, local project.
- Sort alphabetically within each group. Never import unused symbols.
- Exception: local imports inside a function are allowed for circular dependency avoidance,
  optional dependencies, or startup cost reduction. Always add a comment explaining why.

### Dead Code and TODOs
- Never leave commented-out code. Delete it — version control keeps the history.
- Never add TODO or FIXME comments unless explicitly asked.
  Raise incomplete or broken things as observations instead.

---

## 5. Types and Data Modeling

- Use strict typing everywhere: function signatures, return types, variables, collections.
- Prefer structured data models over loose dictionaries.
  Use Pydantic, dataclasses, TypeScript interfaces, or named tuples.
- Avoid generic types: Python's Any, TypeScript's any, List[Dict[str, Any]].
  These disable type checking and hide bugs.
- In TypeScript, unknown is allowed at boundaries (API responses, user input)
  if narrowed immediately and never propagated unchecked.
- Validate all external input at the boundary. Never pass raw unvalidated data into business logic.
- For enums and discriminated unions, always handle every case explicitly.
  The else/default branch must raise an error — not silently do nothing.

  Python:
    else:
        raise NotImplementedError(f"Unhandled case: {value!r}")

  TypeScript:
    default:
        throw new Error(`Unhandled case: ${value}`)

---

## 6. Parameters and Defaults

- Make required business inputs explicit. Never hide them behind default values.
- Avoid defaults that represent a real choice the caller should make.
- Safe defaults are fine for non-critical config like timeout=30 or max_retries=3.
- Never use mutable defaults.

  Python bug:
    def add_item(item, result=[]):   # list is shared across all calls
        result.append(item)
        return result

  Correct:
    def add_item(item, result=None):
        if result is None:
            result = []
        return [*result, item]

- Optional parameters should be typed Optional[T] = None with explicit None handling inside.

---

## 7. Error Handling

- Always raise errors explicitly. Never silently ignore them.
- Use specific error types that clearly describe what went wrong.
- Preserve the original error when re-raising. Never lose the root cause.
- Fix root causes, not symptoms.

### No silent fallbacks
Do not add silent fallbacks unless the requirement explicitly calls for one.
Fallbacks hide real problems and make bugs harder to find.

  Bad:
    except Exception:
        return []

  Good:
    except SpecificError as e:
        raise RuntimeError(f"Failed to load items: {e}") from e

Forms to avoid: returning None or empty on failure, catching broad exceptions and continuing,
substituting a default value without signaling failure.

### Catch-all handlers
A broad except Exception or bare except: is only acceptable at the very top level of
your program (main(), CLI entry point, server request handler).
Even there: log the full traceback with logger.exception(...), then re-raise or exit non-zero.
Never use broad catches inside business logic.

---

## 8. External Calls: Retries and Timeouts

- Retry only on transient, preferably idempotent failures:
    network timeouts, HTTP 429, HTTP 503
- Never retry permanent errors:
    HTTP 400, 401, 403, 404 — retrying these is wasteful and potentially destructive
- Use bounded retries: 3 attempts max (configurable), exponential backoff starting at 1 second,
  timeout per attempt, structured warning log for each failed attempt.
- After all retries fail: re-raise the original exception type with attempt context in the message.

---

## 9. Logging and Observability

- Use structured logs with stable event names and structured fields.

  Bad (dynamic value in message string — hard to search and aggregate):
    logger.warning(f"Failed for user {user_id}")

  Good (stable message, dynamic values as fields):
    logger.warning("fetch_user_failed", extra={"user_id": user_id})

- Never log secrets, tokens, passwords, cookies, API keys, or unnecessary PII.
- Truncate or summarize large request/response payloads. Do not dump them raw.
- Error messages must be specific and actionable. No "something went wrong."
- Exception: f-strings are acceptable inside raise statements and Exception() constructors.

  Acceptable:
    raise ValueError(f"Expected positive integer, got {value!r}")

---

## 10. Dependencies and Tooling

- Use project-managed dependencies. Never install globally.
- Always add new dependencies to pyproject.toml or package.json and the lockfile.
- Prefer pyproject.toml for Python projects; requirements.txt only for compatibility.
- Do not add a dependency if the standard library or existing tooling is sufficient.
- When adding a dependency, commit the config file change alongside the code that uses it.

---

## 11. Terminal Commands

- Use non-interactive commands with explicit flags.
- Always use: git --no-pager diff    or: git diff | cat
- Use rg for searching code and files — fast and respects .gitignore.
- After code changes, run the project's tests, lint, and type-check commands.
  This is not optional when they are defined.

---

## 12. Documentation

- Code, types, and tests are the primary documentation.
- Docstrings document the public API contract: what the function does, its parameters,
  return type, and what errors it raises.
- Inline comments explain why — a non-obvious decision, a constraint, a business rule.
  If a comment restates what the code does, rewrite the code to be self-explanatory instead.
- Separate docs files are for: architecture, setup instructions, runbooks, and cross-cutting
  concerns that cannot be understood from a single function or module.
- Never duplicate documentation across files. Reference the authoritative location.
- Document current behavior. Version control is the changelog — do not repeat it in comments.

---

## 13. Final Review Before Finishing

Before saying a task is complete:

1. Run git --no-pager diff and read every changed line.
2. Confirm every changed file is directly related to the task.
3. Remove any accidental or unrelated edits.
4. Confirm names, types, log messages, and docs still match the implemented behavior.
5. Run the project's test, lint, and type-check commands.
6. Produce a brief summary: which files changed, what changed in each, and why.

---

## 14. How Claude Should Communicate

- Be explicit about assumptions. If you assumed something, say it.
- Report what changed, what was verified, and any remaining risks or open questions.
- Do not present unverified work as completed fact.
- If uncertain, say so and explain what verification would look like.
- If you find a problem outside the current task scope, report it clearly.
  Do not fix it silently. Do not ignore it.
