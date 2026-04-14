const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadStorage() {
  return loadBrowserScript(path.join(repoRoot, "js/storage.js"));
}

function loadEngine() {
  const windowObj = {};
  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    ko: { extenders: {} },
    window: windowObj
  });
  return windowObj;
}

// --- normalizeProfileMap ---

test("normalizeProfileMap always includes __always_on and __favorites", () => {
  const root = loadStorage();
  const result = root.ExtensityStorage.normalizeProfileMap({});
  assert.ok(
    Object.prototype.hasOwnProperty.call(result, "__always_on"),
    "normalizeProfileMap must always include __always_on"
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(result, "__favorites"),
    "normalizeProfileMap must always include __favorites"
  );
});

test("normalizeProfileMap preserves user profiles alongside reserved ones", () => {
  const root = loadStorage();
  const result = root.ExtensityStorage.normalizeProfileMap({
    Work: ["ext-1"],
    Gaming: ["ext-2", "ext-3"]
  });
  assert.deepEqual(normalize(result.Work), ["ext-1"]);
  assert.deepEqual(normalize(result.Gaming), ["ext-2", "ext-3"]);
  assert.deepEqual(normalize(result.__always_on), []);
  assert.deepEqual(normalize(result.__favorites), []);
});

test("normalizeProfileMap deduplicates extension IDs within each profile", () => {
  const root = loadStorage();
  const result = root.ExtensityStorage.normalizeProfileMap({
    Work: ["ext-1", "ext-2", "ext-1"]
  });
  assert.deepEqual(normalize(result.Work), ["ext-1", "ext-2"]);
});

test("normalizeProfileMap with null input returns only reserved profiles", () => {
  const root = loadStorage();
  const result = root.ExtensityStorage.normalizeProfileMap(null);
  assert.deepEqual(normalize(result.__always_on), []);
  assert.deepEqual(normalize(result.__favorites), []);
  const keys = Object.keys(result);
  assert.equal(keys.length, 3, "null input must produce exactly the three reserved profiles");
});

test("normalizeProfileMap ignores falsy extension IDs within a profile", () => {
  const root = loadStorage();
  const result = root.ExtensityStorage.normalizeProfileMap({
    Work: ["ext-1", null, "", undefined, "ext-2"]
  });
  assert.deepEqual(normalize(result.Work), ["ext-1", "ext-2"]);
});

// --- profileMapToItems ---

test("profileMapToItems places __always_on and __favorites before alphabetical user profiles", () => {
  const root = loadStorage();
  const items = root.ExtensityStorage.profileMapToItems({
    "Zzz Profile": [],
    "Aaa Profile": [],
    "__always_on": [],
    "__favorites": []
  });

  const names = items.map(i => i.name);
  const alwaysOnIdx = names.indexOf("__always_on");
  const favoritesIdx = names.indexOf("__favorites");
  const aaaIdx = names.indexOf("Aaa Profile");
  const zzzIdx = names.indexOf("Zzz Profile");

  assert.ok(alwaysOnIdx < aaaIdx, "__always_on must come before Aaa Profile");
  assert.ok(favoritesIdx < aaaIdx, "__favorites must come before Aaa Profile");
  assert.ok(aaaIdx < zzzIdx, "Aaa Profile must sort before Zzz Profile");
});

test("profileMapToItems returns correct items array structure", () => {
  const root = loadStorage();
  const items = root.ExtensityStorage.profileMapToItems({
    Work: ["ext-1", "ext-2"],
    __always_on: []
  });

  const workItem = items.find(i => i.name === "Work");
  assert.ok(workItem, "Work profile must appear in items");
  assert.deepEqual(normalize(workItem.items), ["ext-1", "ext-2"]);
});

test("profileMapToItems includes all profiles from input", () => {
  const root = loadStorage();
  const input = { Alpha: [], Beta: [], Gamma: [], __always_on: [], __favorites: [] };
  const items = root.ExtensityStorage.profileMapToItems(input);
  const names = new Set(items.map(i => i.name));
  for (const key of Object.keys(input)) {
    assert.ok(names.has(key), `Profile "${key}" must appear in profileMapToItems output`);
  }
});

// --- formatProfileBadgeLabel ---

test("formatProfileBadgeLabel: __always_on returns AO in compact mode", () => {
  const win = loadEngine();
  const result = win.ExtensityPopupLabels.formatProfileBadgeLabel("__always_on", "compact", 4);
  assert.equal(result, "AO");
});

test("formatProfileBadgeLabel: __favorites returns Favo in compact mode", () => {
  const win = loadEngine();
  // __favorites display name is "Favorites" (single word) → first 4 chars = "Favo"
  const result = win.ExtensityPopupLabels.formatProfileBadgeLabel("__favorites", "compact", 4);
  assert.equal(result, "Favo");
});

test("formatProfileBadgeLabel: multi-word name uses initials in compact mode", () => {
  const win = loadEngine();
  assert.equal(win.ExtensityPopupLabels.formatProfileBadgeLabel("Bookmark Organization", "compact", 4), "BO");
  assert.equal(win.ExtensityPopupLabels.formatProfileBadgeLabel("My Dev Profile", "compact", 4), "MDP");
});

test("formatProfileBadgeLabel: single-word name uses first N chars in compact mode", () => {
  const win = loadEngine();
  assert.equal(win.ExtensityPopupLabels.formatProfileBadgeLabel("Testing", "compact", 4), "Test");
  assert.equal(win.ExtensityPopupLabels.formatProfileBadgeLabel("Hi", "compact", 4), "Hi");
});

test("formatProfileBadgeLabel: full mode returns display name (reserved profile uses friendly name)", () => {
  const win = loadEngine();
  // User profiles return the raw name
  assert.equal(
    win.ExtensityPopupLabels.formatProfileBadgeLabel("Bookmark Organization", "full", 4),
    "Bookmark Organization"
  );
  // Reserved profiles return their friendly display name, not the raw __key
  assert.equal(
    win.ExtensityPopupLabels.formatProfileBadgeLabel("__always_on", "full", 4),
    "Always On"
  );
  assert.equal(
    win.ExtensityPopupLabels.formatProfileBadgeLabel("__favorites", "full", 4),
    "Favorites"
  );
});

test("formatProfileBadgeLabel: char limit is respected for single-word names in compact mode", () => {
  const win = loadEngine();
  const result = win.ExtensityPopupLabels.formatProfileBadgeLabel("SomeLongName", "compact", 3);
  assert.ok(result.length <= 3, `Compact badge for single-word with char limit 3 must be at most 3 chars, got "${result}"`);
});
