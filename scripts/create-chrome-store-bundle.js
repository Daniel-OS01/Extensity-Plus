const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const oauthClientId = require("./google-oauth-client-id");

const repoRoot = path.resolve(__dirname, "..");
const distZipPath = path.join(repoRoot, "dist", "dist.zip");
const distManifestPath = path.join(repoRoot, "dist", "manifest.json");
const distDriveWebConfigPath = path.join(repoRoot, "dist", "js", "drive-oauth-config.js");
const packageJsonPath = path.join(repoRoot, "package.json");
const artifactsRoot = path.join(repoRoot, "artifacts", "chrome-web-store");
const generatedAt = new Date().toISOString();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readDriveWebClientId(source) {
  const match = source.match(/driveWebClientId:\s*"([^"]*)"/);
  assert(match, "Drive Web OAuth config must define driveWebClientId.");
  return match[1].trim();
}

function validateBundleCredentials(manifest, driveWebClientId, environment) {
  const env = environment || process.env;
  const suppliedDriveClientId = String(env.EXTENSITY_DRIVE_CLIENT_ID || "").trim();
  const suppliedWebClientId = String(env.EXTENSITY_DRIVE_WEB_CLIENT_ID || "").trim();

  assert(
    suppliedDriveClientId,
    "EXTENSITY_DRIVE_CLIENT_ID is required before creating a Chrome Web Store bundle."
  );
  oauthClientId.validateGoogleClientId(suppliedDriveClientId, "Release Drive OAuth client ID");
  assert(
    manifest.oauth2 && manifest.oauth2.client_id === suppliedDriveClientId,
    "Packaged manifest oauth2.client_id does not match EXTENSITY_DRIVE_CLIENT_ID. Rebuild before bundling."
  );

  if (suppliedWebClientId) {
    oauthClientId.validateGoogleClientId(suppliedWebClientId, "Release Drive Web OAuth client ID");
    assert(
      driveWebClientId === suppliedWebClientId,
      "Packaged Drive Web OAuth client ID does not match EXTENSITY_DRIVE_WEB_CLIENT_ID. Rebuild before bundling."
    );
  } else {
    assert(
      driveWebClientId === oauthClientId.PLACEHOLDER_WEB_CLIENT_ID,
      "Packaged Drive Web OAuth client is configured but EXTENSITY_DRIVE_WEB_CLIENT_ID is absent."
    );
  }
}

function createBundle() {
  assert(fs.existsSync(distZipPath), "Expected dist/dist.zip to exist. Run `make dist` before bundling.");

  assert(fs.existsSync(distManifestPath), "Expected dist/manifest.json to exist. Run `make dist` before bundling.");
  assert(fs.existsSync(distDriveWebConfigPath), "Expected dist/js/drive-oauth-config.js to exist. Run `make dist` before bundling.");

  const manifest = JSON.parse(fs.readFileSync(distManifestPath, "utf8"));
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const driveWebConfig = fs.readFileSync(distDriveWebConfigPath, "utf8");
  const driveWebClientId = readDriveWebClientId(driveWebConfig);
  validateBundleCredentials(manifest, driveWebClientId, process.env);

  const version = manifest.version;
  const packageName = packageJson.name || "extensity-plus";
  const extensionZipName = `${packageName}-v${version}.zip`;
  const extensionZipPath = path.join(artifactsRoot, extensionZipName);
  const manifestCopyPath = path.join(artifactsRoot, "manifest.json");
  const metadataPath = path.join(artifactsRoot, "submission-metadata.json");
  const checksumsPath = path.join(artifactsRoot, "checksums.txt");
  const notesPath = path.join(artifactsRoot, "submission-notes.md");

  fs.rmSync(artifactsRoot, { force: true, recursive: true });
  fs.mkdirSync(artifactsRoot, { recursive: true });
  fs.copyFileSync(distZipPath, extensionZipPath);
  fs.copyFileSync(distManifestPath, manifestCopyPath);

  const zipChecksum = sha256(extensionZipPath);
  const metadata = {
    createdAt: generatedAt,
    extensionZip: extensionZipName,
    gitSha: process.env.GITHUB_SHA || null,
    manifestVersion: manifest.manifest_version,
    name: manifest.name,
    optionsPage: manifest.options_ui && manifest.options_ui.page,
    version: version
  };

  const notes = [
    "# Chrome Web Store Submission Bundle",
    "",
    `Generated: ${generatedAt}`,
    `Extension version: ${version}`,
    "",
    "## Included files",
    "",
    `- \`${extensionZipName}\`: upload this ZIP package to the Chrome Web Store developer dashboard.`,
    "- `manifest.json`: snapshot of the packaged manifest used for this release.",
    "- `submission-metadata.json`: machine-readable release metadata for CI and release notes.",
    "- `checksums.txt`: SHA-256 checksum for the upload package.",
    "",
    "## Manual store tasks that still remain",
    "",
    "- Update the store listing text, screenshots, privacy declarations, and distribution settings in the Chrome Web Store dashboard.",
    "- Confirm the dashboard metadata matches the packaged manifest before you upload.",
    "- If your publisher account has enabled verified uploads, sign the upload according to your Web Store configuration before submitting."
  ].join("\n");

  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
  fs.writeFileSync(checksumsPath, `${zipChecksum}  ${extensionZipName}\n`, "utf8");
  fs.writeFileSync(notesPath, `${notes}\n`, "utf8");

  console.log(JSON.stringify({
    artifactDirectory: artifactsRoot,
    extensionZip: extensionZipPath,
    version: version
  }, null, 2));
}

if (require.main === module) {
  createBundle();
}

module.exports = {
  createBundle: createBundle,
  readDriveWebClientId: readDriveWebClientId,
  validateBundleCredentials: validateBundleCredentials
};
