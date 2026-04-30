const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packagePath = path.join(repoRoot, "package.json");
const packageLockPath = path.join(repoRoot, "package-lock.json");
const manifestPath = path.join(repoRoot, "manifest.json");
const allowedBumps = ["patch", "minor", "major"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function bumpVersion(version, bumpType) {
  const parsed = parseSemver(version);
  if (bumpType === "patch") {
    parsed.patch += 1;
  } else if (bumpType === "minor") {
    parsed.minor += 1;
    parsed.patch = 0;
  } else if (bumpType === "major") {
    parsed.major += 1;
    parsed.minor = 0;
    parsed.patch = 0;
  } else {
    throw new Error(`Unsupported bump type: ${bumpType}`);
  }
  return [parsed.major, parsed.minor, parsed.patch].join(".");
}

function getBumpTypeFromArgv(argv) {
  const values = Array.isArray(argv) ? argv : [];
  for (const value of values) {
    if (allowedBumps.includes(value)) {
      return value;
    }
  }
  return null;
}

function main() {
  const bumpType = getBumpTypeFromArgv(process.argv);
  if (!allowedBumps.includes(bumpType)) {
    throw new Error(`Expected one of: ${allowedBumps.join(", ")}`);
  }

  const packageJson = readJson(packagePath);
  const packageLock = readJson(packageLockPath);
  const manifest = readJson(manifestPath);

  if (packageJson.version !== manifest.version) {
    throw new Error(`package.json (${packageJson.version}) and manifest.json (${manifest.version}) must match before bumping.`);
  }

  const nextVersion = bumpVersion(packageJson.version, bumpType);
  packageJson.version = nextVersion;
  packageLock.version = nextVersion;
  if (packageLock.packages && packageLock.packages[""]) {
    packageLock.packages[""].version = nextVersion;
  }
  manifest.version = nextVersion;

  writeJson(packagePath, packageJson);
  writeJson(packageLockPath, packageLock);
  writeJson(manifestPath, manifest);

  process.stdout.write(`${nextVersion}\n`);
}

module.exports = {
  allowedBumps,
  bumpVersion,
  getBumpTypeFromArgv,
  main,
  parseSemver
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
