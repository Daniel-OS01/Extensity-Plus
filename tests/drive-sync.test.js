const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");

function loadDriveSync(overrides = {}) {
  const chromeOverrides = overrides.chrome || {};
  const chromeIdentityOverrides = chromeOverrides.identity || {};
  const chromeRuntimeOverrides = chromeOverrides.runtime || {};
  const chromeManagementOverrides = chromeOverrides.management || {};
  const chromeStorageOverrides = chromeOverrides.storage || {};
  const chromeRuntime = {
    getManifest() {
      return {
        oauth2: {
          client_id: "test-client-id.apps.googleusercontent.com",
          scopes: ["https://www.googleapis.com/auth/drive.appdata"]
        }
      };
    },
    id: "runtime-extension",
    lastError: null
  };
  Object.defineProperties(chromeRuntime, Object.getOwnPropertyDescriptors(chromeRuntimeOverrides));
  const self = {
    ExtensityDriveConfig: {
      drivePreferWebAuth: false,
      driveWebClientId: "",
      ...(overrides.driveConfig || {})
    },
    ...(overrides.self || {})
  };

  return loadBrowserScript(path.join(repoRoot, "js/drive-sync.js"), {
    ...overrides,
    chrome: {
      identity: {
        getAuthToken() {},
        getRedirectURL(path) {
          return "https://runtime-extension.chromiumapp.org/" + String(path || "");
        },
        launchWebAuthFlow() {},
        removeCachedAuthToken(details, callback) {
          if (typeof callback === "function") {
            callback();
          }
        },
        ...chromeIdentityOverrides
      },
      management: {
        getSelf(callback) {
          callback({
            id: "runtime-extension",
            installType: "development"
          });
        },
        ...chromeManagementOverrides
      },
      runtime: chromeRuntime,
      storage: {
        local: {
          get(keys, callback) {
            callback({});
          },
          remove(keys, callback) {
            callback();
          },
          set(values, callback) {
            callback();
          }
        },
        ...chromeStorageOverrides
      }
    },
    fetch: overrides.fetch || (async function() {
      throw new Error("Unexpected fetch in unit test.");
    }),
    self: self,
    setTimeout: overrides.setTimeout || setTimeout
  });
}

function sampleContext() {
  return {
    driveSyncMeta: {
      categoryTimestamps: {
        aliases: 100,
        options: 200,
        profiles: 300
      },
      fileId: "file-1",
      lastMergedAt: {
        aliases: 50,
        options: 150,
        profiles: 250
      }
    },
    localState: {
      aliases: { ext1: "Alias" },
      eventHistory: [],
      groupOrder: [],
      groups: {},
      urlRules: []
    },
    options: {
      activeProfile: null,
      driveSyncCategories: {
        aliases: true,
        groups: false,
        history: false,
        options: true,
        profiles: true,
        urlRules: false
      },
      sortMode: "recent"
    },
    profiles: {
      map: { Work: ["ext1"], __always_on: [], __base: [], __favorites: [] },
      meta: {}
    }
  };
}

function jsonResponse(status, body) {
  return {
    headers: {
      get() {
        return "application/json";
      }
    },
    json: async function() {
      return body;
    },
    ok: status >= 200 && status < 300,
    status: status,
    text: async function() {
      return JSON.stringify(body);
    }
  };
}

function textResponse(status, body) {
  return {
    headers: {
      get() {
        return "text/plain";
      }
    },
    ok: status >= 200 && status < 300,
    status: status,
    text: async function() {
      return body;
    }
  };
}

test("normalizeCategoryFlags applies defaults and preserves explicit false", () => {
  const root = loadDriveSync();
  const normalized = root.ExtensityDriveSync.normalizeCategoryFlags({
    history: true,
    options: false
  });

  assert.equal(normalized.history, true);
  assert.equal(normalized.options, false);
  assert.equal(normalized.profiles, true);
});

test("detectConflicts returns categories changed on both sides since last merge", () => {
  const root = loadDriveSync();
  const conflicts = root.ExtensityDriveSync.detectConflicts(
    sampleContext().driveSyncMeta,
    {
      categories: {
        aliases: { updatedAt: 120, data: {} },
        options: { updatedAt: 180, data: {} },
        profiles: { updatedAt: 400, data: {} }
      }
    },
    sampleContext().options.driveSyncCategories
  );

  const conflictIds = conflicts.map((entry) => entry.categoryId).sort();
  assert.equal(conflictIds.length, 3);
  assert.equal(conflictIds.join(","), "aliases,options,profiles");
});

