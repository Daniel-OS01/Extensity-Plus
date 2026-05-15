const fs = require("node:fs");
const path = require("node:path");

const PLACEHOLDER_CLIENT_ID = "REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com";
const repoRoot = path.resolve(__dirname, "..");
const LOCAL_EXTENSION_IDS_PATH = path.join(repoRoot, "config", "drive-extension-ids.local");
const EXPECTED_EXTENSION_IDS = [
  "kjpdgpbbmmnickeingbbhkldeeeklnhj",
  "gbojjphhdboeaafjdilfibonoflhgcde"
];
const localClientIdPath = path.join(repoRoot, "config", "drive-oauth-client-id.local");
const defaultManifestPath = path.join(repoRoot, "manifest.json");

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const result = {
    clientId: "",
    fromJson: "",
    fromLocal: false,
    manifestPath: defaultManifestPath,
    validateIds: false,
    reset: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--client-id") {
      result.clientId = String(argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (arg === "--from-json") {
      result.fromJson = String(argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (arg === "--reset") {
      result.reset = true;
      continue;
    }
    if (arg === "--from-local") {
      result.fromLocal = true;
      continue;
    }
    if (arg === "--manifest-path") {
      result.manifestPath = path.resolve(process.cwd(), String(argv[i + 1] || ""));
      i += 1;
      continue;
    }
    if (arg === "--validate-ids") {
      result.validateIds = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage:",
          "  npm run drive:set-client-id -- --client-id <google-client-id>",
          "  npm run drive:set-client-id -- --from-json <path-to-oauth-json>",
          "  npm run drive:apply-local",
          "  npm run drive:set-client-id -- --manifest-path <path> --from-local",
          "  npm run drive:set-client-id -- --validate-ids",
          "  npm run drive:set-client-id -- --reset",
          "",
          "Environment:",
          "  EXTENSITY_DRIVE_CLIENT_ID=<id> npm run drive:set-client-id",
          "",
          "Notes:",
          "- Drive sync requires a Chrome extension OAuth client ID.",
          "- Desktop OAuth JSON exports include client_secret and must not be used here.",
          "- Chrome extension OAuth JSON exports can be accepted when client_secret is absent.",
          "- Local file (gitignored): config/drive-oauth-client-id.local",
          "- Registered extension IDs file (gitignored): config/drive-extension-ids.local",
          "- This script only updates manifest oauth2.client_id unless --validate-ids is used."
        ].join("\n")
      );
      process.exit(0);
    }
    fail("Unknown argument: " + arg);
  }
  return result;
}

function readFirstMeaningfulLine(filePath, missingMessage) {
  if (!fs.existsSync(filePath)) {
    fail(missingMessage);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const line = raw
    .split(/\r?\n/)
    .map(function(entry) {
      return entry.trim();
    })
    .find(function(entry) {
      return entry.length > 0 && entry.charAt(0) !== "#";
    });

  if (!line) {
    fail("File is empty: " + filePath);
  }

  return line;
}

function extractGoogleClientId(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return "";
  }

  if (parsed.oauth2 && typeof parsed.oauth2.client_id === "string") {
    return parsed.oauth2.client_id.trim();
  }

  if (parsed.installed && typeof parsed.installed.client_id === "string") {
    return parsed.installed.client_id.trim();
  }

  if (parsed.web && typeof parsed.web.client_id === "string") {
    return parsed.web.client_id.trim();
  }

  if (typeof parsed.client_id === "string") {
    return parsed.client_id.trim();
  }

  return "";
}

function hasClientSecret(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return false;
  }
  if (typeof parsed.client_secret === "string" && parsed.client_secret.trim()) {
    return true;
  }
  if (parsed.installed && typeof parsed.installed.client_secret === "string" && parsed.installed.client_secret.trim()) {
    return true;
  }
  if (parsed.web && typeof parsed.web.client_secret === "string" && parsed.web.client_secret.trim()) {
    return true;
  }
  return false;
}

function extractClientIdFromJsonFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    fail("OAuth JSON file does not exist: " + absolutePath);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail("OAuth JSON is not valid JSON.");
  }

  if (hasClientSecret(parsed)) {
    fail(
      [
        "Desktop OAuth credentials detected (`client_secret` present).",
        "Drive sync in the extension requires a Chrome extension OAuth client.",
        "Create a Chrome extension client in Google Cloud and use that client_id."
      ].join(" ")
    );
  }

  const clientId = extractGoogleClientId(parsed);

  if (!clientId) {
    fail("Could not find a Google OAuth client_id in the provided JSON file.");
  }

  return clientId;
}

