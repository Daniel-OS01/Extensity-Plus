# CI And Release

## Local Commands

### Install Dependencies

```bash
npm install
```

### Run Automated Checks

```bash
npm test
npm run check:manifest
```

### Build The Extension

```bash
make dist
```

This writes the packaged extension ZIP to `dist/dist.zip`.

### Build The Chrome Web Store Submission Bundle

```bash
npm run bundle:chrome-store
```

This creates `artifacts/chrome-web-store/` with:

- the extension ZIP renamed for release use
- a manifest snapshot
- submission metadata
- SHA-256 checksums
- release notes for the submission package

## GitHub Actions

### CI And Release Workflow

File: `.github/workflows/ci.yml`

Runs on:

- pull requests
- pushes to `main`
- pushes to tags matching `v*`
- manual dispatch with a `patch`, `minor`, or `major` version bump

Behavior:

- pull requests and normal pushes run validation only
- manual dispatch bumps `package.json`, `package-lock.json`, and `manifest.json`, commits the version change to `main`, pushes a matching `vX.Y.Z` tag, publishes a GitHub Release entry, and uploads release packages as workflow artifacts
- tag pushes can still build release assets, upload them as workflow artifacts, and publish a GitHub Release entry for externally created tags

Pre-release jobs:

- `pre-release-contracts`: tests, manifest validation, and version-match checks
- `pre-release-build-checks`: dry build/package verification before any release publishing

Validation/build steps:

- install dependencies with `npm ci`
- run unit tests
- validate the manifest contract
- build the extension with `make dist`
- build the Chrome Web Store submission bundle

Release assets:

- workflow-run artifact `release-assets-vX.Y.Z/` containing the packaged extension ZIP, the Chrome Web Store upload ZIP, and the release metadata files
- the packaged extension ZIP from `dist/dist.zip`, renamed to `<package>-extension-vX.Y.Z.zip`
- the Chrome Web Store upload ZIP from `artifacts/chrome-web-store/<package>-vX.Y.Z.zip`, renamed to `<package>-chrome-web-store-upload-vX.Y.Z.zip`
- `submission-metadata.json`
- `checksums.txt`
- `submission-notes.md`

## What The Submission Bundle Solves

The workflow does not publish directly to the Chrome Web Store. It creates the files needed for a clean upload package and release handoff.

That means:

- packaging is reproducible
- the upload ZIP is versioned and checksummed
- GitHub Actions stores the release artifact without exposing downloadable files on the public GitHub Release page
- the repo has a machine-readable record of what was packaged

## Manual Release Tasks Still Required

- download `release-assets-vX.Y.Z` from the workflow run and upload the `*-chrome-web-store-upload-vX.Y.Z.zip` file in the Chrome Web Store dashboard
- update listing copy, screenshots, privacy disclosures, and distribution settings
- review permissions and manifest changes before submission
- complete any publisher-account-specific signing or verification requirements
- update the GitHub repository "About" metadata if you want the hosted repo description to match the README wording exactly

## Recommended Manual Test Pass Before Release

Load the unpacked extension in Chrome and verify each surface:

### Popup (`index.html`)

- list/grid mode toggle works
- alpha, popular, and recent sort modes work
- search filters by name, alias, and description (with fuzzy matching for 3+ character queries)
- extension toggle enables and disables correctly
- undo reverts the last toggle or bulk action
- profile pills appear as a horizontal strip; clicking a profile applies it
- active profile pill is highlighted
- profile membership badges appear on the right of each extension row
- extensions with multiple profile memberships show multiple badges in different colors
- dark mode: header, toolbar, sort buttons, search bar, and all inputs use dark surfaces

### Options page (`options.html`)

- all checkboxes save and reload correctly
- number inputs for font size, item padding, item spacing, and popup width apply immediately in the popup after save
- preset buttons (Compact, Default, Comfortable) write the correct pixel values
- color scheme toggle (Auto/Light/Dark) applies across all pages
- dark mode: input and select fields use dark background (not white)
- export JSON and export CSV produce downloadable files
- import JSON backup restores settings and profiles

### Profiles page (`profiles.html`)

- profile list shows on the right, extension checklist on the left (landscape mode)
- adding a new profile captures the current enabled-extension set
- inline rename works; reserved profiles cannot be renamed
- bulk delete removes selected user profiles
- extension checklist sorts by A-Z, Popular, Recent, and Profiles count
- always-on and favorites reserved profiles are accessible
- save persists the profile set; quota error is shown if sync storage is exceeded

### Dashboard (`dashboard.html`)

- clicking each tab (History, Groups, URL Rules, Aliases, Import/Export) shows only that section
- history list shows records with event type badge, extension name, source, and timestamp
- adding, editing, and removing groups works; save persists changes
- adding, editing, and removing URL rules works; save persists changes
- aliases can be set per extension; save persists changes
- export JSON and import JSON round-trip correctly
- dark mode: section headings, grid cards, and history rows use dark surfaces

### Background behavior

- URL rules apply when navigating to matching URLs
- reminder alarms fire for extensions enabled beyond the configured delay
- keyboard shortcuts from `chrome://extensions/shortcuts` trigger toggle-all and profile cycling

### Build verification

- `npm test` passes the browser-module test suite
- `npm run check:manifest` reports `manifest_ok`
- `make dist` produces a valid `dist/dist.zip`
- `npm run bundle:chrome-store` produces the submission bundle under `artifacts/chrome-web-store/`
- the bundle includes a versioned upload ZIP whose root contains `manifest.json`, `images/icon16.png`, `images/icon32.png`, `images/icon48.png`, and `images/icon128.png`
