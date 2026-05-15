const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = require("../scripts/set-drive-oauth-client-id.js");

test("parseArgs accepts manifest path and validate ids flags", () => {
  const args = script.parseArgs([
    "--manifest-path",
    "./dist/manifest.json",
    "--validate-ids",
    "--from-local"
  ]);

  assert.equal(args.manifestPath, path.resolve(process.cwd(), "./dist/manifest.json"));
  assert.equal(args.validateIds, true);
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
    /Desktop OAuth credentials detected/
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

test("validateRegisteredExtensionIds requires both extension IDs", () => {
  const idsPath = path.join(path.resolve(__dirname, ".."), "config", "drive-extension-ids.local");
  const existed = fs.existsSync(idsPath);
  const backup = existed ? fs.readFileSync(idsPath, "utf8") : null;

  try {
    fs.writeFileSync(idsPath, script.EXPECTED_EXTENSION_IDS.join("\n") + "\n", "utf8");
    assert.deepEqual(script.validateRegisteredExtensionIds(), script.EXPECTED_EXTENSION_IDS);

    fs.writeFileSync(idsPath, script.EXPECTED_EXTENSION_IDS[0] + "\n", "utf8");
    assert.throws(
      () => script.validateRegisteredExtensionIds(),
      /missing required IDs/
    );
  } finally {
    if (existed) {
      fs.writeFileSync(idsPath, backup, "utf8");
    } else {
      fs.rmSync(idsPath, { force: true });
    }
  }
});