test("buildEnvelope includes only enabled categories", () => {
  const root = loadDriveSync();
  const envelope = root.ExtensityDriveSync.buildEnvelope(
    sampleContext(),
    sampleContext().options.driveSyncCategories,
    "writer-1"
  );

  assert.ok(envelope.categories.options);
  assert.ok(envelope.categories.profiles);
  assert.ok(envelope.categories.aliases);
  assert.equal(envelope.categories.urlRules, undefined);
  assert.equal(envelope.categories.groups, undefined);
});

test("buildPatchesFromEnvelope maps remote data into storage patches", () => {
  const root = loadDriveSync();
  const patches = root.ExtensityDriveSync.buildPatchesFromEnvelope(
    {
      categories: {
        aliases: { data: { ext2: "Remote" }, updatedAt: 1 },
        options: { data: { sortMode: "alpha" }, updatedAt: 2 }
      }
    },
    { aliases: true, options: true, profiles: false, groups: false, urlRules: false, history: false }
  );

  assert.deepEqual(patches.localState.aliases, { ext2: "Remote" });
  assert.equal(patches.syncOptions.sortMode, "alpha");
});

test("isOAuthConfigured rejects placeholder client id", () => {
  const root = loadDriveSync();
  assert.equal(
    root.ExtensityDriveSync.isOAuthConfigured({
      oauth2: { client_id: "REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com" }
    }),
    false
  );
  assert.equal(
    root.ExtensityDriveSync.isOAuthConfigured({
      oauth2: { client_id: "real-id.apps.googleusercontent.com" }
    }),
    true
  );
});

test("isGoogleClientIdFormat validates expected Google OAuth shape", () => {
  const root = loadDriveSync();
  assert.equal(
    root.ExtensityDriveSync.isGoogleClientIdFormat("775277874801-abc123.apps.googleusercontent.com"),
    true
  );
  assert.equal(
    root.ExtensityDriveSync.isGoogleClientIdFormat("not-a-google-client-id"),
    false
  );
});

test("normalizeDriveError returns sanitized payload", () => {
  const root = loadDriveSync();
  const payload = root.ExtensityDriveSync.normalizeDriveError(
    { code: "drive_api", message: "Drive API error (403): lots of details" },
    "sync_failed"
  );
  assert.equal(payload.code, "drive_api");
  assert.equal(typeof payload.message, "string");
  assert.ok(payload.message.length > 0);
});

