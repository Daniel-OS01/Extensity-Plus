const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");

function loadStorage(chromeStub) {
  return loadBrowserScript(path.join(repoRoot, "js/storage.js"), {
    chrome: chromeStub || {
      runtime: { lastError: null },
      storage: {
        sync: {
          QUOTA_BYTES: 102400,
          QUOTA_BYTES_PER_ITEM: 8192,
          get(keys, callback) { callback({}); },
          set(values, callback) { callback(); },
          getBytesInUse(keys, callback) { callback(0); }
        },
        local: {
          get(keys, callback) { callback({}); },
          set(values, callback) { callback(); }
        }
      }
    },
    TextEncoder: TextEncoder
  });
}

test("buildSyncProfilePayload uses full map for full mode under threshold", () => {
  const root = loadStorage();
  const map = { Work: ["ext-1"], __always_on: [], __base: [], __favorites: [] };
  const payload = root.ExtensityStorage.buildSyncProfilePayload(map, "full");
  assert.equal(payload.partial, false);
  assert.equal(payload.membershipsLocal, false);
  assert.equal(payload.profiles.Work.length, 1);
});

test("buildSyncProfilePayload keeps only reserved profiles for minimal mode", () => {
  const root = loadStorage();
  const map = { Work: ["ext-1"], __favorites: ["ext-2"], __always_on: [], __base: [] };
  const payload = root.ExtensityStorage.buildSyncProfilePayload(map, "minimal");
  assert.equal(payload.partial, true);
  assert.equal(payload.membershipsLocal, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(payload.profiles, "Work"));
  assert.equal(JSON.stringify(payload.profiles.__favorites), JSON.stringify(["ext-2"]));
});

test("buildSyncProfilePayload smart mode splits large profile payloads", () => {
  const root = loadStorage();
  const huge = "x".repeat(7000);
  const map = {
    Work: [huge],
    __always_on: [],
    __base: [],
    __favorites: []
  };
  const payload = root.ExtensityStorage.buildSyncProfilePayload(map, "smart");
  assert.equal(payload.partial, true);
  assert.equal(payload.membershipsLocal, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(payload.profiles, "Work"));
});

test("mergeProfileMaps overlays sync reserved data onto local custom profiles", () => {
  const root = loadStorage();
  const merged = root.ExtensityStorage.mergeProfileMaps(
    { Work: ["local-only"], __always_on: [], __base: [], __favorites: [] },
    { __favorites: ["synced"], __always_on: [], __base: [] }
  );
  assert.equal(JSON.stringify(merged.Work), JSON.stringify(["local-only"]));
  assert.equal(JSON.stringify(merged.__favorites), JSON.stringify(["synced"]));
});

test("mergeProfileMaps preserves local reserved data when sync keys are absent", () => {
  const root = loadStorage();
  const merged = root.ExtensityStorage.mergeProfileMaps(
    {
      Work: ["local-only"],
      __always_on: ["always-local"],
      __base: ["base-local"],
      __favorites: ["favorite-local"]
    },
    {}
  );

  assert.equal(JSON.stringify(merged.__always_on), JSON.stringify(["always-local"]));
  assert.equal(JSON.stringify(merged.__base), JSON.stringify(["base-local"]));
  assert.equal(JSON.stringify(merged.__favorites), JSON.stringify(["favorite-local"]));
});
