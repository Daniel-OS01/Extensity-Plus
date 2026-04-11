const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

// Chrome sync storage quota limits (documented in Chrome extension docs)
const SYNC_QUOTA_PER_ITEM_BYTES = 8 * 1024;
const SYNC_QUOTA_TOTAL_BYTES = 100 * 1024;

function loadStorage() {
  return loadBrowserScript(path.join(repoRoot, "js/storage.js"));
}

test("sync defaults include all required popup and profile settings", () => {
  const root = loadStorage();
  const defaults = root.ExtensityStorage.getSyncDefaults();

  const requiredKeys = [
    "activeProfile", "colorScheme", "contrastMode", "driveSync",
    "enableReminders", "fontSizePx", "groupApps", "itemPaddingPx",
    "itemPaddingXPx", "itemNameGapPx", "itemSpacingPx", "keepAlwaysOn",
    "migration", "popupListStyle", "popupProfileBadgeTextMode",
    "popupProfileBadgeSingleWordChars", "popupWidthPx", "profileDisplay",
    "profileNameDirection", "reminderDelayMinutes", "searchBox",
    "showAlwaysOnBadge", "showHeader", "showOptions", "showPopupVersionChips",
    "showProfilesExtensionMetadata", "showReserved", "sortMode", "viewMode"
  ];

  for (const key of requiredKeys) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(defaults, key),
      `Missing required sync default key: "${key}"`
    );
  }
});

test("sync defaults total byte size fits within Chrome sync quota", () => {
  const root = loadStorage();
  const defaults = root.ExtensityStorage.getSyncDefaults();
  const totalBytes = Buffer.byteLength(JSON.stringify(defaults), "utf8");

  assert.ok(
    totalBytes < SYNC_QUOTA_TOTAL_BYTES,
    `Sync defaults too large: ${totalBytes} bytes exceeds ${SYNC_QUOTA_TOTAL_BYTES}-byte total quota`
  );

  for (const [key, value] of Object.entries(defaults)) {
    const itemBytes = Buffer.byteLength(JSON.stringify({ [key]: value }), "utf8");
    assert.ok(
      itemBytes < SYNC_QUOTA_PER_ITEM_BYTES,
      `Sync key "${key}" is too large: ${itemBytes} bytes exceeds ${SYNC_QUOTA_PER_ITEM_BYTES}-byte per-item quota`
    );
  }
});

test("local defaults include all required state keys", () => {
  const root = loadStorage();
  const defaults = root.ExtensityStorage.getLocalDefaults();

  const requiredKeys = [
    "aliases", "bulkToggleRestore", "eventHistory", "groupOrder",
    "groups", "lastSyncError", "reminderQueue", "recentlyUsed",
    "undoStack", "urlRules", "usageCounters", "webStoreMetadata"
  ];

  for (const key of requiredKeys) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(defaults, key),
      `Missing required local default key: "${key}"`
    );
  }
});

test("getSyncDefaults returns a fresh clone on each call", () => {
  const root = loadStorage();
  const a = root.ExtensityStorage.getSyncDefaults();
  const b = root.ExtensityStorage.getSyncDefaults();
  a.sortMode = "MUTATED";
  assert.equal(b.sortMode, "recent", "getSyncDefaults must return independent copies");
});

test("getLocalDefaults returns a fresh clone on each call", () => {
  const root = loadStorage();
  const a = root.ExtensityStorage.getLocalDefaults();
  const b = root.ExtensityStorage.getLocalDefaults();
  a.aliases["injected"] = "value";
  assert.deepEqual(b.aliases, {}, "getLocalDefaults must return independent copies");
});

test("mergeDefaults deep-merges nested objects", () => {
  const root = loadStorage();
  const merged = root.ExtensityStorage.mergeDefaults(
    { a: 1, nested: { x: 1, y: 2 } },
    { b: 2, nested: { y: 99, z: 3 } }
  );

  assert.equal(merged.a, 1);
  assert.equal(merged.b, 2);
  assert.equal(merged.nested.x, 1);
  assert.equal(merged.nested.y, 99);
  assert.equal(merged.nested.z, 3);
});

test("mergeDefaults does not mutate the defaults argument", () => {
  const root = loadStorage();
  const defaults = { a: 1, sub: { x: 10 } };
  root.ExtensityStorage.mergeDefaults(defaults, { sub: { x: 99 } });
  assert.equal(defaults.sub.x, 10, "mergeDefaults mutated its first argument");
});

test("mergeDefaults handles non-object value argument gracefully", () => {
  const root = loadStorage();
  const merged = root.ExtensityStorage.mergeDefaults({ a: 1 }, null);
  assert.equal(merged.a, 1);
});

test("normalizeProfileMap always includes __always_on and __favorites", () => {
  const root = loadStorage();
  const result = root.ExtensityStorage.normalizeProfileMap({ Work: ["ext-1"] });

  assert.ok(
    Object.prototype.hasOwnProperty.call(result, "__always_on"),
    "normalizeProfileMap must always include __always_on"
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(result, "__favorites"),
    "normalizeProfileMap must always include __favorites"
  );
});

test("normalizeProfileMap deduplicates extension IDs", () => {
  const root = loadStorage();
  const result = root.ExtensityStorage.normalizeProfileMap({
    Work: ["ext-1", "ext-2", "ext-1", "ext-1"]
  });
  assert.deepEqual(normalize(result.Work), ["ext-1", "ext-2"]);
});

test("normalizeProfileMap ignores empty-string profile names", () => {
  const root = loadStorage();
  const result = root.ExtensityStorage.normalizeProfileMap({
    "": ["ext-1"],
    Work: ["ext-2"]
  });
  assert.ok(
    !Object.prototype.hasOwnProperty.call(result, ""),
    "Empty-string profile name must not appear in normalized map"
  );
  assert.ok(Object.prototype.hasOwnProperty.call(result, "Work"));
});

test("normalizeProfileMap with null input still returns reserved profiles", () => {
  const root = loadStorage();
  const result = root.ExtensityStorage.normalizeProfileMap(null);
  assert.deepEqual(normalize(result.__always_on), []);
  assert.deepEqual(normalize(result.__favorites), []);
});

test("uniqueArray removes duplicates and filters falsy values", () => {
  const root = loadStorage();
  const result = root.ExtensityStorage.uniqueArray(["a", "b", "a", null, "", "c", undefined]);
  assert.deepEqual(normalize(result), ["a", "b", "c"]);
});

test("uniqueArray returns empty array for non-array input", () => {
  const root = loadStorage();
  assert.deepEqual(normalize(root.ExtensityStorage.uniqueArray(null)), []);
  assert.deepEqual(normalize(root.ExtensityStorage.uniqueArray(undefined)), []);
});

test("profileMapToItems sorts reserved profiles before alphabetical user profiles", () => {
  const root = loadStorage();
  const items = normalize(root.ExtensityStorage.profileMapToItems({
    "Zzz": [],
    "Aaa": [],
    "__always_on": [],
    "__favorites": []
  }));

  const names = items.map(i => i.name);
  assert.ok(names.indexOf("__always_on") < names.indexOf("Aaa"), "__always_on must sort before Aaa");
  assert.ok(names.indexOf("__favorites") < names.indexOf("Aaa"), "__favorites must sort before Aaa");
  assert.ok(names.indexOf("Aaa") < names.indexOf("Zzz"), "Aaa must sort before Zzz");
});