test("retryDriveApiRequest retries transient 5xx failures with exponential backoff", async () => {
  const delays = [];
  let fetchCalls = 0;
  const root = loadDriveSync({
    fetch: async function() {
      fetchCalls += 1;
      if (fetchCalls < 3) {
        return textResponse(503, "unavailable");
      }
      return jsonResponse(200, { ok: true });
    },
    setTimeout: function(callback, delay) {
      delays.push(delay);
      callback();
      return 1;
    }
  });

  const result = await root.ExtensityDriveSync.retryDriveApiRequest("token-1", "/drive/v3/files", {});

  assert.deepEqual(result, { ok: true });
  assert.equal(fetchCalls, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test("retryDriveApiRequest retries network TypeError failures", async () => {
  const delays = [];
  let fetchCalls = 0;
  const root = loadDriveSync({
    fetch: async function() {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        throw new TypeError("Network error");
      }
      return jsonResponse(200, { network: true });
    },
    setTimeout: function(callback, delay) {
      delays.push(delay);
      callback();
      return 1;
    }
  });

  const result = await root.ExtensityDriveSync.retryDriveApiRequest("token-1", "/drive/v3/files", {});

  assert.deepEqual(result, { network: true });
  assert.equal(fetchCalls, 2);
  assert.deepEqual(delays, [1000]);
});

test("retryDriveApiRequest does not retry client errors", async () => {
  let fetchCalls = 0;
  const root = loadDriveSync({
    fetch: async function() {
      fetchCalls += 1;
      return textResponse(400, "bad request");
    }
  });

  await assert.rejects(
    root.ExtensityDriveSync.retryDriveApiRequest("token-1", "/drive/v3/files", {}),
    /Drive API error \(400\): bad request/
  );
  assert.equal(fetchCalls, 1);
});

test("retryDriveApiRequest refreshes the token after a 401 response", async () => {
  const removedTokens = [];
  const tokensRequested = [];
  let fetchCalls = 0;
  const root = loadDriveSync({
    chrome: {
      identity: {
        getAuthToken(options, callback) {
          tokensRequested.push(options);
          callback("fresh-token");
        },
        removeCachedAuthToken(details, callback) {
          removedTokens.push(details.token);
          callback();
        }
      }
    },
    fetch: async function(url, options) {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return textResponse(401, "unauthorized");
      }
      assert.equal(options.headers.Authorization, "Bearer fresh-token");
      return jsonResponse(200, { refreshed: true });
    }
  });

  const result = await root.ExtensityDriveSync.retryDriveApiRequest("stale-token", "/drive/v3/files", {
    interactive: false
  });

  assert.deepEqual(result, { refreshed: true });
  assert.equal(fetchCalls, 2);
  assert.deepEqual(removedTokens, ["stale-token"]);
  assert.equal(tokensRequested.length, 1);
});

test("retryDriveApiRequest clears web fallback token cache after a 401 response", async () => {
  const removedStorageKeys = [];
  let fetchCalls = 0;
  const root = loadDriveSync({
    chrome: {
      storage: {
        local: {
          get(keys, callback) {
            callback({});
          },
          remove(keys, callback) {
            removedStorageKeys.push(keys);
            callback();
          },
          set(values, callback) {
            callback();
          }
        }
      }
    },
    fetch: async function(url, options) {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return textResponse(401, "unauthorized");
      }
      assert.equal(options.headers.Authorization, "Bearer fresh-web-token");
      return jsonResponse(200, { refreshed: true });
    }
  });

  const result = await root.ExtensityDriveSync.retryDriveApiRequest("stale-web-token", "/drive/v3/files", {
    getFreshToken: async function() {
      return {
        authProvider: "web_fallback",
        token: "fresh-web-token"
      };
    },
    interactive: false
  });

  assert.deepEqual(result, { refreshed: true });
  assert.equal(fetchCalls, 2);
  assert.deepEqual(removedStorageKeys, ["driveWebAuthToken"]);
});

