const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const distZipPath = path.join(repoRoot, "dist", "dist.zip");
const manifestPath = path.join(repoRoot, "manifest.json");
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

assert(fs.existsSync(distZipPath), "Expected dist/dist.zip to exist. Run `make dist` before bundling.");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
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
fs.copyFileSync(manifestPath, manifestCopyPath);

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
