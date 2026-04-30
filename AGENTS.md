# Repository Guidelines

## Project Structure & Module Organization
This repository is a Chrome Manifest V3 extension with top-level HTML entrypoints: `index.html` (popup), `options.html`, `profiles.html`, and `dashboard.html`. Core logic lives in `js/`, with `js/background.js` as the service-worker owner of extension state and feature modules such as `storage.js`, `url-rules.js`, and `import-export.js`. Styles live in `styles/`, static assets in `images/`, `graphics/`, and `fonts/`, and release/helper scripts in `scripts/`. Tests live in `tests/`, with helpers in `tests/helpers/` and HTML fixtures in `tests/fixtures/`.

## Build, Test, and Development Commands
Install project-managed tooling with `npm install`.

- `npm test`: runs the Node test suite in `tests/**/*.test.js`.
- `npm run check:manifest`: validates `manifest.json`.
- `npm run build`: calls `make dist` to copy, minify, and package the extension.
- `make dist`: creates `dist/` and packages `dist/dist.zip`.
- `npm run bundle:chrome-store`: builds the Chrome Web Store submission bundle in `artifacts/chrome-web-store/`.

## Coding Style & Naming Conventions
Follow the existing plain JavaScript style: 2-space indentation, semicolons, `var` declarations, function-based structure, and IIFE-style modules where already used. Keep imports and `importScripts(...)` at the top of the file. Match current file naming patterns: lowercase kebab-case for assets and scripts (`history-logger.js`), concise descriptive function names, and no silent fallbacks. Keep comments short, in English, and limited to non-obvious reasoning.

## Testing Guidelines
Tests use the built-in Node runner (`node --test`) with `node:assert/strict`. Add new unit tests in `tests/` with a `.test.js` suffix, and prefer focused browser-module tests using the existing stubs in `tests/helpers/load-browser-script.js`. There is no enforced coverage threshold in the repo today, so each change should include tests for pure logic and manual verification notes for popup, dashboard, profile, or service-worker behavior.

## Commit & Pull Request Guidelines
Recent history favors short, imperative commit subjects such as `Fix URL-rule close behavior...` and tagged version commits like `2.0.2`. Keep commit titles specific and scoped to one change. Pull requests should include a concise summary, linked issue or task when applicable, manual test notes, and screenshots or short recordings for UI changes affecting `index.html`, `dashboard.html`, `options.html`, or `profiles.html`.

## Security & Configuration Tips
Treat `manifest.json` permissions and any future OAuth or sync settings as sensitive surface area. Validate manifest changes before opening a PR, avoid committing secrets or store credentials, and document any permission changes in the PR description.
