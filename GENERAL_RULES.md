# AI Coding Assistant Rules — General Version
# Use this file with any AI coding assistant that accepts a plain instruction file.
# This is your canonical source of truth. Edit this file first when changing any rule.

---

## Why These Rules Exist

AI coding assistants are powerful but predictably flawed. They may:
- Claim a fix is done before verifying it actually works
- Invent a function or API they don't actually know
- Add "helpful" changes that break something unrelated
- Add defensive fallback code that hides real problems instead of fixing them

These rules are designed to prevent exactly those failure modes.
They prioritize correctness over speed, and explicitness over convenience.
As a beginner, following them will also help you build habits that
experienced developers use — and that make code easier to debug and maintain.

---

## 0. Before Writing Any Code

Do all of these before touching a single file:

1. Read the relevant files first. Do not guess what is already there.
2. Search the codebase for related logic before writing new code. Use `rg` (ripgrep)
   or your editor search. If it already exists, reuse or extend it — never duplicate it.
3. For a bug fix: reproduce the problem first, or clearly describe the failing case.
   Do not attempt a fix you cannot describe.
4. For new functionality: write out what "done" looks like (acceptance criteria)
   before writing any code.
5. When uncertain about anything: inspect the code, read the docs, or say you are not sure.
   Never invent APIs, file paths, function names, or behaviors you have not verified.

> Why: Fixing without understanding the problem is the fastest way to make things worse.

---

## 1. Scope Control

- Keep changes minimal in scope. Only touch files and logic the task actually requires.
- Do not minimize line count artificially. If the correct fix needs 30 lines, write 30 lines.
- Do not modify files unrelated to the current task.
- Do not revert or undo changes made in a previous session unless explicitly asked.
- If the correct fix requires touching multiple connected files, do so explicitly and explain why.
- If you notice a real problem somewhere else in the code, report it as an observation.
  Never fix it silently without being asked.

> Why: Unexpected changes are hard to review, easy to miss, and often introduce new bugs.

---

## 2. Verification Before Claiming Completion

Never say a task is done unless you have verified it. Verification means at least one of:
- Running the project's test suite and seeing it pass
- Running the project's lint or type-check command and seeing it pass
- Running the code and observing the expected behavior directly
- Tracing through the changed code path explicitly and confirming it is correct

If the project has no automated tests or lint commands, say so explicitly.
State what would need to be manually tested and what the expected result should be.

When verification is only partial, say exactly what was verified and what was not.
Presenting unverified work as completed is not acceptable.

> Why: The most common and costly AI failure is confident-but-wrong completion.

---

## 3. Never Invent What You Have Not Verified

Before calling any library function, using any API endpoint, or referencing any file path:
- Verify it exists by reading the installed source, checking type stubs, or running a quick test
- If you cannot verify it, say so explicitly

Do not guess a function signature from partial memory.
Do not assume an API endpoint exists because a similar one does.
Do not assume a file exists because a similar one does.

Priority order for understanding how a library works:
1. Installed source code in the project (node_modules, .venv, etc.) — most authoritative
2. Type stubs or .d.ts files
3. Official documentation
4. Training data — least reliable; treat as a starting hypothesis, not a conclusion

> Why: Hallucinated APIs and signatures are one of the hardest bugs to catch because
> the code looks plausible and the error only appears at runtime.

---

## 4. Code Style

### Language
- Comments in English only.
- Follow DRY (Don't Repeat Yourself), KISS (Keep It Simple), and YAGNI (You Aren't Gonna Need It).
- Match the repository's naming conventions, formatting, and file organization.
  Exception: if the existing style conflicts with the safety, typing, or verification rules
  in this document, these rules take priority. Style matches the repo; architecture does not drift.

### Functions
- Write small, single-purpose functions. One function does one thing.
- Avoid boolean "mode" parameters that change what a function fundamentally does.

  Bad:
    process(data, use_fast_mode=True)

  Good:
    process_fast(data)
    process_normal(data)

  If multiple modes are genuinely needed, use an explicit enum or tagged union, not a boolean.

- Avoid functions with more than 3-4 positional arguments. Group them into a typed object instead.

### Separate Logic From Side Effects
- Pure logic: transforms data, returns a result, has no external effect. Put as much as possible here.
- Side effects: reading files, writing to a database, calling an API. Keep these at the edges.
- This makes your logic easy to test and your side effects easy to audit.

