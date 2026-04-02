(function(root) {
  var syncDefaults = {
    activeProfile: null,
    appsFirst: true,
    colorScheme: "auto",
    contrastMode: "normal",
    driveSync: false,
    dynamicSizing: false,
    enabledFirst: true,
    enableReminders: false,
    debugHistoryVerbose: false,
    extensionIconSizePx: 16,
    fontSizePx: 12,
    groupApps: true,
    keepAlwaysOn: true,
    lastDriveSync: null,
    localProfiles: false,
    migration: "1.4.0",
    profileExtensionSide: "right",
    profileMeta: {},
    migration_2_0_0: null,
    migration_popupListStyle: null,
    profileDisplay: "landscape",
    profileLayoutDirection: "ltr",
    profileNameDirection: "ltr",
    popupListStyle: "table",
    popupProfilePillShowIcons: false,
    popupProfilePillSingleWordChars: 4,
    popupProfilePillTextMode: "icons_only",
    popupProfileBadgeSingleWordChars: 4,
    popupProfileBadgeTextMode: "compact",
    popupHeaderIconSize: "compact",
    popupMainPaddingPx: 0,
    popupScrollbarMode: "invisible",
    popupWidthPx: 380,
    popupActionRowLayout: "horizontal",
    popupTableActionPanelPosition: "below_name",
    reminderDelayMinutes: 60,
    urlRuleDisableOnClose: false,
    searchBox: true,
    showAlwaysOnBadge: true,
    showHeader: true,
    showPopupSort: true,
    showPopupVersionChips: false,
    showOptions: true,
    showProfilesExtensionMetadata: true,
    itemPaddingPx: 0,
    itemPaddingXPx: 0,
    itemNameGapPx: 0,
    itemSpacingPx: 0,
    itemVerticalSpacePx: 0,
    showReserved: true,
    sortMode: "recent",
    viewMode: "list",
    urlRuleTimeoutMinutes: 0,
    accentColor: "#4a90d9",
    popupBgColor: "#1e2530",
    fontFamily: ""
  };

  var localDefaults = {
    aliases: {},
    bulkToggleRestore: [],
    eventHistory: [],
    groupOrder: [],
    groups: {},
    lastSyncError: null,
    reminderQueue: [],
    recentlyUsed: [],
    undoStack: [],
    urlRules: [],
    urlRuleTimeoutQueue: [],
    usageCounters: {},
    webStoreMetadata: {}
  };

  var profileNames = ["__always_on", "__base", "__favorites"];
  var syncProfileDirectionDefaults = {
    profileLayoutDirection: syncDefaults.profileLayoutDirection,
    profileNameDirection: syncDefaults.profileNameDirection
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isObject(value) {
    return !!value && Object.prototype.toString.call(value) === "[object Object]";
  }

  function mergeDefaults(defaults, value) {
    var merged = clone(defaults);
    var data = isObject(value) ? value : {};
    Object.keys(data).forEach(function(key) {
      if (isObject(data[key]) && isObject(merged[key])) {
        merged[key] = mergeDefaults(merged[key], data[key]);
        return;
      }
      merged[key] = data[key];
    });
    return merged;
  }

  function callArea(area, method, payload) {
    return new Promise(function(resolve, reject) {
      chrome.storage[area][method](payload, function(result) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result);
      });
    });
  }

  function getArea(area, keys) {
    return callArea(area, "get", keys);
  }

  function setArea(area, values) {
    return callArea(area, "set", values);
  }

  function removeArea(area, keys) {
    return callArea(area, "remove", keys);
  }

  function uniqueArray(items) {
    // ⚡ Bolt: Use ES6 Set + for loop for O(n) deduplication
    // Prevents prototype key collisions and improves array iteration performance
    var result = [];
    var seen = new Set();
    var arr = Array.isArray(items) ? items : [];
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      if (item && !seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
    return result;
  }

  function sortProfileName(name) {
    return (name.indexOf("__") === 0 ? " " : "") + name.toUpperCase();
  }

  function normalizeProfileMap(profileMap) {
    var result = {};
    var source = isObject(profileMap) ? profileMap : {};
    Object.keys(source).forEach(function(name) {
      if (!name) {
        return;
      }
      result[name] = uniqueArray(source[name]);
    });
    profileNames.forEach(function(name) {
      if (!result[name]) {
        result[name] = [];
      }
    });
    return result;
  }

  function profileMapToItems(profileMap, metaMap) {
    var meta = metaMap || {};
    var normalized = normalizeProfileMap(profileMap);
    return Object.keys(normalized).sort(function(left, right) {
      return sortProfileName(left).localeCompare(sortProfileName(right));
    }).map(function(name) {
      var m = meta[name] || {};
      return { name: name, items: normalized[name], color: m.color || null, icon: m.icon || m.emoji || null };
    });
  }

  async function loadSyncOptions() {
    var result = await getArea("sync", Object.keys(syncDefaults));
    return mergeDefaults(syncDefaults, result);
  }

  async function saveSyncOptions(values) {
    var allowed = {};
    Object.keys(syncDefaults).forEach(function(key) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        allowed[key] = values[key];
      }
    });
    await setArea("sync", allowed);
    return loadSyncOptions();
  }

  async function loadLocalState() {
    var result = await getArea("local", Object.keys(localDefaults));
    return mergeDefaults(localDefaults, result);
  }

  async function saveLocalState(values) {
    await setArea("local", values);
    return loadLocalState();
  }

  async function ensureAreaDefaults(area, defaults) {
    var keys = Object.keys(defaults);
    var current = await getArea(area, keys);
    var missing = {};
    keys.forEach(function(key) {
      if (typeof current[key] === "undefined") {
        missing[key] = clone(defaults[key]);
      }
    });
    if (Object.keys(missing).length > 0) {
      await setArea(area, missing);
    }
  }

  async function ensureSyncDefaults() {
    await ensureAreaDefaults("sync", syncProfileDirectionDefaults);
  }

  async function ensureLocalDefaults() {
    await ensureAreaDefaults("local", localDefaults);
  }

  async function loadProfiles() {
    var syncState = await getArea("sync", { localProfiles: false });
    var area = syncState.localProfiles ? "local" : "sync";
    var payload = await getArea(area, { profiles: {}, profileMeta: {} });
    var map = normalizeProfileMap(payload.profiles);
    var meta = isObject(payload.profileMeta) ? payload.profileMeta : {};
    return {
      items: profileMapToItems(map, meta),
      localProfiles: !!syncState.localProfiles,
      map: map,
      meta: meta
    };
  }

  async function saveProfiles(profileMap, metaMap) {
    var normalized = normalizeProfileMap(profileMap);
    var syncPayload = { localProfiles: false, profiles: normalized };
    if (metaMap !== undefined) {
      syncPayload.profileMeta = metaMap || {};
    }
    try {
      await setArea("sync", syncPayload);
      return {
        items: profileMapToItems(normalized, metaMap),
        localProfiles: false,
        map: normalized
      };
    } catch (error) {
      var localPayload = { profiles: normalized };
      if (metaMap !== undefined) {
        localPayload.profileMeta = metaMap || {};
      }
      await setArea("local", localPayload);
      await setArea("sync", { localProfiles: true });
      return {
        items: profileMapToItems(normalized, metaMap),
        localProfiles: true,
        map: normalized
      };
    }
  }

  function makeId(prefix) {
    return [prefix, Date.now().toString(36), Math.random().toString(36).slice(2, 8)].join("-");
  }

  root.ExtensityStorage = {
    clone: clone,
    ensureLocalDefaults: ensureLocalDefaults,
    ensureSyncDefaults: ensureSyncDefaults,
    getArea: getArea,
    getLocalDefaults: function() { return clone(localDefaults); },
    getSyncDefaults: function() { return clone(syncDefaults); },
    loadLocalState: loadLocalState,
    loadProfiles: loadProfiles,
    loadSyncOptions: loadSyncOptions,
    makeId: makeId,
    isObject: isObject,
    mergeDefaults: mergeDefaults,
    normalizeProfileMap: normalizeProfileMap,
    profileMapToItems: profileMapToItems,
    removeArea: removeArea,
    saveLocalState: saveLocalState,
    saveProfiles: saveProfiles,
    saveSyncOptions: saveSyncOptions,
    setArea: setArea,
    uniqueArray: uniqueArray
  };
})(typeof window !== "undefined" ? window : self);
