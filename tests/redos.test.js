const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");
const storageStub = {
  uniqueArray(items) {
    return Array.from(new Set(items || []));
  },
  makeId(prefix) {
    return `${prefix}-id`;
  }
};

function loadModule(relativePath, extraGlobals = {}) {
  return loadBrowserScript(path.join(repoRoot, relativePath), {
    self: {
      ExtensityStorage: storageStub,
      ...extraGlobals
    }
  });
}

test("ReDoS vulnerability in matchUrl", () => {
  const root = loadModule("js/url-rules.js");
  const { matchUrl } = root.ExtensityUrlRules;

  const evilPattern = "(a+)+$";
  const evilUrl = "a".repeat(100) + "!";

  const start = Date.now();
  const result = matchUrl(evilUrl, evilPattern, "regex");
  const duration = Date.now() - start;

  console.log(`Dangerous pattern took ${duration}ms`);
  assert.equal(result, false, "Should return false for dangerous pattern");
  assert.ok(duration < 100, "Should handle dangerous pattern quickly");
});

test("Safe patterns still work", () => {
  const root = loadModule("js/url-rules.js");
  const { matchUrl } = root.ExtensityUrlRules;

  assert.equal(matchUrl("https://github.com/openai", "^https://github\\.com/.+$", "regex"), true);
  assert.equal(matchUrl("https://google.com", "^https://github\\.com/.+$", "regex"), false);
});

test("Long pattern is rejected", () => {
  const root = loadModule("js/url-rules.js");
  const { matchUrl } = root.ExtensityUrlRules;

  const longPattern = "a".repeat(513);
  assert.equal(matchUrl("https://example.com", longPattern, "regex"), false);
});

test("Long URL is rejected", () => {
  const root = loadModule("js/url-rules.js");
  const { matchUrl } = root.ExtensityUrlRules;

  const longUrl = "https://example.com/" + "a".repeat(2048);
  assert.equal(matchUrl(longUrl, ".*", "regex"), false);
});
