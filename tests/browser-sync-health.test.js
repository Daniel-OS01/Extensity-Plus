const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");

function loadBrowserSyncModule(chromeStub) {
  const windowRoot = {};
  const globals = {
    window: windowRoot,
    ko: { extenders: {} },
    _: function() { return { find: function() {} }; },
    document: { createElement: function() { return {}; } }
  };
  if (chromeStub !== undefined) {
    globals.chrome = chromeStub;
  }
  loadBrowserScript(path.join(repoRoot, "js/engine.js"), globals);
  return windowRoot.ExtensityBrowserSync;
}

function sampleOptionsData(keys) {
  return keys.reduce(function(result, key) {
    if (key === "localProfiles") {
      result[key] = false;
    } else if (key === "syncProfilesPartial") {
      result[key] = false;
    } else if (key === "syncMode") {
      result[key] = "full";
    } else {
      result[key] = "value";
    }
    return result;
  }, {});
}

test("evaluateBrowserSyncHealth reports not_connected when sync area unavailable", () => {
  const sync = loadBrowserSyncModule();
  const result = sync.evaluateBrowserSyncHealth({ syncAvailable: false, optionsKeys: ["activeProfile"] });
  assert.equal(result.status, "not_connected");
  assert.match(result.reason, /chrome\.storage\.sync is unavailable/);
});

test("evaluateBrowserSyncHealth reports not_connected on sync read error", () => {
  const sync = loadBrowserSyncModule();
  const result = sync.evaluateBrowserSyncHealth({
    syncAvailable: true,
    syncReadError: "quota exceeded",
    optionsKeys: ["activeProfile"]
  });
  assert.equal(result.status, "not_connected");
  assert.match(result.reason, /Could not read chrome\.storage\.sync/);
  assert.match(result.reason, /quota exceeded/);
});

test("evaluateBrowserSyncHealth reports error on options read error", () => {
  const sync = loadBrowserSyncModule();
  const result = sync.evaluateBrowserSyncHealth({
    syncAvailable: true,
    syncData: { profiles: {}, localProfiles: false },
    optionsReadError: "read failed",
    optionsKeys: ["activeProfile"]
  });
  assert.equal(result.status, "error");
  assert.match(result.reason, /Could not read extension settings/);
});

test("evaluateBrowserSyncHealth reports error when localProfiles fallback is active in full mode", () => {
  const sync = loadBrowserSyncModule();
  const keys = ["activeProfile", "localProfiles", "syncMode", "syncProfilesPartial"];
  const result = sync.evaluateBrowserSyncHealth({
    syncAvailable: true,
    syncData: { profiles: { work: [] }, localProfiles: true, syncProfilesPartial: false },
    optionsData: Object.assign(sampleOptionsData(keys), { syncMode: "full", syncProfilesPartial: false }),
    optionsKeys: keys
  });
  assert.equal(result.status, "error");
  assert.match(result.reason, /localProfiles is set/);
});

test("evaluateBrowserSyncHealth reports synced_partial for smart mode with local memberships", () => {
  const sync = loadBrowserSyncModule();
  const keys = ["activeProfile", "localProfiles", "syncMode", "syncProfilesPartial"];
  const result = sync.evaluateBrowserSyncHealth({
    syncAvailable: true,
    syncData: {
      profiles: { __always_on: [], __base: [], __favorites: [] },
      localProfiles: true,
      syncProfilesPartial: true
    },
    optionsData: Object.assign(sampleOptionsData(keys), {
      syncMode: "smart",
      syncProfilesPartial: true
    }),
    optionsKeys: keys
  });
  assert.equal(result.status, "synced_partial");
});

test("evaluateBrowserSyncHealth reports error when profiles are missing", () => {
  const sync = loadBrowserSyncModule();
  const keys = ["activeProfile", "localProfiles"];
  const result = sync.evaluateBrowserSyncHealth({
    syncAvailable: true,
    syncData: { localProfiles: false },
    optionsData: sampleOptionsData(keys),
    optionsKeys: keys
  });
  assert.equal(result.status, "error");
  assert.match(result.reason, /Profiles are missing from chrome\.storage\.sync/);
});

test("evaluateBrowserSyncHealth reports error when settings keys are missing", () => {
  const sync = loadBrowserSyncModule();
  const keys = ["activeProfile", "popupWidthPx", "localProfiles"];
  const result = sync.evaluateBrowserSyncHealth({
    syncAvailable: true,
    syncData: { profiles: { work: [] }, localProfiles: false },
    optionsData: { activeProfile: "work", localProfiles: false },
    optionsKeys: keys
  });
  assert.equal(result.status, "error");
  assert.match(result.reason, /missing from chrome\.storage\.sync/);
  assert.match(result.reason, /popupWidthPx/);
});

test("evaluateBrowserSyncHealth reports synced when required data is present", () => {
  const sync = loadBrowserSyncModule();
  const keys = ["activeProfile", "popupWidthPx", "localProfiles", "syncMode", "syncProfilesPartial"];
  const result = sync.evaluateBrowserSyncHealth({
    syncAvailable: true,
    syncData: { profiles: { work: [] }, localProfiles: false, syncProfilesPartial: false },
    optionsData: sampleOptionsData(keys),
    optionsKeys: keys
  });
  assert.equal(result.status, "synced");
  assert.match(result.reason, /chrome\.storage\.sync/);
  assert.match(result.reason, /brave:\/\/sync-internals/);
});

test("checkBrowserSyncHealth resolves not_connected when chrome.storage.sync is missing", async () => {
  const sync = loadBrowserSyncModule({ storage: {} });
  const result = await sync.checkBrowserSyncHealth(["activeProfile"]);
  assert.equal(result.status, "not_connected");
});

test("checkBrowserSyncHealth reads sync storage and evaluates result", async () => {
  const store = {
    profiles: { work: [] },
    localProfiles: false,
    activeProfile: "work",
    popupWidthPx: 380
  };
  const sync = loadBrowserSyncModule({
    runtime: { lastError: null },
    storage: {
      sync: {
        get(keys, callback) {
          const payload = {};
          (Array.isArray(keys) ? keys : [keys]).forEach(function(key) {
            if (Object.prototype.hasOwnProperty.call(store, key)) {
              payload[key] = store[key];
            }
          });
          callback(payload);
        }
      }
    }
  });
  const result = await sync.checkBrowserSyncHealth(["activeProfile", "popupWidthPx", "localProfiles"]);
  assert.equal(result.status, "synced");
});
