const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const strictDrive = process.env.EXTENSITY_STRICT_DRIVE === "1";
const driveOauthJsonPath = process.env.EXTENSITY_DRIVE_OAUTH_JSON || "";
const PLACEHOLDER_CLIENT_ID = "REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com";

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
  "identity",
  "management",
  "notifications",
  "storage",
  "tabs",
  "webNavigation"
];

assert(Array.isArray(manifest.permissions), "Manifest permissions must be an array.");
assert(hasAllEntries(manifest.permissions, requiredPermissions), "Manifest is missing one or more required permissions.");

const requiredCommands = [
  "toggle-all-extensions",
  "cycle-next-profile",
  "cycle-previous-profile"
];

assert(manifest.commands && hasAllEntries(Object.keys(manifest.commands), requiredCommands), "Manifest commands must include toggle-all and profile cycling.");

assert(manifest.oauth2 && typeof manifest.oauth2.client_id === "string", "Manifest oauth2.client_id must be configured for Drive sync.");
if (manifest.oauth2.client_id !== PLACEHOLDER_CLIENT_ID) {
  assert(
    /^[0-9]+-[a-z0-9._-]+\.apps\.googleusercontent\.com$/i.test(manifest.oauth2.client_id),
    "Manifest oauth2.client_id must be a valid Google OAuth client ID format."
  );
}
assert(
  Array.isArray(manifest.oauth2.scopes) &&
    manifest.oauth2.scopes.includes("https://www.googleapis.com/auth/drive.appdata"),
  "Manifest oauth2.scopes must include drive.appdata."
);
assert(
  Array.isArray(manifest.host_permissions) &&
    manifest.host_permissions.some((entry) => entry.indexOf("googleapis.com") !== -1),
  "Manifest host_permissions must include https://www.googleapis.com/* for Drive API calls."
);

if (strictDrive) {
  assert(
    manifest.oauth2.client_id !== PLACEHOLDER_CLIENT_ID,
    "Strict mode: manifest oauth2.client_id still uses placeholder."
  );
}

if (driveOauthJsonPath) {
  const resolvedJsonPath = path.resolve(process.cwd(), driveOauthJsonPath);
  assert(fs.existsSync(resolvedJsonPath), `Drive OAuth JSON not found: ${resolvedJsonPath}`);
  const oauthJson = JSON.parse(fs.readFileSync(resolvedJsonPath, "utf8"));
  assert(
    !oauthJson.installed,
    "Drive OAuth JSON appears to be Desktop credentials (`installed` block). Use a Chrome extension OAuth client."
  );
  if (oauthJson.oauth2 && typeof oauthJson.oauth2.client_id === "string") {
    assert(
      oauthJson.oauth2.client_id === manifest.oauth2.client_id,
      "Drive OAuth JSON client_id does not match manifest oauth2.client_id."
    );
  }
}

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
  "js/drive-sync.js",
  "js/url-rules.js",
  "styles/index.css",
  "styles/options.css",
  "styles/dashboard.css"
].forEach(assertFileExists);

console.log("manifest_ok");