### Immutability — Never Modify Inputs
- Never modify a function's input parameters. If you need a changed version, create a new value.

  Bad (mutates the input list):
    items.append(new_item)
    return items

  Good:
    return [*items, new_item]

- Prefer building new values (list comprehensions, map, filter) over mutating existing ones.
- When a mutable accumulator is truly necessary, confine it to the narrowest possible scope.

> Why: Functions that change their inputs are unpredictable, hard to test, and cause
> subtle bugs that are very hard to track down.

### Imports
- All imports go at the top of the file.
- Organize in three groups separated by a blank line:
  Group 1: standard library
  Group 2: third-party packages
  Group 3: your own project files
- Sort alphabetically within each group.
- Never import something you do not use.
- Exception: a local import (inside a function body) is allowed when needed to break
  a circular dependency, load an optional dependency, or reduce startup time.
  Add a short comment explaining why when making an exception.

### Dead Code and TODOs
- Never leave commented-out code. Delete it — version control keeps the history.
- Never add TODO or FIXME comments unless explicitly asked to.
  If something is broken or incomplete, raise it as a clear observation instead of annotating and moving on.

---

## 5. Types and Data Modeling

- Use strict typing for all public function signatures, return types, and shared data structures.
- Prefer named types over loose dictionaries for anything non-trivial.

  Bad:
    {"name": "Alice", "age": 30}  passed around as a plain dict

  Good:
    A User dataclass, Pydantic model, TypeScript interface, or named tuple

- Avoid unchecked dynamic types: Python's Any, TypeScript's any.
  They disable type checking and hide bugs.

- In TypeScript, unknown is allowed at system boundaries (API responses, user input)
  but must be narrowed (type-checked) immediately and never passed through the system unchecked.

- Validate all external input at the boundary — the moment data enters your system.
  Never pass raw, unvalidated external data deep into your business logic.

- For enums and discriminated unions: always handle every case explicitly.
  The else/default branch of a match on an enum must raise an error, not silently do nothing.

  Bad:
    else: pass
    default: return null

  Good (Python):
    else:
        raise NotImplementedError(f"Unhandled case: {value!r}")

  Good (TypeScript):
    default:
        throw new Error(`Unhandled case: ${value}`)

> Why: When you add a new enum variant later, the error will tell you exactly which
> match statements need updating — instead of silently producing wrong behavior.

---

## 6. Parameters and Defaults

- Make required business inputs explicit. Do not hide them behind default values.
- Avoid default parameter values when they represent a real choice the caller should make.
- Safe defaults are fine for non-critical configuration like timeout=30 or max_retries=3,
  where the value is obvious and well-documented at the call site.
- Never use mutable defaults.

  Python bug — the list is shared across all calls:
    def add_item(item, result=[]):
        result.append(item)
        return result

  Correct:
    def add_item(item, result=None):
        if result is None:
            result = []
        return [*result, item]

---

## 7. Error Handling

### Core rules
- Always raise errors explicitly. Never silently ignore them.
- Use specific error types that clearly describe what went wrong, not a generic Exception or Error.
- Preserve the original error when wrapping or re-raising. Never lose the root cause.
- Fix root causes, not symptoms.

### No silent fallbacks
Do not add silent fallbacks unless the requirement explicitly calls for one.
Fallbacks hide real problems and make bugs harder to find.

  Bad — caller has no idea something failed:
    except Exception:
        return []

  Good — let it propagate, or re-raise with more context:
    except SpecificError as e:
        raise RuntimeError(f"Failed to load items: {e}") from e

Forms of silent fallback to avoid:
- Returning an empty list or None on failure
- Substituting a default value without signaling the failure
- Catching a broad exception and continuing as if nothing happened
- Any try/except block that swallows an error silently

Transport-level resilience (retries, timeouts) is different from business-logic fallbacks
and is handled in Section 8.

### Catch-all exception handlers
A broad except Exception or bare except: is only acceptable at the very top level of your
program — a main() function, a CLI entry point, or a server request handler.
Even there, it must:
  1. Log the full traceback using logger.exception(...)
  2. Re-raise the exception, or exit with a non-zero exit code

