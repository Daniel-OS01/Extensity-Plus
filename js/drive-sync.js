(function(root) {
  var DRIVE_FILE_NAME = "extensity-plus-sync.json";
  var ENVELOPE_VERSION = "2.0.0";
  var DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  var PLACEHOLDER_CLIENT_ID = "REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com";
  var PLACEHOLDER_WEB_CLIENT_ID = "REPLACE_WITH_DRIVE_WEB_CLIENT_ID.apps.googleusercontent.com";
  var DRIVE_WEB_AUTH_CACHE_KEY = "driveWebAuthToken";
  var DRIVE_WEB_AUTH_PATH = "drive";
  var DRIVE_WEB_AUTH_EXPIRY_SKEW_MS = 60000;
  var GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
  var CATEGORY_IDS = ["options", "profiles", "aliases", "groups", "urlRules", "history"];
  var DEFAULT_CATEGORY_FLAGS = {
    aliases: true,
    groups: true,
    history: false,
    options: true,
    profiles: true,
    urlRules: true
  };
  var CATEGORY_LABELS = {
    aliases: "Aliases",
    groups: "Groups",
    history: "History",
    options: "Options",
    profiles: "Profiles",
    urlRules: "URL rules"
  };
  var DRIVE_SYNC_OPTION_KEYS = [
    "driveSync",
    "driveAutoSyncIntervalMinutes",
    "driveChangeBasedSync",
    "driveFailsafeEnabled",
    "driveFailsafeThresholdPercent",
    "driveSyncOnStartup",
    "driveSyncStrategy",
    "driveTimeBasedSync",
    "driveSyncCategories",
    "lastDriveSync",
    "lastDriveSyncError"
  ];
  var DRIVE_MAX_RETRIES = 3;
  var DRIVE_RETRY_BASE_DELAY_MS = 1000;
  var DRIVE_REQUEST_TIMEOUT_MS = 15000;
  var DRIVE_RETRYABLE_HTTP_STATUSES = [429, 500, 502, 503, 504];
  var DRIVE_BACKUP_LIMIT = 3;
  var DRIVE_FAILSAFE_ABSOLUTE_DELETIONS = 1000;
  var DRIVE_MAX_CONCURRENCY_RETRIES = 3;
  var activeSyncPromise = null;
  var previewConfirmations = {};

  // Mirrors js/history-logger.js maxRecords so merged history truncation matches append truncation.
  var HISTORY_MAX_RECORDS = 500;

  function getStorage() {
    return root.ExtensityStorage || {};
  }

  function isObject(value) {
    return !!value && Object.prototype.toString.call(value) === "[object Object]";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowMs() {
    return Date.now();
  }

  function sleep(ms) {
    return new Promise(function(resolve) {
      setTimeout(resolve, ms);
    });
  }

  function normalizeInstallType(value) {
    return value === "development" || value === "normal" ? value : "unknown";
  }

  function getDriveConfig() {
    return root.ExtensityDriveConfig || {};
  }

  function isDriveWebAuthPreferred() {
    var config = getDriveConfig();
    return !!config.drivePreferWebAuth || false;
  }

  async function getExtensionEnvironment() {
    var extensionId = chrome.runtime && chrome.runtime.id ? chrome.runtime.id : "";
    if (!chrome.management || typeof chrome.management.getSelf !== "function") {
      return {
        extensionId: extensionId,
        installType: "unknown"
      };
    }

    return new Promise(function(resolve) {
      chrome.management.getSelf(function(info) {
        if (chrome.runtime.lastError || !info) {
          resolve({
            extensionId: extensionId,
            installType: "unknown"
          });
          return;
        }
        resolve({
          extensionId: info.id || extensionId,
          installType: normalizeInstallType(info.installType)
        });
      });
    });
  }

  /**
   * Normalize sync category settings into a complete category-flag map.
   * @param {Object} flags - Optional category settings; missing categories use their default values.
   * @return {Object} A map containing a boolean flag for every supported category.
   */
  function normalizeCategoryFlags(flags) {
    var source = isObject(flags) ? flags : {};
    var normalized = {};
    CATEGORY_IDS.forEach(function(id) {
      if (Object.prototype.hasOwnProperty.call(source, id)) {
        normalized[id] = !!source[id];
      } else {
        normalized[id] = !!DEFAULT_CATEGORY_FLAGS[id];
      }
    });
    return normalized;
  }

  /**
   * Lists the enabled synchronization categories.
   * @param {Object} flags - Category enablement flags.
   * @return {string[]} The enabled category IDs.
   */
  function enabledCategoryList(flags) {
    return CATEGORY_IDS.filter(function(id) {
      return !!normalizeCategoryFlags(flags)[id];
    });
  }

  /**
   * Normalize Drive synchronization metadata for consistent state handling.
   * @param {*} meta - Metadata to normalize.
   * @return {Object} Metadata with normalized file identifiers, category timestamps, baseline categories, envelope version, and merge times.
   */
  function normalizeDriveMeta(meta) {
    var source = isObject(meta) ? meta : {};
    return {
      categoryTimestamps: isObject(source.categoryTimestamps) ? clone(source.categoryTimestamps) : {},
      fileId: source.fileId || null,
      fileModifiedTime: source.fileModifiedTime || null,
      fileSize: source.fileSize || null,
      fileVersion: source.fileVersion || null,
      baselineCategories: isObject(source.baselineCategories) ? clone(source.baselineCategories) : {},
      envelopeVersion: source.envelopeVersion || null,
      lastMergedAt: isObject(source.lastMergedAt) ? clone(source.lastMergedAt) : {}
    };
  }

  /**
   * Records the update time for a synchronization category.
   * @param {Object} meta - Drive synchronization metadata to normalize and update.
   * @param {string} categoryId - Category whose timestamp should be recorded.
   * @param {number} [timestamp] - Timestamp to store; defaults to the current time.
   * @return {Object} Updated Drive synchronization metadata.
   */
  function bumpCategoryTimestamp(meta, categoryId, timestamp) {
    var next = normalizeDriveMeta(meta);
    var at = typeof timestamp === "number" ? timestamp : nowMs();
    next.categoryTimestamps[categoryId] = at;
    return next;
  }

  function buildOptionsCategoryPayload(options) {
    var payload = clone(options || {});
    DRIVE_SYNC_OPTION_KEYS.forEach(function(key) {
      delete payload[key];
    });
    delete payload._syncOptionsUpdatedAt;
    return payload;
  }

  function buildCategoryData(categoryId, context) {
    var options = context.options || {};
    var localState = context.localState || {};
    var profiles = context.profiles || {};

    if (categoryId === "options") {
      return buildOptionsCategoryPayload(options);
    }
    if (categoryId === "profiles") {
      return {
        map: clone(profiles.map || {}),
        meta: clone(profiles.meta || {})
      };
    }
    if (categoryId === "aliases") {
      return clone(localState.aliases || {});
    }
    if (categoryId === "groups") {
      return {
        groupOrder: clone(localState.groupOrder || []),
        groups: clone(localState.groups || {})
      };
    }
    if (categoryId === "urlRules") {
      return clone(localState.urlRules || []);
    }
    if (categoryId === "history") {
      return clone(localState.eventHistory || []);
    }
    throw new Error("Unknown Drive sync category: " + categoryId);
  }

  function remoteIsNewer(localUpdatedAt, remoteUpdatedAt) {
    var localAt = typeof localUpdatedAt === "number" ? localUpdatedAt : 0;
    var remoteAt = typeof remoteUpdatedAt === "number" ? remoteUpdatedAt : 0;
    return remoteAt > localAt;
  }

  function mergeAliases(localData, remoteData, localUpdatedAt, remoteUpdatedAt) {
    var local = isObject(localData) ? localData : {};
    var remote = isObject(remoteData) ? remoteData : {};
    // Union all keys; shared keys resolve to the newer side (tie -> local).
    if (remoteIsNewer(localUpdatedAt, remoteUpdatedAt)) {
      return Object.assign({}, local, remote);
    }
    return Object.assign({}, remote, local);
  }

  function mergeUrlRules(localData, remoteData, localUpdatedAt, remoteUpdatedAt) {
    var local = Array.isArray(localData) ? localData : [];
    var remote = Array.isArray(remoteData) ? remoteData : [];
    var remoteNewer = remoteIsNewer(localUpdatedAt, remoteUpdatedAt);
    var remoteById = {};
    remote.forEach(function(rule) {
      if (rule && rule.id) {
        remoteById[rule.id] = rule;
      }
    });
    var localIds = {};
    var merged = [];
    // Local order first; shared ids resolve to the newer side.
    local.forEach(function(rule) {
      if (!rule || !rule.id) {
        return;
      }
      localIds[rule.id] = true;
      var counterpart = remoteById[rule.id];
      if (counterpart && remoteNewer) {
        merged.push(clone(counterpart));
      } else {
        merged.push(clone(rule));
      }
    });
    // Remote-only rules appended, preserving remote order.
    remote.forEach(function(rule) {
      if (rule && rule.id && !localIds[rule.id]) {
        merged.push(clone(rule));
      }
    });
    return merged;
  }

  function mergeGroups(localData, remoteData, localUpdatedAt, remoteUpdatedAt) {
    var storage = getStorage();
    var local = isObject(localData) ? localData : {};
    var remote = isObject(remoteData) ? remoteData : {};
    var localGroups = isObject(local.groups) ? local.groups : {};
    var remoteGroups = isObject(remote.groups) ? remote.groups : {};
    var localOrder = Array.isArray(local.groupOrder) ? local.groupOrder : [];
    var remoteOrder = Array.isArray(remote.groupOrder) ? remote.groupOrder : [];
    var remoteNewer = remoteIsNewer(localUpdatedAt, remoteUpdatedAt);
    var mergedGroups = {};

    Object.keys(localGroups).forEach(function(groupId) {
      mergedGroups[groupId] = clone(localGroups[groupId]);
    });
    Object.keys(remoteGroups).forEach(function(groupId) {
      var remoteGroup = remoteGroups[groupId];
      if (!mergedGroups[groupId]) {
        mergedGroups[groupId] = clone(remoteGroup);
        return;
      }
      // Shared group: union extensionIds, take newer side's scalar fields.
      var base = remoteNewer ? clone(remoteGroup) : clone(mergedGroups[groupId]);
      base.extensionIds = storage.uniqueArray(
        [].concat(
          Array.isArray(mergedGroups[groupId].extensionIds) ? mergedGroups[groupId].extensionIds : [],
          Array.isArray(remoteGroup.extensionIds) ? remoteGroup.extensionIds : []
        )
      );
      mergedGroups[groupId] = base;
    });

    var groupOrder = [];
    var seenOrder = {};
    localOrder.forEach(function(groupId) {
      if (mergedGroups[groupId] && !seenOrder[groupId]) {
        seenOrder[groupId] = true;
        groupOrder.push(groupId);
      }
    });
    remoteOrder.forEach(function(groupId) {
      if (mergedGroups[groupId] && !seenOrder[groupId]) {
        seenOrder[groupId] = true;
        groupOrder.push(groupId);
      }
    });
    // Include any merged group ids missing from both order lists.
    Object.keys(mergedGroups).forEach(function(groupId) {
      if (!seenOrder[groupId]) {
        seenOrder[groupId] = true;
        groupOrder.push(groupId);
      }
    });

    return {
      groupOrder: groupOrder,
      groups: mergedGroups
    };
  }

  function mergeHistory(localData, remoteData) {
    var local = Array.isArray(localData) ? localData : [];
    var remote = Array.isArray(remoteData) ? remoteData : [];
    var byId = {};
    var order = [];
    [].concat(local, remote).forEach(function(entry) {
      if (!entry || !entry.id) {
        return;
      }
      if (!byId[entry.id]) {
        order.push(entry.id);
      }
      byId[entry.id] = entry;
    });
    var merged = order.map(function(id) {
      return clone(byId[id]);
    });
    merged.sort(function(left, right) {
      var leftTs = typeof left.timestamp === "number" ? left.timestamp : 0;
      var rightTs = typeof right.timestamp === "number" ? right.timestamp : 0;
      return leftTs - rightTs;
    });
    // Keep the most recent records, mirroring history-logger.js truncation.
    return merged.slice(-HISTORY_MAX_RECORDS);
  }

  function mergeProfileMembership(localMap, remoteMap) {
    var storage = getStorage();
    var local = isObject(localMap) ? localMap : {};
    var remote = isObject(remoteMap) ? remoteMap : {};
    var merged = {};
    // Union membership arrays for every profile so no one-sided members are dropped.
    Object.keys(local).forEach(function(name) {
      merged[name] = storage.uniqueArray(local[name]);
    });
    Object.keys(remote).forEach(function(name) {
      if (merged[name]) {
        merged[name] = storage.uniqueArray([].concat(merged[name], remote[name] || []));
      } else {
        merged[name] = storage.uniqueArray(remote[name]);
      }
    });
    return merged;
  }

  function mergeProfiles(localData, remoteData, localUpdatedAt, remoteUpdatedAt) {
    var storage = getStorage();
    var local = isObject(localData) ? localData : {};
    var remote = isObject(remoteData) ? remoteData : {};
    var remoteNewer = remoteIsNewer(localUpdatedAt, remoteUpdatedAt);
    var localMeta = isObject(local.meta) ? local.meta : {};
    var remoteMeta = isObject(remote.meta) ? remote.meta : {};
    var unionedMap = mergeProfileMembership(local.map, remote.map);
    var mergedMeta;
    // Select metadata by category timestamp: newer side wins scalar conflicts (tie -> local).
    // mergeProfileMetaMaps(a, b) deep-merges with b winning, so put the losing side first.
    if (typeof storage.mergeProfileMetaMaps === "function") {
      mergedMeta = remoteNewer
        ? storage.mergeProfileMetaMaps(localMeta, remoteMeta)
        : storage.mergeProfileMetaMaps(remoteMeta, localMeta);
    } else {
      mergedMeta = remoteNewer
        ? Object.assign({}, localMeta, remoteMeta)
        : Object.assign({}, remoteMeta, localMeta);
    }
    return {
      map: typeof storage.normalizeProfileMap === "function"
        ? storage.normalizeProfileMap(unionedMap)
        : unionedMap,
      meta: mergedMeta
    };
  }

  function mergeOptions(localData, remoteData, localUpdatedAt, remoteUpdatedAt) {
    var storage = getStorage();
    var local = isObject(localData) ? localData : {};
    var remote = isObject(remoteData) ? remoteData : {};
    var remoteNewer = remoteIsNewer(localUpdatedAt, remoteUpdatedAt);
    // Deep merge; the newer side wins scalar conflicts (tie -> local).
    if (typeof storage.mergeDefaults === "function") {
      return remoteNewer
        ? storage.mergeDefaults(local, remote)
        : storage.mergeDefaults(remote, local);
    }
    return remoteNewer
      ? Object.assign({}, local, remote)
      : Object.assign({}, remote, local);
  }

  /**
   * Merges local and remote data for a supported Drive sync category.
   * @param {string} categoryId - The category to merge.
   * @param {*} localData - The local category data.
   * @param {*} remoteData - The remote category data.
   * @param {number} localUpdatedAt - The local category update timestamp.
   * @param {number} remoteUpdatedAt - The remote category update timestamp.
   * @return {*} The merged category data.
   * @throws {Error} If the category is unsupported.
   */
  function mergeCategoryData(categoryId, localData, remoteData, localUpdatedAt, remoteUpdatedAt) {
    if (categoryId === "aliases") {
      return mergeAliases(localData, remoteData, localUpdatedAt, remoteUpdatedAt);
    }
    if (categoryId === "urlRules") {
      return mergeUrlRules(localData, remoteData, localUpdatedAt, remoteUpdatedAt);
    }
    if (categoryId === "groups") {
      return mergeGroups(localData, remoteData, localUpdatedAt, remoteUpdatedAt);
    }
    if (categoryId === "history") {
      return mergeHistory(localData, remoteData);
    }
    if (categoryId === "profiles") {
      return mergeProfiles(localData, remoteData, localUpdatedAt, remoteUpdatedAt);
    }
    if (categoryId === "options") {
      return mergeOptions(localData, remoteData, localUpdatedAt, remoteUpdatedAt);
    }
    throw new Error("Unknown Drive sync category: " + categoryId);
  }

  /**
   * Builds a versioned sync envelope for the enabled categories.
   * @param {Object} context - Local sync context containing category data and Drive metadata.
   * @param {Object} categoryFlags - Category enablement flags.
   * @param {string} writerId - Identifier for the envelope writer.
   * @return {Object} The envelope containing category data, timestamps, export time, version, and writer ID.
   */
  function buildEnvelope(context, categoryFlags, writerId) {
    var enabled = enabledCategoryList(categoryFlags);
    var meta = normalizeDriveMeta(context.driveSyncMeta);
    var categories = {};
    enabled.forEach(function(categoryId) {
      categories[categoryId] = {
        data: buildCategoryData(categoryId, context),
        updatedAt: typeof meta.categoryTimestamps[categoryId] === "number"
          ? meta.categoryTimestamps[categoryId]
          : 0
      };
    });

    return {
      categories: categories,
      exportedAt: nowMs(),
      version: ENVELOPE_VERSION,
      writerId: writerId || ""
    };
  }

  /**
   * Serializes a value as JSON for comparison and fingerprinting.
   * @param {*} value - The value to serialize.
   * @return {string|undefined} The JSON representation, or `undefined` when serialization produces no result.
   */
  function stableSerialize(value) {
    return JSON.stringify(value);
  }

  /**
   * Determines whether two values have identical JSON representations.
   * @param {*} left - The first value to compare.
   * @param {*} right - The second value to compare.
   * @return {boolean} `true` if both values serialize identically, `false` otherwise.
   */
  function dataEqual(left, right) {
    return stableSerialize(left) === stableSerialize(right);
  }

  /**
   * Estimates the UTF-8 byte size of a serialized value.
   * @param {*} value - The value to serialize and measure.
   * @return {number} The estimated serialized size in bytes.
   */
  function estimatePayloadBytes(value) {
    return unescape(encodeURIComponent(stableSerialize(value))).length;
  }

  /**
   * Computes a deterministic hexadecimal fingerprint for a sync envelope.
   * @param {Object|null|undefined} envelope - The envelope to fingerprint.
   * @return {string} The envelope's hexadecimal fingerprint.
   */
  function envelopeFingerprint(envelope) {
    var text = JSON.stringify(envelope || null);
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  /**
   * Create a short-lived token for confirming a Drive sync preview.
   * @param {Object} details - Confirmation details associated with the token.
   * @return {string} The generated confirmation token, valid for two minutes.
   */
  function createPreviewConfirmation(details) {
    var token = "drive-preview-" + nowMs().toString(36) + "-" + Math.random().toString(36).slice(2);
    previewConfirmations[token] = Object.assign({ expiresAt: nowMs() + 2 * 60 * 1000 }, details);
    return token;
  }

  /**
   * Validates and consumes a Drive sync preview confirmation.
   * @param {string} token - The confirmation token issued for the preview.
   * @param {Object} expected - The current sync details that must match the preview.
   * @throws {Error} If the token is missing, expired, already consumed, or does not match the expected sync details.
   */
  function consumePreviewConfirmation(token, expected) {
    var record = token && previewConfirmations[token];
    delete previewConfirmations[token];
    if (!record || record.expiresAt < nowMs()) {
      throw createDriveError("preview_stale", "The Drive sync preview expired. Refresh the preview and confirm again.");
    }
    if (
      record.direction !== expected.direction
      || record.localHash !== expected.localHash
      || String(record.remoteVersion || "") !== String(expected.remoteVersion || "")
      || record.resolution !== expected.resolution
    ) {
      throw createDriveError("preview_stale", "The Drive sync data changed after preview. Refresh the preview and confirm again.");
    }
  }

  /**
   * Stamp an envelope for its initial upload.
   * @param {Object} envelope - The envelope to clone and timestamp.
   * @return {Object} A cloned envelope with timestamps assigned to unstamped categories and the export time.
   */
  function stampEnvelopeForInitialUpload(envelope) {
    var next = clone(envelope);
    var stampedAt = nowMs();
    Object.keys(next.categories || {}).forEach(function(categoryId) {
      if (!next.categories[categoryId].updatedAt) {
        next.categories[categoryId].updatedAt = stampedAt;
      }
    });
    next.exportedAt = stampedAt;
    return next;
  }

  /**
   * Converts category data into a comparison map using category-specific item keys.
   * @param {string} categoryId - The category whose data should be mapped.
   * @param {*} data - The category data to convert.
   * @return {Object} A map of category items keyed by property, membership, metadata, group, or item identifier.
   */
  function categoryItemMap(categoryId, data) {
    var result = {};
    if (categoryId === "options" || categoryId === "aliases") {
      Object.keys(isObject(data) ? data : {}).forEach(function(key) {
        result[key] = data[key];
      });
      return result;
    }
    if (categoryId === "profiles") {
      var profileData = isObject(data) ? data : {};
      Object.keys(profileData.map || {}).forEach(function(profileName) {
        (profileData.map[profileName] || []).forEach(function(extensionId) {
          result["member:" + profileName + ":" + extensionId] = true;
        });
      });
      Object.keys(profileData.meta || {}).forEach(function(profileName) {
        result["meta:" + profileName] = profileData.meta[profileName];
      });
      return result;
    }
    if (categoryId === "groups") {
      var groupData = isObject(data) ? data : {};
      Object.keys(groupData.groups || {}).forEach(function(groupId) {
        result[groupId] = groupData.groups[groupId];
      });
      return result;
    }
    (Array.isArray(data) ? data : []).forEach(function(item, index) {
      var id = item && (item.id || item.eventId || item.timestamp);
      result[String(id || index)] = item;
    });
    return result;
  }

  /**
   * Reconstructs category data from an item map.
   * @param {string} categoryId - The category whose data shape should be reconstructed.
   * @param {Object} items - Item data keyed by category-specific identifiers.
   * @param {Object} [template] - Optional group data used to preserve existing group order.
   * @return {Object|Array} The reconstructed category data.
   */
  function categoryDataFromItemMap(categoryId, items, template) {
    if (categoryId === "options" || categoryId === "aliases") {
      return clone(items);
    }
    if (categoryId === "profiles") {
      var profiles = { map: {}, meta: {} };
      Object.keys(items).forEach(function(key) {
        if (key.indexOf("member:") === 0 && items[key]) {
          var parts = key.split(":");
          var profileName = parts[1];
          var extensionId = parts.slice(2).join(":");
          profiles.map[profileName] = (profiles.map[profileName] || []).concat([extensionId]);
        } else if (key.indexOf("meta:") === 0) {
          profiles.meta[key.slice(5)] = clone(items[key]);
        }
      });
      return profiles;
    }
    if (categoryId === "groups") {
      var groups = clone(items);
      var previousOrder = template && Array.isArray(template.groupOrder) ? template.groupOrder : [];
      var groupOrder = previousOrder.filter(function(id) {
        return Object.prototype.hasOwnProperty.call(groups, id);
      });
      Object.keys(groups).forEach(function(id) {
        if (groupOrder.indexOf(id) === -1) {
          groupOrder.push(id);
        }
      });
      return { groupOrder: groupOrder, groups: groups };
    }
    return Object.keys(items).map(function(key) {
      return clone(items[key]);
    });
  }

  /**
   * Builds an item-level three-way merge of enabled categories and records conflicting changes.
   * @param {Object} localEnvelope - The current local envelope.
   * @param {Object} remoteEnvelope - The remote envelope.
   * @param {Object} baselineCategories - Category snapshots from the last successful merge.
   * @param {Object} categoryFlags - Flags identifying categories to merge.
   * @param {string} resolution - Conflict resolution mode; `"keep_remote"` selects remote values for conflicts, while other modes select local values.
   * @param {string} writerId - Identifier for the envelope writer.
   * @return {Object} An object containing `conflicts`, an array of item-level conflict records, and `envelope`, the merged envelope.
   */
  function buildThreeWayEnvelope(localEnvelope, remoteEnvelope, baselineCategories, categoryFlags, resolution, writerId) {
    var result = { categories: {}, exportedAt: nowMs(), version: ENVELOPE_VERSION, writerId: writerId || "" };
    var conflicts = [];
    enabledCategoryList(categoryFlags).forEach(function(categoryId) {
      var localCategory = localEnvelope.categories && localEnvelope.categories[categoryId] || { data: null, updatedAt: 0 };
      var remoteCategory = remoteEnvelope.categories && remoteEnvelope.categories[categoryId] || { data: null, updatedAt: 0 };
      var baseData = baselineCategories && baselineCategories[categoryId];
      var baseItems = categoryItemMap(categoryId, baseData);
      var localItems = categoryItemMap(categoryId, localCategory.data);
      var remoteItems = categoryItemMap(categoryId, remoteCategory.data);
      var mergedItems = {};
      var keys = Object.keys(Object.assign({}, baseItems, localItems, remoteItems));
      keys.forEach(function(itemId) {
        var baseHas = Object.prototype.hasOwnProperty.call(baseItems, itemId);
        var localHas = Object.prototype.hasOwnProperty.call(localItems, itemId);
        var remoteHas = Object.prototype.hasOwnProperty.call(remoteItems, itemId);
        var localChanged = localHas !== baseHas || (localHas && !dataEqual(localItems[itemId], baseItems[itemId]));
        var remoteChanged = remoteHas !== baseHas || (remoteHas && !dataEqual(remoteItems[itemId], baseItems[itemId]));
        var chooseRemote = false;
        if (localChanged && remoteChanged && (localHas !== remoteHas || !dataEqual(localItems[itemId], remoteItems[itemId]))) {
          conflicts.push({
            categoryId: categoryId,
            itemId: itemId,
            label: (CATEGORY_LABELS[categoryId] || categoryId) + " / " + itemId,
            localDeleted: !localHas,
            remoteDeleted: !remoteHas,
            localUpdatedAt: localCategory.updatedAt || 0,
            remoteUpdatedAt: remoteCategory.updatedAt || 0
          });
          chooseRemote = resolution === "keep_remote";
        } else {
          chooseRemote = remoteChanged && !localChanged;
        }
        var chosenHas = chooseRemote ? remoteHas : localChanged ? localHas : remoteHas;
        var chosenValue = chooseRemote ? remoteItems[itemId] : localChanged ? localItems[itemId] : remoteItems[itemId];
        if (chosenHas) {
          mergedItems[itemId] = clone(chosenValue);
        }
      });
      result.categories[categoryId] = {
        data: categoryDataFromItemMap(categoryId, mergedItems, localCategory.data || remoteCategory.data),
        updatedAt: Math.max(localCategory.updatedAt || 0, remoteCategory.updatedAt || 0) || nowMs()
      };
    });
    return { conflicts: conflicts, envelope: result };
  }

  /**
   * Summarize item-level changes between two versions of a category.
   * @param {string} categoryId - The category whose items are being compared.
   * @param {*} beforeData - The earlier category data.
   * @param {*} afterData - The later category data.
   * @return {Object} Change counts, item counts, estimated payload sizes, category ID, and deletion percentage.
   */
  function buildCategoryChange(categoryId, beforeData, afterData) {
    var before = categoryItemMap(categoryId, beforeData);
    var after = categoryItemMap(categoryId, afterData);
    var beforeKeys = Object.keys(before);
    var afterKeys = Object.keys(after);
    var added = afterKeys.filter(function(key) {
      return !Object.prototype.hasOwnProperty.call(before, key);
    }).length;
    var deleted = beforeKeys.filter(function(key) {
      return !Object.prototype.hasOwnProperty.call(after, key);
    }).length;
    var changed = afterKeys.filter(function(key) {
      return Object.prototype.hasOwnProperty.call(before, key) && !dataEqual(before[key], after[key]);
    }).length;
    return {
      added: added,
      afterBytes: estimatePayloadBytes(afterData),
      afterCount: afterKeys.length,
      beforeBytes: estimatePayloadBytes(beforeData),
      beforeCount: beforeKeys.length,
      categoryId: categoryId,
      changed: changed,
      deleted: deleted,
      deletionPercent: beforeKeys.length ? Math.round((deleted / beforeKeys.length) * 10000) / 100 : 0
    };
  }

  /**
   * Summarize changes for each enabled synchronization category.
   * @param {Object} beforeEnvelope - The envelope representing the earlier state.
   * @param {Object} afterEnvelope - The envelope representing the later state.
   * @param {Object} categoryFlags - Flags indicating which categories to include.
   * @return {Array<Object>} Change summaries for the enabled categories.
   */
  function buildChangeSummary(beforeEnvelope, afterEnvelope, categoryFlags) {
    var beforeCategories = beforeEnvelope && beforeEnvelope.categories || {};
    var afterCategories = afterEnvelope && afterEnvelope.categories || {};
    return enabledCategoryList(categoryFlags).map(function(categoryId) {
      return buildCategoryChange(
        categoryId,
        beforeCategories[categoryId] && beforeCategories[categoryId].data,
        afterCategories[categoryId] && afterCategories[categoryId].data
      );
    });
  }

  /**
   * Detects whether a category change exceeds the configured failsafe limits.
   * @param {Array<Object>} summary - Category change summaries containing item counts and deletion statistics.
   * @param {Object} [options] - Failsafe settings, including threshold and automatic-trigger behavior.
   * @return {Object|null} The first violating category summary with its label and threshold, or `null` when no violation is found.
   */
  function findFailsafeViolation(summary, options) {
    if (options && options.driveFailsafeEnabled === false) {
      return null;
    }
    var threshold = Math.max(1, Math.min(100, Number(options && options.driveFailsafeThresholdPercent) || 20));
    for (var index = 0; index < summary.length; index += 1) {
      var entry = summary[index];
      if (
        (entry.beforeCount > 0 && entry.afterCount === 0)
        || entry.deleted >= DRIVE_FAILSAFE_ABSOLUTE_DELETIONS
        || (entry.deleted > 0 && entry.deletionPercent >= threshold)
        || (options && options.driveAutomaticTrigger && entry.added >= 20)
        || (
          options && options.driveAutomaticTrigger
          && entry.beforeCount > 0
          && (entry.changed + entry.deleted) / entry.beforeCount * 100 >= threshold
        )
      ) {
        return Object.assign({
          label: CATEGORY_LABELS[entry.categoryId] || entry.categoryId,
          thresholdPercent: threshold
        }, entry);
      }
    }
    return null;
  }

  /**
   * Creates a structured record for a pending Drive sync conflict.
   * @param {Array} conflicts - Conflict details to include.
   * @param {Object|null} file - Remote Drive file metadata, if available.
   * @param {Object} localEnvelope - Local envelope used to calculate the payload summary.
   * @param {string} reason - Conflict cause, defaulting to `"divergence"`.
   * @param {string} trigger - Event that initiated the sync, defaulting to `"manual"`.
   * @param {Object} details - Additional fields to merge into the record.
   * @return {Object} The pending conflict record with conflict details, detection time, file metadata, local payload summary, reason, and trigger.
   */
  function buildPendingConflict(conflicts, file, localEnvelope, reason, trigger, details) {
    return Object.assign({
      categories: clone(conflicts || []),
      detectedAt: nowMs(),
      file: file ? {
        id: file.id || null,
        modifiedTime: file.modifiedTime || null,
        size: file.size || null,
        version: file.version || null
      } : null,
      localSummary: {
        bytes: estimatePayloadBytes(localEnvelope),
        updatedAt: localEnvelope && localEnvelope.exportedAt || nowMs()
      },
      reason: reason || "divergence",
      trigger: trigger || "manual"
    }, details || {});
  }

  /**
   * Identifies enabled categories changed locally and remotely since the last merge.
   * @param {Object} localMeta - Local Drive sync metadata containing category timestamps and merge timestamps.
   * @param {Object} remoteEnvelope - Remote sync envelope containing category update timestamps.
   * @param {Object} categoryFlags - Category enablement flags used to limit conflict detection.
   * @return {Array<Object>} Conflict records containing the category ID, label, and local and remote update timestamps.
   */
  function detectConflicts(localMeta, remoteEnvelope, categoryFlags) {
    var enabled = enabledCategoryList(categoryFlags);
    var mergedAt = normalizeDriveMeta(localMeta).lastMergedAt;
    var localTimestamps = normalizeDriveMeta(localMeta).categoryTimestamps;
    var remoteCategories = remoteEnvelope && isObject(remoteEnvelope.categories) ? remoteEnvelope.categories : {};
    var conflicts = [];

    enabled.forEach(function(categoryId) {
      var localUpdatedAt = localTimestamps[categoryId] || 0;
      var remoteCategory = remoteCategories[categoryId];
      var remoteUpdatedAt = remoteCategory && typeof remoteCategory.updatedAt === "number"
        ? remoteCategory.updatedAt
        : 0;
      var baseline = mergedAt[categoryId] || 0;
      var localChanged = localUpdatedAt > baseline;
      var remoteChanged = remoteUpdatedAt > baseline;

      if (localChanged && remoteChanged) {
        conflicts.push({
          categoryId: categoryId,
          label: CATEGORY_LABELS[categoryId] || categoryId,
          localUpdatedAt: localUpdatedAt,
          remoteUpdatedAt: remoteUpdatedAt
        });
      }
    });

    return conflicts;
  }

  function applyCategoryToPatches(categoryId, categoryData, patches) {
    if (categoryId === "options") {
      patches.syncOptions = Object.assign(patches.syncOptions || {}, categoryData);
      return;
    }
    if (categoryId === "profiles") {
      patches.profiles = {
        map: categoryData.map || {},
        meta: categoryData.meta || {}
      };
      return;
    }
    if (categoryId === "aliases") {
      patches.localState = patches.localState || {};
      patches.localState.aliases = categoryData || {};
      return;
    }
    if (categoryId === "groups") {
      patches.localState = patches.localState || {};
      patches.localState.groupOrder = Array.isArray(categoryData.groupOrder) ? categoryData.groupOrder : [];
      patches.localState.groups = categoryData.groups || {};
      return;
    }
    if (categoryId === "urlRules") {
      patches.localState = patches.localState || {};
      patches.localState.urlRules = Array.isArray(categoryData) ? categoryData : [];
      return;
    }
    if (categoryId === "history") {
      patches.localState = patches.localState || {};
      patches.localState.eventHistory = Array.isArray(categoryData) ? categoryData : [];
    }
  }

  function buildPatchesFromEnvelope(envelope, categoryFlags) {
    var enabled = enabledCategoryList(categoryFlags);
    var patches = {};
    var remoteCategories = envelope && isObject(envelope.categories) ? envelope.categories : {};

    enabled.forEach(function(categoryId) {
      var remoteCategory = remoteCategories[categoryId];
      if (!remoteCategory) {
        return;
      }
      applyCategoryToPatches(categoryId, remoteCategory.data, patches);
    });

    return patches;
  }

  /**
   * Builds storage patches representing the enabled categories in the local context.
   * @param {Object} context - The local synchronization context.
   * @param {Object} categoryFlags - Flags identifying the categories to include.
   * @return {Object} Patches containing the selected local synchronization data.
   */
  function buildPatchesFromLocal(context, categoryFlags) {
    return buildPatchesFromEnvelope(buildEnvelope(context, categoryFlags, ""), categoryFlags);
  }

  /**
   * Determines whether merged data differs from the reference envelope for any enabled category.
   * @param {Object} mergedEnvelope - The envelope containing the merged category data.
   * @param {Object} referenceEnvelope - The envelope containing the data to compare.
   * @param {Object} categoryFlags - Category enablement flags.
   * @return {boolean} `true` if any enabled category differs, `false` otherwise.
   */
  function mergedDataDiffers(mergedEnvelope, referenceEnvelope, categoryFlags) {
    var enabled = enabledCategoryList(categoryFlags);
    var mergedCategories = mergedEnvelope && isObject(mergedEnvelope.categories) ? mergedEnvelope.categories : {};
    var refCategories = referenceEnvelope && isObject(referenceEnvelope.categories) ? referenceEnvelope.categories : {};
    return enabled.some(function(categoryId) {
      var mergedCategory = mergedCategories[categoryId];
      var refCategory = refCategories[categoryId];
      var mergedValue = mergedCategory ? mergedCategory.data : undefined;
      var refValue = refCategory ? refCategory.data : undefined;
      return !dataEqual(mergedValue, refValue);
    });
  }

  /**
   * Combines enabled categories from local and remote envelopes into a versioned envelope.
   * @param {Object} localEnvelope - The local sync envelope.
   * @param {Object} remoteEnvelope - The remote sync envelope.
   * @param {Object} categoryFlags - Flags identifying categories to include.
   * @param {string} writerId - Identifier of the envelope writer.
   * @return {Object} The merged envelope with category data, timestamps, export time, version, and writer identifier.
   */
  function buildMergedEnvelope(localEnvelope, remoteEnvelope, categoryFlags, writerId) {
    var enabled = enabledCategoryList(categoryFlags);
    var localCategories = localEnvelope && isObject(localEnvelope.categories) ? localEnvelope.categories : {};
    var remoteCategories = remoteEnvelope && isObject(remoteEnvelope.categories) ? remoteEnvelope.categories : {};
    var categories = {};

    enabled.forEach(function(categoryId) {
      var localCategory = localCategories[categoryId];
      var remoteCategory = remoteCategories[categoryId];
      var localUpdatedAt = localCategory && typeof localCategory.updatedAt === "number" ? localCategory.updatedAt : 0;
      var remoteUpdatedAt = remoteCategory && typeof remoteCategory.updatedAt === "number" ? remoteCategory.updatedAt : 0;

      if (!remoteCategory && !localCategory) {
        return;
      }
      if (!remoteCategory) {
        categories[categoryId] = {
          data: clone(localCategory.data),
          updatedAt: localUpdatedAt || nowMs()
        };
        return;
      }
      if (!localCategory) {
        categories[categoryId] = {
          data: clone(remoteCategory.data),
          updatedAt: remoteUpdatedAt || nowMs()
        };
        return;
      }

      categories[categoryId] = {
        data: mergeCategoryData(categoryId, localCategory.data, remoteCategory.data, localUpdatedAt, remoteUpdatedAt),
        updatedAt: Math.max(localUpdatedAt, remoteUpdatedAt) || nowMs()
      };
    });

    return {
      categories: categories,
      exportedAt: nowMs(),
      version: ENVELOPE_VERSION,
      writerId: writerId || ""
    };
  }

  /**
   * Resolves category conflicts in a merged synchronization envelope.
   * @param {Object} localEnvelope - The local synchronization envelope.
   * @param {Object} remoteEnvelope - The remote synchronization envelope.
   * @param {Object} categoryFlags - Category enablement flags.
   * @param {Array<Object>} conflicts - Conflicts identifying categories to resolve.
   * @param {string} resolution - Resolution mode; `"keep_remote"` selects remote data, while other values select local data.
   * @param {string} writerId - Identifier for the envelope writer.
   * @return {Object} The resolved envelope with an updated export timestamp.
   */
  function buildResolvedEnvelope(localEnvelope, remoteEnvelope, categoryFlags, conflicts, resolution, writerId) {
    var merged = buildMergedEnvelope(localEnvelope, remoteEnvelope, categoryFlags, writerId);
    var localCategories = localEnvelope && localEnvelope.categories || {};
    var remoteCategories = remoteEnvelope && remoteEnvelope.categories || {};
    (conflicts || []).forEach(function(conflict) {
      var categoryId = conflict.categoryId;
      var chosen = resolution === "keep_remote" ? remoteCategories[categoryId] : localCategories[categoryId];
      if (chosen) {
        merged.categories[categoryId] = clone(chosen);
      }
    });
    merged.exportedAt = nowMs();
    return merged;
  }

  /**
   * Records the applied envelope as the baseline for enabled sync categories.
   *
   * @param {Object} localMeta - Current Drive sync metadata.
   * @param {Object} envelope - Applied envelope containing category data and timestamps.
   * @param {Object} categoryFlags - Flags identifying the categories to update.
   * @return {Object} Updated metadata with category timestamps, baseline data, and envelope version.
   */
  function mergeEnvelopeAfterSync(localMeta, envelope, categoryFlags) {
    var meta = normalizeDriveMeta(localMeta);
    var mergedAt = meta.lastMergedAt;
    var timestamps = meta.categoryTimestamps;
    enabledCategoryList(categoryFlags).forEach(function(categoryId) {
      var remoteCategory = envelope.categories && envelope.categories[categoryId];
      var remoteUpdatedAt = remoteCategory && typeof remoteCategory.updatedAt === "number"
        ? remoteCategory.updatedAt
        : timestamps[categoryId] || nowMs();
      var localUpdatedAt = timestamps[categoryId] || remoteUpdatedAt;
      mergedAt[categoryId] = Math.max(localUpdatedAt, remoteUpdatedAt, mergedAt[categoryId] || 0);
      timestamps[categoryId] = mergedAt[categoryId];
      meta.baselineCategories[categoryId] = clone(remoteCategory && remoteCategory.data);
    });
    meta.lastMergedAt = mergedAt;
    meta.categoryTimestamps = timestamps;
    meta.envelopeVersion = envelope && envelope.version || ENVELOPE_VERSION;
    return meta;
  }

  /**
   * Determines whether the manifest contains a configured OAuth client ID.
   * @param {Object} manifest - Extension manifest containing OAuth configuration.
   * @return {boolean} `true` if the OAuth client ID is present and not a placeholder, `false` otherwise.
   */
  function isOAuthConfigured(manifest) {
    var oauth = manifest && manifest.oauth2;
    if (!oauth || !oauth.client_id) {
      return false;
    }
    return oauth.client_id !== PLACEHOLDER_CLIENT_ID;
  }

  function isGoogleClientIdFormat(value) {
    return /^[0-9]+-[a-z0-9._-]+\.apps\.googleusercontent\.com$/i.test(String(value || ""));
  }

  function getDriveWebClientId() {
    var config = getDriveConfig();
    return String(config.driveWebClientId || "").trim();
  }

  function setWebClientId(clientId) {
    var config = getDriveConfig();
    config.driveWebClientId = String(clientId || "").trim();
  }

  function isDriveWebOAuthConfigured() {
    var clientId = getDriveWebClientId();
    return !!clientId && clientId !== PLACEHOLDER_WEB_CLIENT_ID && isGoogleClientIdFormat(clientId);
  }

  function isDriveAuthConfigured(manifest, authProvider) {
    if (authProvider === "web_fallback") {
      return isDriveWebOAuthConfigured();
    }
    if (authProvider === "chrome_identity") {
      return isOAuthConfigured(manifest);
    }
    throw new Error("Unsupported Drive authentication provider: " + authProvider);
  }

  async function detectBraveBrowser() {
    var nav = typeof navigator !== "undefined" ? navigator : root.navigator;
    if (!nav || !nav.brave || typeof nav.brave.isBrave !== "function") {
      return false;
    }
    try {
      return !!await nav.brave.isBrave();
    } catch (error) {
      return false;
    }
  }

  function normalizeDriveError(error, fallbackCode) {
    var source = error || {};
    var code = source.code || fallbackCode || "unknown";
    var message = source.userMessage || source.message || "Drive sync failed.";
    return {
      code: code,
      message: String(message || "Drive sync failed.")
    };
  }

  function createDriveError(code, userMessage, debugMessage) {
    var error = new Error(debugMessage || userMessage || "Drive sync failed.");
    error.code = code || "unknown";
    error.userMessage = userMessage || "Drive sync failed.";
    return error;
  }

  function storageLocalGet(key) {
    return new Promise(function(resolve) {
      if (!chrome.storage || !chrome.storage.local || typeof chrome.storage.local.get !== "function") {
        resolve({});
        return;
      }
      chrome.storage.local.get(key, function(result) {
        resolve(result || {});
      });
    });
  }

  function storageLocalSet(values) {
    return new Promise(function(resolve) {
      if (!chrome.storage || !chrome.storage.local || typeof chrome.storage.local.set !== "function") {
        resolve();
        return;
      }
      chrome.storage.local.set(values, function() {
        resolve();
      });
    });
  }

  function storageLocalRemove(key) {
    return new Promise(function(resolve) {
      if (!chrome.storage || !chrome.storage.local || typeof chrome.storage.local.remove !== "function") {
        resolve();
        return;
      }
      chrome.storage.local.remove(key, function() {
        resolve();
      });
    });
  }

  function isCustomUriSchemeOAuthError(error) {
    var message = String((error && (error.message || error.userMessage)) || "").toLowerCase();
    return error && error.code === "custom_uri_scheme" || message.indexOf("custom uri scheme") !== -1;
  }

  async function shouldPreferWebAuth() {
    if (isDriveWebAuthPreferred()) {
      return true;
    }
    return detectBraveBrowser();
  }

  function chromeIdentityGetToken(interactive) {
    return new Promise(function(resolve, reject) {
      if (!chrome.identity || typeof chrome.identity.getAuthToken !== "function") {
        reject(new Error("chrome.identity is not available."));
        return;
      }
      chrome.identity.getAuthToken({ interactive: !!interactive }, function(token) {
        if (chrome.runtime.lastError) {
          var rawMessage = String(chrome.runtime.lastError.message || "");
          var lower = rawMessage.toLowerCase();
          if (lower.indexOf("custom uri scheme") !== -1) {
            reject(createDriveError(
              "custom_uri_scheme",
              "Google sign-in needs the Brave-compatible web OAuth fallback.",
              rawMessage
            ));
            return;
          }
          if (
            lower.indexOf("invalid_client") !== -1
            || lower.indexOf("bad client id") !== -1
            || lower.indexOf("client id") !== -1
          ) {
            reject(createDriveError(
              "invalid_client_type",
              "OAuth client rejected. Drive sync requires a Chrome extension OAuth client (Desktop clients are not supported for extension sync).",
              rawMessage
            ));
            return;
          }
          reject(createDriveError(
            "auth",
            interactive
              ? "Google sign-in failed. Check account access and try again."
              : "Background sync needs interactive sign-in. Run Sync now once to authorize.",
            rawMessage
          ));
          return;
        }
        if (!token) {
          reject(createDriveError(
            "auth",
            "Google sign-in did not return an access token."
          ));
          return;
        }
        resolve(token);
      });
    });
  }

  function chromeIdentityRemoveCachedToken(token) {
    return new Promise(function(resolve) {
      if (!chrome.identity || typeof chrome.identity.removeCachedAuthToken !== "function") {
        resolve();
        return;
      }
      chrome.identity.removeCachedAuthToken({ token: token }, function() {
        resolve();
      });
    });
  }

  async function getFreshDriveWebToken(interactive) {
    if (!isDriveWebOAuthConfigured()) {
      throw createDriveError(
        "auth",
        "Brave fallback not configured. Add a Web OAuth client ID for Drive sync."
      );
    }
    if (!interactive) {
      throw createDriveError(
        "auth",
        "Background sync needs interactive sign-in. Run Sync now once to authorize."
      );
    }
    if (!chrome.identity || typeof chrome.identity.getRedirectURL !== "function") {
      throw createDriveError("auth", "Brave-compatible Google sign-in is not available in this browser.");
    }

    var state = "drive_" + nowMs() + "_" + Math.random().toString(36).slice(2);
    var authUrl = buildDriveWebAuthUrl(state);
    var redirectUrl = await launchDriveWebAuthFlow(authUrl, interactive);
    var parsed = parseDriveWebAuthRedirect(redirectUrl, state);
    await writeCachedDriveWebToken(parsed.accessToken, parsed.expiresIn);
    return {
      authProvider: "web_fallback",
      token: parsed.accessToken
    };
  }

  async function readCachedDriveWebToken() {
    var result = await storageLocalGet(DRIVE_WEB_AUTH_CACHE_KEY);
    var cached = result && result[DRIVE_WEB_AUTH_CACHE_KEY];
    if (!cached || !cached.accessToken || typeof cached.expiresAt !== "number") {
      return null;
    }
    if (cached.expiresAt <= nowMs() + DRIVE_WEB_AUTH_EXPIRY_SKEW_MS) {
      await storageLocalRemove(DRIVE_WEB_AUTH_CACHE_KEY);
      return null;
    }
    return cached;
  }

  async function writeCachedDriveWebToken(accessToken, expiresInSeconds) {
    var ttlMs = Math.max(60, Number(expiresInSeconds) || 3600) * 1000;
    await storageLocalSet((function() {
      var payload = {};
      payload[DRIVE_WEB_AUTH_CACHE_KEY] = {
        accessToken: accessToken,
        expiresAt: nowMs() + ttlMs
      };
      return payload;
    })());
  }

  function buildDriveWebAuthUrl(state) {
    var redirectUri = chrome.identity.getRedirectURL(DRIVE_WEB_AUTH_PATH);
    var params = new URLSearchParams({
      client_id: getDriveWebClientId(),
      include_granted_scopes: "true",
      redirect_uri: redirectUri,
      response_type: "token",
      scope: DRIVE_SCOPE,
      state: state
    });
    return GOOGLE_OAUTH_AUTH_URL + "?" + params.toString();
  }

  function parseDriveWebAuthRedirect(redirectUrl, expectedState) {
    var parsed = new URL(redirectUrl);
    var hashParams = new URLSearchParams(String(parsed.hash || "").replace(/^#/, ""));
    var queryParams = parsed.searchParams;
    var state = hashParams.get("state") || queryParams.get("state") || "";
    if (state !== expectedState) {
      throw createDriveError("auth", "Google sign-in returned an invalid OAuth state.");
    }
    var error = hashParams.get("error") || queryParams.get("error") || "";
    if (error) {
      throw createDriveError("auth", "Google sign-in failed. Check account access and try again.", error);
    }
    var accessToken = hashParams.get("access_token") || queryParams.get("access_token") || "";
    if (!accessToken) {
      throw createDriveError("auth", "Google sign-in did not return an access token.");
    }
    return {
      accessToken: accessToken,
      expiresIn: Number(hashParams.get("expires_in") || queryParams.get("expires_in") || 3600)
    };
  }

  function launchDriveWebAuthFlow(authUrl, interactive) {
    return new Promise(function(resolve, reject) {
      if (!chrome.identity || typeof chrome.identity.launchWebAuthFlow !== "function") {
        reject(createDriveError("auth", "Brave-compatible Google sign-in is not available in this browser."));
        return;
      }
      chrome.identity.launchWebAuthFlow({
        interactive: !!interactive,
        url: authUrl
      }, function(redirectUrl) {
        if (chrome.runtime.lastError) {
          reject(createDriveError(
            "auth",
            interactive
              ? "Google sign-in failed. Check account access and try again."
              : "Background sync needs interactive sign-in. Run Sync now once to authorize.",
            chrome.runtime.lastError.message
          ));
          return;
        }
        if (!redirectUrl) {
          reject(createDriveError("auth", "Google sign-in did not complete."));
          return;
        }
        resolve(redirectUrl);
      });
    });
  }

  async function acquireDriveWebToken(interactive) {
    var cached = await readCachedDriveWebToken();
    if (cached) {
      return {
        authProvider: "web_fallback",
        token: cached.accessToken
      };
    }
    return getFreshDriveWebToken(interactive);
  }

  async function acquireDriveToken(interactive) {
    var preferWebAuth = await shouldPreferWebAuth();
    if (preferWebAuth) {
      if (isDriveWebOAuthConfigured()) {
        return acquireDriveWebToken(interactive);
      }
      if (interactive) {
        throw createDriveError(
          "auth",
          "Brave requires a Web OAuth client ID for Drive sync. Configure it in Dashboard → Sync Status → Drive OAuth Configuration."
        );
      }
      try {
        return {
          authProvider: "chrome_identity",
          token: await chromeIdentityGetToken(false)
        };
      } catch (chromeErr) {
        if (isCustomUriSchemeOAuthError(chromeErr)) {
          throw createDriveError(
            "auth",
            "Brave requires a Web OAuth client ID for Drive sync. Configure it in Dashboard → Sync Status → Drive OAuth Configuration."
          );
        }
        throw chromeErr;
      }
    }
    try {
      return {
        authProvider: "chrome_identity",
        token: await chromeIdentityGetToken(interactive)
      };
    } catch (error) {
      if (!isCustomUriSchemeOAuthError(error)) {
        throw error;
      }
      return acquireDriveWebToken(interactive);
    }
  }

  function normalizeTokenResult(value) {
    if (value && typeof value === "object") {
      return {
        authProvider: value.authProvider || "chrome_identity",
        token: value.token || value.accessToken || ""
      };
    }
    return {
      authProvider: "chrome_identity",
      token: value || ""
    };
  }

  async function clearDriveAuthToken(token) {
    await chromeIdentityRemoveCachedToken(token);
    await storageLocalRemove(DRIVE_WEB_AUTH_CACHE_KEY);
  }

  function parseRetryAfterMs(value) {
    var normalized = String(value || "").trim();
    if (!normalized) {
      return 0;
    }
    var seconds = Number(normalized);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }
    var retryAt = Date.parse(normalized);
    return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs()) : 0;
  }

  function logDriveRetry(operation, attempt, delayMs, error) {
    var payload = {
      attempt: attempt,
      delayMs: delayMs,
      errorCode: error && error.code ? error.code : "network",
      httpStatus: error && typeof error.httpStatus === "number" ? error.httpStatus : null,
      operation: operation || "drive_request"
    };
    if (root.ExtensityLogger && typeof root.ExtensityLogger.warn === "function") {
      root.ExtensityLogger.warn("drive_api_retry", payload);
      return;
    }
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("drive_api_retry", payload);
    }
  }

  async function driveApiRequest(token, path, options) {
    var config = options || {};
    var headers = Object.assign({
      Authorization: "Bearer " + token
    }, config.headers || {});
    var AbortControllerClass = root.AbortController
      || (typeof AbortController !== "undefined" ? AbortController : null);
    var controller = AbortControllerClass ? new AbortControllerClass() : null;
    var timeoutMs = typeof config.timeoutMs === "number" ? config.timeoutMs : DRIVE_REQUEST_TIMEOUT_MS;
    var timeoutId = controller ? setTimeout(function() {
      controller.abort();
    }, timeoutMs) : null;
    var response;
    try {
      response = await fetch("https://www.googleapis.com" + path, {
        body: config.body,
        headers: headers,
        method: config.method || "GET",
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      if (controller && controller.signal.aborted) {
        var timeoutError = createDriveError(
          "timeout",
          "Google Drive request timed out. Try again.",
          "Google Drive request timed out after " + timeoutMs + " ms."
        );
        timeoutError.name = "DriveTimeoutError";
        throw timeoutError;
      }
      throw error;
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }

    if (response.status === 401) {
      var authError = createDriveError(
        "auth",
        "Google authorization expired. Run Sync now to sign in again.",
        "Google Drive authorization expired."
      );
      authError.httpStatus = 401;
      throw authError;
    }

    if (!response.ok) {
      var errorText = await response.text();
      var httpStatus = response.status;
      var apiError = createDriveError(
        httpStatus === 404 ? "not_found" : "drive_api",
        httpStatus >= 500
          ? "Google Drive service is temporarily unavailable."
          : "Google Drive request failed. Check OAuth client setup and try again.",
        "Drive API error (" + httpStatus + "): " + errorText
      );
      apiError.httpStatus = httpStatus;
      apiError.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      throw apiError;
    }

    if (config.responseType === "text") {
      return response.text();
    }
    if (config.responseType === "blob") {
      return response.blob();
    }
    if (response.status === 204) {
      return null;
    }
    var contentType = response.headers.get("content-type") || "";
    if (contentType.indexOf("application/json") === -1) {
      return response.text();
    }
    return response.json();
  }

  function isRetryableDriveError(error) {
    var httpStatus = error && typeof error.httpStatus === "number" ? error.httpStatus : 0;
    return DRIVE_RETRYABLE_HTTP_STATUSES.indexOf(httpStatus) !== -1
      || error instanceof TypeError
      || (error && (error.name === "TypeError" || error.code === "timeout"));
  }

  /**
   * Executes a Google Drive request with token refresh and retry handling.
   * @param {string} token - The initial authentication token.
   * @param {string} path - The Drive API request path.
   * @param {Object} [options] - Request and retry configuration.
   * @param {string} [options.operation] - Operation name used for retry reporting.
   * @param {boolean} [options.interactive] - Whether token refresh may prompt for authentication.
   * @param {Function} [options.getFreshToken] - Callback that obtains a refreshed token.
   * @param {Function} [options.onTokenRefresh] - Callback invoked after the token is refreshed.
   * @param {Function} [options.sleep] - Delay callback used between retries.
   * @returns {*} The Drive API response.
   * @throws {Object} The final request error when retries are exhausted or the error is not retryable.
   */
  async function retryDriveApiRequest(token, path, options) {
    var config = options || {};
    var currentToken = token;
    var attempt = 0;
    var tokenRefreshed = false;
    var operation = config.operation || "drive_request";

    while (attempt < DRIVE_MAX_RETRIES) {
      try {
        return await driveApiRequest(currentToken, path, config);
      } catch (error) {
        var isAuthError = error && error.code === "auth";
        var canRetry = attempt < DRIVE_MAX_RETRIES - 1;

        if (isAuthError && canRetry && !tokenRefreshed) {
          await clearDriveAuthToken(currentToken);
          var nextTokenResult = typeof config.getFreshToken === "function"
            ? normalizeTokenResult(await config.getFreshToken())
            : normalizeTokenResult(await chromeIdentityGetToken(!!config.interactive));
          currentToken = nextTokenResult.token;
          tokenRefreshed = true;
          if (typeof config.onTokenRefresh === "function") {
            config.onTokenRefresh(currentToken, nextTokenResult.authProvider);
          }
          attempt += 1;
          continue;
        }

        if (isRetryableDriveError(error) && canRetry) {
          var exponentialDelay = DRIVE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          var delayMs = Math.max(exponentialDelay, Number(error.retryAfterMs) || 0);
          logDriveRetry(operation, attempt + 1, delayMs, error);
          if (typeof config.sleep === "function") {
            await config.sleep(delayMs);
          } else {
            await sleep(delayMs);
          }
          attempt += 1;
          continue;
        }

        if (isRetryableDriveError(error) && !canRetry) {
          error.message = String(error.message || "Google Drive request failed.")
            + " Failed after " + DRIVE_MAX_RETRIES + " attempts.";
        }

        throw error;
      }
    }

    throw createDriveError("sync_failed", "Google Drive request failed.");
  }

  /**
   * Selects the newest matching Drive sync file and reports duplicate candidates.
   * @param {Array<Object>} files - Drive file metadata candidates.
   * @return {Object|null} The newest matching file with its duplicate count, or `null` if no match exists.
   */
  function selectNewestDriveFile(files) {
    var matches = (Array.isArray(files) ? files : []).filter(function(file) {
      return file && file.name === DRIVE_FILE_NAME && file.id;
    }).slice();
    matches.sort(function(left, right) {
      var modifiedOrder = String(right.modifiedTime || "").localeCompare(String(left.modifiedTime || ""));
      if (modifiedOrder !== 0) {
        return modifiedOrder;
      }
      return String(left.id).localeCompare(String(right.id));
    });
    if (!matches.length) {
      return null;
    }
    return Object.assign({}, matches[0], {
      duplicateCount: Math.max(0, matches.length - 1)
    });
  }

  /**
   * Finds the newest Extensity sync file in the Drive app data folder.
   * @param {Function} requestDriveApi - Performs an authenticated Drive API request.
   * @return {Object|null} The newest matching file, including older matching files in `duplicates`, or `null` when no matching file exists.
   */
  async function findDriveFile(requestDriveApi) {
    var query = "name='" + DRIVE_FILE_NAME.replace(/'/g, "\\'") + "' and trashed=false";
    var result = await requestDriveApi(
      "/drive/v3/files?spaces=appDataFolder&pageSize=100&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime,size,version)&q=" + encodeURIComponent(query),
      { operation: "find_sync_file" }
    );
    var files = result && Array.isArray(result.files) ? result.files : [];
    var selected = selectNewestDriveFile(files);
    if (selected) {
      selected.duplicates = files.filter(function(file) {
        return file && file.id && file.id !== selected.id && file.name === DRIVE_FILE_NAME;
      });
    }
    return selected;
  }

  /**
   * Retrieves metadata for a Drive sync file.
   * @param {string} fileId - The Drive file identifier.
   * @returns {Object|null} The file metadata, or `null` when no file ID is provided.
   */
  async function getDriveFileMetadata(requestDriveApi, fileId) {
    if (!fileId) {
      return null;
    }
    return requestDriveApi(
      "/drive/v3/files/" + encodeURIComponent(fileId) + "?fields=id,name,modifiedTime,size,version",
      { operation: "get_sync_file_metadata" }
    );
  }

  /**
   * Downloads and parses a Drive sync file.
   * @param {string} fileId - The Drive file identifier.
   * @return {Object|null} The parsed file contents, or `null` if the file is empty.
   * @throws {Error} If the file contents are not valid JSON.
   */
  async function downloadDriveFile(requestDriveApi, fileId) {
    var raw = await requestDriveApi(
      "/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media",
      { operation: "download_sync_file", responseType: "text" }
    );
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error("Drive sync file is not valid JSON.");
    }
  }

  /**
   * Creates the sync file in Google Drive's app data folder, safely reusing a matching file after a creation conflict.
   * @param {Function} requestDriveApi - Function used to make authenticated Drive API requests.
   * @param {string} content - JSON content to store in the sync file.
   * @returns {string} The created or safely reused Drive file ID.
   */
  async function createDriveFile(requestDriveApi, content) {
    var generated = await requestDriveApi(
      "/drive/v3/files/generateIds?count=1&space=appDataFolder&fields=ids",
      { operation: "generate_sync_file_id" }
    );
    var generatedId = generated && Array.isArray(generated.ids) ? generated.ids[0] : "";
    if (!generatedId) {
      throw createDriveError(
        "drive_api",
        "Google Drive did not provide an ID for the sync file."
      );
    }
    var metadata = {
      id: generatedId,
      mimeType: "application/json",
      name: DRIVE_FILE_NAME,
      parents: ["appDataFolder"]
    };
    var boundary = "extensity_drive_" + nowMs();
    var body =
      "--" + boundary + "\r\n" +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) + "\r\n" +
      "--" + boundary + "\r\n" +
      "Content-Type: application/json\r\n\r\n" +
      content + "\r\n" +
      "--" + boundary + "--";

    try {
      var created = await requestDriveApi("/upload/drive/v3/files?uploadType=multipart&fields=id", {
        body: body,
        headers: {
          "Content-Type": "multipart/related; boundary=" + boundary
        },
        method: "POST",
        operation: "create_sync_file"
      });
      return created && created.id ? created.id : generatedId;
    } catch (error) {
      if (!error || error.httpStatus !== 409) {
        throw error;
      }
      var existing = await downloadDriveFile(requestDriveApi, generatedId);
      var expected;
      try {
        expected = JSON.parse(content);
      } catch (parseError) {
        throw createDriveError("drive_create_conflict", "Drive sync file creation conflicted with different content.");
      }
      if (dataEqual(existing, expected)) {
        return generatedId;
      }
      throw createDriveError(
        "drive_create_conflict",
        "Drive sync file creation conflicted with different content. No duplicate was created."
      );
    }
  }

  /**
   * Update the contents of an existing Drive sync file.
   * @param {string} fileId - The Drive file identifier.
   * @param {string} content - The serialized JSON content to upload.
   * @return {Object} The updated Drive file response.
   */
  async function updateDriveFile(requestDriveApi, fileId, content) {
    return requestDriveApi(
      "/upload/drive/v3/files/" + encodeURIComponent(fileId) + "?uploadType=media&fields=id,modifiedTime,size,version",
      {
        body: content,
        headers: {
          "Content-Type": "application/json"
        },
        method: "PATCH",
        operation: "update_sync_file"
      }
    );
  }

  /**
   * Reads a remote Drive sync envelope and its associated file metadata.
   * @param {Function} requestDriveApi - Function used to make Drive API requests.
   * @param {string} fileId - ID of the Drive file to read.
   * @return {{envelope: Object|null, file: Object|null}} The envelope and file metadata, or null values when the file is missing or cannot be found.
   */
  async function readRemoteEnvelope(requestDriveApi, fileId) {
    if (!fileId) {
      return { envelope: null, file: null };
    }
    try {
      var file = await getDriveFileMetadata(requestDriveApi, fileId);
      return {
        envelope: await downloadDriveFile(requestDriveApi, fileId),
        file: file || { id: fileId }
      };
    } catch (error) {
      if (error.code === "not_found") {
        return { envelope: null, file: null };
      }
      throw error;
    }
  }

  /**
   * Writes an envelope to an existing Drive file or creates a new sync file.
   * @param {string|null} fileId - The existing Drive file ID, or a falsy value to create a file.
   * @param {Object} envelope - The envelope to serialize and store.
   * @return {Object} Metadata for the written file, including its ID.
   */
  async function writeRemoteEnvelope(requestDriveApi, fileId, envelope) {
    var serialized = JSON.stringify(envelope);
    if (fileId) {
      return await updateDriveFile(requestDriveApi, fileId, serialized) || { id: fileId };
    }
    var createdId = await createDriveFile(requestDriveApi, serialized);
    return await getDriveFileMetadata(requestDriveApi, createdId) || { id: createdId };
  }

  /**
   * Writes an envelope to Drive, detects concurrent changes, and verifies the stored content.
   * @param {Function} requestDriveApi - Function used to make authenticated Drive API requests.
   * @param {Object|null} file - Existing Drive file metadata, if available.
   * @param {Object} envelope - Envelope to write.
   * @returns {Object} Metadata for the verified Drive file.
   */
  async function writeRemoteEnvelopeVerified(requestDriveApi, file, envelope) {
    var expectedVersion = file && file.version || null;
    if (file && file.id && expectedVersion != null) {
      var current = await getDriveFileMetadata(requestDriveApi, file.id);
      if (current && String(current.version) !== String(expectedVersion)) {
        throw createDriveError(
          "drive_concurrent_update",
          "The Drive backup changed while synchronization was running. Please retry."
        );
      }
    }
    var written = await writeRemoteEnvelope(requestDriveApi, file && file.id, envelope);
    var verified = await downloadDriveFile(requestDriveApi, written.id);
    if (!dataEqual(verified, envelope)) {
      throw createDriveError(
        "drive_verification_failed",
        "Drive wrote different data than expected. The recovery journal was retained."
      );
    }
    return written;
  }

  /**
   * Creates a sync result with a status and creation timestamp.
   * @param {string} status - The sync operation status.
   * @param {Object} [details] - Additional result properties to include.
   * @return {Object} The sync result containing the status, timestamp, and additional details.
   */
  function buildSyncResult(status, details) {
    return Object.assign({
      status: status,
      at: nowMs()
    }, details || {});
  }

  /**
   * Tests Drive authentication, connectivity, sync-file access, and optional conflict detection.
   * @param {Object} [options] - Test configuration.
   * @param {Function} [options.loadContext] - Loads local sync context for dry-run conflict detection.
   * @param {Function} [options.sleep] - Delays retry attempts.
   * @return {Object} A report containing the overall success state, timestamp, and per-step results.
   */
  async function testDriveConnection(options) {
    var config = options || {};
    var report = {
      success: false,
      timestamp: new Date().toISOString(),
      steps: []
    };
    var token = null;
    var authProvider = null;
    var fileId = null;
    var remoteEnvelope = null;

    function step(name, status, detail) {
      report.steps.push({ name: name, status: status, detail: detail || null });
    }

    var manifest = chrome.runtime.getManifest();
    var preferredAuthProvider = await shouldPreferWebAuth() ? "web_fallback" : "chrome_identity";
    if (!isDriveAuthConfigured(manifest, preferredAuthProvider)) {
      step(
        "oauth_config",
        "fail",
        preferredAuthProvider === "web_fallback"
          ? "No valid Brave Web OAuth client ID is configured."
          : "No valid OAuth client ID in manifest.json. Drive sync is not configured."
      );
      return report;
    }
    step(
      "oauth_config",
      "ok",
      preferredAuthProvider === "web_fallback"
        ? "Brave Web OAuth client ID is configured."
        : "OAuth client ID: " + (manifest.oauth2 && manifest.oauth2.client_id || "")
    );

    var env;
    try {
      env = await getExtensionEnvironment();
      step("environment", "ok", "Extension ID: " + env.extensionId + " (" + env.installType + ")");
    } catch (envError) {
      step("environment", "warn", "Could not read extension environment: " + (envError.message || "unknown"));
      env = { extensionId: "", installType: "unknown" };
    }

    if (isDriveWebOAuthConfigured()) {
      step("web_fallback", "ok", "Web OAuth fallback is configured (Brave-compatible).");
    } else {
      step("web_fallback", "info", "Web OAuth fallback not configured. Chrome-only sync active.");
    }

    try {
      var tokenResult = await acquireDriveToken(true);
      token = tokenResult.token;
      authProvider = tokenResult.authProvider;
      step("auth", "ok", "Token acquired via " + authProvider + ".");
    } catch (authError) {
      step("auth", "fail", authError.userMessage || authError.message || "Authentication failed.");
      return report;
    }

    function requestTestDriveApi(path, requestOptions) {
      return retryDriveApiRequest(token, path, Object.assign({}, requestOptions || {}, {
        getFreshToken: function() {
          return acquireDriveToken(true);
        },
        interactive: true,
        onTokenRefresh: function(nextToken, nextAuthProvider) {
          token = nextToken;
          authProvider = nextAuthProvider || authProvider;
        },
        sleep: config.sleep
      }));
    }

    try {
      var listResult = await requestTestDriveApi(
        "/drive/v3/files?spaces=appDataFolder&fields=files(id,name,size,modifiedTime)&pageSize=100",
        { operation: "test_connection_list" }
      );
      var files = listResult && Array.isArray(listResult.files) ? listResult.files : [];
      step("drive_list", "ok", "Drive appDataFolder reachable. " + files.length + " file(s) found.");

      var syncEntry = selectNewestDriveFile(files);
      if (syncEntry) {
        fileId = syncEntry.id;
        var sizeKb = syncEntry.size
          ? (Math.round(Number(syncEntry.size) / 102.4) / 10) + " KB"
          : "unknown size";
        step(
          "sync_file",
          "ok",
          "Sync file found. ID: " + fileId
            + ". Size: " + sizeKb
            + ". Modified: " + (syncEntry.modifiedTime || "unknown")
            + ". Duplicate count: " + syncEntry.duplicateCount + "."
        );
      } else {
        step("sync_file", "info", "Sync file not found. First sync will create it.");
      }
    } catch (listError) {
      step("drive_list", "fail", listError.userMessage || listError.message || "Failed to list Drive files.");
      return report;
    }

    if (fileId) {
      try {
        remoteEnvelope = await downloadDriveFile(requestTestDriveApi, fileId);
        if (remoteEnvelope) {
          var cats = remoteEnvelope.categories ? Object.keys(remoteEnvelope.categories) : [];
          step("dry_run_read", "ok", "Remote envelope parsed. Categories: " + (cats.join(", ") || "none") + ". Version: " + (remoteEnvelope.version || "unknown") + ".");
        } else {
          step("dry_run_read", "warn", "Remote sync file exists but could not be parsed.");
        }
      } catch (readError) {
        step("dry_run_read", "warn", "Could not read remote sync file: " + (readError.userMessage || readError.message || "read failed") + ".");
      }
    } else {
      step("dry_run_read", "skip", "Skipped — no remote sync file exists yet.");
    }

    if (typeof config.loadContext === "function") {
      try {
        var context = await config.loadContext();
        var categoryFlags = normalizeCategoryFlags(context.options && context.options.driveSyncCategories);
        var localMeta = normalizeDriveMeta(context.localState && context.localState.driveSyncMeta);
        if (remoteEnvelope) {
          var conflicts = detectConflicts(localMeta, remoteEnvelope, categoryFlags);
          if (conflicts.length === 0) {
            step("dry_run_conflicts", "ok", "No conflicts detected. Local and remote are in sync.");
          } else {
            var labels = conflicts.map(function(c) { return c.label; }).join(", ");
            step("dry_run_conflicts", "warn", "Conflicts in: " + labels + ". A real sync would prompt for resolution.");
          }
        } else {
          step("dry_run_conflicts", "info", "No remote data to compare. First sync will push local data.");
        }
      } catch (dryRunError) {
        step("dry_run_conflicts", "warn", "Dry-run comparison failed: " + (dryRunError.message || "unknown error") + ".");
      }
    }

    report.success = !report.steps.some(function(s) { return s.status === "fail"; });

    if (root.ExtensityLogger) {
      var anyFail = !report.success;
      var anyWarn = report.steps.some(function(s) { return s.status === "warn"; });
      var summary = "Drive connection test complete. Steps: " + report.steps.length + ". Auth: " + (authProvider || "none") + ".";
      if (anyFail) {
        root.ExtensityLogger.error(summary);
      } else if (anyWarn) {
        root.ExtensityLogger.warn(summary);
      } else {
        root.ExtensityLogger.info(summary);
      }
    }

    return report;
  }

  /**
   * Synchronize configured extension data with its Google Drive app data file.
   * Supports pull, push, and bidirectional merge flows with conflict detection, preview confirmation, failsafe checks, backups, and transaction tracking.
   * @param {Object} [options] - Synchronization settings and required `loadContext` and `savePatches` callbacks, plus optional persistence callbacks.
   * @return {Object} The synchronization status, changes, conflicts, and associated Drive file ID.
   * @throws {Error} If authentication or configuration is invalid, required callbacks are missing, or synchronization fails.
   */
  async function runSyncDrive(options) {
    var config = options || {};
    var manifest = chrome.runtime.getManifest();
    var preferredAuthProvider = await shouldPreferWebAuth() ? "web_fallback" : "chrome_identity";
    if (!isDriveAuthConfigured(manifest, preferredAuthProvider)) {
      throw createDriveError(
        "not_configured",
        preferredAuthProvider === "web_fallback"
          ? "Drive sync is not configured. Add the Brave Web OAuth client ID in Dashboard → Sync Status."
          : "Drive sync is not configured for this build. Add a Chrome extension OAuth client ID to manifest.json (see docs/google-drive-sync.md)."
      );
    }
    if (
      preferredAuthProvider === "chrome_identity"
      && !isGoogleClientIdFormat(manifest.oauth2 && manifest.oauth2.client_id)
    ) {
      throw createDriveError(
        "invalid_client_id",
        "oauth2.client_id in manifest.json is not a valid Google OAuth client ID."
      );
    }

    var loadContext = config.loadContext;
    var savePatches = config.savePatches;
    var saveDriveMeta = config.saveDriveMeta;
    var saveSyncOptions = config.saveSyncOptions;
    var saveBackup = config.saveBackup;
    var savePendingConflict = config.savePendingConflict;
    var saveTransaction = config.saveTransaction;
    var clearTransaction = config.clearTransaction;
    var appendAudit = config.appendAudit;
    if (typeof loadContext !== "function" || typeof savePatches !== "function") {
      throw new Error("Drive sync requires loadContext and savePatches callbacks.");
    }

    var context = await loadContext();
    var syncOptions = context.options || {};
    var categoryFlags = normalizeCategoryFlags(syncOptions.driveSyncCategories);
    var direction = config.direction || "sync";
    var resolution = config.resolution || null;
    var trigger = config.trigger || (config.interactive === false ? "automatic" : "manual");
    var interactive = config.interactive !== false && (config.interactive === true || direction !== "auto");

    var token;
    var authProvider = "chrome_identity";
    try {
      var tokenResult = await acquireDriveToken(interactive);
      token = tokenResult.token;
      authProvider = tokenResult.authProvider;
    } catch (error) {
      throw error;
    }

    /**
     * Executes a Drive API request with retry and token-refresh handling.
     * @param {string} path - The Drive API path.
     * @param {Object} [requestOptions] - Request options passed to the Drive API client.
     * @return {*} The Drive API response.
     */
    function requestDriveApi(path, requestOptions) {
      return retryDriveApiRequest(token, path, Object.assign({}, requestOptions || {}, {
        interactive: interactive,
        getFreshToken: function() {
          return acquireDriveToken(interactive);
        },
        onTokenRefresh: function(nextToken) {
          token = nextToken;
          authProvider = arguments.length > 1 ? arguments[1] : authProvider;
        }
      }));
    }

    try {
      var driveMeta = normalizeDriveMeta(context.localState.driveSyncMeta);
      var discoveredFile = await findDriveFile(requestDriveApi);
      var selectedFileId = config.selectedFileId || driveMeta.fileId || discoveredFile && discoveredFile.id;
      var localEnvelope = buildEnvelope(context, categoryFlags, syncOptions.syncWriterId || "");

      if (
        discoveredFile
        && Array.isArray(discoveredFile.duplicates)
        && discoveredFile.duplicates.length
        && !config.selectedFileId
      ) {
        var duplicateCandidates = [discoveredFile].concat(discoveredFile.duplicates).map(function(file) {
          return {
            id: file.id,
            modifiedTime: file.modifiedTime || null,
            name: file.name || DRIVE_FILE_NAME,
            size: file.size || null,
            version: file.version || null
          };
        });
        var duplicatePending = buildPendingConflict(
          [],
          discoveredFile,
          localEnvelope,
          "duplicate_remote_files",
          trigger,
          { duplicateFiles: duplicateCandidates }
        );
        if (typeof savePendingConflict === "function") {
          await savePendingConflict(duplicatePending);
        }
        return buildSyncResult("conflict", {
          duplicateFiles: duplicateCandidates,
          pendingConflict: duplicatePending,
          reason: "duplicate_remote_files"
        });
      }

      driveMeta.fileId = selectedFileId || null;
      var remoteRead = await readRemoteEnvelope(requestDriveApi, selectedFileId);
      var remoteEnvelope = remoteRead.envelope;
      var remoteFile = remoteRead.file || discoveredFile;
      if (remoteRead.file && remoteRead.file.id) {
        driveMeta.fileId = remoteRead.file.id;
        driveMeta.fileModifiedTime = remoteRead.file.modifiedTime || null;
        driveMeta.fileSize = remoteRead.file.size || null;
        driveMeta.fileVersion = remoteRead.file.version || null;
      }

      if (
        remoteEnvelope
        && driveMeta.envelopeVersion
        && String(driveMeta.envelopeVersion).indexOf("2.") === 0
        && String(remoteEnvelope.version || "").indexOf("1.") === 0
      ) {
        var schemaPending = buildPendingConflict([], remoteFile, localEnvelope, "schema_regression", trigger);
        if (typeof savePendingConflict === "function") {
          await savePendingConflict(schemaPending);
        }
        return buildSyncResult("conflict", { pendingConflict: schemaPending, reason: "schema_regression" });
      }
      var threeWay = remoteEnvelope
        ? buildThreeWayEnvelope(
          localEnvelope,
          remoteEnvelope,
          driveMeta.baselineCategories,
          categoryFlags,
          resolution,
          syncOptions.syncWriterId || ""
        )
        : null;
      var conflicts = direction === "sync" && threeWay ? threeWay.conflicts : [];
      if (direction === "sync" && conflicts.length && !resolution) {
        var pending = buildPendingConflict(conflicts, remoteFile, localEnvelope, "divergence", trigger);
        if (typeof savePendingConflict === "function") {
          await savePendingConflict(pending);
        }
        if (typeof appendAudit === "function") {
          await appendAudit({ direction: direction, status: "conflict", trigger: trigger, conflicts: conflicts });
        }
        return buildSyncResult("conflict", {
          conflicts: conflicts,
          fileId: driveMeta.fileId,
          pendingConflict: pending
        });
      }
      if (direction === "sync" && conflicts.length && resolution === "cancel") {
        return buildSyncResult("cancelled", { conflicts: conflicts, pendingConflict: context.localState.drivePendingConflict || null });
      }

      var resultEnvelope;
      var status;
      var reason = null;
      if (direction === "pull") {
        if (!remoteEnvelope) {
          return buildSyncResult("noop", { reason: "no_remote_file" });
        }
        resultEnvelope = remoteEnvelope;
        status = "pulled";
      } else if (direction === "push") {
        resultEnvelope = remoteEnvelope ? localEnvelope : stampEnvelopeForInitialUpload(localEnvelope);
        status = "pushed";
      } else if (!remoteEnvelope) {
        resultEnvelope = stampEnvelopeForInitialUpload(localEnvelope);
        status = "pushed";
        reason = "initial_upload";
      } else if (conflicts.length && (resolution === "keep_local" || resolution === "keep_remote")) {
        resultEnvelope = threeWay.envelope;
        status = resolution === "keep_local" ? "resolved_local" : "resolved_remote";
      } else {
        resultEnvelope = threeWay.envelope;
        status = "merged";
      }

      var remoteDiffers = direction !== "pull" && (!remoteEnvelope || mergedDataDiffers(resultEnvelope, remoteEnvelope, categoryFlags));
      var localDiffers = direction !== "push" && mergedDataDiffers(resultEnvelope, localEnvelope, categoryFlags);
      if (!remoteDiffers && !localDiffers) {
        return buildSyncResult("noop", { fileId: driveMeta.fileId });
      }

      var remoteSummary = remoteDiffers ? buildChangeSummary(remoteEnvelope, resultEnvelope, categoryFlags) : [];
      var localSummary = localDiffers ? buildChangeSummary(localEnvelope, resultEnvelope, categoryFlags) : [];
      var failsafeOptions = Object.assign({}, syncOptions, {
        driveAutomaticTrigger: ["change", "periodic", "startup"].indexOf(trigger) >= 0
      });
      var failsafe = findFailsafeViolation(remoteSummary, failsafeOptions) || findFailsafeViolation(localSummary, failsafeOptions);
      var confirmationDetails = {
        direction: direction,
        localHash: envelopeFingerprint(localEnvelope),
        remoteVersion: remoteFile && remoteFile.version || null,
        resolution: resolution
      };
      if (config.preview) {
        return buildSyncResult("preview", {
          changes: remoteSummary.concat(localSummary),
          confirmationToken: createPreviewConfirmation(confirmationDetails),
          expiresInMs: 2 * 60 * 1000,
          failsafe: failsafe,
          local: { bytes: estimatePayloadBytes(localEnvelope) },
          remote: remoteFile ? {
            id: remoteFile.id,
            modifiedTime: remoteFile.modifiedTime || null,
            size: remoteFile.size || null,
            version: remoteFile.version || null
          } : null
        });
      }
      if (config.requireConfirmation) {
        consumePreviewConfirmation(config.confirmationToken, confirmationDetails);
      }
      if (failsafe && !config.overrideFailsafe) {
        var failsafePending = buildPendingConflict(
          [],
          remoteFile,
          localEnvelope,
          "failsafe",
          trigger,
          { failsafe: failsafe }
        );
        if (typeof savePendingConflict === "function") {
          await savePendingConflict(failsafePending);
        }
        if (typeof appendAudit === "function") {
          await appendAudit({ direction: direction, failsafe: failsafe, status: "failsafe", trigger: trigger });
        }
        return buildSyncResult("failsafe", {
          details: failsafe,
          pendingConflict: failsafePending
        });
      }

      var backupRef = null;
      if (typeof saveBackup === "function") {
        backupRef = await saveBackup({
          at: nowMs(),
          direction: direction,
          localEnvelope: localDiffers ? localEnvelope : null,
          remoteEnvelope: remoteDiffers ? remoteEnvelope : null
        });
      }
      var transaction = {
        backupRef: backupRef,
        direction: direction,
        expectedRemoteVersion: remoteFile && remoteFile.version || null,
        phase: "prepared",
        recovery: {
          localSnapshotRequired: localDiffers,
          remoteSnapshotRequired: remoteDiffers
        },
        resultEnvelope: resultEnvelope,
        resultHash: envelopeFingerprint(resultEnvelope),
        startedAt: nowMs()
      };
      if (typeof saveTransaction === "function") {
        await saveTransaction(transaction);
      }

      if (remoteDiffers) {
        var writtenFile = await writeRemoteEnvelopeVerified(requestDriveApi, remoteFile, resultEnvelope);
        driveMeta.fileId = writtenFile.id || driveMeta.fileId;
        driveMeta.fileModifiedTime = writtenFile.modifiedTime || null;
        driveMeta.fileSize = writtenFile.size || null;
        driveMeta.fileVersion = writtenFile.version || null;
        transaction.phase = "remote_verified";
        if (typeof saveTransaction === "function") {
          await saveTransaction(transaction);
        }
      }
      if (localDiffers) {
        await savePatches(buildPatchesFromEnvelope(resultEnvelope, categoryFlags), {
          direction: direction === "pull" ? "pull" : "merge",
          source: "drive"
        });
        transaction.phase = "local_written";
        if (typeof saveTransaction === "function") {
          await saveTransaction(transaction);
        }
      }

      driveMeta = mergeEnvelopeAfterSync(driveMeta, resultEnvelope, categoryFlags);
      await saveDriveMeta(driveMeta);
      await saveSyncOptions({
        lastDriveSync: nowMs(),
        lastDriveSyncError: null
      });
      if (typeof savePendingConflict === "function") {
        await savePendingConflict(null);
      }
      if (typeof appendAudit === "function") {
        await appendAudit({
          changes: remoteSummary.concat(localSummary),
          direction: direction,
          status: status,
          trigger: trigger
        });
      }
      if (typeof clearTransaction === "function") {
        await clearTransaction();
      }
      return buildSyncResult(status, {
        changes: remoteSummary.concat(localSummary),
        conflicts: conflicts,
        fileId: driveMeta.fileId,
        reason: reason
      });
    } catch (error) {
      if (error && error.code === "auth" && token) {
        await clearDriveAuthToken(token, authProvider);
      }
      throw normalizeDriveError(error, "sync_failed");
    }
  }

  /**
   * Coordinates a Drive synchronization while preventing overlapping runs and retrying eligible concurrent-update conflicts.
   * @param {Object} [options] - Synchronization configuration, including direction, trigger, and conflict resolution settings.
   * @return {Object} The synchronization result.
   */
  async function syncDrive(options) {
    if (activeSyncPromise) {
      if (options && (options.interactive !== false || options.trigger === "manual" || options.trigger === "preview")) {
        return activeSyncPromise.catch(function() {}).then(function() {
          return syncDrive(options);
        });
      }
      return activeSyncPromise;
    }
    var config = options || {};
    activeSyncPromise = (async function() {
      var attempt = 0;
      while (true) {
        try {
          return await runSyncDrive(config);
        } catch (error) {
          attempt += 1;
          if (
            error && error.code === "drive_concurrent_update"
            && !config.resolution
            && (config.direction || "sync") === "sync"
            && attempt < DRIVE_MAX_CONCURRENCY_RETRIES
          ) {
            continue;
          }
          throw error;
        }
      }
    })();
    try {
      return await activeSyncPromise;
    } finally {
      activeSyncPromise = null;
    }
  }

  /**
   * Builds a status snapshot for Drive synchronization and the local sync state.
   * @param {Object} [options] - Status options.
   * @param {Function} [options.loadContext] - Loads the current extension context.
   * @return {Object} The sync status, including category settings, authentication configuration, local and remote file metadata, pending conflicts, transactions, and backup availability.
   */
  async function getDriveSyncStatus(options) {
    var manifest = chrome.runtime.getManifest();
    var loadContext = options && options.loadContext;
    var context = typeof loadContext === "function" ? await loadContext() : { localState: {}, options: {} };
    var environment = context.extensionEnvironment || await getExtensionEnvironment();
    var driveMeta = normalizeDriveMeta(context.driveSyncMeta || context.localState && context.localState.driveSyncMeta);
    var localEnvelope = buildEnvelope(
      context,
      normalizeCategoryFlags(context.options.driveSyncCategories),
      context.options.syncWriterId || ""
    );
    var webAuthPreferred = await shouldPreferWebAuth();
    var preferredAuthProvider = webAuthPreferred ? "web_fallback" : "chrome_identity";
    return {
      categories: normalizeCategoryFlags(context.options.driveSyncCategories),
      authProvider: preferredAuthProvider,
      configured: isDriveAuthConfigured(manifest, preferredAuthProvider),
      driveAuthStatus: context.options.driveAuthStatus || "unknown",
      driveSync: !!context.options.driveSync,
      extensionId: context.extensionId || environment.extensionId || "",
      intervalMinutes: context.options.driveAutoSyncIntervalMinutes || 60,
      installType: normalizeInstallType(context.installType || environment.installType || "unknown"),
      lastDriveSync: context.options.lastDriveSync || null,
      lastDriveSyncError: context.options.lastDriveSyncError || null,
      fileId: driveMeta.fileId || null,
      local: {
        bytes: estimatePayloadBytes(localEnvelope),
        updatedAt: localEnvelope.exportedAt
      },
      pendingConflict: context.localState.drivePendingConflict || null,
      remote: {
        id: driveMeta.fileId || null,
        modifiedTime: driveMeta.fileModifiedTime || null,
        size: driveMeta.fileSize || null,
        version: driveMeta.fileVersion || null
      },
      transaction: context.localState.driveSyncTxn || null,
      backupAvailable: !!(context.localState.driveSyncBackups && context.localState.driveSyncBackups.length),
      webAuthPreferred: webAuthPreferred,
      webFallbackConfigured: isDriveWebOAuthConfigured(),
      webClientId: getDriveWebClientId()
    };
  }

  root.ExtensityDriveSync = {
    CATEGORY_IDS: CATEGORY_IDS,
    CATEGORY_LABELS: CATEGORY_LABELS,
    DEFAULT_CATEGORY_FLAGS: DEFAULT_CATEGORY_FLAGS,
    DRIVE_FILE_NAME: DRIVE_FILE_NAME,
    applyCategoryToPatches: applyCategoryToPatches,
    buildCategoryData: buildCategoryData,
    buildEnvelope: buildEnvelope,
    buildChangeSummary: buildChangeSummary,
    buildPatchesFromEnvelope: buildPatchesFromEnvelope,
    buildResolvedEnvelope: buildResolvedEnvelope,
    buildThreeWayEnvelope: buildThreeWayEnvelope,
    bumpCategoryTimestamp: bumpCategoryTimestamp,
    createDriveFile: createDriveFile,
    mergeCategoryData: mergeCategoryData,
    detectConflicts: detectConflicts,
    detectBraveBrowser: detectBraveBrowser,
    enabledCategoryList: enabledCategoryList,
    acquireDriveToken: acquireDriveToken,
    getExtensionEnvironment: getExtensionEnvironment,
    getDriveSyncStatus: getDriveSyncStatus,
    findFailsafeViolation: findFailsafeViolation,
    isDriveWebOAuthConfigured: isDriveWebOAuthConfigured,
    isOAuthConfigured: isOAuthConfigured,
    isGoogleClientIdFormat: isGoogleClientIdFormat,
    normalizeDriveError: normalizeDriveError,
    normalizeCategoryFlags: normalizeCategoryFlags,
    normalizeDriveMeta: normalizeDriveMeta,
    retryDriveApiRequest: retryDriveApiRequest,
    selectNewestDriveFile: selectNewestDriveFile,
    setWebClientId: setWebClientId,
    syncDrive: syncDrive,
    testDriveConnection: testDriveConnection
  };
})(typeof window !== "undefined" ? window : self);
