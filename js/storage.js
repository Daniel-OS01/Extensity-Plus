(function(root) {
  var syncDefaults = {
    activeProfile: null,
    appsFirst: true,
    colorScheme: "auto",
    contrastMode: "normal",
    driveSync: false,
    driveAutoSyncIntervalMinutes: 60,
    driveAuthStatus: "unknown",
    driveSyncCategories: {
      aliases: true,
      groups: true,
      history: false,
      options: true,
      profiles: true,
      urlRules: true
    },
    dynamicSizing: false,
    enabledFirst: true,
    enableReminders: false,
    debugHistoryVerbose: false,
    extensionIconSizePx: 16,
    fontSizePx: 12,
    groupApps: true,
    keepAlwaysOn: true,
    lastDriveSync: null,
    lastDriveSyncError: null,
    drivePendingConflict: null,
    localProfiles: false,
    migration: "1.4.0",
    profileExtensionSide: "right",
    profileMeta: {},
    migration_2_0_0: null,
    migration_popupListStyle: null,
    migration_syncModes: null,
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
    fontFamily: "",
    cacheManagementItems: true,
    managementCacheTtlSeconds: 10,
    pinMethod: "auto",
    syncMode: "smart",
    syncProfilesPartial: false
  };

  var localDefaults = {
    aliases: {},
    dismissals: [],
    bulkToggleRestore: [],
    eventHistory: [],
    groupOrder: [],
    groups: {},
    lastSyncError: null,
    driveSyncMeta: {
      categoryTimestamps: {},
      fileId: null,
      lastMergedAt: {}
    },
    reminderQueue: [],
    recentlyUsed: [],
    toolbarPins: [],
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
  var SYNC_META_DEFAULTS = {
    syncOptionsUpdatedAt: 0,
    syncProfilesUpdatedAt: 0,
    syncWriterId: ""
  };
  var SYNC_FALLBACK_QUOTA_BYTES = 102400;
  var SYNC_FALLBACK_QUOTA_BYTES_PER_ITEM = 8192;
  var SMART_PROFILE_PAYLOAD_THRESHOLD_BYTES = 6000;
  var SYNC_MODE_VALUES = ["full", "smart", "minimal"];
  var syncWriteHook = null;

  function normalizeSyncMode(mode) {
    if (SYNC_MODE_VALUES.indexOf(mode) !== -1) {
      return mode;
    }
    return "smart";
  }

  function isReservedProfileName(name) {
    return profileNames.indexOf(name) !== -1;
  }

  function pickReservedProfileMap(profileMap) {
    var source = isObject(profileMap) ? profileMap : {};
    var result = {};
    profileNames.forEach(function(name) {
      result[name] = uniqueArray(source[name]);
    });
    return result;
  }

  function estimateProfilesPayloadBytes(profileMap) {
    return estimateStorageEntryBytes("profiles", normalizeProfileMap(profileMap));
  }

  function buildSyncProfilePayload(profileMap, syncMode) {
    var normalized = normalizeProfileMap(profileMap);
    var mode = normalizeSyncMode(syncMode);
    if (mode === "minimal") {
      return {
        membershipsLocal: true,
        partial: true,
        profiles: pickReservedProfileMap(normalized)
      };
    }
    if (mode === "smart") {
      var bytes = estimateProfilesPayloadBytes(normalized);
      if (bytes > SMART_PROFILE_PAYLOAD_THRESHOLD_BYTES) {
        return {
          membershipsLocal: true,
          partial: true,
          profiles: pickReservedProfileMap(normalized)
        };
      }
      return {
        membershipsLocal: false,
        partial: false,
        profiles: normalized
      };
    }
    return {
      membershipsLocal: false,
      partial: false,
      profiles: normalized
    };
  }

  function mergeProfileMaps(localMap, syncMap) {
    var merged = normalizeProfileMap(localMap);
    var syncNormalized = normalizeProfileMap(syncMap);
    Object.keys(syncNormalized).forEach(function(name) {
      merged[name] = uniqueArray(syncNormalized[name]);
    });
    return merged;
  }

  function mergeProfileMetaMaps(localMeta, syncMeta) {
    var localValue = isObject(localMeta) ? localMeta : {};
    var syncValue = isObject(syncMeta) ? syncMeta : {};
    return mergeDefaults(localValue, syncValue);
  }

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

  function registerSyncWriteHook(listener) {
    syncWriteHook = typeof listener === "function" ? listener : null;
  }

  function notifySyncWrite(keys) {
    if (syncWriteHook) {
      syncWriteHook(keys);
    }
  }

  function setArea(area, values) {
    if (area === "sync") {
      notifySyncWrite(Object.keys(values || {}));
    }
    return callArea(area, "set", values);
  }

  function getSyncQuotaLimits() {
    var syncArea = typeof chrome !== "undefined" && chrome.storage ? chrome.storage.sync : null;
    return {
      maxItems: syncArea && syncArea.MAX_ITEMS ? syncArea.MAX_ITEMS : 512,
      quotaBytes: syncArea && syncArea.QUOTA_BYTES ? syncArea.QUOTA_BYTES : SYNC_FALLBACK_QUOTA_BYTES,
      quotaBytesPerItem: syncArea && syncArea.QUOTA_BYTES_PER_ITEM
        ? syncArea.QUOTA_BYTES_PER_ITEM
        : SYNC_FALLBACK_QUOTA_BYTES_PER_ITEM
    };
  }

  function estimateStorageEntryBytes(key, value) {
    var serialized = JSON.stringify({ [key]: value });
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(serialized).length;
    }
    return serialized.length;
  }

  function estimatePayloadBytes(payload) {
    var perKey = {};
    var total = 0;
    Object.keys(payload || {}).forEach(function(key) {
      var bytes = estimateStorageEntryBytes(key, payload[key]);
      perKey[key] = bytes;
      total += bytes;
    });
    return { perKey: perKey, total: total };
  }

  function classifySyncError(message) {
    var text = String(message || "").toLowerCase();
    if (text.indexOf("quota") !== -1 || text.indexOf("quota_bytes") !== -1) {
      return "quota";
    }
    if (text.indexOf("max_write") !== -1 || text.indexOf("write operations") !== -1) {
      return "write_rate_limit";
    }
    if (text.indexOf("sync") !== -1 && (text.indexOf("disabled") !== -1 || text.indexOf("unavailable") !== -1)) {
      return "sync_unavailable";
    }
    return "unknown";
  }

  async function getSyncBytesInUse(keys) {
    if (!chrome.storage || !chrome.storage.sync || typeof chrome.storage.sync.getBytesInUse !== "function") {
      return null;
    }
    return callArea("sync", "getBytesInUse", keys || null);
  }

  function preflightSyncSet(payload) {
    var limits = getSyncQuotaLimits();
    var estimates = estimatePayloadBytes(payload);
    var oversizeKeys = Object.keys(estimates.perKey).filter(function(key) {
      return estimates.perKey[key] > limits.quotaBytesPerItem;
    });
    if (oversizeKeys.length > 0) {
      var perItemError = new Error(
        "Sync item exceeds per-key quota (" + limits.quotaBytesPerItem + " bytes): " + oversizeKeys.join(", ")
      );
      perItemError.code = "quota_per_item";
      throw perItemError;
    }
    return getSyncBytesInUse(null).then(function(bytesInUse) {
      if (bytesInUse == null) {
        if (estimates.total > limits.quotaBytes) {
          var totalError = new Error(
            "Sync payload exceeds total quota (" + limits.quotaBytes + " bytes)."
          );
          totalError.code = "quota_total";
          throw totalError;
        }
        return { bytesInUse: null, estimates: estimates, limits: limits };
      }
      if (bytesInUse + estimates.total > limits.quotaBytes) {
        var quotaError = new Error(
          "Sync storage quota exceeded (" + bytesInUse + " + " + estimates.total + " > " + limits.quotaBytes + ")."
        );
        quotaError.code = "quota_total";
        throw quotaError;
      }
      return { bytesInUse: bytesInUse, estimates: estimates, limits: limits };
    });
  }

  async function recordSyncError(code, message, context) {
    await setArea("local", {
      lastSyncError: {
        at: Date.now(),
        code: code || "unknown",
        context: context || "sync",
        message: message || ""
      }
    });
  }

  async function clearSyncError() {
    await setArea("local", { lastSyncError: null });
  }

  async function loadSyncMeta() {
    var result = await getArea("sync", SYNC_META_DEFAULTS);
    return {
      syncOptionsUpdatedAt: result.syncOptionsUpdatedAt || 0,
      syncProfilesUpdatedAt: result.syncProfilesUpdatedAt || 0,
      syncWriterId: result.syncWriterId || ""
    };
  }

  async function ensureSyncWriterId() {
    var meta = await loadSyncMeta();
    if (meta.syncWriterId) {
      return meta.syncWriterId;
    }
    var writerId = makeId("sync");
    await setArea("sync", { syncWriterId: writerId });
    return writerId;
  }

  async function ensureSyncMetaDefaults() {
    await ensureAreaDefaults("sync", SYNC_META_DEFAULTS);
  }

  function pickNewerTimestamp(left, right) {
    var leftValue = typeof left === "number" ? left : 0;
    var rightValue = typeof right === "number" ? right : 0;
    return rightValue > leftValue ? rightValue : leftValue;
  }

  function resolveConflictByTimestamp(localValue, remoteValue, localUpdatedAt, remoteUpdatedAt) {
    if (remoteUpdatedAt > localUpdatedAt) {
      return { source: "remote", value: remoteValue, updatedAt: remoteUpdatedAt };
    }
    if (localUpdatedAt > remoteUpdatedAt) {
      return { source: "local", value: localValue, updatedAt: localUpdatedAt };
    }
    return { source: "tie", value: remoteValue, updatedAt: remoteUpdatedAt };
  }

  function removeArea(area, keys) {
    return callArea(area, "remove", keys);
  }

  function uniqueArray(items) {
    if (!Array.isArray(items)) {
      return [];
    }

    // Performance optimization: Using a Set and a standard for loop
    // instead of `{}` and `.filter()` significantly improves array iteration
    // performance and prevents prototype key collisions (e.g. "__proto__").
    // Benchmarks show a ~50% reduction in execution time for large arrays.
    var result = [];
    var seen = new Set();
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
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
    var keys = Object.keys(syncDefaults);
    var result = await getArea("sync", keys);
    var meta = await loadSyncMeta();
    var merged = mergeDefaults(syncDefaults, result);
    merged._syncOptionsUpdatedAt = meta.syncOptionsUpdatedAt || 0;
    return merged;
  }

  async function saveSyncOptions(values) {
    var allowed = {};
    Object.keys(syncDefaults).forEach(function(key) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        allowed[key] = values[key];
      }
    });
    var nextUpdatedAt = Date.now();
    await ensureSyncWriterId();
    var payload = Object.assign({}, allowed, { syncOptionsUpdatedAt: nextUpdatedAt });
    try {
      await preflightSyncSet(payload);
      await setArea("sync", payload);
      await clearSyncError();
      return loadSyncOptions();
    } catch (error) {
      await recordSyncError(error.code || classifySyncError(error.message), error.message, "options");
      throw error;
    }
  }

  async function loadLocalState() {
    var result = await getArea("local", Object.keys(localDefaults));
    return mergeDefaults(localDefaults, result);
  }

  async function saveLocalState(values) {
    await setArea("local", values);
    return loadLocalState();
  }

  async function loadDismissals() {
    var localState = await getArea("local", { dismissals: [] });
    return uniqueArray(localState.dismissals || []);
  }

  async function saveDismissals(dismissals) {
    await setArea("local", { dismissals: uniqueArray(dismissals || []) });
    return loadDismissals();
  }

  async function appendDismissal(id) {
    if (!id) {
      return loadDismissals();
    }
    var dismissals = await loadDismissals();
    if (dismissals.indexOf(id) !== -1) {
      return dismissals;
    }
    dismissals.push(id);
    return saveDismissals(dismissals);
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
    await ensureSyncMetaDefaults();
  }

  async function ensureLocalDefaults() {
    await ensureAreaDefaults("local", localDefaults);
  }

  async function loadProfiles() {
    var both = await Promise.all([
      getArea("sync", {
        localProfiles: false,
        profiles: {},
        profileMeta: {},
        syncMode: syncDefaults.syncMode,
        syncProfilesPartial: false
      }),
      getArea("local", { profiles: {}, profileMeta: {} })
    ]);
    var syncData = both[0];
    var localData = both[1];
    var syncMeta = await loadSyncMeta();
    var syncMode = normalizeSyncMode(syncData.syncMode);
    var syncProfilesPartial = !!syncData.syncProfilesPartial;
    var quotaLocalFallback = !!syncData.localProfiles && syncMode === "full" && !syncProfilesPartial;
    var map;
    var meta;
    if (syncMode === "full" && !quotaLocalFallback) {
      map = normalizeProfileMap(syncData.profiles);
      meta = isObject(syncData.profileMeta) ? syncData.profileMeta : {};
    } else {
      map = mergeProfileMaps(localData.profiles, syncData.profiles);
      meta = mergeProfileMetaMaps(localData.profileMeta, syncData.profileMeta);
    }
    var membershipsLocal = syncMode !== "full" || quotaLocalFallback || syncProfilesPartial;
    return {
      items: profileMapToItems(map, meta),
      localProfiles: membershipsLocal,
      map: map,
      meta: meta,
      syncMode: syncMode,
      syncProfilesPartial: syncProfilesPartial,
      syncProfilesUpdatedAt: syncMeta.syncProfilesUpdatedAt || 0
    };
  }

  async function saveProfiles(profileMap, metaMap) {
    var normalized = normalizeProfileMap(profileMap);
    var meta = metaMap !== undefined ? (metaMap || {}) : undefined;
    var syncModeResult = await getArea("sync", { syncMode: syncDefaults.syncMode });
    var syncMode = normalizeSyncMode(syncModeResult.syncMode);
    var profilePayload = buildSyncProfilePayload(normalized, syncMode);
    var nextUpdatedAt = Date.now();
    var localPayload = { profiles: normalized };
    if (meta !== undefined) {
      localPayload.profileMeta = meta;
    }
    await setArea("local", localPayload);
    var syncPayload = {
      localProfiles: profilePayload.membershipsLocal,
      profiles: profilePayload.profiles,
      syncMode: syncMode,
      syncProfilesPartial: profilePayload.partial,
      syncProfilesUpdatedAt: nextUpdatedAt
    };
    if (meta !== undefined) {
      syncPayload.profileMeta = meta;
    }
    try {
      await ensureSyncWriterId();
      await preflightSyncSet(syncPayload);
      await setArea("sync", syncPayload);
      await clearSyncError();
      return {
        items: profileMapToItems(normalized, meta),
        localProfiles: profilePayload.membershipsLocal,
        map: normalized,
        syncMode: syncMode,
        syncProfilesPartial: profilePayload.partial,
        syncProfilesUpdatedAt: nextUpdatedAt
      };
    } catch (error) {
      var fallbackCode = error.code || classifySyncError(error.message);
      await recordSyncError(fallbackCode, error.message, "profiles");
      await setArea("sync", {
        localProfiles: true,
        syncMode: syncMode,
        syncProfilesPartial: true,
        syncProfilesUpdatedAt: nextUpdatedAt
      });
      return {
        items: profileMapToItems(normalized, meta),
        localProfiles: true,
        map: normalized,
        syncMode: syncMode,
        syncProfilesPartial: true,
        syncProfilesUpdatedAt: nextUpdatedAt
      };
    }
  }

  async function getSyncDiagnostics() {
    var limits = getSyncQuotaLimits();
    var bytesInUse = await getSyncBytesInUse(null);
    var localState = await getArea("local", { lastSyncError: null });
    var syncMeta = await loadSyncMeta();
    var syncFlags = await getArea("sync", {
      localProfiles: false,
      syncMode: syncDefaults.syncMode,
      syncProfilesPartial: false,
      profiles: {}
    });
    var headroomBytes = bytesInUse == null ? null : Math.max(0, limits.quotaBytes - bytesInUse);
    var profilesBytes = estimateProfilesPayloadBytes(syncFlags.profiles || {});
    var syncMode = normalizeSyncMode(syncFlags.syncMode);
    return {
      bytesInUse: bytesInUse,
      headroomBytes: headroomBytes,
      lastSyncError: localState.lastSyncError || null,
      limits: limits,
      localProfiles: !!syncFlags.localProfiles,
      profilesBytes: profilesBytes,
      profilesBytesThreshold: SMART_PROFILE_PAYLOAD_THRESHOLD_BYTES,
      syncMode: syncMode,
      syncProfilesPartial: !!syncFlags.syncProfilesPartial,
      syncOptionsUpdatedAt: syncMeta.syncOptionsUpdatedAt || 0,
      syncProfilesUpdatedAt: syncMeta.syncProfilesUpdatedAt || 0,
      syncWriterId: syncMeta.syncWriterId || ""
    };
  }

  function isRelevantSyncChangeKey(key) {
    if (Object.prototype.hasOwnProperty.call(syncDefaults, key)) {
      return true;
    }
    return [
      "profiles",
      "profileMeta",
      "localProfiles",
      "syncMode",
      "syncProfilesPartial",
      "syncOptionsUpdatedAt",
      "syncProfilesUpdatedAt",
      "syncWriterId"
    ].indexOf(key) !== -1;
  }

  function makeId(prefix) {
    return [prefix, Date.now().toString(36), Math.random().toString(36).slice(2, 8)].join("-");
  }

  var POPUP_WIDTH_MIN_PX = 300;
  var POPUP_WIDTH_MAX_PX = 600;
  var POPUP_WIDTH_SESSION_KEY = "extensity_popup_width_px";

  function clampPopupWidthPx(value) {
    var parsed = parseInt(value, 10);
    if (!isFinite(parsed)) {
      parsed = syncDefaults.popupWidthPx;
    }
    return Math.min(POPUP_WIDTH_MAX_PX, Math.max(POPUP_WIDTH_MIN_PX, parsed));
  }

  function applyPopupWidthCss(widthPx) {
    var width = clampPopupWidthPx(widthPx);
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.style.setProperty("--popup-width", width + "px");
    }
    return width;
  }

  root.ExtensityStorage = {
    POPUP_WIDTH_SESSION_KEY: POPUP_WIDTH_SESSION_KEY,
    appendDismissal: appendDismissal,
    applyPopupWidthCss: applyPopupWidthCss,
    buildSyncProfilePayload: buildSyncProfilePayload,
    classifySyncError: classifySyncError,
    clampPopupWidthPx: clampPopupWidthPx,
    clone: clone,
    ensureLocalDefaults: ensureLocalDefaults,
    ensureSyncDefaults: ensureSyncDefaults,
    estimatePayloadBytes: estimatePayloadBytes,
    isReservedProfileName: isReservedProfileName,
    getArea: getArea,
    getLocalDefaults: function() { return clone(localDefaults); },
    getSyncDefaults: function() { return clone(syncDefaults); },
    getSyncDiagnostics: getSyncDiagnostics,
    getSyncQuotaLimits: getSyncQuotaLimits,
    isRelevantSyncChangeKey: isRelevantSyncChangeKey,
    loadDismissals: loadDismissals,
    loadLocalState: loadLocalState,
    loadProfiles: loadProfiles,
    loadSyncMeta: loadSyncMeta,
    loadSyncOptions: loadSyncOptions,
    makeId: makeId,
    isObject: isObject,
    mergeDefaults: mergeDefaults,
    mergeProfileMaps: mergeProfileMaps,
    normalizeProfileMap: normalizeProfileMap,
    normalizeSyncMode: normalizeSyncMode,
    pickNewerTimestamp: pickNewerTimestamp,
    preflightSyncSet: preflightSyncSet,
    profileMapToItems: profileMapToItems,
    registerSyncWriteHook: registerSyncWriteHook,
    removeArea: removeArea,
    resolveConflictByTimestamp: resolveConflictByTimestamp,
    saveDismissals: saveDismissals,
    saveLocalState: saveLocalState,
    saveProfiles: saveProfiles,
    saveSyncOptions: saveSyncOptions,
    setArea: setArea,
    uniqueArray: uniqueArray
  };
})(typeof window !== "undefined" ? window : self);
