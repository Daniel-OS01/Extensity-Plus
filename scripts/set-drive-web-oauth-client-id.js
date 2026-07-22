const fs = require("node:fs");
const path = require("node:path");

const oauthClientId = require("./google-oauth-client-id");

const repoRoot = path.resolve(__dirname, "..");
const defaultConfigPath = path.join(repoRoot, "js", "drive-oauth-config.js");
const localClientIdPath = path.join(repoRoot, "config", "drive-oauth-web-client-id.local");

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const result = {
    clientId: "",
    configPath: defaultConfigPath,
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
    if (arg === "--config-path") {
      result.configPath = path.resolve(process.cwd(), String(argv[i + 1] || ""));
      i += 1;
      continue;
    }
    if (arg === "--from-json") {
      result.fromJson = String(argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (arg === "--from-local") {
      result.fromLocal = true;
      continue;
    }
    if (arg === "--reset") {
      result.reset = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage:",
        "  node scripts/set-drive-web-oauth-client-id.js --client-id <web-client-id>",
        "  node scripts/set-drive-web-oauth-client-id.js --from-json <path-to-oauth-json>",
        "  node scripts/set-drive-web-oauth-client-id.js --from-local",
        "  node scripts/set-drive-web-oauth-client-id.js --reset",
        "",
        "Environment:",
        "  EXTENSITY_DRIVE_WEB_CLIENT_ID=<id> node scripts/set-drive-web-oauth-client-id.js",
        "",
        "Notes:",
        "- This optional config is only for the Brave-compatible launchWebAuthFlow fallback.",
        "- JSON is checked only for syntax and absence of client_secret; verify client type and redirects in Google Cloud.",
        "- Local file (gitignored): config/drive-oauth-web-client-id.local"
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

function extractWebClientIdFromJsonFile(filePath) {
  return oauthClientId.readSecretFreeClientIdJson(filePath);
}

function readClientIdFromLocalFile() {
  return readFirstMeaningfulLine(
    localClientIdPath,
    [
      "Local Web client ID file not found:",
      localClientIdPath,
      "Copy config/drive-oauth-web-client-id.local.example to config/drive-oauth-web-client-id.local",
      "and paste the optional Web OAuth client ID."
    ].join("\n")
  );
}

function validateClientId(clientId) {
  return oauthClientId.validateGoogleClientId(clientId, "Drive Web OAuth client ID");
}

function updateConfigClientId(clientId, targetConfigPath) {
  const configPath = targetConfigPath || defaultConfigPath;
  const source = fs.readFileSync(configPath, "utf8");
  const pattern = /driveWebClientId:\s*"[^"]*"/;
  if (!pattern.test(source)) {
    fail("Could not find driveWebClientId in " + configPath);
  }
  const next = source.replace(pattern, 'driveWebClientId: "' + clientId + '"');
  if (next !== source) {
    fs.writeFileSync(configPath, next, "utf8");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.reset) {
    updateConfigClientId(oauthClientId.PLACEHOLDER_WEB_CLIENT_ID, args.configPath);
    console.log("Drive Web OAuth client ID reset to placeholder.");
    return;
  }

  const envClientId = String(process.env.EXTENSITY_DRIVE_WEB_CLIENT_ID || "").trim();
  const clientId = args.fromJson
    ? extractWebClientIdFromJsonFile(args.fromJson)
    : args.fromLocal
      ? readClientIdFromLocalFile()
      : String(args.clientId || envClientId || "").trim();

  if (!clientId) {
    fail("Provide --client-id, --from-json, --from-local, or EXTENSITY_DRIVE_WEB_CLIENT_ID.");
  }
  validateClientId(clientId);
  updateConfigClientId(clientId, args.configPath);
  console.log("Drive Web OAuth client ID updated.");
}

if (require.main === module) {
  main();
}

module.exports = {
  PLACEHOLDER_WEB_CLIENT_ID: oauthClientId.PLACEHOLDER_WEB_CLIENT_ID,
  extractWebClientIdFromJsonFile: extractWebClientIdFromJsonFile,
  parseArgs: parseArgs,
  readClientIdFromLocalFile: readClientIdFromLocalFile,
  updateConfigClientId: updateConfigClientId,
  validateClientId: validateClientId
};
