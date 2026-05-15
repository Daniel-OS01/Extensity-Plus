(function(root) {
  var DRIVE_FILE_NAME = "extensity-plus-sync.json";
  var ENVELOPE_VERSION = "1.0.0";
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
    "driveSyncCategories",
    "lastDriveSync",
    "lastDriveSyncError"
  ];
  var DRIVE_MAX_RETRIES = 3;
  var DRIVE_RETRY_BASE_DELAY_MS = 1000;

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
    return httpStatus >= 500 || error instanceof TypeError || (error && error.name === "TypeError");
  }

  async function retryDriveApiRequest(token, path, options) {
    var config = options || {};
    var currentToken = token;
    var attempt = 0;

    while (attempt < DRIVE_MAX_RETRIES) {
      try {
        return await driveApiRequest(currentToken, path, config);
      } catch (error) {
        var isAuthError = error && error.code === "auth";
        var canRetry = attempt < DRIVE_MAX_RETRIES - 1;

        if (isAuthError && canRetry) {
          await clearDriveAuthToken(currentToken);
          var nextTokenResult = typeof config.getFreshToken === "function"
            ? normalizeTokenResult(await config.getFreshToken())
            : normalizeTokenResult(await chromeIdentityGetToken(!!config.interactive));
          currentToken = nextTokenResult.token;
          if (typeof config.onTokenRefresh === "function") {
            config.onTokenRefresh(currentToken, nextTokenResult.authProvider);
          }
          attempt += 1;
          continue;
        }

        if (isRetryableDriveError(error) && canRetry) {
          await sleep(DRIVE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          attempt += 1;
          continue;
        }

        throw error;
      }
    }

    throw createDriveError("sync_failed", "Google Drive request failed.");
  }

  async function findDriveFile(requestDriveApi) {
    var query = "name='" + DRIVE_FILE_NAME.replace(/'/g, "\\'") + "' and trashed=false";
    var result = await requestDriveApi(
      "/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&q=" + encodeURIComponent(query)
    );
    var files = result && Array.isArray(result.files) ? result.files : [];
    return files.length ? files[0] : null;
  }

  async function downloadDriveFile(requestDriveApi, fileId) {
    var raw = await requestDriveApi(
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

  async function createDriveFile(requestDriveApi, content) {
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

    var created = await requestDriveApi("/upload/drive/v3/files?uploadType=multipart&fields=id", {
      body: body,
      headers: {
        "Content-Type": "multipart/related; boundary=" + boundary
      },
      method: "POST"
    });
    return created && created.id ? created.id : null;
  }

  async function updateDriveFile(requestDriveApi, fileId, content) {
    await requestDriveApi(
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

  async function readRemoteEnvelope(requestDriveApi, fileId) {
    if (!fileId) {
      return { envelope: null, file: null };
    }
    try {
      return {
        envelope: await downloadDriveFile(requestDriveApi, fileId),
        file: { id: fileId }
      };
    } catch (error) {
      if (error.code === "not_found") {
        return { envelope: null, file: null };
      }
      throw error;
    }
  }

  async function writeRemoteEnvelope(requestDriveApi, fileId, envelope) {
    var serialized = JSON.stringify(envelope);
    if (fileId) {
      await updateDriveFile(requestDriveApi, fileId, serialized);
      return fileId;
    }
    return createDriveFile(requestDriveApi, serialized);
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
    if (!isOAuthConfigured(manifest)) {
      step("oauth_config", "fail", "No valid OAuth client ID in manifest.json. Drive sync is not configured.");
      return report;
    }
    step("oauth_config", "ok", "OAuth client ID: " + (manifest.oauth2 && manifest.oauth2.client_id || ""));

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
      var tokenResult = await acquireDriveToken(false);
      token = tokenResult.token;
      authProvider = tokenResult.authProvider;
      step("auth", "ok", "Token acquired via " + authProvider + ".");
    } catch (authError) {
      step("auth", "fail", authError.userMessage || authError.message || "Authentication failed.");
      return report;
    }

    try {
      var listResult = await driveApiRequest(token, "/drive/v3/files?spaces=appDataFolder&fields=files(id,name,size,modifiedTime)&pageSize=10");
      var files = listResult && Array.isArray(listResult.files) ? listResult.files : [];
      step("drive_list", "ok", "Drive appDataFolder reachable. " + files.length + " file(s) found.");

      var syncEntry = files.find(function(f) { return f.name === DRIVE_FILE_NAME; });
      if (syncEntry) {
        fileId = syncEntry.id;
        var sizeKb = syncEntry.size
          ? (Math.round(Number(syncEntry.size) / 102.4) / 10) + " KB"
          : "unknown size";
        step("sync_file", "ok", "Sync file found. ID: " + fileId + ". Size: " + sizeKb + ". Modified: " + (syncEntry.modifiedTime || "unknown") + ".");
      } else {
        step("sync_file", "info", "Sync file not found. First sync will create it.");
      }
    } catch (listError) {
      step("drive_list", "fail", listError.userMessage || listError.message || "Failed to list Drive files.");
      return report;
    }

    if (fileId) {
      try {
        remoteEnvelope = await downloadDriveFile(function(path, opts) {
          return driveApiRequest(token, path, opts);
        }, fileId);
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
    var webAuthPreferred = await shouldPreferWebAuth();

    var token;
    var authProvider = "chrome_identity";
    try {
      var tokenResult = await acquireDriveToken(interactive);
      token = tokenResult.token;
      authProvider = tokenResult.authProvider;
    } catch (error) {
      throw error;
    }

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
      var fileRecord = driveMeta.fileId ? { id: driveMeta.fileId } : await findDriveFile(requestDriveApi);
      if (fileRecord && fileRecord.id && !driveMeta.fileId) {
        driveMeta.fileId = fileRecord.id;
      }

      var remoteRead = await readRemoteEnvelope(requestDriveApi, driveMeta.fileId);
      var remoteEnvelope = remoteRead.envelope;
      if (remoteRead.file && remoteRead.file.id) {
        driveMeta.fileId = remoteRead.file.id;
      }

      var localEnvelope = buildEnvelope(context, categoryFlags, syncOptions.syncWriterId || "");

      if (direction === "push") {
        var pushedFileId = await writeRemoteEnvelope(requestDriveApi, driveMeta.fileId, localEnvelope);
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
        var createdId = await writeRemoteEnvelope(requestDriveApi, null, localEnvelope);
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
        await writeRemoteEnvelope(requestDriveApi, driveMeta.fileId, localEnvelope);
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
        await writeRemoteEnvelope(requestDriveApi, driveMeta.fileId, localEnvelope);
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
        await clearDriveAuthToken(token, authProvider);
      }
      throw normalizeDriveError(error, "sync_failed");
    }
  }

  async function getDriveSyncStatus(options) {
    var manifest = chrome.runtime.getManifest();
    var loadContext = options && options.loadContext;
    var context = typeof loadContext === "function" ? await loadContext() : { localState: {}, options: {} };
    var environment = context.extensionEnvironment || await getExtensionEnvironment();
    var driveMeta = normalizeDriveMeta(context.driveSyncMeta || context.localState && context.localState.driveSyncMeta);
    var webAuthPreferred = await shouldPreferWebAuth();
    return {
      categories: normalizeCategoryFlags(context.options.driveSyncCategories),
      authProvider: webAuthPreferred ? "web_fallback" : "chrome_identity",
      configured: isOAuthConfigured(manifest),
      driveAuthStatus: context.options.driveAuthStatus || "unknown",
      driveSync: !!context.options.driveSync,
      extensionId: context.extensionId || environment.extensionId || "",
      intervalMinutes: context.options.driveAutoSyncIntervalMinutes || 60,
      installType: normalizeInstallType(context.installType || environment.installType || "unknown"),
      lastDriveSync: context.options.lastDriveSync || null,
      lastDriveSyncError: context.options.lastDriveSyncError || null,
      fileId: driveMeta.fileId || null,
      pendingConflict: context.options.drivePendingConflict || context.localState.drivePendingConflict || null,
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
    buildPatchesFromEnvelope: buildPatchesFromEnvelope,
    bumpCategoryTimestamp: bumpCategoryTimestamp,
    detectConflicts: detectConflicts,
    detectBraveBrowser: detectBraveBrowser,
    enabledCategoryList: enabledCategoryList,
    acquireDriveToken: acquireDriveToken,
    getExtensionEnvironment: getExtensionEnvironment,
    getDriveSyncStatus: getDriveSyncStatus,
    isDriveWebOAuthConfigured: isDriveWebOAuthConfigured,
    isOAuthConfigured: isOAuthConfigured,
    isGoogleClientIdFormat: isGoogleClientIdFormat,
    normalizeDriveError: normalizeDriveError,
    normalizeCategoryFlags: normalizeCategoryFlags,
    normalizeDriveMeta: normalizeDriveMeta,
    retryDriveApiRequest: retryDriveApiRequest,
    setWebClientId: setWebClientId,
    syncDrive: syncDrive,
    testDriveConnection: testDriveConnection
  };
})(typeof window !== "undefined" ? window : self);
