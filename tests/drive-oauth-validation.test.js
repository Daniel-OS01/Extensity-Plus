const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const spawnSync = require("node:child_process").spawnSync;
const test = require("node:test");

const bundle = require("../scripts/create-chrome-store-bundle");
const oauthClientId = require("../scripts/google-oauth-client-id");
const validator = require("../scripts/validate-manifest");

const repoRoot = path.resolve(__dirname, "..");
const validChromeClientId = "123456789012-localfixture.apps.googleusercontent.com";
const validStoreClientId = "123456789012-storefixture.apps.googleusercontent.com";
const validWebClientId = "123456789012-webfixture.apps.googleusercontent.com";

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extensity-drive-validation-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

function createValidationFixture(dir, driveClientId, webClientId) {
  ["images", "js", "styles"].forEach(function(directory) {
    fs.cpSync(path.join(repoRoot, directory), path.join(dir, directory), { recursive: true });
  });
  ["index.html", "options.html", "profiles.html", "dashboard.html"].forEach(function(fileName) {
    fs.copyFileSync(path.join(repoRoot, fileName), path.join(dir, fileName));
  });

  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
  manifest.oauth2.client_id = driveClientId;
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const webConfigPath = path.join(dir, "js", "drive-oauth-config.js");
  const webConfig = fs.readFileSync(webConfigPath, "utf8").replace(
    oauthClientId.PLACEHOLDER_WEB_CLIENT_ID,
    webClientId
  );
  fs.writeFileSync(webConfigPath, webConfig);

  return {
    manifestPath: path.join(dir, "manifest.json"),
    webConfigPath: webConfigPath
  };
}

test("OAuth helper accepts supported secret-free JSON shapes", () => {
  const shapes = [
    { oauth2: { client_id: validChromeClientId } },
    { installed: { client_id: validChromeClientId } },
    { web: { client_id: validChromeClientId } },
    { client_id: validChromeClientId }
  ];
  shapes.forEach(function(shape) {
    assert.equal(
      oauthClientId.parseSecretFreeClientIdJson(JSON.stringify(shape)),
      validChromeClientId
    );
  });
});

test("OAuth helper rejects root and nested client_secret fields", () => {
  [
    { client_id: validChromeClientId, client_secret: "fixture" },
    { oauth2: { client_id: validChromeClientId, nested: { client_secret: "fixture" } } }
  ].forEach(function(shape) {
    assert.throws(
      () => oauthClientId.parseSecretFreeClientIdJson(JSON.stringify(shape)),
      /contains client_secret/
    );
  });
});

test("manifest Chrome strict mode is independent from optional Web strict mode", () => {
  withTempDir(function(dir) {
    const fixture = createValidationFixture(
      dir,
      validChromeClientId,
      oauthClientId.PLACEHOLDER_WEB_CLIENT_ID
    );

    assert.doesNotThrow(function() {
      validator.validateManifest({
        manifestPath: fixture.manifestPath,
        requireDriveClient: true,
        requireWebClient: false,
        webConfigPath: fixture.webConfigPath
      });
    });
    assert.throws(function() {
      validator.validateManifest({
        manifestPath: fixture.manifestPath,
        requireDriveClient: true,
        requireWebClient: true,
        webConfigPath: fixture.webConfigPath
      });
    }, /Web OAuth client ID still uses a placeholder/);
  });
});

test("manifest validator rejects client_secret at any depth", () => {
  withTempDir(function(dir) {
    const fixture = createValidationFixture(dir, validChromeClientId, validWebClientId);
    const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8"));
    manifest.oauth2.nested = { client_secret: "fixture" };
    fs.writeFileSync(fixture.manifestPath, JSON.stringify(manifest));

    assert.throws(function() {
      validator.validateManifest({
        manifestPath: fixture.manifestPath,
        requireDriveClient: true,
        requireWebClient: true,
        webConfigPath: fixture.webConfigPath
      });
    }, /must not contain client_secret/);
  });
});

