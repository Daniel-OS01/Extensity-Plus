const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = require("../scripts/set-drive-oauth-client-id.js");

test("parseArgs accepts manifest path and local source", () => {
  const args = script.parseArgs([
    "--manifest-path",
    "./dist/manifest.json",
    "--from-local"
  ]);

  assert.equal(args.manifestPath, path.resolve(process.cwd(), "./dist/manifest.json"));
  assert.equal(args.fromLocal, true);
});

test("extractClientIdFromJsonFile accepts chrome extension exports without client_secret", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "extensity-drive-"));
  const jsonPath = path.join(tmpDir, "oauth.json");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({
      installed: {
        client_id: "12345-chrome-extension.apps.googleusercontent.com"
      }
    }),
    "utf8"
  );

  assert.equal(
    script.extractClientIdFromJsonFile(jsonPath),
    "12345-chrome-extension.apps.googleusercontent.com"
  );
});

test("extractClientIdFromJsonFile rejects desktop exports that include client_secret", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "extensity-drive-"));
  const jsonPath = path.join(tmpDir, "oauth.json");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({
      installed: {
        client_id: "12345-desktop.apps.googleusercontent.com",
        client_secret: "secret"
      }
    }),
    "utf8"
  );

  assert.throws(
    () => script.extractClientIdFromJsonFile(jsonPath),
    /contains client_secret/
  );
});

test("updateManifestClientId rewrites the manifest client_id at the requested path", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "extensity-drive-"));
  const manifestPath = path.join(tmpDir, "manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      oauth2: {
        client_id: "REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com",
        scopes: ["https://www.googleapis.com/auth/drive.appdata"]
      }
    }, null, 2),
    "utf8"
  );

  script.updateManifestClientId("12345-new.apps.googleusercontent.com", manifestPath);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.oauth2.client_id, "12345-new.apps.googleusercontent.com");
});
