const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = require("../scripts/set-drive-web-oauth-client-id.js");

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extensity-drive-web-oauth-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

test("extractWebClientIdFromJsonFile accepts Web application OAuth JSON", () => {
  withTempDir((dir) => {
    const jsonPath = path.join(dir, "web.json");
    fs.writeFileSync(jsonPath, JSON.stringify({
      web: {
        client_id: "12345-web.apps.googleusercontent.com",
        client_secret: "not-used-by-extension"
      }
    }));

    assert.equal(
      script.extractWebClientIdFromJsonFile(jsonPath),
      "12345-web.apps.googleusercontent.com"
    );
  });
});

test("extractWebClientIdFromJsonFile rejects Desktop OAuth JSON", () => {
  withTempDir((dir) => {
    const jsonPath = path.join(dir, "desktop.json");
    fs.writeFileSync(jsonPath, JSON.stringify({
      installed: {
        client_id: "12345-desktop.apps.googleusercontent.com",
        client_secret: "secret"
      }
    }));

    assert.throws(
      () => script.extractWebClientIdFromJsonFile(jsonPath),
      /Desktop OAuth credentials/
    );
  });
});

test("updateConfigClientId rewrites driveWebClientId", () => {
  withTempDir((dir) => {
    const configPath = path.join(dir, "drive-oauth-config.js");
    fs.writeFileSync(configPath, [
      "(function(root) {",
      "  root.ExtensityDriveConfig = Object.assign({",
      "    driveWebClientId: \"REPLACE_WITH_DRIVE_WEB_CLIENT_ID.apps.googleusercontent.com\"",
      "  }, root.ExtensityDriveConfig || {});",
      "})(typeof window !== \"undefined\" ? window : self);",
      ""
    ].join("\n"));

    script.updateConfigClientId("12345-web.apps.googleusercontent.com", configPath);

    assert.match(
      fs.readFileSync(configPath, "utf8"),
      /driveWebClientId: "12345-web\.apps\.googleusercontent\.com"/
    );
  });
});