test("manifest validator uses the shared secret-free OAuth JSON rules", () => {
  withTempDir(function(dir) {
    const fixture = createValidationFixture(dir, validChromeClientId, validWebClientId);
    const oauthPath = path.join(dir, "oauth.json");
    const previousPath = process.env.EXTENSITY_DRIVE_OAUTH_JSON;
    try {
      process.env.EXTENSITY_DRIVE_OAUTH_JSON = oauthPath;
      fs.writeFileSync(oauthPath, JSON.stringify({ installed: { client_id: validChromeClientId } }));
      assert.doesNotThrow(function() {
        validator.validateManifest({
          manifestPath: fixture.manifestPath,
          requireDriveClient: true,
          requireWebClient: true,
          webConfigPath: fixture.webConfigPath
        });
      });

      fs.writeFileSync(oauthPath, JSON.stringify({
        oauth2: {
          client_id: validChromeClientId,
          nested: { client_secret: "fixture" }
        }
      }));
      assert.throws(function() {
        validator.validateManifest({
          manifestPath: fixture.manifestPath,
          requireDriveClient: true,
          requireWebClient: true,
          webConfigPath: fixture.webConfigPath
        });
      }, /contains client_secret/);
    } finally {
      if (previousPath === undefined) {
        delete process.env.EXTENSITY_DRIVE_OAUTH_JSON;
      } else {
        process.env.EXTENSITY_DRIVE_OAUTH_JSON = previousPath;
      }
    }
  });
});

test("bundle credential gate requires exact store injection and allows absent Web fallback", () => {
  const manifest = { oauth2: { client_id: validStoreClientId } };
  assert.doesNotThrow(function() {
    bundle.validateBundleCredentials(
      manifest,
      oauthClientId.PLACEHOLDER_WEB_CLIENT_ID,
      { EXTENSITY_DRIVE_CLIENT_ID: validStoreClientId }
    );
  });
  assert.throws(function() {
    bundle.validateBundleCredentials(manifest, oauthClientId.PLACEHOLDER_WEB_CLIENT_ID, {});
  }, /EXTENSITY_DRIVE_CLIENT_ID is required/);
  assert.throws(function() {
    bundle.validateBundleCredentials(
      manifest,
      oauthClientId.PLACEHOLDER_WEB_CLIENT_ID,
      { EXTENSITY_DRIVE_CLIENT_ID: validChromeClientId }
    );
  }, /does not match/);
  assert.throws(function() {
    bundle.validateBundleCredentials(
      { oauth2: { client_id: oauthClientId.PLACEHOLDER_CLIENT_ID } },
      oauthClientId.PLACEHOLDER_WEB_CLIENT_ID,
      { EXTENSITY_DRIVE_CLIENT_ID: oauthClientId.PLACEHOLDER_CLIENT_ID }
    );
  }, /placeholder/);
  assert.throws(function() {
    bundle.validateBundleCredentials(
      { oauth2: { client_id: "malformed" } },
      oauthClientId.PLACEHOLDER_WEB_CLIENT_ID,
      { EXTENSITY_DRIVE_CLIENT_ID: "malformed" }
    );
  }, /does not match Google OAuth client ID syntax/);
});

test("bundle credential gate validates optional Web injection independently", () => {
  const manifest = { oauth2: { client_id: validStoreClientId } };
  assert.doesNotThrow(function() {
    bundle.validateBundleCredentials(manifest, validWebClientId, {
      EXTENSITY_DRIVE_CLIENT_ID: validStoreClientId,
      EXTENSITY_DRIVE_WEB_CLIENT_ID: validWebClientId
    });
  });
  assert.throws(function() {
    bundle.validateBundleCredentials(manifest, validWebClientId, {
      EXTENSITY_DRIVE_CLIENT_ID: validStoreClientId
    });
  }, /Web OAuth client is configured/);
});

test("workflow-style environment injection updates only the build manifest without logging the ID", () => {
  withTempDir(function(dir) {
    const manifestPath = path.join(dir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      oauth2: {
        client_id: oauthClientId.PLACEHOLDER_CLIENT_ID,
        scopes: ["https://www.googleapis.com/auth/drive.appdata"]
      }
    }));

    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "set-drive-oauth-client-id.js"), "--manifest-path", manifestPath],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          EXTENSITY_DRIVE_CLIENT_ID: validStoreClientId
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(validStoreClientId));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.oauth2.client_id, validStoreClientId);
  });
});
