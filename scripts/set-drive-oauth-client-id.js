const fs = require("node:fs");
const path = require("node:path");

const oauthClientId = require("./google-oauth-client-id");

const repoRoot = path.resolve(__dirname, "..");
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
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage:",
        "  npm run drive:set-client-id -- --client-id <google-client-id>",
        "  npm run drive:set-client-id -- --from-json <path-to-oauth-json>",
        "  npm run drive:apply-local",
        "  npm run drive:set-client-id -- --manifest-path <path> --from-local",
        "  npm run drive:set-client-id -- --reset",
        "",
        "Environment:",
        "  EXTENSITY_DRIVE_CLIENT_ID=<id> npm run drive:set-client-id",
        "",
        "Notes:",
        "- The client ID must come from a Chrome Extension OAuth client bound to this build's runtime ID.",
        "- JSON is checked only for syntax and absence of client_secret; Google Cloud type and ID binding require a live check.",
        "- Local file (gitignored): config/drive-oauth-client-id.local"
      ].join("\n"));
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
  const line = fs.readFileSync(filePath, "utf8")
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

function extractClientIdFromJsonFile(filePath) {
  return oauthClientId.readSecretFreeClientIdJson(filePath);
}

function readClientIdFromLocalFile() {
  return readFirstMeaningfulLine(
    localClientIdPath,
    [
      "Local client ID file not found:",
      localClientIdPath,
      "Copy config/drive-oauth-client-id.local.example to config/drive-oauth-client-id.local",
      "and paste the Chrome Extension OAuth client ID for the observed local runtime ID."
    ].join("\n")
  );
}

function validateClientId(clientId) {
  return oauthClientId.validateGoogleClientId(clientId, "Drive OAuth client ID");
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
  if (args.reset) {
    updateManifestClientId(oauthClientId.PLACEHOLDER_CLIENT_ID, args.manifestPath);
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
  PLACEHOLDER_CLIENT_ID: oauthClientId.PLACEHOLDER_CLIENT_ID,
  extractClientIdFromJsonFile: extractClientIdFromJsonFile,
  parseArgs: parseArgs,
  readClientIdFromLocalFile: readClientIdFromLocalFile,
  updateManifestClientId: updateManifestClientId,
  validateClientId: validateClientId
};
