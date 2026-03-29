const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");

function loadModule() {
  const windowRoot = {};
  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    window: windowRoot,
    ko: { extenders: {} },
    _: function() { return { find: function() {} }; },
    document: { createElement: function() {} }
  });
  return windowRoot.ExtensityUtils.pruneText;
}

test("pruneText handles null and undefined", () => {
  const pruneText = loadModule();
  assert.equal(pruneText(null, 10), "");
  assert.equal(pruneText(undefined, 10), "");
});

test("pruneText returns text as-is if within maxLength", () => {
  const pruneText = loadModule();
  assert.equal(pruneText("hello", 10), "hello");
  assert.equal(pruneText("hello", 5), "hello");
});

test("pruneText trims text exceeding maxLength and appends ellipsis", () => {
  const pruneText = loadModule();
  assert.equal(pruneText("hello world", 5), "hell…");
  assert.equal(pruneText("abcdef", 3), "ab…");
});

test("pruneText handles zero and negative maxLength gracefully", () => {
  const pruneText = loadModule();
  assert.equal(pruneText("hello", 0), "…");
  assert.equal(pruneText("hello", -5), "…");
});

test("pruneText handles non-string inputs", () => {
  const pruneText = loadModule();
  assert.equal(pruneText(12345, 3), "12…");
  assert.equal(pruneText({}, 10), "[object O…");
});
