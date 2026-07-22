const fs = require("node:fs");
const path = require("node:path");

const GOOGLE_CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9._-]+\.apps\.googleusercontent\.com$/i;
const PLACEHOLDER_CLIENT_ID = "REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com";
const PLACEHOLDER_WEB_CLIENT_ID = "REPLACE_WITH_DRIVE_WEB_CLIENT_ID.apps.googleusercontent.com";

function fail(message) {
  throw new Error(message);
}

function containsClientSecret(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, "client_secret")) {
    return true;
  }
  return Object.keys(value).some(function(key) {
    return containsClientSecret(value[key]);
  });
}

function extractGoogleClientId(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return "";
  }

  var candidates = [
    parsed.oauth2 && parsed.oauth2.client_id,
    parsed.installed && parsed.installed.client_id,
    parsed.web && parsed.web.client_id,
    parsed.client_id
  ];
  var clientId = candidates.find(function(candidate) {
    return typeof candidate === "string" && candidate.trim().length > 0;
  });
  return typeof clientId === "string" ? clientId.trim() : "";
}

function isGoogleClientIdFormat(clientId) {
  return GOOGLE_CLIENT_ID_PATTERN.test(String(clientId || "").trim());
}

function isPlaceholderClientId(clientId) {
  var normalized = String(clientId || "").trim();
  return normalized === PLACEHOLDER_CLIENT_ID || normalized === PLACEHOLDER_WEB_CLIENT_ID;
}

function parseSecretFreeClientIdJson(raw, sourceLabel) {
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail((sourceLabel || "OAuth JSON") + " is not valid JSON.");
  }

  if (containsClientSecret(parsed)) {
    fail(
      (sourceLabel || "OAuth JSON")
      + " contains client_secret. Browser extension Drive configuration accepts client_id only."
    );
  }

  var clientId = extractGoogleClientId(parsed);
  if (!clientId) {
    fail("Could not find a Google OAuth client_id in " + (sourceLabel || "OAuth JSON") + ".");
  }
  validateGoogleClientId(clientId, sourceLabel || "OAuth JSON client_id");
  return clientId;
}

function readSecretFreeClientIdJson(filePath) {
  var absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    fail("OAuth JSON file does not exist: " + absolutePath);
  }
  return parseSecretFreeClientIdJson(fs.readFileSync(absolutePath, "utf8"), "OAuth JSON");
}

function validateGoogleClientId(clientId, label) {
  var normalized = String(clientId || "").trim();
  if (!normalized) {
    fail((label || "Client ID") + " is empty.");
  }
  if (isPlaceholderClientId(normalized)) {
    fail((label || "Client ID") + " still uses a placeholder.");
  }
  if (!isGoogleClientIdFormat(normalized)) {
    fail((label || "Client ID") + " does not match Google OAuth client ID syntax.");
  }
  return normalized;
}

module.exports = {
  GOOGLE_CLIENT_ID_PATTERN: GOOGLE_CLIENT_ID_PATTERN,
  PLACEHOLDER_CLIENT_ID: PLACEHOLDER_CLIENT_ID,
  PLACEHOLDER_WEB_CLIENT_ID: PLACEHOLDER_WEB_CLIENT_ID,
  containsClientSecret: containsClientSecret,
  extractGoogleClientId: extractGoogleClientId,
  isGoogleClientIdFormat: isGoogleClientIdFormat,
  isPlaceholderClientId: isPlaceholderClientId,
  parseSecretFreeClientIdJson: parseSecretFreeClientIdJson,
  readSecretFreeClientIdJson: readSecretFreeClientIdJson,
  validateGoogleClientId: validateGoogleClientId
};
