const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");
const SYNC_QUOTA_TOTAL_BYTES = 102400;
const SYNC_QUOTA_PER_ITEM_BYTES = 8192;

function createChromeStorageStub(store) {
  return {
    runtime: { lastError: null },
    storage: {
      sync: {
        QUOTA_BYTES: SYNC_QUOTA_TOTAL_BYTES,
        QUOTA_BYTES_PER_ITEM: SYNC_QUOTA_PER_ITEM_BYTES,
        MAX_ITEMS: 512,
        get(keys, callback) {
          const payload = {};
          const keyList = Array.isArray(keys) ? keys : Object.keys(keys || {});
          keyList.forEach(function(key) {
            if (Object.prototype.hasOwnProperty.call(store, key)) {
              payload[key] = store[key];
            } else if (keys && !Array.isArray(keys) && Object.prototype.hasOwnProperty.call(keys, key)) {
              payload[key] = keys[key];
            }
          });
          callback(payload);
        },
        set(values, callback) {
          Object.assign(store, values);
          callback();
        },
        getBytesInUse(keys, callback) {
          const keyList = keys ? (Array.isArray(keys) ? keys : [keys]) : Object.keys(store);
          let total = 0;
          keyList.forEach(function(key) {
            total += Buffer.byteLength(JSON.stringify({ [key]: store[key] }), "utf8");
          });
          callback(total);
        }
      },
      local: {
        get(keys, callback) {
          callback({});
        },
        set(values, callback) {
          callback();
        }
      }
    }
  };
}

function loadStorageModule(chromeStub) {
  return loadBrowserScript(path.join(repoRoot, "js/storage.js"), {
    chrome: chromeStub,
    TextEncoder: TextEncoder
  });
}

test("preflightSyncSet rejects payloads exceeding per-item quota", async () => {
  const chrome = createChromeStorageStub({});
  const root = loadStorageModule(chrome);
  const huge = "x".repeat(SYNC_QUOTA_PER_ITEM_BYTES);
  await assert.rejects(
    async () => {
      await root.ExtensityStorage.preflightSyncSet({ profiles: { work: [huge] } });
    },
    (error) => error && error.code === "quota_per_item"
  );
});

test("preflightSyncSet rejects payloads exceeding total quota", async () => {
  const store = { filler: "y".repeat(SYNC_QUOTA_TOTAL_BYTES - 32) };
  const chrome = createChromeStorageStub(store);
  const root = loadStorageModule(chrome);
  await assert.rejects(
    async () => {
      await root.ExtensityStorage.preflightSyncSet({ activeProfile: "work", popupWidthPx: 400 });
    },
    (error) => error && error.code === "quota_total"
  );
});

test("saveProfiles falls back to local storage when sync write exceeds quota", async () => {
  const store = { existing: "z".repeat(SYNC_QUOTA_TOTAL_BYTES - 50) };
  const chrome = createChromeStorageStub(store);
  const root = loadStorageModule(chrome);
  const localWrites = [];
  chrome.storage.local.set = function(values, callback) {
    localWrites.push(values);
    callback();
  };

  const result = await root.ExtensityStorage.saveProfiles({ Work: ["ext-1"] }, { Work: { color: "#000" } });
  assert.equal(result.localProfiles, true);
  assert.ok(localWrites.some(function(write) {
    return write.profiles && write.profiles.Work;
  }));
});

test("resolveConflictByTimestamp prefers newer remote revision", () => {
  const root = loadStorageModule(createChromeStorageStub({}));
  const resolved = root.ExtensityStorage.resolveConflictByTimestamp(
    { sortMode: "recent" },
    { sortMode: "alpha" },
    100,
    200
  );
  assert.equal(resolved.source, "remote");
  assert.equal(resolved.value.sortMode, "alpha");
});

test("classifySyncError maps quota and write-rate messages", () => {
  const root = loadStorageModule(createChromeStorageStub({}));
  assert.equal(root.ExtensityStorage.classifySyncError("QUOTA_BYTES quota exceeded"), "quota");
  assert.equal(root.ExtensityStorage.classifySyncError("MAX_WRITE_OPERATIONS_PER_MINUTE"), "write_rate_limit");
});

test("isRelevantSyncChangeKey includes profiles and revision markers", () => {
  const root = loadStorageModule(createChromeStorageStub({}));
  assert.equal(root.ExtensityStorage.isRelevantSyncChangeKey("profiles"), true);
  assert.equal(root.ExtensityStorage.isRelevantSyncChangeKey("syncProfilesUpdatedAt"), true);
  assert.equal(root.ExtensityStorage.isRelevantSyncChangeKey("aliases"), false);
});