function readClientIdFromLocalFile() {
  return readFirstMeaningfulLine(
    localClientIdPath,
    [
      "Local client ID file not found:",
      localClientIdPath,
      "Copy config/drive-oauth-client-id.local.example to config/drive-oauth-client-id.local",
      "and paste your Chrome extension OAuth client ID (one line, no quotes)."
    ].join("\n")
  );
}

function readRegisteredExtensionIds() {
  if (!fs.existsSync(LOCAL_EXTENSION_IDS_PATH)) {
    fail(
      [
        "Registered extension IDs file not found:",
        LOCAL_EXTENSION_IDS_PATH,
        "Copy config/drive-extension-ids.local.example to config/drive-extension-ids.local",
        "and list the local and store extension IDs, one per line."
      ].join("\n")
    );
  }

  return fs.readFileSync(LOCAL_EXTENSION_IDS_PATH, "utf8")
    .split(/\r?\n/)
    .map(function(entry) {
      return entry.trim();
    })
    .filter(function(entry) {
      return entry.length > 0 && entry.charAt(0) !== "#";
    });
}

function validateRegisteredExtensionIds() {
  const ids = readRegisteredExtensionIds();
  const missing = EXPECTED_EXTENSION_IDS.filter(function(expectedId) {
    return ids.indexOf(expectedId) === -1;
  });
  if (missing.length) {
    fail(
      [
        "Registered extension IDs file is missing required IDs:",
        missing.join(", "),
        "Update config/drive-extension-ids.local with both the local and store IDs."
      ].join(" ")
    );
  }
  return ids;
}

function validateClientId(clientId) {
  if (!clientId) {
    fail("Client ID is empty.");
  }
  if (clientId === PLACEHOLDER_CLIENT_ID) {
    fail("Refusing to set placeholder client ID.");
  }
  if (!/^[0-9]+-[a-z0-9._-]+\.apps\.googleusercontent\.com$/i.test(clientId)) {
    fail("Client ID does not look like a Google OAuth client id.");
  }
}

function updateManifestClientId(clientId, targetManifestPath) {
  const manifestFilePath = targetManifestPath || defaultManifestPath;
  const manifest = JSON.parse(fs.readFileSync(manifestFilePath, "utf8"));
  if (!manifest.oauth2 || typeof manifest.oauth2 !== "object") {
    manifest.oauth2 = {};
  }
  manifest.oauth2.client_id = clientId;
  fs.writeFileSync(manifestFilePath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.validateIds) {
    validateRegisteredExtensionIds();
    console.log("drive extension IDs validated.");
    if (!args.clientId && !args.fromJson && !args.fromLocal && !String(process.env.EXTENSITY_DRIVE_CLIENT_ID || "").trim()) {
      return;
    }
  }

  if (args.reset) {
    updateManifestClientId(PLACEHOLDER_CLIENT_ID, args.manifestPath);
    console.log("manifest oauth2.client_id reset to placeholder.");
    return;
  }

  const envClientId = String(process.env.EXTENSITY_DRIVE_CLIENT_ID || "").trim();
  const clientId = args.fromJson
    ? extractClientIdFromJsonFile(args.fromJson)
    : args.fromLocal
      ? readClientIdFromLocalFile()
      : String(args.clientId || envClientId || "").trim();

  if (!clientId) {
    fail("Provide --client-id, --from-json, --from-local, or EXTENSITY_DRIVE_CLIENT_ID.");
  }

  validateClientId(clientId);
  updateManifestClientId(clientId, args.manifestPath);
  console.log("manifest oauth2.client_id updated.");
}

if (require.main === module) {
  main();
}

module.exports = {
  EXPECTED_EXTENSION_IDS: EXPECTED_EXTENSION_IDS,
  extractClientIdFromJsonFile: extractClientIdFromJsonFile,
  parseArgs: parseArgs,
  readClientIdFromLocalFile: readClientIdFromLocalFile,
  readRegisteredExtensionIds: readRegisteredExtensionIds,
  updateManifestClientId: updateManifestClientId,
  validateClientId: validateClientId,
  validateRegisteredExtensionIds: validateRegisteredExtensionIds
};
