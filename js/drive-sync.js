(function(root) {
  var DRIVE_FILE_NAME = "extensity-plus-sync.json";
  var ENVELOPE_VERSION = "1.0.0";
  var DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  var PLACEHOLDER_CLIENT_ID = "REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com";
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
    "driveSyncCategories",
    "lastDriveSync",
    "lastDriveSyncError"
  ];

  function isObject(value) {
    return !!value && Object.prototype.toString.call(value) === "[object Object]";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowMs() {
    return Date.now();
  }

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

  function enabledCategoryList(flags) {
    return CATEGORY_IDS.filter(function(id) {
      return !!normalizeCategoryFlags(flags)[id];
    });
  }

  function normalizeDriveMeta(meta) {
    var source = isObject(meta) ? meta : {};
    return {
      categoryTimestamps: isObject(source.categoryTimestamps) ? clone(source.categoryTimestamps) : {},
      fileId: source.fileId || null,
      lastMergedAt: isObject(source.lastMergedAt) ? clone(source.lastMergedAt) : {}
    };
  }

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

  function buildEnvelope(context, categoryFlags, writerId) {
    var enabled = enabledCategoryList(categoryFlags);
    var meta = normalizeDriveMeta(context.driveSyncMeta);
    var categories = {};
    enabled.forEach(function(categoryId) {
      categories[categoryId] = {
        data: buildCategoryData(categoryId, context),
        updatedAt: meta.categoryTimestamps[categoryId] || nowMs()
      };
    });

    return {
      categories: categories,
      exportedAt: nowMs(),
      version: ENVELOPE_VERSION,
      writerId: writerId || ""
    };
  }

  function stableSerialize(value) {
    return JSON.stringify(value);
  }

  function dataEqual(left, right) {
    return stableSerialize(left) === stableSerialize(right);
  }

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

  function buildPatchesFromLocal(context, categoryFlags) {
    return buildPatchesFromEnvelope(buildEnvelope(context, categoryFlags, ""), categoryFlags);
  }

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
    });
    meta.lastMergedAt = mergedAt;
    meta.categoryTimestamps = timestamps;
    return meta;
  }

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

  async function driveApiRequest(token, path, options) {
    var config = options || {};
    var headers = Object.assign({
      Authorization: "Bearer " + token
    }, config.headers || {});
    var response = await fetch("https://www.googleapis.com" + path, {
      body: config.body,
      headers: headers,
      method: config.method || "GET"
    });

    if (response.status === 401) {
      var authError = createDriveError(
        "auth",
        "Google authorization expired. Run Sync now to sign in again.",
        "Google Drive authorization expired."
      );
      throw authError;
    }

    if (!response.ok) {
      var errorText = await response.text();
      var apiError = createDriveError(
        response.status === 404 ? "not_found" : "drive_api",
        response.status >= 500
          ? "Google Drive service is temporarily unavailable."
          : "Google Drive request failed. Check OAuth client setup and try again.",
        "Drive API error (" + response.status + "): " + errorText
      );
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

  async function findDriveFile(token) {
    var query = "name='" + DRIVE_FILE_NAME.replace(/'/g, "\\'") + "' and trashed=false";
    var result = await driveApiRequest(
      token,
      "/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&q=" + encodeURIComponent(query)
    );
    var files = result && Array.isArray(result.files) ? result.files : [];
    return files.length ? files[0] : null;
  }

  async function downloadDriveFile(token, fileId) {
    var raw = await driveApiRequest(
      token,
      "/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media",
      { responseType: "text" }
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

  async function createDriveFile(token, content) {
    var metadata = {
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

    var created = await driveApiRequest(token, "/upload/drive/v3/files?uploadType=multipart&fields=id", {
      body: body,
      headers: {
        "Content-Type": "multipart/related; boundary=" + boundary
      },
      method: "POST"
    });
    return created && created.id ? created.id : null;
  }

  async function updateDriveFile(token, fileId, content) {
    await driveApiRequest(
      token,
      "/upload/drive/v3/files/" + encodeURIComponent(fileId) + "?uploadType=media",
      {
        body: content,
        headers: {
          "Content-Type": "application/json"
        },
        method: "PATCH"
      }
    );
  }

  async function readRemoteEnvelope(token, fileId) {
    if (!fileId) {
      return { envelope: null, file: null };
    }
    try {
      return {
        envelope: await downloadDriveFile(token, fileId),
        file: { id: fileId }
      };
    } catch (error) {
      if (error.code === "not_found") {
        return { envelope: null, file: null };
      }
      throw error;
    }
  }

  async function writeRemoteEnvelope(token, fileId, envelope) {
    var serialized = JSON.stringify(envelope);
    if (fileId) {
      await updateDriveFile(token, fileId, serialized);
      return fileId;
    }
    return createDriveFile(token, serialized);
  }

  function summarizeConflicts(conflicts) {
    return conflicts.map(function(entry) {
      return entry.label;
    }).join(", ");
  }

  function buildSyncResult(status, details) {
    return Object.assign({
      status: status,
      at: nowMs()
    }, details || {});
  }

  async function syncDrive(options) {
    var config = options || {};
    var manifest = chrome.runtime.getManifest();
    if (!isOAuthConfigured(manifest)) {
      throw createDriveError(
        "not_configured",
        "Drive sync is not configured for this build. Add a Chrome extension OAuth client ID to manifest.json (see docs/google-drive-sync.md).",
        "Drive sync is not configured for this build. Add a Google Cloud OAuth client ID to manifest.json (see docs/google-drive-sync.md)."
      );
    }
    if (!isGoogleClientIdFormat(manifest.oauth2 && manifest.oauth2.client_id)) {
      throw createDriveError(
        "invalid_client_id",
        "oauth2.client_id in manifest.json is not a valid Google OAuth client ID."
      );
    }

    var loadContext = config.loadContext;
    var savePatches = config.savePatches;
    var saveDriveMeta = config.saveDriveMeta;
    var saveSyncOptions = config.saveSyncOptions;
    if (typeof loadContext !== "function" || typeof savePatches !== "function") {
      throw new Error("Drive sync requires loadContext and savePatches callbacks.");
    }

    var context = await loadContext();
    var syncOptions = context.options || {};
    var categoryFlags = normalizeCategoryFlags(syncOptions.driveSyncCategories);
    var direction = config.direction || "sync";
    var resolution = config.resolution || null;
    var interactive = config.interactive !== false && (config.interactive === true || direction !== "auto");

    var token;
    try {
      token = await chromeIdentityGetToken(interactive);
    } catch (error) {
      throw error;
    }

    try {
      var driveMeta = normalizeDriveMeta(context.localState.driveSyncMeta);
      var fileRecord = driveMeta.fileId ? { id: driveMeta.fileId } : await findDriveFile(token);
      if (fileRecord && fileRecord.id && !driveMeta.fileId) {
        driveMeta.fileId = fileRecord.id;
      }

      var remoteRead = await readRemoteEnvelope(token, driveMeta.fileId);
      var remoteEnvelope = remoteRead.envelope;
      if (remoteRead.file && remoteRead.file.id) {
        driveMeta.fileId = remoteRead.file.id;
      }

      var localEnvelope = buildEnvelope(context, categoryFlags, syncOptions.syncWriterId || "");

      if (direction === "push") {
        var pushedFileId = await writeRemoteEnvelope(token, driveMeta.fileId, localEnvelope);
        driveMeta.fileId = pushedFileId || driveMeta.fileId;
        driveMeta = mergeEnvelopeAfterSync(driveMeta, localEnvelope, categoryFlags);
        await saveDriveMeta(driveMeta);
        await saveSyncOptions({
          lastDriveSync: nowMs(),
          lastDriveSyncError: null
        });
        return buildSyncResult("pushed", { fileId: driveMeta.fileId });
      }

      if (direction === "pull") {
        if (!remoteEnvelope) {
          return buildSyncResult("noop", { reason: "no_remote_file" });
        }
        var pullPatches = buildPatchesFromEnvelope(remoteEnvelope, categoryFlags);
        await savePatches(pullPatches, { source: "drive", direction: "pull" });
        driveMeta = mergeEnvelopeAfterSync(driveMeta, remoteEnvelope, categoryFlags);
        await saveDriveMeta(driveMeta);
        await saveSyncOptions({
          drivePendingConflict: null,
          lastDriveSync: nowMs(),
          lastDriveSyncError: null
        });
        return buildSyncResult("pulled", { fileId: driveMeta.fileId });
      }

      if (!remoteEnvelope) {
        var createdId = await writeRemoteEnvelope(token, null, localEnvelope);
        driveMeta.fileId = createdId || driveMeta.fileId;
        driveMeta = mergeEnvelopeAfterSync(driveMeta, localEnvelope, categoryFlags);
        await saveDriveMeta(driveMeta);
        await saveSyncOptions({
          lastDriveSync: nowMs(),
          lastDriveSyncError: null
        });
        return buildSyncResult("pushed", { fileId: driveMeta.fileId, reason: "initial_upload" });
      }

      var conflicts = detectConflicts(driveMeta, remoteEnvelope, categoryFlags);
      if (conflicts.length && !resolution) {
        await saveSyncOptions({
          drivePendingConflict: {
            at: nowMs(),
            categories: conflicts,
            localEnvelope: localEnvelope,
            remoteEnvelope: remoteEnvelope
          },
          lastDriveSyncError: null
        });
        return buildSyncResult("conflict", {
          conflicts: conflicts,
          message: "Conflicts in: " + summarizeConflicts(conflicts)
        });
      }

      if (conflicts.length && resolution === "cancel") {
        return buildSyncResult("cancelled", { conflicts: conflicts });
      }

      if (conflicts.length && resolution === "keep_local") {
        await writeRemoteEnvelope(token, driveMeta.fileId, localEnvelope);
        driveMeta = mergeEnvelopeAfterSync(driveMeta, localEnvelope, categoryFlags);
        await saveDriveMeta(driveMeta);
        await saveSyncOptions({
          drivePendingConflict: null,
          lastDriveSync: nowMs(),
          lastDriveSyncError: null
        });
        return buildSyncResult("resolved_local", { conflicts: conflicts });
      }

      if (conflicts.length && resolution === "keep_remote") {
        var remotePatches = buildPatchesFromEnvelope(remoteEnvelope, categoryFlags);
        await savePatches(remotePatches, { source: "drive", direction: "pull" });
        driveMeta = mergeEnvelopeAfterSync(driveMeta, remoteEnvelope, categoryFlags);
        await saveDriveMeta(driveMeta);
        await saveSyncOptions({
          drivePendingConflict: null,
          lastDriveSync: nowMs(),
          lastDriveSyncError: null
        });
        return buildSyncResult("resolved_remote", { conflicts: conflicts });
      }

      var remotePatchesAuto = buildPatchesFromEnvelope(remoteEnvelope, categoryFlags);
      var localPatchesAuto = buildPatchesFromLocal(context, categoryFlags);
      var pullNeeded = false;
      var pushNeeded = false;
      enabledCategoryList(categoryFlags).forEach(function(categoryId) {
        var remoteCategory = remoteEnvelope.categories[categoryId];
        var localCategory = localEnvelope.categories[categoryId];
        if (!remoteCategory) {
          pushNeeded = true;
          return;
        }
        if (!localCategory) {
          pullNeeded = true;
          return;
        }
        if (!dataEqual(remoteCategory.data, localCategory.data)) {
          var localUpdatedAt = localCategory.updatedAt || 0;
          var remoteUpdatedAt = remoteCategory.updatedAt || 0;
          if (remoteUpdatedAt > localUpdatedAt) {
            pullNeeded = true;
          } else if (localUpdatedAt > remoteUpdatedAt) {
            pushNeeded = true;
          } else {
            pushNeeded = true;
          }
        }
      });

      if (pullNeeded && !pushNeeded) {
        await savePatches(remotePatchesAuto, { source: "drive", direction: "pull" });
        driveMeta = mergeEnvelopeAfterSync(driveMeta, remoteEnvelope, categoryFlags);
        await saveDriveMeta(driveMeta);
        await saveSyncOptions({
          drivePendingConflict: null,
          lastDriveSync: nowMs(),
          lastDriveSyncError: null
        });
        return buildSyncResult("pulled", { fileId: driveMeta.fileId });
      }

      if (pushNeeded) {
        await writeRemoteEnvelope(token, driveMeta.fileId, localEnvelope);
        driveMeta = mergeEnvelopeAfterSync(driveMeta, localEnvelope, categoryFlags);
        await saveDriveMeta(driveMeta);
        await saveSyncOptions({
          drivePendingConflict: null,
          lastDriveSync: nowMs(),
          lastDriveSyncError: null
        });
        return buildSyncResult("pushed", { fileId: driveMeta.fileId });
      }

      driveMeta = mergeEnvelopeAfterSync(driveMeta, remoteEnvelope, categoryFlags);
      await saveDriveMeta(driveMeta);
      await saveSyncOptions({
        drivePendingConflict: null,
        lastDriveSync: nowMs(),
        lastDriveSyncError: null
      });
      return buildSyncResult("noop", { fileId: driveMeta.fileId });
    } catch (error) {
      if (error && error.code === "auth" && token) {
        await chromeIdentityRemoveCachedToken(token);
      }
      throw normalizeDriveError(error, "sync_failed");
    }
  }

  async function getDriveSyncStatus(options) {
    var manifest = chrome.runtime.getManifest();
    var loadContext = options && options.loadContext;
    var context = typeof loadContext === "function" ? await loadContext() : { localState: {}, options: {} };
    return {
      categories: normalizeCategoryFlags(context.options.driveSyncCategories),
      configured: isOAuthConfigured(manifest),
      driveAuthStatus: context.options.driveAuthStatus || "unknown",
      driveSync: !!context.options.driveSync,
      intervalMinutes: context.options.driveAutoSyncIntervalMinutes || 60,
      lastDriveSync: context.options.lastDriveSync || null,
      lastDriveSyncError: context.options.lastDriveSyncError || null,
      pendingConflict: context.options.drivePendingConflict || context.localState.drivePendingConflict || null
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
    buildPatchesFromEnvelope: buildPatchesFromEnvelope,
    bumpCategoryTimestamp: bumpCategoryTimestamp,
    detectConflicts: detectConflicts,
    enabledCategoryList: enabledCategoryList,
    getDriveSyncStatus: getDriveSyncStatus,
    isOAuthConfigured: isOAuthConfigured,
    isGoogleClientIdFormat: isGoogleClientIdFormat,
    normalizeDriveError: normalizeDriveError,
    normalizeCategoryFlags: normalizeCategoryFlags,
    normalizeDriveMeta: normalizeDriveMeta,
    syncDrive: syncDrive
  };
})(typeof window !== "undefined" ? window : self);
