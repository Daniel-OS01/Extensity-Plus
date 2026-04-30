# Building Extensity

## Prerequisites

- Node.js 18+
- npm

Install the project-managed build tools with:

```bash
npm install
```

## Building

To build the distributable version, just run:

```bash
make dist
```

To generate the Chrome Web Store submission bundle after the build completes, run:

```bash
npm run bundle:chrome-store
```
