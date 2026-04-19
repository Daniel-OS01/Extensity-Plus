const assert = require("node:assert/strict");
const test = require("node:test");

const {
  bumpVersion,
  getBumpTypeFromArgv,
  parseSemver
} = require("../scripts/bump-version.js");

test("getBumpTypeFromArgv handles direct node invocation", () => {
  assert.equal(
    getBumpTypeFromArgv(["node", "scripts/bump-version.js", "patch"]),
    "patch"
  );
  assert.equal(
    getBumpTypeFromArgv(["node", "scripts/bump-version.js", "minor"]),
    "minor"
  );
});

test("getBumpTypeFromArgv handles pnpm forwarded separator", () => {
  assert.equal(
    getBumpTypeFromArgv(["node", "pnpm", "run", "release:bump", "--", "major"]),
    "major"
  );
  assert.equal(
    getBumpTypeFromArgv(["node", "pnpm", "--filter", "extensity-plus", "run", "release:bump", "--", "patch"]),
    "patch"
  );
});

test("getBumpTypeFromArgv ignores unrelated argv values and returns null when missing", () => {
  assert.equal(
    getBumpTypeFromArgv(["node", "scripts/bump-version.js", "--verbose", "minor", "--dry-run"]),
    "minor"
  );
  assert.equal(
    getBumpTypeFromArgv(["node", "scripts/bump-version.js", "--verbose"]),
    null
  );
  assert.equal(
    getBumpTypeFromArgv(["node", "scripts/bump-version.js", "prerelease"]),
    null
  );
});

test("parseSemver parses supported versions", () => {
  assert.deepEqual(parseSemver("2.0.2"), {
    major: 2,
    minor: 0,
    patch: 2
  });
});

test("bumpVersion increments supported bump types", () => {
  assert.equal(bumpVersion("2.0.2", "patch"), "2.0.3");
  assert.equal(bumpVersion("2.0.2", "minor"), "2.1.0");
  assert.equal(bumpVersion("2.0.2", "major"), "3.0.0");
});
