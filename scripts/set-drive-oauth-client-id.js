const fs = require("node:fs");
const path = require("node:path");

const PLACEHOLDER_CLIENT_ID = "REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com";
const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, "manifest.json");
const localClientIdPath = path.join(repoRoot, "config", "drive-oauth-client-id.local");

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const result = {
    clientId: "",
    fromJson: "",
    fromLocal: false,
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
    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage:",
          "  npm run drive:set-client-id -- --client-id <google-client-id>",
          "  npm run drive:set-client-id -- --from-json <path-to-oauth-json>",
          "  npm run drive:apply-local",
          "  npm run drive:set-client-id -- --reset",
          "",
          "Environment:",
          "  EXTENSITY_DRIVE_CLIENT_ID=<id> npm run drive:set-client-id",
          "",
          "Notes:",
          "- Drive sync requires a Chrome extension OAuth client ID.",
          "- Desktop OAuth JSON usually has an `installed` block and must not be used here.",
          "- Local file (gitignored): config/drive-oauth-client-id.local",
          "- This script only updates manifest oauth2.client_id."
        ].join("\n")
      );
      process.exit(0);
    }
    fail("Unknown argument: " + arg);
  }
  return result;
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

  if (parsed && parsed.installed) {
    fail(
      [
        "Desktop OAuth credentials detected (`installed` block).",
        "Drive sync in the extension requires a Chrome extension OAuth client.",
        "Create a Chrome extension client in Google Cloud and use that client_id."
      ].join(" ")
    );
  }

  const clientId = parsed
    && parsed.oauth2
    && typeof parsed.oauth2.client_id === "string"
    ? parsed.oauth2.client_id.trim()
    : "";

  if (!clientId) {
    fail("Could not find oauth2.client_id in the provided JSON file.");
  }

  return clientId;
}

function readClientIdFromLocalFile() {
  if (!fs.existsSync(localClientIdPath)) {
    fail(
      [
        "Local client ID file not found:",
        localClientIdPath,
        "Copy config/drive-oauth-client-id.local.example to config/drive-oauth-client-id.local",
        "and paste your Chrome extension OAuth client ID (one line, no quotes)."
      ].join("\n")
    );
  }
  const raw = fs.readFileSync(localClientIdPath, "utf8");
  const line = raw
    .split(/\r?\n/)
    .map(function(entry) {
      return entry.trim();
    })
    .find(function(entry) {
      return entry.length > 0 && entry.charAt(0) !== "#";
    });
  if (!line) {
    fail("Local client ID file is empty: " + localClientIdPath);
  }
  return line;
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

function updateManifestClientId(clientId) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.oauth2 || typeof manifest.oauth2 !== "object") {
    manifest.oauth2 = {};
  }
  manifest.oauth2.client_id = clientId;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.reset) {
    updateManifestClientId(PLACEHOLDER_CLIENT_ID);
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
  updateManifestClientId(clientId);
  console.log("manifest oauth2.client_id updated.");
}

main();
