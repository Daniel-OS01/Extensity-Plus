const fs = require("node:fs");
const path = require("node:path");

const PLACEHOLDER_WEB_CLIENT_ID = "REPLACE_WITH_DRIVE_WEB_CLIENT_ID.apps.googleusercontent.com";
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
        "  node scripts/set-drive-web-oauth-client-id.js --from-json <path-to-web-oauth-json>",
        "  node scripts/set-drive-web-oauth-client-id.js --from-local",
        "  node scripts/set-drive-web-oauth-client-id.js --reset",
        "",
        "Environment:",
        "  EXTENSITY_DRIVE_WEB_CLIENT_ID=<id> node scripts/set-drive-web-oauth-client-id.js",
        "",
        "Notes:",
        "- This config is only for Brave-compatible launchWebAuthFlow fallback.",
        "- Use a Google Cloud Web application OAuth client.",
        "- Desktop OAuth JSON exports include an installed block and must not be used here.",
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
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0 && entry.charAt(0) !== "#");
  if (!line) {
    fail("File is empty: " + filePath);
  }
  return line;
}

function extractWebClientIdFromJsonFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    fail("OAuth JSON file does not exist: " + absolutePath);
  }
  const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  if (parsed.installed) {
    fail("Desktop OAuth credentials detected (`installed` block). Use a Web application OAuth client for Brave fallback.");
  }
  if (!parsed.web || typeof parsed.web.client_id !== "string") {
    fail("Could not find a Web application OAuth client_id in the provided JSON file.");
  }
  return parsed.web.client_id.trim();
}

function readClientIdFromLocalFile() {
  return readFirstMeaningfulLine(
    localClientIdPath,
    [
      "Local Web client ID file not found:",
      localClientIdPath,
      "Copy config/drive-oauth-web-client-id.local.example to config/drive-oauth-web-client-id.local",
      "and paste your Web application OAuth client ID (one line, no quotes)."
    ].join("\n")
  );
}

function validateClientId(clientId) {
  if (!clientId) {
    fail("Client ID is empty.");
  }
  if (clientId === PLACEHOLDER_WEB_CLIENT_ID) {
    fail("Refusing to set placeholder Web client ID.");
  }
  if (!/^[0-9]+-[a-z0-9._-]+\.apps\.googleusercontent\.com$/i.test(clientId)) {
    fail("Client ID does not look like a Google OAuth client id.");
  }
}

function updateConfigClientId(clientId, targetConfigPath) {
  const configPath = targetConfigPath || defaultConfigPath;
  const source = fs.readFileSync(configPath, "utf8");
  const pattern = /driveWebClientId:\s*"[^"]*"/;
  const matched = pattern.test(source);
  const next = source.replace(
    pattern,
    'driveWebClientId: "' + clientId + '"'
  );
  if (!matched) {
    fail("Could not find driveWebClientId in " + configPath);
  }
  if (next === source) {
    return;
  }
  fs.writeFileSync(configPath, next, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.reset) {
    updateConfigClientId(PLACEHOLDER_WEB_CLIENT_ID, args.configPath);
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
  PLACEHOLDER_WEB_CLIENT_ID: PLACEHOLDER_WEB_CLIENT_ID,
  extractWebClientIdFromJsonFile: extractWebClientIdFromJsonFile,
  parseArgs: parseArgs,
  readClientIdFromLocalFile: readClientIdFromLocalFile,
  updateConfigClientId: updateConfigClientId,
  validateClientId: validateClientId
};