Never use broad catches inside business logic to silence errors.

---

## 8. External Calls: Retries and Timeouts

- Retries are only for transient, preferably idempotent failures:
    network timeouts, HTTP 429 (rate limited), HTTP 503 (unavailable)
- Never retry on permanent errors:
    HTTP 400 (bad request), HTTP 401 (unauthorized), HTTP 403 (forbidden), HTTP 404 (not found)
    These will keep failing — retrying wastes time and can cause damage.
- Use bounded retries with: explicit attempt count, backoff delay between attempts,
  a timeout on each attempt, and a structured log warning for each failed attempt.
- Sensible defaults: 3 attempts maximum, exponential backoff starting at 1 second.
  Make these configurable, not hardcoded.
- After all retries fail: re-raise the original exception type (not a wrapper),
  with attempt context added to the message.
- Log each failed attempt as a structured warning including:
    attempt number, error type, status code, wait time before next attempt.

---

## 9. Logging and Observability

- Use structured logs with stable event names and structured fields.

  Bad — dynamic value interpolated into the message string:
    logger.warning(f"Failed to fetch user {user_id} after {attempts} attempts")

  Good — message is stable, values are fields:
    logger.warning("fetch_user_failed", extra={"user_id": user_id, "attempts": attempts})

- Include enough context to debug: request parameters, response status code,
  relevant IDs, timing information.
- Never log secrets, tokens, passwords, cookies, API keys, or unnecessary PII.
- Summarize or truncate large request/response payloads instead of dumping them raw.
  A 10-line summary is more useful than a 500-line dump that hides the signal.
- Error messages must be specific and actionable — not "something went wrong."
- Exception: f-strings are acceptable inside raise statements and Exception() constructors
  where interpolation aids readability.

  Acceptable:
    raise ValueError(f"Expected positive integer, got {value!r}")

  Not acceptable in a log call:
    logger.error(f"Failed for user {user_id}")  # message is no longer stable/searchable

---

## 10. Dependencies and Tooling

- Use project-managed dependencies. Never install globally.
- Add every new dependency to the project's config file and lockfile:
    Python: pyproject.toml (preferred) or requirements.txt
    Node/TypeScript: package.json
  Never install as a one-off without updating the project file.
- Do not add a new dependency if the standard library or existing project tooling is sufficient.
- When adding a dependency, update the config file and commit it alongside the code that uses it.

---

## 11. Terminal Commands

- Use non-interactive commands with explicit flags. Avoid commands that prompt for input.
- Always use a non-interactive git diff:
    git --no-pager diff
    or: git diff | cat
- Use rg (ripgrep) for searching code and files — it is fast and respects .gitignore.
- Run commands that the project already defines after making code changes:
    tests, lint, type-check, build, validation

---

## 12. Documentation

- Code, types, and tests are the primary documentation. Prioritize clear naming and explicit types.
- Docstrings document the public API contract: what a function does, its parameters,
  return type, and what errors it raises.
- Inline comments explain why — a non-obvious decision, a constraint, a business rule
  that is not apparent from the code alone.
  If a comment restates what the code does, rewrite the code to be self-explanatory instead.
- Use separate documentation files for: architecture overviews, setup instructions,
  operational runbooks, and cross-cutting concerns that cannot be understood from a single file.
- Never duplicate documentation across files. Reference the authoritative location instead.
- Document current behavior, not a running changelog of edits.
  Version control is the changelog — do not duplicate it in comments or docstrings.

---

## 13. Final Review Before Finishing

Before saying a task is complete:

1. Run git --no-pager diff and read every changed line.
2. Confirm every changed file is directly related to the task.
3. Remove any accidental, unrelated, or exploratory edits.
4. Confirm that names, types, log messages, and documentation still match the implemented behavior.
5. Run the project's test, lint, and type-check commands if they exist.
6. Produce a brief summary: which files changed, what changed in each, and why.

---

## 14. How the Assistant Should Communicate

- Be explicit about assumptions. If you assumed something, say it.
- Report what changed, what was verified, and any remaining risks or open questions.
- Do not present unverified work as a completed fact.
- If you are not sure about something, say so and explain what you would need to verify it.
- If you find a problem outside the current task scope, report it clearly —
  do not silently fix it and do not ignore it.
