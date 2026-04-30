const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasAllEntries(actual, expected) {
  return expected.every((entry) => actual.includes(entry));
}

function assertFileExists(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  assert(fs.existsSync(absolutePath), `Missing required file: ${relativePath}`);
}

assert(manifest.manifest_version === 3, "Manifest must stay on MV3.");
assert(typeof manifest.name === "string" && manifest.name.trim().length > 0, "Manifest name must be set.");
assert(typeof manifest.version === "string" && manifest.version.length > 0, "Manifest version must be set.");
assert(typeof manifest.description === "string" && manifest.description.trim().length > 0, "Manifest description must be set.");
assert(manifest.description.length <= 132, "Manifest description must be 132 characters or fewer.");
assert(manifest.background && manifest.background.service_worker === "js/background.js", "Background service worker must be js/background.js.");
assert(manifest.options_ui && manifest.options_ui.page === "options.html", "options_ui.page must be options.html.");
assert(manifest.options_ui && manifest.options_ui.open_in_tab === true, "options_ui.open_in_tab must be true.");
assert(manifest.icons && typeof manifest.icons === "object", "Manifest icons must be configured.");

[
  ["16", "images/icon16.png"],
  ["32", "images/icon32.png"],
  ["48", "images/icon48.png"],
  ["128", "images/icon128.png"]
].forEach(([size, relativePath]) => {
  assert(manifest.icons[size] === relativePath, `Manifest icon ${size} must be ${relativePath}.`);
});

const requiredPermissions = [
  "alarms",
  "contextMenus",
  "management",
  "notifications",
  "storage",
  "tabs",
  "webNavigation"
];

assert(Array.isArray(manifest.permissions), "Manifest permissions must be an array.");
assert(hasAllEntries(manifest.permissions, requiredPermissions), "Manifest is missing one or more required permissions.");

assert(Array.isArray(manifest.optional_permissions), "Manifest optional_permissions must be an array.");
assert(manifest.optional_permissions.includes("identity"), "Manifest must keep identity as an optional permission.");

const requiredCommands = [
  "toggle-all-extensions",
  "cycle-next-profile",
  "cycle-previous-profile"
];

assert(manifest.commands && hasAllEntries(Object.keys(manifest.commands), requiredCommands), "Manifest commands must include toggle-all and profile cycling.");

[
  "images/icon16.png",
  "images/icon32.png",
  "images/icon48.png",
  "images/icon128.png",
  "index.html",
  "options.html",
  "profiles.html",
  "dashboard.html",
  "js/background.js",
  "js/storage.js",
  "js/import-export.js",
  "js/url-rules.js",
  "styles/index.css",
  "styles/options.css",
  "styles/dashboard.css"
].forEach(assertFileExists);

console.log("manifest_ok");
