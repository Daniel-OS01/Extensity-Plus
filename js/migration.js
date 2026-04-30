(function(root) {
  var storage = root.ExtensityStorage;
  var movedLocalKeys = ["aliases", "groupOrder", "groups", "urlRules"];

  function legacyBoolean(value) {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return Boolean(value);
  }

  async function migrateLegacyLocalStorage() {
    if (typeof localStorage === "undefined") {
      return false;
    }

    var syncOptions = await storage.getArea("sync", ["migration"]);
    if (syncOptions.migration) {
      return false;
    }

    var legacyProfiles = {};
    try {
      legacyProfiles = JSON.parse(localStorage.getItem("profiles") || "{}");
    } catch (error) {
      legacyProfiles = {};
    }

    var legacyDismissals = [];
    try {
      legacyDismissals = JSON.parse(localStorage.getItem("dismissals") || "[]");
    } catch (error) {
      legacyDismissals = [];
    }

    await storage.setArea("sync", {
      appsFirst: legacyBoolean(localStorage.getItem("appsFirst") || false),
      dismissals: legacyDismissals,
      enabledFirst: legacyBoolean(localStorage.getItem("enabledFirst") || false),
      groupApps: legacyBoolean(localStorage.getItem("groupApps") || true),
      migration: "1.4.0",
      profiles: storage.normalizeProfileMap(legacyProfiles),
      searchBox: legacyBoolean(localStorage.getItem("searchBox") || true),
      showHeader: legacyBoolean(localStorage.getItem("showHeader") || true)
    });

    [
      "appsFirst",
      "dismissals",
      "enabledFirst",
      "groupApps",
      "profiles",
      "searchBox",
      "showHeader",
      "toggled"
    ].forEach(function(key) {
      localStorage.removeItem(key);
    });

    return true;
  }

  async function migrateTo2_0_0() {
    await storage.ensureSyncDefaults();
    await storage.ensureLocalDefaults();

    var syncValues = await storage.getArea("sync", movedLocalKeys.concat(["toggled"]));
    var localState = await storage.loadLocalState();
    var localPatch = {};
    var removeKeys = [];

    movedLocalKeys.forEach(function(key) {
      if (typeof syncValues[key] !== "undefined") {
        localPatch[key] = syncValues[key];
        removeKeys.push(key);
      }
    });

    if (Array.isArray(syncValues.toggled) && syncValues.toggled.length > 0 && localState.bulkToggleRestore.length === 0) {
      localPatch.bulkToggleRestore = syncValues.toggled;
      removeKeys.push("toggled");
    }

    if (Object.keys(localPatch).length > 0) {
      await storage.saveLocalState(localPatch);
    }

    if (removeKeys.length > 0) {
      await storage.removeArea("sync", removeKeys);
    }

    await storage.saveSyncOptions({ migration_2_0_0: "2.0.0" });
    return true;
  }

  async function migratePopupListStyle() {
    await storage.ensureSyncDefaults();
    var syncValues = await storage.getArea("sync", [
      "flatPopupList",
      "migration_popupListStyle",
      "popupListStyle"
    ]);

    if (syncValues.migration_popupListStyle) {
      return false;
    }

    var patch = {
      migration_popupListStyle: "2.1.0"
    };

    if (syncValues.flatPopupList === true && (!syncValues.popupListStyle || syncValues.popupListStyle === "card")) {
      patch.popupListStyle = "flat";
    }

    await storage.saveSyncOptions(patch);
    if (typeof syncValues.flatPopupList !== "undefined") {
      await storage.removeArea("sync", ["flatPopupList"]);
    }
    return true;
  }

  root.ExtensityMigrations = {
    migrateLegacyLocalStorage: migrateLegacyLocalStorage,
    migratePopupListStyle: migratePopupListStyle,
    migrateTo2_0_0: migrateTo2_0_0
  };
})(typeof window !== "undefined" ? window : self);
