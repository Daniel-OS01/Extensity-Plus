# Chrome Web Store Checklist

This checklist covers the Chrome Web Store submission items that are not fully stored in the extension package itself.

## In The Extension Package

- `manifest.json` includes `name`, `version`, `description`, and `icons`.
- Required icon files exist at:
  - `images/icon16.png`
  - `images/icon32.png`
  - `images/icon48.png`
  - `images/icon128.png`
- `manifest.json` stays valid JSON with no comments.
- The upload ZIP keeps `manifest.json` at the root of the archive.

## In The Chrome Web Store Dashboard

- Detailed description
- Primary category
- Store listing language
- At least one 1280x800 screenshot
- 128x128 store icon
- 440x280 small promo tile
- Optional 1400x560 marquee promo tile
- Optional YouTube promo video
- Homepage URL
- Support URL
- Privacy disclosures
- Distribution settings
- Mature-content declaration, if applicable

## Recommended Submission Pass

- Run `npm run generate:icons`
- Run `npm run check:manifest`
- Run `npm test`
- Run `make dist`
- Run `npm run bundle:chrome-store`
- Upload the generated Chrome Web Store ZIP from the build artifacts or local bundle output
