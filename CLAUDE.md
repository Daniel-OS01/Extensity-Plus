# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install               # install dev dependencies (uglify-js, sass)
npm test                  # run unit tests (Node.js built-in test runner)
npm run check:manifest    # validate manifest.json structure
make dist                 # build: copy, minify, zip → dist/dist.zip
npm run bundle:chrome-store  # generate Chrome Web Store submission bundle → artifacts/chrome-web-store/
```

There is no lint or type-check command. Tests live in `tests/browser-modules.test.js` and use Node's built-in `--test` runner (no external test framework).

To run only one test file:
```bash
node --test tests/browser-modules.test.js
```

## Architecture

This is a Chrome Manifest V3 extension. The production source lives entirely in root-level files — no frontend build step.

### Service Worker Ownership

`js/background.js` is the single owner of all extension enable/disable mutations. UI pages never call `chrome.management` directly — they send messages to the background and receive state back. This single-mutation-path design ensures undo history, usage counters, reminder scheduling, and event history are always updated together.

### Message API

Background handles these message types (defined in `docs/extensity-2.0-plan.md`):
`GET_STATE`, `SET_EXTENSION_STATE`, `TOGGLE_ALL`, `APPLY_PROFILE`, `UNDO_LAST`, `SAVE_ALIAS`, `SAVE_GROUPS`, `SAVE_URL_RULES`, `IMPORT_BACKUP`, `EXPORT_BACKUP`, `SYNC_DRIVE`, `OPEN_DASHBOARD`

Each mutating message carries an operation context object with `source` (`manual` | `bulk` | `profile` | `rule` | `undo` | `import`) — this attribution is required for correct history logging and usage metric tracking.

### Storage Split

- `chrome.storage.sync` — lightweight settings and profile state (quota-sensitive; large collections must not go here)
- `chrome.storage.local` — aliases, groups, URL rules, undo stack, event history, usage counters

`js/storage.js` owns the schema defaults for both stores and exposes `load`, `save`, and `clone` helpers used throughout. `js/migration.js` handles additive version migrations.

### Module Pattern

All `js/` files use an IIFE pattern: `(function(root) { ... })(self)`. They expose a single namespace object on `root` (e.g. `root.ExtensityStorage`, `root.ExtensityHistory`). `background.js` imports all modules via `importScripts()` at the top and accesses them through their namespace.

### UI Surfaces

Each HTML page loads its own Knockout.js ViewModel:

| Page | Entry point | Role |
|------|-------------|------|
| `index.html` | `js/index.js` | Popup: toggle, sort, filter, undo, apply profile |
| `profiles.html` | `js/profiles.js` | Profile editor: rename, bulk delete, layout |
| `options.html` | `js/options.js` | Settings and backup controls |
| `dashboard.html` | `js/dashboard.js` | Aliases, groups, URL rules, history, import/export |

### Supporting Modules

| File | Responsibility |
|------|---------------|
| `js/engine.js` | Knockout.js extenders and shared UI utilities (loaded by all pages) |
| `js/url-rules.js` | URL pattern matching and rule evaluation |
| `js/history-logger.js` | Append-only event history |
| `js/reminders.js` | `chrome.alarms`-based reminder scheduling |
| `js/import-export.js` | Versioned JSON backup envelope (export and import) |
| `js/drive-sync.js` | Google Drive sync stub — OAuth not yet configured |

### Build

`Makefile` copies root source files and `js/`, `styles/`, `images/`, `fonts/` into `dist/`, minifies JS (uglify-js) and CSS (sass), then zips the result. `python3 -m zipfile` is required at build time.

### Key Constraints

- `chrome.commands` is static — profile shortcuts cannot be dynamically created per user.
- Google Drive sync (`js/drive-sync.js`) is incomplete; OAuth manifest config is missing. Do not treat it as available.
- `chrome.storage.sync` quota is tight — never move large or unbounded collections there.
- KSB (knockout-secure-binding) does **not** support the ternary operator `? :` in `data-sbind` expressions. Use ViewModel computeds instead.

---

## Claude Code Rules

### Why These Rules Exist

AI coding assistants are powerful but predictably flawed. They may:
- Claim a fix is done before verifying it actually works
- Invent a function or API they don't actually know
- Add "helpful" changes that break something unrelated
- Add defensive fallback code that hides real problems instead of fixing them

These rules prioritize correctness over speed, and explicitness over convenience.

---

### 0. Before Writing Any Code

1. Read the relevant files and any CLAUDE.md files in their directories first. Do not guess what is already there.
2. Search the codebase for related logic before writing new code. Use rg (ripgrep). If it already exists, reuse or extend it — never duplicate it.
3. For a bug fix: reproduce the problem first, or clearly describe the failing case. Do not attempt a fix you cannot describe.
4. For new functionality: write out what "done" looks like (acceptance criteria) before writing any code.
5. When uncertain about anything: inspect the codebase instead of inventing patterns. Never fabricate APIs, file paths, function names, or behaviors.

---

### 1. Scope Control

- Keep changes minimal in scope. Only touch files and logic the task actually requires.
- Do not minimize line count artificially. If the correct fix needs 30 lines, write 30 lines.
- Do not modify files unrelated to the current task.
- Do not revert or undo changes made in a previous session unless explicitly asked.
- If the correct fix requires touching multiple connected files, do so and explain why.
- If you notice a real problem somewhere else, report it as an observation. Never fix it silently without being asked.

---

### 2. Verification Before Claiming Completion

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

### 3. Never Invent What You Have Not Verified

Before calling any library function, using any API endpoint, or referencing any file path:
- Verify it exists by reading the installed source, checking type stubs, or running a quick test.
- If you cannot verify it, say so explicitly. Do not guess.

Priority order for understanding a library:
1. Installed source (node_modules) — most authoritative, read this directly
2. Type stubs or .d.ts files
3. Official documentation
4. Training data — least reliable; treat as starting hypothesis, not confirmed fact

---

### 4. Code Style

- Comments in English only.
- Follow DRY, KISS, YAGNI. Match the existing code style.
- Prefer functional programming over OOP. Use OOP classes only for connectors and interfaces to external systems.
- Keep pure logic separate from side effects.
- Write small, single-purpose functions. Never modify a function's input parameters.
- Avoid boolean mode parameters that switch what a function fundamentally does.
- All imports at the top of the file. Never leave commented-out code. Never add TODO or FIXME comments unless explicitly asked.

---

### 5. Types and Data Modeling

- Use strict typing everywhere.
- Prefer structured data models over loose dictionaries.
- For enums and discriminated unions, always handle every case explicitly. The `default` branch must throw an error — not silently do nothing.

---

### 6. Error Handling

- Always raise errors explicitly. Never silently ignore them.
- Use specific error types. Preserve the original error when re-raising.
- Do not add silent fallbacks unless the requirement explicitly calls for one.
- A broad catch is only acceptable at the very top level of your program. Even there: log the full traceback, then re-raise or exit non-zero.

---

### 7. Terminal Commands

- Use non-interactive commands with explicit flags.
- Always use: `git --no-pager diff` or `git diff | cat`
- Use rg for searching code and files — fast and respects .gitignore.
- After code changes, run the project's tests and manifest validation commands.

---

### 8. Final Review Before Finishing

1. Run `git --no-pager diff` and read every changed line.
2. Confirm every changed file is directly related to the task.
3. Remove any accidental or unrelated edits.
4. Confirm names, types, log messages, and docs still match the implemented behavior.
5. Run `npm test` and `npm run check:manifest`.
6. Produce a brief summary: which files changed, what changed in each, and why.

---

### 9. How Claude Should Communicate

- Be explicit about assumptions. If you assumed something, say it.
- Report what changed, what was verified, and any remaining risks or open questions.
- Do not present unverified work as completed fact.
- If uncertain, say so and explain what verification would look like.
- If you find a problem outside the current task scope, report it clearly. Do not fix it silently.
