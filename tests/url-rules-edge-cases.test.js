const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

const storageStub = {
  makeId(prefix) {
    return `${prefix}-id`;
  },
  uniqueArray(items) {
    const seen = {};
    return (Array.isArray(items) ? items : []).filter(item => {
      if (!item || seen[item]) {
        return false;
      }
      seen[item] = true;
      return true;
    });
  }
};

function loadUrlRules() {
  return loadBrowserScript(path.join(repoRoot, "js/url-rules.js"), {
    self: { ExtensityStorage: storageStub }
  });
}

// --- isSupportedUrl ---

test("isSupportedUrl accepts http:// and https:// URLs", () => {
  const root = loadUrlRules();
  assert.equal(root.ExtensityUrlRules.isSupportedUrl("http://example.com"), true);
  assert.equal(root.ExtensityUrlRules.isSupportedUrl("https://example.com/path?q=1#hash"), true);
  assert.equal(root.ExtensityUrlRules.isSupportedUrl("https://sub.domain.example.com"), true);
});

test("isSupportedUrl rejects chrome://, chrome-extension://, and ftp:// URLs", () => {
  const root = loadUrlRules();
  assert.equal(root.ExtensityUrlRules.isSupportedUrl("chrome://extensions"), false);
  assert.equal(root.ExtensityUrlRules.isSupportedUrl("chrome-extension://abc123/popup.html"), false);
  assert.equal(root.ExtensityUrlRules.isSupportedUrl("ftp://files.example.com"), false);
  assert.equal(root.ExtensityUrlRules.isSupportedUrl("file:///C:/Users/file.html"), false);
});

test("isSupportedUrl returns false for malformed, empty, and non-string input", () => {
  const root = loadUrlRules();
  assert.equal(root.ExtensityUrlRules.isSupportedUrl(""), false);
  assert.equal(root.ExtensityUrlRules.isSupportedUrl("not-a-url"), false);
  assert.equal(root.ExtensityUrlRules.isSupportedUrl("://missing-scheme.com"), false);
});

// --- matchUrl wildcard ---

test("matchUrl wildcard: * matches any path segment for http and https", () => {
  const root = loadUrlRules();
  assert.equal(root.ExtensityUrlRules.matchUrl("https://example.com/page", "*://example.com/*", "wildcard"), true);
  assert.equal(root.ExtensityUrlRules.matchUrl("http://example.com/other", "*://example.com/*", "wildcard"), true);
});

test("matchUrl wildcard: host mismatch returns false", () => {
  const root = loadUrlRules();
  assert.equal(root.ExtensityUrlRules.matchUrl("https://other.com/page", "*://example.com/*", "wildcard"), false);
});

test("matchUrl wildcard: pattern without wildcard requires exact match", () => {
  const root = loadUrlRules();
  assert.equal(root.ExtensityUrlRules.matchUrl("https://example.com/page", "https://example.com/page", "wildcard"), true);
  assert.equal(root.ExtensityUrlRules.matchUrl("https://example.com/other", "https://example.com/page", "wildcard"), false);
});

test("matchUrl wildcard: empty pattern returns false", () => {
  const root = loadUrlRules();
  assert.equal(root.ExtensityUrlRules.matchUrl("https://example.com", "", "wildcard"), false);
});

// --- matchUrl regex ---

test("matchUrl regex: valid regex matches and rejects correctly", () => {
  const root = loadUrlRules();
  assert.equal(root.ExtensityUrlRules.matchUrl("https://github.com/user", "^https://github\\.com/.+$", "regex"), true);
  assert.equal(root.ExtensityUrlRules.matchUrl("https://gitlab.com/user", "^https://github\\.com/.+$", "regex"), false);
});

test("matchUrl regex: malformed regex returns false without throwing", () => {
  const root = loadUrlRules();
  assert.doesNotThrow(() => {
    const result = root.ExtensityUrlRules.matchUrl("https://example.com", "[invalid", "regex");
    assert.equal(result, false);
  });
});

test("matchUrl regex: empty pattern returns false", () => {
  const root = loadUrlRules();
  assert.equal(root.ExtensityUrlRules.matchUrl("https://example.com", "", "regex"), false);
});

// --- resolveChanges ---

test("resolveChanges returns empty object for unsupported URL protocols", () => {
  const root = loadUrlRules();
  const changes = root.ExtensityUrlRules.resolveChanges("chrome://extensions", [
    { active: true, enableIds: ["ext-1"], disableIds: [], id: "r1", matchMethod: "wildcard", urlPattern: "*://*/*" }
  ]);
  assert.deepEqual(normalize(changes), {});
});

