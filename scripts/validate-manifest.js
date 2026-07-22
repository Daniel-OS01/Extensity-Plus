const fs = require("node:fs");
const path = require("node:path");

const oauthClientId = require("./google-oauth-client-id");

const repoRoot = path.resolve(__dirname, "..");
const defaultManifestPath = path.join(repoRoot, "manifest.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseArgs(argv) {
  const result = {
    manifestPath: defaultManifestPath,
    requireDriveClient: process.env.EXTENSITY_STRICT_DRIVE === "1",
    requireWebClient: process.env.EXTENSITY_STRICT_DRIVE_WEB === "1",
    webConfigPath: ""
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest-path") {
      result.manifestPath = path.resolve(process.cwd(), String(argv[i + 1] || ""));
      i += 1;
      continue;
    }
    if (arg === "--web-config-path") {
      result.webConfigPath = path.resolve(process.cwd(), String(argv[i + 1] || ""));
      i += 1;
      continue;
    }
    if (arg === "--require-drive-client") {
      result.requireDriveClient = true;
      continue;
    }
    if (arg === "--require-web-client") {
      result.requireWebClient = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage:",
        "  node scripts/validate-manifest.js [--manifest-path <path>] [--web-config-path <path>]",
        "      [--require-drive-client] [--require-web-client]",
        "",
        "Strict modes are independent: Chrome validation does not require the optional Brave Web client."
      ].join("\n"));
      process.exit(0);
    }
    throw new Error("Unknown argument: " + arg);
  }
  if (!result.webConfigPath) {
    result.webConfigPath = path.join(path.dirname(result.manifestPath), "js", "drive-oauth-config.js");
  }
  return result;
}

function hasAllEntries(actual, expected) {
  return expected.every(function(entry) {
    return actual.includes(entry);
  });
}

function readDriveWebClientId(configPath) {
  assert(fs.existsSync(configPath), "Missing Drive Web OAuth config: " + configPath);
  const source = fs.readFileSync(configPath, "utf8");
  const match = source.match(/driveWebClientId:\s*"([^"]*)"/);
  assert(match, "Drive Web OAuth config must define driveWebClientId.");
  return match[1].trim();
}

function validateOptionalClientId(clientId, label, required) {
  const isPlaceholder = oauthClientId.isPlaceholderClientId(clientId);
  if (required) {
    assert(!isPlaceholder, label + " still uses a placeholder.");
  }
  if (!isPlaceholder) {
    oauthClientId.validateGoogleClientId(clientId, label);
  }
}

function validateManifest(options) {
  const manifestPath = options.manifestPath;
  const manifestRoot = path.dirname(manifestPath);
  assert(fs.existsSync(manifestPath), "Manifest not found: " + manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(!oauthClientId.containsClientSecret(manifest), "Manifest must not contain client_secret at any depth.");

  function assertFileExists(relativePath) {
    const absolutePath = path.join(manifestRoot, relativePath);
    assert(fs.existsSync(absolutePath), "Missing required file: " + relativePath);
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
  ].forEach(function(entry) {
    assert(manifest.icons[entry[0]] === entry[1], "Manifest icon " + entry[0] + " must be " + entry[1] + ".");
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
  validateOptionalClientId(
    manifest.oauth2.client_id,
    "Manifest oauth2.client_id",
    options.requireDriveClient
  );
  assert(
    Array.isArray(manifest.oauth2.scopes)
      && manifest.oauth2.scopes.includes("https://www.googleapis.com/auth/drive.appdata"),
    "Manifest oauth2.scopes must include drive.appdata."
  );
  assert(
    Array.isArray(manifest.host_permissions)
      && manifest.host_permissions.some(function(entry) {
        return entry.indexOf("googleapis.com") !== -1;
      }),
    "Manifest host_permissions must include https://www.googleapis.com/* for Drive API calls."
  );

  const driveWebClientId = readDriveWebClientId(options.webConfigPath);
  validateOptionalClientId(
    driveWebClientId,
    "Drive Web OAuth client ID",
    options.requireWebClient
  );

  const driveOauthJsonPath = process.env.EXTENSITY_DRIVE_OAUTH_JSON || "";
  if (driveOauthJsonPath) {
    const jsonClientId = oauthClientId.readSecretFreeClientIdJson(driveOauthJsonPath);
    assert(
      jsonClientId === manifest.oauth2.client_id,
      "Drive OAuth JSON client_id does not match packaged manifest oauth2.client_id."
    );
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
    "js/drive-oauth-config.js",
    "js/drive-sync.js",
    "js/url-rules.js",
    "styles/index.css",
    "styles/options.css",
    "styles/dashboard.css"
  ].forEach(assertFileExists);

  return {
    driveClientId: manifest.oauth2.client_id,
    driveWebClientId: driveWebClientId,
    manifest: manifest
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  validateManifest(options);
  console.log("manifest_ok");
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs: parseArgs,
  readDriveWebClientId: readDriveWebClientId,
  validateManifest: validateManifest,
  validateOptionalClientId: validateOptionalClientId
};
