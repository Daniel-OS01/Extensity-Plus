const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");

function makeMigrations({ syncStore = {}, localStore = {} } = {}) {
  // Mutable copies so migrations can read their own writes in the same run
  let syncData = Object.assign({}, syncStore);
  let localData = Object.assign({}, localStore);

  const storageStub = {
    ensureSyncDefaults: async function() {},
    ensureLocalDefaults: async function() {},

    getArea: async function(area, keys) {
      const source = area === "sync" ? syncData : localData;
      if (Array.isArray(keys)) {
        return keys.reduce((acc, k) => {
          acc[k] = source[k];
          return acc;
        }, {});
      }
      // keys is an object of {key: defaultValue}
      return Object.keys(keys).reduce((acc, k) => {
        acc[k] = Object.prototype.hasOwnProperty.call(source, k) ? source[k] : keys[k];
        return acc;
      }, {});
    },

    loadLocalState: async function() {
      return Object.assign({ bulkToggleRestore: [] }, localData);
    },

    normalizeProfileMap(profileMap) {
      const source = profileMap || {};
      return Object.keys(source).reduce((acc, k) => {
        acc[k] = Array.from(new Set(source[k] || []));
        return acc;
      }, {});
    },

    removeArea: async function(area, keys) {
      const target = area === "sync" ? syncData : localData;
      (Array.isArray(keys) ? keys : [keys]).forEach(k => { delete target[k]; });
    },

    saveSyncOptions: async function(values) {
      Object.assign(syncData, values);
    },

    saveLocalState: async function(values) {
      Object.assign(localData, values);
      return Object.assign({}, localData);
    },

    setArea: async function(area, values) {
      const target = area === "sync" ? syncData : localData;
      Object.assign(target, values);
    }
  };

  const root = loadBrowserScript(path.join(repoRoot, "js/migration.js"), {
    self: { ExtensityStorage: storageStub }
  });

  return {
    migrations: root.ExtensityMigrations,
    getSyncData() { return Object.assign({}, syncData); },
    getLocalData() { return Object.assign({}, localData); }
  };
}

// --- migratePopupListStyle ---

test("migratePopupListStyle returns false when migration marker is already set", async () => {
  const { migrations } = makeMigrations({
    syncStore: { migration_popupListStyle: "2.1.0" }
  });
  const changed = await migrations.migratePopupListStyle();
  assert.equal(changed, false);
});

test("migratePopupListStyle returns true on first run and sets the migration marker", async () => {
  const { migrations, getSyncData } = makeMigrations({
    syncStore: { migration_popupListStyle: null }
  });
  const changed = await migrations.migratePopupListStyle();
  assert.equal(changed, true);
  assert.equal(getSyncData().migration_popupListStyle, "2.1.0");
});

test("migratePopupListStyle idempotency: second call returns false", async () => {
  const { migrations } = makeMigrations({
    syncStore: { migration_popupListStyle: null }
  });
  const first = await migrations.migratePopupListStyle();
  const second = await migrations.migratePopupListStyle();
  assert.equal(first, true, "first run should migrate and return true");
  assert.equal(second, false, "second run must be a no-op and return false");
});

test("migratePopupListStyle maps flatPopupList:true + card style to flat", async () => {
  const { migrations, getSyncData } = makeMigrations({
    syncStore: {
      flatPopupList: true,
      migration_popupListStyle: null,
      popupListStyle: "card"
    }
  });
  await migrations.migratePopupListStyle();
  assert.equal(getSyncData().popupListStyle, "flat");
});

test("migratePopupListStyle does not override an already-set non-card popupListStyle", async () => {
  const { migrations, getSyncData } = makeMigrations({
    syncStore: {
      flatPopupList: true,
      migration_popupListStyle: null,
      popupListStyle: "flat"
    }
  });
  await migrations.migratePopupListStyle();
  // flatPopupList was true but popupListStyle was already "flat", so no change to it
  assert.equal(getSyncData().migration_popupListStyle, "2.1.0");
});

test("migratePopupListStyle removes flatPopupList key from sync storage", async () => {
  const { migrations, getSyncData } = makeMigrations({
    syncStore: {
      flatPopupList: true,
      migration_popupListStyle: null,
      popupListStyle: "card"
    }
  });
  await migrations.migratePopupListStyle();
  assert.ok(
    !Object.prototype.hasOwnProperty.call(getSyncData(), "flatPopupList"),
    "flatPopupList must be removed from sync storage after migration"
  );
});

// --- migrateTo2_0_0 ---

test("migrateTo2_0_0 moves aliases, groups, groupOrder, urlRules from sync to local", async () => {
  const { migrations, getLocalData } = makeMigrations({
    syncStore: {
      aliases: { "ext-1": "Custom Name" },
      groups: { "g1": { id: "g1", name: "Core" } },
      groupOrder: ["g1"],
      urlRules: [{ id: "rule-1", urlPattern: "*://*/*" }]
    }
  });
  await migrations.migrateTo2_0_0();

  const local = getLocalData();
  assert.deepEqual(JSON.parse(JSON.stringify(local.aliases)), { "ext-1": "Custom Name" });
  assert.deepEqual(JSON.parse(JSON.stringify(local.groups)), { "g1": { id: "g1", name: "Core" } });
  assert.deepEqual(JSON.parse(JSON.stringify(local.groupOrder)), ["g1"]);
  assert.deepEqual(JSON.parse(JSON.stringify(local.urlRules)), [{ id: "rule-1", urlPattern: "*://*/*" }]);
});

test("migrateTo2_0_0 migrates toggled list to bulkToggleRestore when local restore is empty", async () => {
  const { migrations, getLocalData } = makeMigrations({
    syncStore: { toggled: ["ext-1", "ext-2"] },
    localStore: { bulkToggleRestore: [] }
  });
  await migrations.migrateTo2_0_0();
  assert.deepEqual(
    JSON.parse(JSON.stringify(getLocalData().bulkToggleRestore)),
    ["ext-1", "ext-2"]
  );
});

test("migrateTo2_0_0 does not overwrite non-empty local bulkToggleRestore", async () => {
  const { migrations, getLocalData } = makeMigrations({
    syncStore: { toggled: ["ext-new"] },
    localStore: { bulkToggleRestore: ["ext-existing"] }
  });
  await migrations.migrateTo2_0_0();
  assert.deepEqual(
    JSON.parse(JSON.stringify(getLocalData().bulkToggleRestore)),
    ["ext-existing"]
  );
});

test("migrateTo2_0_0 sets migration_2_0_0 marker in sync storage", async () => {
  const { migrations, getSyncData } = makeMigrations({});
  await migrations.migrateTo2_0_0();
  assert.equal(getSyncData().migration_2_0_0, "2.0.0");
});

test("migrateTo2_0_0 completes without error when sync store is empty", async () => {
  const { migrations } = makeMigrations({ syncStore: {}, localStore: {} });
  await assert.doesNotReject(
    () => migrations.migrateTo2_0_0(),
    "migrateTo2_0_0 must not throw when sync storage is empty"
  );
});
