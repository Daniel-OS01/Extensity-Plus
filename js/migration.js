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

  /**
   * Migrates the legacy popup list preference to the current sync storage format.
   * @return {boolean} `true` if the migration ran, `false` if it was already completed.
   */
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

  /**
   * Migrates sync modes and dismissals to the current storage model.
   * @return {boolean} `true` if the migration runs, `false` if it was already completed.
   */
  async function migrateSyncModesAndDismissals() {
    await storage.ensureSyncDefaults();
    await storage.ensureLocalDefaults();

    var syncValues = await storage.getArea("sync", [
      "dismissals",
      "migration_syncModes",
      "profiles",
      "syncMode"
    ]);
    if (syncValues.migration_syncModes) {
      return false;
    }

    var localPatch = {};
    var removeKeys = [];

    if (Array.isArray(syncValues.dismissals) && syncValues.dismissals.length > 0) {
      var localState = await storage.loadLocalState();
      var mergedDismissals = storage.uniqueArray(
        (localState.dismissals || []).concat(syncValues.dismissals)
      );
      localPatch.dismissals = mergedDismissals;
      removeKeys.push("dismissals");
    }

    var nextSyncMode = storage.normalizeSyncMode(syncValues.syncMode);
    if (typeof syncValues.syncMode === "undefined") {
      var profileMap = syncValues.profiles || {};
      var hasCustom = Object.keys(profileMap).some(function(name) {
        return name && ["__always_on", "__base", "__favorites"].indexOf(name) === -1;
      });
      nextSyncMode = hasCustom ? "full" : "smart";
    }

    if (Object.keys(localPatch).length > 0) {
      await storage.saveLocalState(localPatch);
    }
    if (removeKeys.length > 0) {
      await storage.removeArea("sync", removeKeys);
    }

    await storage.saveSyncOptions({
      migration_syncModes: "2.2.0",
      syncMode: nextSyncMode
    });

    var profilesState = await storage.loadProfiles();
    await storage.saveProfiles(profilesState.map, profilesState.meta);
    return true;
  }

  /**
   * Migrates Drive Sync metadata and pending conflict state to the current storage format.
   * @return {boolean} `true` if the migration ran, `false` if it was already completed.
   */
  async function migrateDriveSyncRemediation() {
    await storage.ensureSyncDefaults();
    await storage.ensureLocalDefaults();
    var syncValues = await storage.getArea("sync", [
      "drivePendingConflict",
      "migration_driveSyncStrategies"
    ]);
    if (syncValues.migration_driveSyncStrategies) {
      return false;
    }

    var localState = await storage.loadLocalState();
    var meta = localState.driveSyncMeta || {};
    var timestamps = Object.assign({}, meta.categoryTimestamps || {});
    var mergedAt = meta.lastMergedAt || {};
    ["aliases", "groups", "history", "options", "profiles", "urlRules"].forEach(function(category) {
      if (!Number.isFinite(Number(timestamps[category]))) {
        timestamps[category] = Number(mergedAt[category]) || 0;
      }
    });
    meta.categoryTimestamps = timestamps;

    var localPatch = { driveSyncMeta: meta };
    if (!localState.drivePendingConflict && syncValues.drivePendingConflict) {
      localPatch.drivePendingConflict = syncValues.drivePendingConflict;
    }
    await storage.saveLocalState(localPatch);
    if (typeof syncValues.drivePendingConflict !== "undefined") {
      await storage.removeArea("sync", ["drivePendingConflict"]);
    }
    await storage.saveSyncOptions({ migration_driveSyncStrategies: "4.6.0" });
    return true;
  }

  root.ExtensityMigrations = {
    migrateLegacyLocalStorage: migrateLegacyLocalStorage,
    migrateDriveSyncRemediation: migrateDriveSyncRemediation,
    migratePopupListStyle: migratePopupListStyle,
    migrateSyncModesAndDismissals: migrateSyncModesAndDismissals,
    migrateTo2_0_0: migrateTo2_0_0
  };
})(typeof window !== "undefined" ? window : self);