test("acquireDriveToken falls back to web auth when Brave rejects the Chrome app custom scheme", async () => {
  const runtimeState = { lastError: null };
  const runtime = {};
  Object.defineProperty(runtime, "lastError", {
    get() {
      return runtimeState.lastError;
    }
  });
  let webAuthUrl = "";
  const root = loadDriveSync({
    driveConfig: {
      driveWebClientId: "775277874801-webclient.apps.googleusercontent.com"
    },
    chrome: {
      identity: {
        getAuthToken(options, callback) {
          assert.equal(options.interactive, true);
          runtimeState.lastError = {
            message: "Custom URI scheme is not supported on Chrome apps."
          };
          callback();
        },
        launchWebAuthFlow(options, callback) {
          webAuthUrl = options.url;
          const parsed = new URL(options.url);
          const redirectUri = parsed.searchParams.get("redirect_uri");
          const state = parsed.searchParams.get("state");
          runtimeState.lastError = null;
          callback(redirectUri + "#access_token=web-token&expires_in=3600&state=" + encodeURIComponent(state));
        }
      },
      runtime: runtime
    }
  });

  const result = await root.ExtensityDriveSync.acquireDriveToken(true);
  const parsed = new URL(webAuthUrl);

  assert.equal(result.token, "web-token");
  assert.equal(result.authProvider, "web_fallback");
  assert.equal(parsed.searchParams.get("client_id"), "775277874801-webclient.apps.googleusercontent.com");
  assert.equal(parsed.searchParams.get("redirect_uri"), "https://runtime-extension.chromiumapp.org/drive");
  assert.equal(parsed.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.appdata");
  assert.equal(parsed.searchParams.get("response_type"), "token");
});

test("acquireDriveToken uses web auth first when Brave is detected", async () => {
  const runtimeState = { lastError: null };
  const runtime = {};
  Object.defineProperty(runtime, "lastError", {
    get() {
      return runtimeState.lastError;
    }
  });
  let getAuthTokenCalls = 0;
  let launchCalls = 0;
  const root = loadDriveSync({
    driveConfig: {
      drivePreferWebAuth: true,
      driveWebClientId: "775277874801-webclient.apps.googleusercontent.com"
    },
    navigator: {
      brave: {
        isBrave: function() {
          return Promise.resolve(true);
        }
      }
    },
    chrome: {
      identity: {
        getAuthToken() {
          getAuthTokenCalls += 1;
          throw new Error("Should not call getAuthToken first in Brave.");
        },
        launchWebAuthFlow(options, callback) {
          launchCalls += 1;
          const parsed = new URL(options.url);
          const state = parsed.searchParams.get("state");
          runtimeState.lastError = null;
          callback(options.url + "#access_token=web-token&expires_in=3600&state=" + encodeURIComponent(state));
        }
      },
      runtime: runtime
    }
  });

  const token = await root.ExtensityDriveSync.acquireDriveToken(true);

  assert.equal(token.authProvider, "web_fallback");
  assert.equal(token.token, "web-token");
  assert.equal(getAuthTokenCalls, 0);
  assert.equal(launchCalls, 1);
});

test("acquireDriveToken uses web auth first when configured to prefer web auth", async () => {
  const runtimeState = { lastError: null };
  const runtime = {};
  Object.defineProperty(runtime, "lastError", {
    get() {
      return runtimeState.lastError;
    }
  });
  let getAuthTokenCalls = 0;
  let launchCalls = 0;
  const root = loadDriveSync({
    driveConfig: {
      drivePreferWebAuth: true,
      driveWebClientId: "775277874801-webclient.apps.googleusercontent.com"
    },
    chrome: {
      identity: {
        getAuthToken() {
          getAuthTokenCalls += 1;
          throw new Error("Should not call getAuthToken first when configured to prefer web auth.");
        },
        launchWebAuthFlow(options, callback) {
          launchCalls += 1;
          const parsed = new URL(options.url);
          const state = parsed.searchParams.get("state");
          runtimeState.lastError = null;
          callback(options.url + "#access_token=web-token&expires_in=3600&state=" + encodeURIComponent(state));
        }
      },
      runtime: runtime
    }
  });

  const token = await root.ExtensityDriveSync.acquireDriveToken(true);

  assert.equal(token.authProvider, "web_fallback");
  assert.equal(token.token, "web-token");
  assert.equal(getAuthTokenCalls, 0);
  assert.equal(launchCalls, 1);
});

test("acquireDriveToken rejects immediately when Brave detected, web client missing, and interactive", async () => {
  const runtimeState = { lastError: null };
  const runtime = {};
  Object.defineProperty(runtime, "lastError", {
    get() {
      return runtimeState.lastError;
    }
  });
  let getAuthTokenCalls = 0;
  let launchCalls = 0;
  const root = loadDriveSync({
    driveConfig: {
      drivePreferWebAuth: true,
      driveWebClientId: "REPLACE_WITH_DRIVE_WEB_CLIENT_ID.apps.googleusercontent.com"
    },
    navigator: {
      brave: {
        isBrave: function() {
          return Promise.resolve(true);
        }
      }
    },
    chrome: {
      identity: {
        getAuthToken(opts, callback) {
          getAuthTokenCalls += 1;
        },
        launchWebAuthFlow() {
          launchCalls += 1;
        }
      },
      runtime: runtime
    }
  });

  await assert.rejects(
    root.ExtensityDriveSync.acquireDriveToken(true),
    /Brave requires a Web OAuth client ID/
  );
  assert.equal(getAuthTokenCalls, 0);
  assert.equal(launchCalls, 0);
});

test("acquireDriveToken tries chrome.identity silently when Brave detected, web client missing, and non-interactive", async () => {
  const runtimeState = { lastError: null };
  const runtime = {};
  Object.defineProperty(runtime, "lastError", {
    get() {
      return runtimeState.lastError;
    }
  });
  let getAuthTokenCalls = 0;
  let launchCalls = 0;
  const root = loadDriveSync({
    driveConfig: {
      drivePreferWebAuth: true,
      driveWebClientId: "REPLACE_WITH_DRIVE_WEB_CLIENT_ID.apps.googleusercontent.com"
    },
    navigator: {
      brave: {
        isBrave: function() {
          return Promise.resolve(true);
        }
      }
    },
    chrome: {
      identity: {
        getAuthToken(opts, callback) {
          getAuthTokenCalls += 1;
          runtimeState.lastError = { message: "Custom URI scheme is not supported" };
          callback(undefined);
          runtimeState.lastError = null;
        },
        launchWebAuthFlow() {
          launchCalls += 1;
        }
      },
      runtime: runtime
    }
  });

  await assert.rejects(
    root.ExtensityDriveSync.acquireDriveToken(false),
    /Brave requires a Web OAuth client ID/
  );
  assert.equal(getAuthTokenCalls, 1);
  assert.equal(launchCalls, 0);
});

test("acquireDriveToken reuses cached web fallback token for non-interactive sync", async () => {
  const runtimeState = { lastError: null };
  const runtime = {};
  Object.defineProperty(runtime, "lastError", {
    get() {
      return runtimeState.lastError;
    }
  });
  let launchCalls = 0;
  const root = loadDriveSync({
    driveConfig: {
      driveWebClientId: "775277874801-webclient.apps.googleusercontent.com"
    },
    chrome: {
      identity: {
        getAuthToken(options, callback) {
          assert.equal(options.interactive, false);
          runtimeState.lastError = {
            message: "Custom URI scheme is not supported on Chrome apps."
          };
          callback();
        },
        launchWebAuthFlow() {
          launchCalls += 1;
        }
      },
      runtime: runtime,
      storage: {
        local: {
          get(keys, callback) {
            callback({
              driveWebAuthToken: {
                accessToken: "cached-web-token",
                expiresAt: Date.now() + 600000
              }
            });
          },
          remove(keys, callback) {
            callback();
          },
          set(values, callback) {
            callback();
          }
        }
      }
    }
  });

  const result = await root.ExtensityDriveSync.acquireDriveToken(false);

  assert.equal(result.token, "cached-web-token");
  assert.equal(result.authProvider, "web_fallback");
  assert.equal(launchCalls, 0);
});

test("getExtensionEnvironment returns runtime id and install type", async () => {
  const root = loadDriveSync({
    chrome: {
      management: {
        getSelf(callback) {
          callback({
            id: "extension-id",
            installType: "normal"
          });
        }
      },
      runtime: {
        id: "extension-id"
      }
    }
  });

  const environment = await root.ExtensityDriveSync.getExtensionEnvironment();

  assert.equal(environment.extensionId, "extension-id");
  assert.equal(environment.installType, "normal");
});

test("getDriveSyncStatus includes extension metadata", async () => {
  const root = loadDriveSync({
    chrome: {
      management: {
        getSelf(callback) {
          callback({
            id: "extension-id",
            installType: "development"
          });
        }
      },
      runtime: {
        id: "extension-id"
      }
    }
  });

  const status = await root.ExtensityDriveSync.getDriveSyncStatus({
    loadContext: async function() {
      return {
        localState: {
          driveSyncMeta: {
            fileId: "remote-file-id"
          }
        },
        options: {
          driveAutoSyncIntervalMinutes: 90,
          driveAuthStatus: "authorized",
          driveSync: true,
          driveSyncCategories: {}
        },
        extensionEnvironment: {
          extensionId: "extension-id",
          installType: "development"
        },
        extensionId: "extension-id",
        installType: "development"
      };
    }
  });

  assert.equal(status.extensionId, "extension-id");
  assert.equal(status.installType, "development");
  assert.equal(status.driveSync, true);
  assert.equal(status.intervalMinutes, 90);
  assert.equal(status.authProvider, "chrome_identity");
  assert.equal(status.fileId, "remote-file-id");
  assert.equal(status.webFallbackConfigured, false);
  assert.equal(status.webAuthPreferred, false);
});

test("getDriveSyncStatus reports Brave web auth preference when detected", async () => {
  const root = loadDriveSync({
    driveConfig: {
      drivePreferWebAuth: false,
      driveWebClientId: "775277874801-webclient.apps.googleusercontent.com"
    },
    navigator: {
      brave: {
        isBrave: function() {
          return Promise.resolve(true);
        }
      }
    }
  });

  const status = await root.ExtensityDriveSync.getDriveSyncStatus({
    loadContext: async function() {
      return {
        localState: {},
        options: {
          driveAutoSyncIntervalMinutes: 90,
          driveAuthStatus: "authorized",
          driveSync: true,
          driveSyncCategories: {}
        }
      };
    }
  });

  assert.equal(status.webFallbackConfigured, true);
  assert.equal(status.webAuthPreferred, true);
  assert.equal(status.authProvider, "web_fallback");
});