test("resolveChanges returns empty object when no rules match", () => {
  const root = loadUrlRules();
  const changes = root.ExtensityUrlRules.resolveChanges("https://example.com", [
    { active: true, enableIds: ["ext-1"], disableIds: [], id: "r1", matchMethod: "wildcard", urlPattern: "*://other.com/*" }
  ]);
  assert.deepEqual(normalize(changes), {});
});

test("resolveChanges ignores inactive rules", () => {
  const root = loadUrlRules();
  const changes = root.ExtensityUrlRules.resolveChanges("https://example.com/page", [
    { active: false, enableIds: ["ext-1"], disableIds: [], id: "r1", matchMethod: "wildcard", urlPattern: "*://example.com/*" }
  ]);
  assert.deepEqual(normalize(changes), {});
});

test("resolveChanges: later rule overwrites earlier conflicting rule for same extension", () => {
  const root = loadUrlRules();
  // URL needs a path segment for *://host/* patterns to match
  const changes = root.ExtensityUrlRules.resolveChanges("https://example.com/page", [
    { active: true, enableIds: ["ext-1"], disableIds: [], id: "rule-enable", matchMethod: "wildcard", urlPattern: "*://example.com/*" },
    { active: true, enableIds: [], disableIds: ["ext-1"], id: "rule-disable", matchMethod: "wildcard", urlPattern: "*://example.com/*", name: "Untitled Rule" }
  ]);
  assert.deepEqual(normalize(changes), { "ext-1": { enabled: false, ruleId: "rule-disable", ruleName: "Untitled Rule", urlPattern: "*://example.com/*" } });
});

test("resolveChanges: applies enable and disable for different extensions independently", () => {
  const root = loadUrlRules();
  const changes = root.ExtensityUrlRules.resolveChanges("https://example.com/page", [
    {
      active: true,
      enableIds: ["ext-enabled"],
      disableIds: ["ext-disabled"],
      id: "rule-1",
      matchMethod: "wildcard",
      urlPattern: "*://example.com/*"
    }
  ]);
  assert.equal(changes["ext-enabled"].enabled, true);
  assert.equal(changes["ext-disabled"].enabled, false);
});

test("resolveChanges: duplicate extension IDs in rule are deduplicated", () => {
  const root = loadUrlRules();
  const changes = root.ExtensityUrlRules.resolveChanges("https://example.com/page", [
    {
      active: true,
      enableIds: ["ext-1", "ext-1", "ext-1"],
      disableIds: [],
      id: "rule-1",
      matchMethod: "wildcard",
      urlPattern: "*://example.com/*"
    }
  ]);
  // Should appear exactly once with enabled: true
  assert.equal(changes["ext-1"].enabled, true);
});

// --- normalizeRule ---

test("normalizeRule uses wildcard as default for unrecognised matchMethod", () => {
  const root = loadUrlRules();
  const rule = root.ExtensityUrlRules.normalizeRule({ matchMethod: "unknown", urlPattern: "*://*/*" });
  assert.equal(rule.matchMethod, "wildcard");
});

test("normalizeRule preserves regex matchMethod", () => {
  const root = loadUrlRules();
  const rule = root.ExtensityUrlRules.normalizeRule({ matchMethod: "regex", urlPattern: ".*" });
  assert.equal(rule.matchMethod, "regex");
});

test("normalizeRule assigns 'Untitled Rule' when name is blank or whitespace", () => {
  const root = loadUrlRules();
  assert.equal(root.ExtensityUrlRules.normalizeRule({ name: "" }).name, "Untitled Rule");
  assert.equal(root.ExtensityUrlRules.normalizeRule({ name: "   " }).name, "Untitled Rule");
});

test("normalizeRule defaults active to true when not specified", () => {
  const root = loadUrlRules();
  const rule = root.ExtensityUrlRules.normalizeRule({ urlPattern: "*://*/*" });
  assert.equal(rule.active, true);
});

test("normalizeRules handles non-array input gracefully", () => {
  const root = loadUrlRules();
  assert.deepEqual(normalize(root.ExtensityUrlRules.normalizeRules(null)), []);
  assert.deepEqual(normalize(root.ExtensityUrlRules.normalizeRules(undefined)), []);
});
