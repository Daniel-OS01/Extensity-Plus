const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");

// drive-sync.js runs inside a vm sandbox, so values it returns carry the sandbox realm's
// prototypes. assert/strict compares prototype identity, so round-trip merged output through
// this realm's JSON before structural assertions.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

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
          client_id: "775277874801-testclient.apps.googleusercontent.com",
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

  // drive-sync.js reuses merge primitives from ExtensityStorage. Load storage.js into the
  // same sandbox `self` first so root.ExtensityStorage is populated before drive-sync runs.
  loadBrowserScript(path.join(repoRoot, "js/storage.js"), {
    chrome: {
      storage: {
        local: {
          get(keys, callback) {
            callback({});
          },
          set(values, callback) {
            callback();
          },
          remove(keys, callback) {
            callback();
          }
        },
        sync: {
          get(keys, callback) {
            callback({});
          },
          set(values, callback) {
            callback();
          },
          remove(keys, callback) {
            callback();
          }
        }
      }
    },
    self: self
  });

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

function responseHeaders(contentType, values) {
  const normalized = {};
  Object.entries(values || {}).forEach(([key, value]) => {
    normalized[key.toLowerCase()] = value;
  });
  return {
    get(name) {
      if (String(name).toLowerCase() === "content-type") {
        return contentType;
      }
      return normalized[String(name).toLowerCase()] || null;
    }
  };
}

function jsonResponse(status, body, headers) {
  return {
    headers: responseHeaders("application/json", headers),
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

function textResponse(status, body, headers) {
  return {
    headers: responseHeaders("text/plain", headers),
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
    }
  });

  const result = await root.ExtensityDriveSync.retryDriveApiRequest("token-1", "/drive/v3/files", {
    sleep: async function(delay) {
      delays.push(delay);
    }
  });

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
    }
  });

  const result = await root.ExtensityDriveSync.retryDriveApiRequest("token-1", "/drive/v3/files", {
    sleep: async function(delay) {
      delays.push(delay);
    }
  });

  assert.deepEqual(result, { network: true });
  assert.equal(fetchCalls, 2);
  assert.deepEqual(delays, [1000]);
});

test("retryDriveApiRequest retries every supported transient HTTP status", async (t) => {
  for (const status of [429, 500, 502, 503, 504]) {
    await t.test(String(status), async () => {
      let fetchCalls = 0;
      const root = loadDriveSync({
        fetch: async function() {
          fetchCalls += 1;
          return fetchCalls === 1
            ? textResponse(status, "temporary")
            : jsonResponse(200, { recovered: status });
        }
      });

      const result = await root.ExtensityDriveSync.retryDriveApiRequest("token", "/drive/v3/files", {
        operation: "test_transient_status",
        sleep: async function() {}
      });

      assert.equal(result.recovered, status);
      assert.equal(fetchCalls, 2);
    });
  }
});

test("retryDriveApiRequest respects Retry-After when it exceeds exponential delay", async () => {
  const delays = [];
  let fetchCalls = 0;
  const root = loadDriveSync({
    fetch: async function() {
      fetchCalls += 1;
      return fetchCalls === 1
        ? textResponse(429, "rate limited", { "retry-after": "3" })
        : jsonResponse(200, { ok: true });
    }
  });

  await root.ExtensityDriveSync.retryDriveApiRequest("token", "/drive/v3/files", {
    operation: "test_retry_after",
    sleep: async function(delay) {
      delays.push(delay);
    }
  });

  assert.deepEqual(delays, [3000]);
});

test("retryDriveApiRequest times out each attempt and stops after three attempts", async () => {
  let fetchCalls = 0;
  const root = loadDriveSync({
    fetch: async function(url, options) {
      fetchCalls += 1;
      return new Promise(function(resolve, reject) {
        options.signal.addEventListener("abort", function() {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }
  });

  await assert.rejects(
    root.ExtensityDriveSync.retryDriveApiRequest("token", "/drive/v3/files", {
      operation: "test_timeout",
      sleep: async function() {},
      timeoutMs: 5
    }),
    (error) => error.code === "timeout" && /3 attempts/.test(error.message)
  );
  assert.equal(fetchCalls, 3);
});

test("drive_api_retry warnings contain structured metadata but no request secrets", async () => {
  const warnings = [];
  let fetchCalls = 0;
  const root = loadDriveSync({
    self: {
      ExtensityLogger: {
        warn(event, data) {
          warnings.push({ event, data });
        }
      }
    },
    fetch: async function() {
      fetchCalls += 1;
      return fetchCalls === 1
        ? textResponse(503, "sensitive response body")
        : jsonResponse(200, { ok: true });
    }
  });

  await root.ExtensityDriveSync.retryDriveApiRequest(
    "secret-token",
    "/drive/v3/files/private-file-id",
    {
      body: "secret-body",
      operation: "safe_operation",
      sleep: async function() {}
    }
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].event, "drive_api_retry");
  assert.deepEqual(Object.keys(warnings[0].data).sort(), [
    "attempt",
    "delayMs",
    "errorCode",
    "httpStatus",
    "operation"
  ]);
  assert.doesNotMatch(JSON.stringify(warnings), /secret|private-file-id|client/i);
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

test("retryDriveApiRequest does not retry 403 or 404 responses", async (t) => {
  for (const status of [403, 404]) {
    await t.test(String(status), async () => {
      let fetchCalls = 0;
      const root = loadDriveSync({
        fetch: async function() {
          fetchCalls += 1;
          return textResponse(status, "permanent");
        }
      });
      await assert.rejects(
        root.ExtensityDriveSync.retryDriveApiRequest("token", "/drive/v3/files", {
          operation: "test_permanent_status"
        })
      );
      assert.equal(fetchCalls, 1);
    });
  }
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

test("getDriveSyncStatus accepts Brave web fallback when manifest OAuth is a placeholder", async () => {
  const root = loadDriveSync({
    chrome: {
      runtime: {
        getManifest() {
          return {
            oauth2: {
              client_id: "REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com",
              scopes: ["https://www.googleapis.com/auth/drive.appdata"]
            }
          };
        }
      }
    },
    driveConfig: {
      driveWebClientId: "775277874801-webclient.apps.googleusercontent.com"
    },
    navigator: {
      brave: {
        isBrave() {
          return Promise.resolve(true);
        }
      }
    }
  });

  const status = await root.ExtensityDriveSync.getDriveSyncStatus();

  assert.equal(status.configured, true);
  assert.equal(status.authProvider, "web_fallback");
  assert.equal(status.webFallbackConfigured, true);
});

test("selectNewestDriveFile chooses deterministically and reports duplicates", () => {
  const root = loadDriveSync();
  const selected = root.ExtensityDriveSync.selectNewestDriveFile([
    { id: "older", name: "extensity-plus-sync.json", modifiedTime: "2026-01-01T00:00:00Z" },
    { id: "other", name: "other.json", modifiedTime: "2027-01-01T00:00:00Z" },
    { id: "newer", name: "extensity-plus-sync.json", modifiedTime: "2026-02-01T00:00:00Z" }
  ]);

  assert.equal(selected.id, "newer");
  assert.equal(selected.duplicateCount, 1);
});

test("createDriveFile reuses a generated ID and accepts a matching 409 result", async () => {
  const content = JSON.stringify({ categories: { options: { data: { theme: "dark" } } } });
  const createBodies = [];
  let createCalls = 0;
  const root = loadDriveSync({
    fetch: async function(url, options) {
      if (url.includes("/drive/v3/files/generateIds")) {
        return jsonResponse(200, { ids: ["generated-file-id"] });
      }
      if (url.includes("/upload/drive/v3/files") && options.method === "POST") {
        createCalls += 1;
        createBodies.push(options.body);
        return createCalls === 1
          ? textResponse(503, "ambiguous create")
          : textResponse(409, "already exists");
      }
      if (url.includes("/drive/v3/files/generated-file-id?alt=media")) {
        return textResponse(200, content);
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  const requestDriveApi = function(path, options) {
    return root.ExtensityDriveSync.retryDriveApiRequest("token", path, {
      ...(options || {}),
      sleep: async function() {}
    });
  };

  const fileId = await root.ExtensityDriveSync.createDriveFile(requestDriveApi, content);

  assert.equal(fileId, "generated-file-id");
  assert.equal(createBodies.length, 2);
  assert.equal(createBodies[0], createBodies[1]);
  assert.match(createBodies[0], /"id":"generated-file-id"/);
});

test("createDriveFile raises a typed conflict when a 409 contains different data", async () => {
  const root = loadDriveSync();
  const requestDriveApi = async function(path) {
    if (path.includes("generateIds")) {
      return { ids: ["generated-file-id"] };
    }
    if (path.includes("upload")) {
      const error = new Error("conflict");
      error.httpStatus = 409;
      throw error;
    }
    if (path.includes("alt=media")) {
      return JSON.stringify({ different: true });
    }
    throw new Error("Unexpected request: " + path);
  };

  await assert.rejects(
    root.ExtensityDriveSync.createDriveFile(requestDriveApi, JSON.stringify({ expected: true })),
    (error) => error.code === "drive_create_conflict"
  );
});

test("testDriveConnection uses interactive auth, common retries, and duplicate diagnostics", async () => {
  let interactiveValue = null;
  let listCalls = 0;
  const root = loadDriveSync({
    chrome: {
      identity: {
        getAuthToken(options, callback) {
          interactiveValue = options.interactive;
          callback("test-token");
        }
      }
    },
    fetch: async function(url) {
      if (url.includes("spaces=appDataFolder")) {
        listCalls += 1;
        if (listCalls === 1) {
          return textResponse(503, "temporary");
        }
        return jsonResponse(200, {
          files: [
            { id: "old", name: "extensity-plus-sync.json", modifiedTime: "2026-01-01T00:00:00Z" },
            { id: "new", name: "extensity-plus-sync.json", modifiedTime: "2026-02-01T00:00:00Z" }
          ]
        });
      }
      if (url.includes("/drive/v3/files/new?alt=media")) {
        return textResponse(200, JSON.stringify({ categories: {}, version: "1.0.0" }));
      }
      throw new Error("Unexpected request: " + url);
    }
  });

  const report = await root.ExtensityDriveSync.testDriveConnection({
    sleep: async function() {}
  });

  assert.equal(report.success, true);
  assert.equal(interactiveValue, true);
  assert.equal(listCalls, 2);
  const syncFileStep = report.steps.find((step) => step.name === "sync_file");
  assert.match(syncFileStep.detail, /ID: new/);
  assert.match(syncFileStep.detail, /Duplicate count: 1/);
});

test("Brave connection test uses Web OAuth when manifest OAuth is a placeholder", async () => {
  const root = loadDriveSync({
    chrome: {
      identity: {
        launchWebAuthFlow(details, callback) {
          const state = new URL(details.url).searchParams.get("state");
          callback(
            "https://runtime-extension.chromiumapp.org/drive"
              + "#access_token=web-token&expires_in=3600&state=" + encodeURIComponent(state)
          );
        }
      },
      runtime: {
        getManifest() {
          return {
            oauth2: {
              client_id: "REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com",
              scopes: ["https://www.googleapis.com/auth/drive.appdata"]
            }
          };
        }
      }
    },
    driveConfig: {
      driveWebClientId: "775277874801-webclient.apps.googleusercontent.com"
    },
    fetch: async function(url) {
      if (url.includes("spaces=appDataFolder")) {
        return jsonResponse(200, { files: [] });
      }
      throw new Error("Unexpected request: " + url);
    },
    navigator: {
      brave: {
        isBrave() {
          return Promise.resolve(true);
        }
      }
    }
  });

  const report = await root.ExtensityDriveSync.testDriveConnection();

  assert.equal(report.success, true);
  assert.equal(report.steps.find((step) => step.name === "oauth_config").status, "ok");
  assert.match(report.steps.find((step) => step.name === "auth").detail, /web_fallback/);
});

test("syncDrive uses Brave Web OAuth when manifest OAuth is a placeholder", async () => {
  const root = loadDriveSync({
    chrome: {
      identity: {
        launchWebAuthFlow(details, callback) {
          const state = new URL(details.url).searchParams.get("state");
          callback(
            "https://runtime-extension.chromiumapp.org/drive"
              + "#access_token=web-token&expires_in=3600&state=" + encodeURIComponent(state)
          );
        }
      },
      runtime: {
        getManifest() {
          return {
            oauth2: {
              client_id: "REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com",
              scopes: ["https://www.googleapis.com/auth/drive.appdata"]
            }
          };
        }
      }
    },
    driveConfig: {
      driveWebClientId: "775277874801-webclient.apps.googleusercontent.com"
    },
    fetch: async function(url) {
      if (url.includes("spaces=appDataFolder")) {
        return jsonResponse(200, { files: [] });
      }
      throw new Error("Unexpected request: " + url);
    },
    navigator: {
      brave: {
        isBrave() {
          return Promise.resolve(true);
        }
      }
    }
  });

  const result = await root.ExtensityDriveSync.syncDrive({
    direction: "pull",
    interactive: true,
    loadContext: async function() {
      return sampleContext();
    },
    saveDriveMeta: async function() {},
    savePatches: async function() {},
    saveSyncOptions: async function() {}
  });

  assert.equal(result.status, "noop");
  assert.equal(result.reason, "no_remote_file");
});

test("mergeCategoryData urlRules unions and de-dups by id preserving order", () => {
  const root = loadDriveSync();
  const local = [
    { id: "r1", name: "Local R1", urlPattern: "a" },
    { id: "r2", name: "Local R2", urlPattern: "b" }
  ];
  const remote = [
    { id: "r2", name: "Remote R2", urlPattern: "b2" },
    { id: "r3", name: "Remote R3", urlPattern: "c" }
  ];
  // Remote newer -> shared id r2 resolves to remote.
  const merged = plain(root.ExtensityDriveSync.mergeCategoryData("urlRules", local, remote, 100, 200));

  assert.deepEqual(merged.map((rule) => rule.id), ["r1", "r2", "r3"]);
  assert.equal(merged.find((rule) => rule.id === "r2").name, "Remote R2");
  assert.equal(merged.find((rule) => rule.id === "r3").name, "Remote R3");
});

test("mergeCategoryData urlRules keeps local for shared id on tie", () => {
  const root = loadDriveSync();
  const local = [{ id: "r1", name: "Local R1" }];
  const remote = [{ id: "r1", name: "Remote R1" }];
  const merged = root.ExtensityDriveSync.mergeCategoryData("urlRules", local, remote, 100, 100);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Local R1");
});

test("mergeCategoryData groups unions by id, unions extensionIds, merges order", () => {
  const root = loadDriveSync();
  const local = {
    groupOrder: ["g1", "g2"],
    groups: {
      g1: { id: "g1", name: "G1", color: "#111", extensionIds: ["e1", "e2"] },
      g2: { id: "g2", name: "G2", color: "#222", extensionIds: ["e3"] }
    }
  };
  const remote = {
    groupOrder: ["g1", "g3"],
    groups: {
      g1: { id: "g1", name: "G1 Remote", color: "#999", extensionIds: ["e2", "e4"] },
      g3: { id: "g3", name: "G3", color: "#333", extensionIds: ["e5"] }
    }
  };
  // Remote newer -> shared g1 takes remote scalar fields, extensionIds unioned.
  const merged = plain(root.ExtensityDriveSync.mergeCategoryData("groups", local, remote, 100, 200));

  assert.deepEqual(merged.groupOrder, ["g1", "g2", "g3"]);
  assert.equal(merged.groups.g1.name, "G1 Remote");
  assert.deepEqual(merged.groups.g1.extensionIds, ["e1", "e2", "e4"]);
  assert.deepEqual(merged.groups.g2.extensionIds, ["e3"]);
  assert.deepEqual(merged.groups.g3.extensionIds, ["e5"]);
});

test("mergeCategoryData history unions by id, sorts by timestamp, truncates to most recent", () => {
  const root = loadDriveSync();
  const local = [
    { id: "h1", timestamp: 10 },
    { id: "h2", timestamp: 30 }
  ];
  const remote = [
    { id: "h2", timestamp: 30 },
    { id: "h3", timestamp: 20 }
  ];
  const merged = plain(root.ExtensityDriveSync.mergeCategoryData("history", local, remote, 100, 200));

  assert.deepEqual(merged.map((entry) => entry.id), ["h1", "h3", "h2"]);
});

test("mergeCategoryData history keeps only the newest 500 records", () => {
  const root = loadDriveSync();
  const local = [];
  const remote = [];
  for (let i = 0; i < 400; i += 1) {
    local.push({ id: "l" + i, timestamp: i });
  }
  for (let i = 0; i < 400; i += 1) {
    remote.push({ id: "r" + i, timestamp: 1000 + i });
  }
  const merged = root.ExtensityDriveSync.mergeCategoryData("history", local, remote, 100, 200);

  assert.equal(merged.length, 500);
  // Most recent kept: the last remote entry survives, the oldest local entry does not.
  assert.ok(merged.some((entry) => entry.id === "r399"));
  assert.ok(!merged.some((entry) => entry.id === "l0"));
});

test("mergeCategoryData aliases unions keys with newer-side tiebreak", () => {
  const root = loadDriveSync();
  const local = { e1: "Local One", e2: "Local Two" };
  const remote = { e1: "Remote One", e3: "Remote Three" };
  // Remote newer -> shared e1 resolves to remote value.
  const mergedRemote = plain(root.ExtensityDriveSync.mergeCategoryData("aliases", local, remote, 100, 200));
  assert.deepEqual(mergedRemote, { e1: "Remote One", e2: "Local Two", e3: "Remote Three" });

  // Tie -> local wins shared e1.
  const mergedTie = plain(root.ExtensityDriveSync.mergeCategoryData("aliases", local, remote, 100, 100));
  assert.deepEqual(mergedTie, { e1: "Local One", e2: "Local Two", e3: "Remote Three" });
});

test("mergeCategoryData profiles unions membership across both sides", () => {
  const root = loadDriveSync();
  const local = {
    map: { Work: ["e1", "e2"], __always_on: [], __base: [], __favorites: [] },
    meta: { Work: { color: "#111" } }
  };
  const remote = {
    map: { Work: ["e2", "e3"], Play: ["e4"], __always_on: [], __base: [], __favorites: [] },
    meta: { Play: { color: "#222" } }
  };
  const merged = plain(root.ExtensityDriveSync.mergeCategoryData("profiles", local, remote, 100, 200));

  assert.deepEqual(merged.map.Work.sort(), ["e1", "e2", "e3"]);
  assert.deepEqual(merged.map.Play, ["e4"]);
  assert.equal(merged.meta.Work.color, "#111");
  assert.equal(merged.meta.Play.color, "#222");
});

test("mergeCategoryData profiles preserves reserved memberships when remote lists are empty", () => {
  const root = loadDriveSync();
  const local = {
    map: {
      Work: ["work-extension"],
      __always_on: ["always-1", "always-2"],
      __base: ["base-1", "base-2"],
      __favorites: ["favorite-1", "favorite-2"]
    },
    meta: {}
  };
  const remote = {
    map: {
      Work: ["work-extension"],
      __always_on: [],
      __base: [],
      __favorites: []
    },
    meta: {}
  };

  const merged = plain(root.ExtensityDriveSync.mergeCategoryData("profiles", local, remote, 100, 200));

  assert.deepEqual(merged.map.__always_on, ["always-1", "always-2"]);
  assert.deepEqual(merged.map.__base, ["base-1", "base-2"]);
  assert.deepEqual(merged.map.__favorites, ["favorite-1", "favorite-2"]);
});

test("mergeCategoryData options deep-merges with newer-side precedence", () => {
  const root = loadDriveSync();
  const local = { sortMode: "recent", nested: { a: 1, b: 2 } };
  const remote = { sortMode: "alpha", nested: { b: 3, c: 4 }, extra: true };
  // Remote newer -> remote scalars win, nested objects deep-merged.
  const merged = root.ExtensityDriveSync.mergeCategoryData("options", local, remote, 100, 200);

  assert.equal(merged.sortMode, "alpha");
  assert.equal(merged.extra, true);
  assert.deepEqual(merged.nested, { a: 1, b: 3, c: 4 });
});

test("mergeCategoryData throws on unknown category", () => {
  const root = loadDriveSync();
  assert.throws(
    () => root.ExtensityDriveSync.mergeCategoryData("bogus", {}, {}, 1, 2),
    /Unknown Drive sync category/
  );
});

test("three-way item merge propagates deletion under the mirror policy while preserving opposite-side addition", () => {
  const root = loadDriveSync();
  const flags = { aliases: false, groups: false, history: false, options: false, profiles: false, urlRules: true };
  const base = [{ id: "A" }, { id: "B" }];
  const localEnvelope = { categories: { urlRules: { data: [{ id: "A" }], updatedAt: 20 } } };
  const remoteEnvelope = { categories: { urlRules: { data: [{ id: "A" }, { id: "B" }, { id: "C" }], updatedAt: 30 } } };
  const result = root.ExtensityDriveSync.buildThreeWayEnvelope(
    localEnvelope,
    remoteEnvelope,
    { urlRules: base },
    flags,
    null,
    "device-a",
    "mirror"
  );

  assert.deepEqual(plain(result.conflicts), []);
  assert.deepEqual(plain(result.envelope.categories.urlRules.data).map((item) => item.id).sort(), ["A", "C"]);
});

test("the default additive policy keeps an item deleted on only one side", () => {
  const root = loadDriveSync();
  const flags = { aliases: false, groups: false, history: false, options: false, profiles: false, urlRules: true };
  const base = [{ id: "A" }, { id: "B" }];
  const localEnvelope = { categories: { urlRules: { data: [{ id: "A" }], updatedAt: 20 } } };
  const remoteEnvelope = { categories: { urlRules: { data: [{ id: "A" }, { id: "B" }, { id: "C" }], updatedAt: 30 } } };

  // No explicit policy -> additive default. "B" was deleted locally but still exists
  // remotely, so it survives; the remote addition "C" still arrives.
  const result = root.ExtensityDriveSync.buildThreeWayEnvelope(
    localEnvelope, remoteEnvelope, { urlRules: base }, flags, null, "device-a"
  );

  assert.deepEqual(plain(result.conflicts), []);
  assert.deepEqual(
    plain(result.envelope.categories.urlRules.data).map((item) => item.id).sort(),
    ["A", "B", "C"]
  );
});

test("an absent remote category never deletes the local copy", () => {
  // Reproduces the reported data loss: a device that syncs with URL Rules unchecked writes
  // an envelope omitting the category. Every other device then read the missing category as
  // "remote deleted everything" and silently wiped its own rules, reporting no conflict.
  const root = loadDriveSync();
  const flags = { aliases: true, groups: false, history: false, options: false, profiles: false, urlRules: true };
  const rules = [{ id: "r1" }, { id: "r2" }, { id: "r3" }];
  const localEnvelope = {
    categories: {
      aliases: { data: { ext1: "Alias" }, updatedAt: 900 },
      urlRules: { data: rules, updatedAt: 500 }
    }
  };
  const remoteEnvelope = { categories: { aliases: { data: { ext1: "Alias" }, updatedAt: 900 } } };

  ["additive", "mirror"].forEach((policy) => {
    const result = root.ExtensityDriveSync.buildThreeWayEnvelope(
      localEnvelope, remoteEnvelope,
      { aliases: { ext1: "Alias" }, urlRules: rules },
      flags, null, "device-a", policy
    );
    assert.deepEqual(plain(result.conflicts), [], policy);
    assert.deepEqual(
      plain(result.envelope.categories.urlRules.data).map((rule) => rule.id).sort(),
      ["r1", "r2", "r3"],
      policy
    );
  });
});

test("an absent local category adopts the remote copy instead of erasing it", () => {
  const root = loadDriveSync();
  const flags = { aliases: false, groups: false, history: false, options: false, profiles: false, urlRules: true };
  const localEnvelope = { categories: {} };
  const remoteEnvelope = { categories: { urlRules: { data: [{ id: "r1" }, { id: "r2" }], updatedAt: 700 } } };

  const result = root.ExtensityDriveSync.buildThreeWayEnvelope(
    localEnvelope, remoteEnvelope, { urlRules: [{ id: "r1" }, { id: "r2" }] }, flags, null, "device-a"
  );

  assert.deepEqual(plain(result.conflicts), []);
  assert.deepEqual(
    plain(result.envelope.categories.urlRules.data).map((rule) => rule.id).sort(),
    ["r1", "r2"]
  );
});

test("each category is compared independently - one missing category cannot affect another", () => {
  const root = loadDriveSync();
  const flags = { aliases: true, groups: true, history: false, options: false, profiles: false, urlRules: true };
  const localEnvelope = {
    categories: {
      aliases: { data: { ext1: "Local Alias" }, updatedAt: 800 },
      groups: { data: { groupOrder: ["g1"], groups: { g1: { name: "Work" } } }, updatedAt: 800 },
      urlRules: { data: [{ id: "r1" }], updatedAt: 500 }
    }
  };
  // Remote carries only aliases, and changed it.
  const remoteEnvelope = { categories: { aliases: { data: { ext1: "Remote Alias" }, updatedAt: 900 } } };

  const result = root.ExtensityDriveSync.buildThreeWayEnvelope(
    localEnvelope, remoteEnvelope,
    { aliases: { ext1: "Local Alias" }, groups: { groupOrder: ["g1"], groups: { g1: { name: "Work" } } }, urlRules: [{ id: "r1" }] },
    flags, null, "device-a"
  );

  const merged = plain(result.envelope.categories);
  // The remote alias edit lands...
  assert.equal(merged.aliases.data.ext1, "Remote Alias");
  // ...without touching the categories remote never sent.
  assert.deepEqual(merged.urlRules.data.map((rule) => rule.id), ["r1"]);
  assert.deepEqual(Object.keys(merged.groups.data.groups), ["g1"]);
});

function tokenIdentityOverrides() {
  return {
    getAuthToken(options, callback) {
      callback("test-token");
    }
  };
}

function driveSyncFetchHarness(remoteEnvelope) {
  const captured = { uploads: [], patches: [] };
  let currentEnvelope = remoteEnvelope;
  let version = 7;
  const fetchImpl = async function(url, options) {
    const method = (options && options.method) || "GET";
    if (url.indexOf("/drive/v3/files?spaces=appDataFolder") !== -1 && method === "GET") {
      return jsonResponse(200, { files: [{
        id: "file-1",
        modifiedTime: "2026-07-23T10:00:00.000Z",
        name: "extensity-plus-sync.json",
        size: String(JSON.stringify(currentEnvelope).length),
        version: String(version)
      }] });
    }
    if (url.indexOf("/drive/v3/files/file-1?fields=") !== -1 && method === "GET") {
      return jsonResponse(200, {
        id: "file-1",
        modifiedTime: "2026-07-23T10:00:00.000Z",
        name: "extensity-plus-sync.json",
        size: String(JSON.stringify(currentEnvelope).length),
        version: String(version)
      });
    }
    if (url.indexOf("alt=media") !== -1) {
      return textResponse(200, JSON.stringify(currentEnvelope));
    }
    if (url.indexOf("/upload/drive/v3/files") !== -1 && (method === "PATCH" || method === "POST")) {
      currentEnvelope = JSON.parse(options.body);
      captured.uploads.push(currentEnvelope);
      version += 1;
      return jsonResponse(200, {
        id: "file-1",
        modifiedTime: "2026-07-23T10:00:01.000Z",
        size: String(JSON.stringify(currentEnvelope).length),
        version: String(version)
      });
    }
    throw new Error("Unexpected fetch: " + method + " " + url);
  };
  return { captured, fetchImpl };
}

test("syncDrive merges remote-only items into a superset written to Drive and local", async () => {
  const remoteEnvelope = {
    version: "1.0.0",
    exportedAt: 5,
    writerId: "remote-writer",
    categories: {
      urlRules: {
        updatedAt: 500,
        data: [
          { id: "r-remote", name: "Remote Rule", urlPattern: "remote.example" }
        ]
      }
    }
  };
  const { captured, fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  const context = {
    driveSyncMeta: {
      categoryTimestamps: { urlRules: 300 },
      fileId: "file-1",
      lastMergedAt: { urlRules: 300 }
    },
    localState: {
      aliases: {},
      eventHistory: [],
      groupOrder: [],
      groups: {},
      urlRules: [{ id: "r-local", name: "Local Rule", urlPattern: "local.example" }],
      driveSyncMeta: {
        categoryTimestamps: { urlRules: 300 },
        fileId: "file-1",
        lastMergedAt: { urlRules: 300 }
      }
    },
    options: {
      driveSyncCategories: {
        aliases: false,
        groups: false,
        history: false,
        options: false,
        profiles: false,
        urlRules: true
      },
      syncWriterId: "local-writer"
    },
    profiles: { map: { __always_on: [], __base: [], __favorites: [] }, meta: {} }
  };

  const savedMeta = [];
  const result = await root.ExtensityDriveSync.syncDrive({
    direction: "sync",
    interactive: false,
    loadContext: async function() {
      return context;
    },
    savePatches: async function(patches) {
      captured.patches.push(patches);
    },
    saveDriveMeta: async function(meta) {
      savedMeta.push(meta);
    },
    saveSyncOptions: async function() {}
  });

  assert.equal(result.status, "merged");

  // Drive received the merged superset (both rules, nothing erased).
  assert.equal(captured.uploads.length, 1);
  const uploadedRuleIds = captured.uploads[0].categories.urlRules.data.map((rule) => rule.id).sort();
  assert.deepEqual(uploadedRuleIds, ["r-local", "r-remote"]);

  // Local received the merged superset too.
  assert.equal(captured.patches.length, 1);
  const localRuleIds = plain(captured.patches[0].localState.urlRules).map((rule) => rule.id).sort();
  assert.deepEqual(localRuleIds, ["r-local", "r-remote"]);

  // Meta bookkeeping advanced so the next sync starts from a clean baseline.
  assert.equal(savedMeta.length, 1);
  assert.equal(savedMeta[0].lastMergedAt.urlRules, 500);
});

test("syncDrive push overwrites Drive with local envelope verbatim", async () => {
  const remoteEnvelope = {
    version: "1.0.0",
    categories: {
      urlRules: { updatedAt: 999, data: [{ id: "r-remote", name: "Remote Rule" }] }
    }
  };
  const { captured, fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  const context = {
    driveSyncMeta: { categoryTimestamps: { urlRules: 1 }, fileId: "file-1", lastMergedAt: {} },
    localState: {
      aliases: {},
      eventHistory: [],
      groupOrder: [],
      groups: {},
      urlRules: [{ id: "r-local", name: "Local Rule" }],
      driveSyncMeta: { categoryTimestamps: { urlRules: 1 }, fileId: "file-1", lastMergedAt: {} }
    },
    options: {
      driveSyncCategories: {
        aliases: false, groups: false, history: false, options: false, profiles: false, urlRules: true
      }
    },
    profiles: { map: { __always_on: [], __base: [], __favorites: [] }, meta: {} }
  };

  const result = await root.ExtensityDriveSync.syncDrive({
    direction: "push",
    interactive: false,
    overrideFailsafe: true,
    loadContext: async function() { return context; },
    savePatches: async function(patches) { captured.patches.push(patches); },
    saveDriveMeta: async function() {},
    saveSyncOptions: async function() {}
  });

  assert.equal(result.status, "pushed");
  // Whole-category overwrite: only the local rule, remote-only rule discarded.
  const uploadedRuleIds = captured.uploads[0].categories.urlRules.data.map((rule) => rule.id);
  assert.deepEqual(uploadedRuleIds, ["r-local"]);
  assert.equal(captured.patches.length, 0);
});

test("syncDrive pull overwrites local with remote envelope verbatim", async () => {
  const remoteEnvelope = {
    version: "1.0.0",
    categories: {
      urlRules: { updatedAt: 999, data: [{ id: "r-remote", name: "Remote Rule" }] }
    }
  };
  const { captured, fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  const context = {
    driveSyncMeta: { categoryTimestamps: { urlRules: 1 }, fileId: "file-1", lastMergedAt: {} },
    localState: {
      aliases: {},
      eventHistory: [],
      groupOrder: [],
      groups: {},
      urlRules: [{ id: "r-local", name: "Local Rule" }],
      driveSyncMeta: { categoryTimestamps: { urlRules: 1 }, fileId: "file-1", lastMergedAt: {} }
    },
    options: {
      driveSyncCategories: {
        aliases: false, groups: false, history: false, options: false, profiles: false, urlRules: true
      }
    },
    profiles: { map: { __always_on: [], __base: [], __favorites: [] }, meta: {} }
  };

  const result = await root.ExtensityDriveSync.syncDrive({
    direction: "pull",
    interactive: false,
    overrideFailsafe: true,
    loadContext: async function() { return context; },
    savePatches: async function(patches) { captured.patches.push(patches); },
    saveDriveMeta: async function() {},
    saveSyncOptions: async function() {}
  });

  assert.equal(result.status, "pulled");
  // Whole-category overwrite: local receives only the remote rule.
  assert.equal(captured.uploads.length, 0);
  const localRuleIds = captured.patches[0].localState.urlRules.map((rule) => rule.id);
  assert.deepEqual(localRuleIds, ["r-remote"]);
});

test("syncDrive keep_local preserves compatible remote additions", async () => {
  const remoteEnvelope = {
    version: "1.0.0",
    categories: {
      urlRules: { updatedAt: 500, data: [{ id: "r-remote", name: "Remote Rule" }] }
    }
  };
  const { captured, fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  const context = {
    driveSyncMeta: { categoryTimestamps: { urlRules: 450 }, fileId: "file-1", lastMergedAt: { urlRules: 100 } },
    localState: {
      aliases: {},
      eventHistory: [],
      groupOrder: [],
      groups: {},
      urlRules: [{ id: "r-local", name: "Local Rule" }],
      driveSyncMeta: { categoryTimestamps: { urlRules: 450 }, fileId: "file-1", lastMergedAt: { urlRules: 100 } }
    },
    options: {
      driveSyncCategories: {
        aliases: false, groups: false, history: false, options: false, profiles: false, urlRules: true
      }
    },
    profiles: { map: { __always_on: [], __base: [], __favorites: [] }, meta: {} }
  };

  const savedConflicts = [];
  const result = await root.ExtensityDriveSync.syncDrive({
    direction: "sync",
    resolution: "keep_local",
    interactive: false,
    overrideFailsafe: true,
    loadContext: async function() { return context; },
    savePatches: async function(patches) { captured.patches.push(patches); },
    saveDriveMeta: async function() {},
    saveSyncOptions: async function() {},
    savePendingConflict: async function(conflict) { savedConflicts.push(conflict); }
  });

  assert.equal(result.status, "merged");
  const uploadedRuleIds = captured.uploads[0].categories.urlRules.data.map((rule) => rule.id).sort();
  assert.deepEqual(uploadedRuleIds, ["r-local", "r-remote"]);
  assert.equal(captured.patches.length, 1);
  // A successful resolution must clear any previously pending conflict banner.
  assert.deepEqual(savedConflicts, [null]);
});

test("syncDrive keep_remote preserves compatible local additions", async () => {
  const remoteEnvelope = {
    version: "1.0.0",
    categories: {
      urlRules: { updatedAt: 500, data: [{ id: "r-remote", name: "Remote Rule" }] }
    }
  };
  const { captured, fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  const context = {
    driveSyncMeta: { categoryTimestamps: { urlRules: 450 }, fileId: "file-1", lastMergedAt: { urlRules: 100 } },
    localState: {
      aliases: {},
      eventHistory: [],
      groupOrder: [],
      groups: {},
      urlRules: [{ id: "r-local", name: "Local Rule" }],
      driveSyncMeta: { categoryTimestamps: { urlRules: 450 }, fileId: "file-1", lastMergedAt: { urlRules: 100 } }
    },
    options: {
      driveSyncCategories: {
        aliases: false, groups: false, history: false, options: false, profiles: false, urlRules: true
      }
    },
    profiles: { map: { __always_on: [], __base: [], __favorites: [] }, meta: {} }
  };

  const savedConflicts = [];
  const result = await root.ExtensityDriveSync.syncDrive({
    direction: "sync",
    resolution: "keep_remote",
    interactive: false,
    overrideFailsafe: true,
    loadContext: async function() { return context; },
    savePatches: async function(patches) { captured.patches.push(patches); },
    saveDriveMeta: async function() {},
    saveSyncOptions: async function() {},
    savePendingConflict: async function(conflict) { savedConflicts.push(conflict); }
  });

  assert.equal(result.status, "merged");
  assert.equal(captured.uploads.length, 1);
  const localRuleIds = captured.patches[0].localState.urlRules.map((rule) => rule.id).sort();
  assert.deepEqual(localRuleIds, ["r-local", "r-remote"]);
  // A successful resolution must clear any previously pending conflict banner.
  assert.deepEqual(savedConflicts, [null]);
});

function successfulSyncConfig(overrides = {}) {
  const context = {
    driveSyncMeta: { categoryTimestamps: { urlRules: 1 }, fileId: "file-1", lastMergedAt: {} },
    localState: {
      aliases: {},
      eventHistory: [],
      groupOrder: [],
      groups: {},
      urlRules: [{ id: "r-local", name: "Local Rule" }],
      driveSyncMeta: { categoryTimestamps: { urlRules: 1 }, fileId: "file-1", lastMergedAt: {} }
    },
    options: {
      driveSyncCategories: {
        aliases: false, groups: false, history: false, options: false, profiles: false, urlRules: true
      }
    },
    profiles: { map: { __always_on: [], __base: [], __favorites: [] }, meta: {} }
  };
  return {
    direction: "push",
    interactive: false,
    overrideFailsafe: true,
    loadContext: async function() { return context; },
    savePatches: async function() {},
    saveDriveMeta: async function() {},
    saveSyncOptions: async function() {},
    ...overrides
  };
}

test("syncDrive rejects an otherwise successful sync when loadContext is omitted", async () => {
  const remoteEnvelope = {
    version: "1.0.0",
    categories: { urlRules: { updatedAt: 999, data: [{ id: "r-remote", name: "Remote Rule" }] } }
  };
  const { fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  await assert.rejects(
    root.ExtensityDriveSync.syncDrive(successfulSyncConfig({ loadContext: undefined })),
    /Drive sync requires loadContext, savePatches, saveDriveMeta, and saveSyncOptions callbacks\./
  );
});

test("syncDrive rejects an otherwise successful sync when savePatches is omitted", async () => {
  const remoteEnvelope = {
    version: "1.0.0",
    categories: { urlRules: { updatedAt: 999, data: [{ id: "r-remote", name: "Remote Rule" }] } }
  };
  const { fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  await assert.rejects(
    root.ExtensityDriveSync.syncDrive(successfulSyncConfig({ savePatches: undefined })),
    /Drive sync requires loadContext, savePatches, saveDriveMeta, and saveSyncOptions callbacks\./
  );
});

test("syncDrive rejects an otherwise successful sync when saveDriveMeta is omitted", async () => {
  const remoteEnvelope = {
    version: "1.0.0",
    categories: { urlRules: { updatedAt: 999, data: [{ id: "r-remote", name: "Remote Rule" }] } }
  };
  const { fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  await assert.rejects(
    root.ExtensityDriveSync.syncDrive(successfulSyncConfig({ saveDriveMeta: undefined })),
    /Drive sync requires loadContext, savePatches, saveDriveMeta, and saveSyncOptions callbacks\./
  );
});

test("syncDrive rejects an otherwise successful sync when saveSyncOptions is omitted", async () => {
  const remoteEnvelope = {
    version: "1.0.0",
    categories: { urlRules: { updatedAt: 999, data: [{ id: "r-remote", name: "Remote Rule" }] } }
  };
  const { fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  await assert.rejects(
    root.ExtensityDriveSync.syncDrive(successfulSyncConfig({ saveSyncOptions: undefined })),
    /Drive sync requires loadContext, savePatches, saveDriveMeta, and saveSyncOptions callbacks\./
  );
});

test("describeDrivePendingConflict returns non-blank, reason-specific text for every conflict reason", () => {
  const root = loadDriveSync();
  const describe = root.ExtensityDriveSync.describeDrivePendingConflict;

  assert.equal(describe(null), "");

  const divergenceText = describe({
    reason: "divergence",
    categories: [{ categoryId: "aliases", itemId: "ext1", label: "Aliases / ext1" }]
  });
  assert.match(divergenceText, /Sync conflict in: Aliases \/ ext1/);
  assert.doesNotMatch(divergenceText, /Sync conflict in: \./);

  // Anomalous case: divergence reason but no per-category entries. Must still be non-blank.
  const divergenceEmptyText = describe({ reason: "divergence", categories: [] });
  assert.notEqual(divergenceEmptyText, "");
  assert.doesNotMatch(divergenceEmptyText, /Sync conflict in: \./);

  const duplicateText = describe({
    reason: "duplicate_remote_files",
    duplicateFiles: [{ id: "a" }, { id: "b" }]
  });
  assert.notEqual(duplicateText, "");
  assert.match(duplicateText, /2/);
  assert.match(duplicateText, /Keep this device \/ Use Drive copy can't resolve this/);

  const schemaText = describe({ reason: "schema_regression" });
  assert.notEqual(schemaText, "");
  assert.match(schemaText, /older data format/);

  const failsafeText = describe({
    reason: "failsafe",
    failsafe: { deleted: 9, beforeCount: 10, deletionPercent: 90, thresholdPercent: 20, label: "Aliases" }
  });
  assert.notEqual(failsafeText, "");
  assert.match(failsafeText, /9 of 10 items in Aliases/);
  assert.match(failsafeText, /90%, threshold 20%/);

  assert.throws(() => describe({ reason: "not_a_real_reason" }), /Unhandled Drive conflict reason/);
});

test("isDriveConflictResolvable is true only for divergence conflicts", () => {
  const root = loadDriveSync();
  const resolvable = root.ExtensityDriveSync.isDriveConflictResolvable;

  assert.equal(resolvable(null), false);
  assert.equal(resolvable({ reason: "divergence" }), true);
  assert.equal(resolvable({ reason: "duplicate_remote_files" }), false);
  assert.equal(resolvable({ reason: "schema_regression" }), false);
  assert.equal(resolvable({ reason: "failsafe" }), false);
});

test("syncDrive cancel clears the pending conflict without any Drive API calls", async () => {
  const root = loadDriveSync({
    fetch: async function(url) {
      throw new Error("Unexpected fetch during cancel: " + url);
    },
    chrome: {
      identity: {
        getAuthToken() {
          throw new Error("Unexpected token acquisition during cancel.");
        }
      }
    }
  });

  const context = sampleContext();
  context.localState.drivePendingConflict = { reason: "failsafe", detectedAt: 1 };

  const savedConflicts = [];
  const appended = [];
  const result = await root.ExtensityDriveSync.syncDrive({
    direction: "sync",
    resolution: "cancel",
    loadContext: async function() { return context; },
    savePatches: async function() {},
    saveDriveMeta: async function() {},
    saveSyncOptions: async function() {},
    savePendingConflict: async function(conflict) { savedConflicts.push(conflict); },
    appendAudit: async function(entry) { appended.push(entry); }
  });

  assert.equal(result.status, "cancelled");
  assert.deepEqual(savedConflicts, [null]);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].status, "cancelled");
});

test("syncDrive rejects keep_local/keep_remote with unsupported_resolution when duplicate Drive files exist", async () => {
  const fetchImpl = async function(url, options) {
    const method = (options && options.method) || "GET";
    if (url.indexOf("/drive/v3/files?spaces=appDataFolder") !== -1 && method === "GET") {
      return jsonResponse(200, {
        files: [
          { id: "file-1", modifiedTime: "2026-07-23T10:00:00.000Z", name: "extensity-plus-sync.json", size: "10", version: "1" },
          { id: "file-2", modifiedTime: "2026-07-20T10:00:00.000Z", name: "extensity-plus-sync.json", size: "10", version: "1" }
        ]
      });
    }
    throw new Error("Unexpected fetch: " + method + " " + url);
  };
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });
  const context = sampleContext();

  await assert.rejects(
    root.ExtensityDriveSync.syncDrive({
      direction: "sync",
      resolution: "keep_local",
      loadContext: async function() { return context; },
      savePatches: async function() {},
      saveDriveMeta: async function() {},
      saveSyncOptions: async function() {}
    }),
    (err) => {
      assert.equal(err.code, "unsupported_resolution");
      return true;
    }
  );
});

test("syncDrive rejects keep_remote with unsupported_resolution on schema regression", async () => {
  const remoteEnvelope = {
    version: "1.0.0",
    categories: { aliases: { updatedAt: 500, data: { a: "A" } } }
  };
  const { fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  const context = sampleContext();
  context.localState.driveSyncMeta = { envelopeVersion: "2.0.0", fileId: "file-1" };

  await assert.rejects(
    root.ExtensityDriveSync.syncDrive({
      direction: "sync",
      resolution: "keep_remote",
      loadContext: async function() { return context; },
      savePatches: async function() {},
      saveDriveMeta: async function() {},
      saveSyncOptions: async function() {}
    }),
    (err) => {
      assert.equal(err.code, "unsupported_resolution");
      return true;
    }
  );
});

test("syncDrive rejects keep_local with unsupported_resolution when a failsafe threshold is tripped", async () => {
  const baselineAliases = { a: "A", b: "B", c: "C", d: "D", e: "E", f: "F" };
  const remoteEnvelope = {
    version: "1.0.0",
    categories: { aliases: { updatedAt: 500, data: { a: "A" } } }
  };
  const { fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  const context = sampleContext();
  context.localState.aliases = { ...baselineAliases };
  context.localState.driveSyncMeta = {
    baselineCategories: { aliases: { ...baselineAliases } },
    fileId: "file-1"
  };
  context.options.driveSyncCategories = {
    aliases: true, groups: false, history: false, options: false, profiles: false, urlRules: false
  };
  // The failsafe guards destructive changes, so this case only arises under the mirror policy.
  context.options.driveSyncDeletionPolicy = "mirror";

  await assert.rejects(
    root.ExtensityDriveSync.syncDrive({
      direction: "sync",
      resolution: "keep_local",
      loadContext: async function() { return context; },
      savePatches: async function() {},
      saveDriveMeta: async function() {},
      saveSyncOptions: async function() {}
    }),
    (err) => {
      assert.equal(err.code, "unsupported_resolution");
      return true;
    }
  );
});

test("deleteDriveFile requires a file ID", async () => {
  const root = loadDriveSync();

  await assert.rejects(
    root.ExtensityDriveSync.deleteDriveFile(null),
    (err) => {
      assert.equal(err.code, "invalid_request");
      return true;
    }
  );
});

test("deleteDriveFile rejects with not_configured when OAuth is not set up", async () => {
  const root = loadDriveSync({
    chrome: {
      runtime: {
        getManifest() {
          return { oauth2: { client_id: "REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com" } };
        }
      }
    }
  });

  await assert.rejects(
    root.ExtensityDriveSync.deleteDriveFile("file-1"),
    (err) => {
      assert.equal(err.code, "not_configured");
      return true;
    }
  );
});

test("deleteDriveFile sends a DELETE request for the given file ID and returns confirmation", async () => {
  const requests = [];
  const fetchImpl = async function(url, options) {
    requests.push({ method: (options && options.method) || "GET", url: url });
    if (url.indexOf("/drive/v3/files/dup-file-2") !== -1 && options.method === "DELETE") {
      return { headers: { get() { return null; } }, ok: true, status: 204, text: async function() { return ""; } };
    }
    throw new Error("Unexpected fetch: " + options.method + " " + url);
  };
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  const result = await root.ExtensityDriveSync.deleteDriveFile("dup-file-2");

  assert.deepEqual(plain(result), { deleted: true, fileId: "dup-file-2" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "DELETE");
  assert.match(requests[0].url, /\/drive\/v3\/files\/dup-file-2$/);
});

test("deleteDriveFile surfaces a Drive API error (e.g. file already gone) with a typed code", async () => {
  const fetchImpl = async function() {
    return {
      headers: { get() { return null; } },
      ok: false,
      status: 404,
      text: async function() { return "File not found"; }
    };
  };
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  await assert.rejects(
    root.ExtensityDriveSync.deleteDriveFile("already-deleted"),
    (err) => {
      assert.equal(err.code, "not_found");
      return true;
    }
  );
});

function statefulLocalStorage() {
  var stored = {};
  return {
    get(keys, callback) { callback(stored); },
    remove(keys, callback) {
      (Array.isArray(keys) ? keys : [keys]).forEach(function(key) { delete stored[key]; });
      callback();
    },
    set(values, callback) { Object.assign(stored, values); callback(); },
    _stored: stored
  };
}

test("hasPendingPreviewConfirmation tracks an outstanding preview until it is consumed or expires", async () => {
  const remoteEnvelope = {
    version: "1.0.0",
    categories: { urlRules: { updatedAt: 999, data: [{ id: "r-remote", name: "Remote Rule" }] } }
  };
  const { fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const localStorageStub = statefulLocalStorage();
  const root = loadDriveSync({
    crypto: crypto,
    fetch: fetchImpl,
    chrome: { identity: tokenIdentityOverrides(), storage: { local: localStorageStub } }
  });

  assert.equal(await root.ExtensityDriveSync.hasPendingPreviewConfirmation(), false);

  const previewResult = await root.ExtensityDriveSync.syncDrive(
    successfulSyncConfig({ direction: "push", preview: true })
  );
  assert.equal(previewResult.status, "preview");
  assert.ok(previewResult.confirmationToken);
  assert.equal(await root.ExtensityDriveSync.hasPendingPreviewConfirmation(), true);

  await root.ExtensityDriveSync.syncDrive(
    successfulSyncConfig({
      confirmationToken: previewResult.confirmationToken,
      direction: "push",
      requireConfirmation: true
    })
  );
  assert.equal(await root.ExtensityDriveSync.hasPendingPreviewConfirmation(), false);
});

test("hasPendingPreviewConfirmation ignores an expired confirmation record", async () => {
  const remoteEnvelope = {
    version: "1.0.0",
    categories: { urlRules: { updatedAt: 999, data: [{ id: "r-remote", name: "Remote Rule" }] } }
  };
  const { fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const localStorageStub = statefulLocalStorage();
  const root = loadDriveSync({
    crypto: crypto,
    fetch: fetchImpl,
    chrome: { identity: tokenIdentityOverrides(), storage: { local: localStorageStub } }
  });

  const previewResult = await root.ExtensityDriveSync.syncDrive(
    successfulSyncConfig({ direction: "push", preview: true })
  );
  assert.equal(await root.ExtensityDriveSync.hasPendingPreviewConfirmation(), true);

  const confirmations = localStorageStub._stored.drivePreviewConfirmations;
  Object.keys(confirmations).forEach(function(token) {
    confirmations[token].expiresAt = 0;
  });

  assert.equal(await root.ExtensityDriveSync.hasPendingPreviewConfirmation(), false);
});

test("confirming a preview succeeds even when real time passes between the two calls", async () => {
  // Regression test: buildEnvelope() stamps a fresh exportedAt (nowMs()) on every call,
  // so if the confirmation fingerprint included it, any real elapsed time between the
  // preview call and the confirm call would make the confirmation fail every time.
  const remoteEnvelope = {
    version: "1.0.0",
    categories: { urlRules: { updatedAt: 999, data: [{ id: "r-remote", name: "Remote Rule" }] } }
  };
  const { fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({
    crypto: crypto,
    fetch: fetchImpl,
    chrome: { identity: tokenIdentityOverrides(), storage: { local: statefulLocalStorage() } }
  });

  const previewResult = await root.ExtensityDriveSync.syncDrive(
    successfulSyncConfig({ direction: "push", preview: true })
  );
  assert.equal(previewResult.status, "preview");

  // Guarantee nowMs() advances by at least a few milliseconds before the confirm call,
  // so this test cannot pass by timing luck the way the original bug sometimes did.
  await new Promise(function(resolve) { setTimeout(resolve, 10); });

  const confirmResult = await root.ExtensityDriveSync.syncDrive(
    successfulSyncConfig({
      confirmationToken: previewResult.confirmationToken,
      direction: "push",
      requireConfirmation: true
    })
  );
  assert.equal(confirmResult.status, "pushed");
});

test("confirming a preview succeeds after an unrelated local change bumps a category timestamp", async () => {
  // Regression test: the confirmation fingerprint covered each category's updatedAt, which
  // background.js touchDriveCategories() bumps on ANY local change — toggling an extension,
  // a URL rule firing, saving options. So a confirm issued after any such event failed with
  // preview_stale even though the synced data was byte-for-byte identical.
  const remoteEnvelope = {
    version: "1.0.0",
    categories: { urlRules: { updatedAt: 999, data: [{ id: "r-remote", name: "Remote Rule" }] } }
  };
  const { fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({
    crypto: crypto,
    fetch: fetchImpl,
    chrome: { identity: tokenIdentityOverrides(), storage: { local: statefulLocalStorage() } }
  });

  const context = {
    driveSyncMeta: { categoryTimestamps: { urlRules: 1 }, fileId: "file-1", lastMergedAt: {} },
    localState: {
      aliases: {},
      eventHistory: [],
      groupOrder: [],
      groups: {},
      urlRules: [{ id: "r-local", name: "Local Rule" }],
      driveSyncMeta: { categoryTimestamps: { urlRules: 1 }, fileId: "file-1", lastMergedAt: {} }
    },
    options: {
      driveSyncCategories: {
        aliases: false, groups: false, history: false, options: false, profiles: false, urlRules: true
      }
    },
    profiles: { map: { __always_on: [], __base: [], __favorites: [] }, meta: {} }
  };
  const sharedConfig = {
    direction: "push",
    interactive: false,
    overrideFailsafe: true,
    loadContext: async function() { return context; },
    savePatches: async function() {},
    saveDriveMeta: async function() {},
    saveSyncOptions: async function() {}
  };

  const previewResult = await root.ExtensityDriveSync.syncDrive({ ...sharedConfig, preview: true });
  assert.equal(previewResult.status, "preview");

  // Simulate the unrelated local change: same rule data, newer category timestamp.
  const bumped = root.ExtensityDriveSync.bumpCategoryTimestamp(context.localState.driveSyncMeta, "urlRules");
  context.localState.driveSyncMeta = bumped;
  context.driveSyncMeta = bumped;

  const confirmResult = await root.ExtensityDriveSync.syncDrive({
    ...sharedConfig,
    confirmationToken: previewResult.confirmationToken,
    requireConfirmation: true
  });
  assert.equal(confirmResult.status, "pushed");
});

test("buildEnvelope keeps device-local options out of the synced payload", () => {
  const root = loadDriveSync();
  const context = sampleContext();
  context.options.driveAuthStatus = "authorized";
  context.options.syncWriterId = "device-a";
  context.options.lastDriveSync = 12345;
  context.options.sortMode = "alpha";

  const envelope = root.ExtensityDriveSync.buildEnvelope(
    context,
    { aliases: false, groups: false, history: false, options: true, profiles: false, urlRules: false },
    "device-a"
  );
  const data = plain(envelope.categories.options.data);

  // Device identity and per-device OAuth state must not travel to other devices.
  assert.equal(Object.prototype.hasOwnProperty.call(data, "syncWriterId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, "driveAuthStatus"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, "lastDriveSync"), false);
  // Genuine user settings still sync.
  assert.equal(data.sortMode, "alpha");
});

test("syncDrive reports noop when only device-local options differ from Drive", async () => {
  // Regression test: syncWriterId (injected per device by background.js loadDriveContext)
  // and driveAuthStatus used to ride along in the options category. Every device wrote its
  // own value, so the category was permanently divergent — each sync wrote to Drive, bumped
  // the file version, and invalidated in-flight preview confirmations. noop was unreachable.
  const remoteEnvelope = {
    version: "2.0.0",
    exportedAt: 5,
    writerId: "device-b",
    categories: { options: { updatedAt: 500, data: { sortMode: "recent", viewMode: "list" } } }
  };
  const { captured, fetchImpl } = driveSyncFetchHarness(remoteEnvelope);
  const root = loadDriveSync({ fetch: fetchImpl, chrome: { identity: tokenIdentityOverrides() } });

  const context = {
    driveSyncMeta: { categoryTimestamps: { options: 500 }, fileId: "file-1", lastMergedAt: { options: 500 } },
    localState: {
      aliases: {},
      eventHistory: [],
      groupOrder: [],
      groups: {},
      urlRules: [],
      driveSyncMeta: { categoryTimestamps: { options: 500 }, fileId: "file-1", lastMergedAt: { options: 500 } }
    },
    options: {
      // Same user settings as Drive; only the device-local fields differ.
      sortMode: "recent",
      viewMode: "list",
      driveAuthStatus: "authorized",
      syncWriterId: "device-a",
      driveSyncCategories: {
        aliases: false, groups: false, history: false, options: true, profiles: false, urlRules: false
      }
    },
    profiles: { map: { __always_on: [], __base: [], __favorites: [] }, meta: {} }
  };

  const result = await root.ExtensityDriveSync.syncDrive({
    direction: "sync",
    interactive: false,
    loadContext: async function() { return context; },
    savePatches: async function() {},
    saveDriveMeta: async function() {},
    saveSyncOptions: async function() {}
  });

  assert.equal(result.status, "noop");
  assert.equal(captured.uploads.length, 0);
});

test("buildChangeSummary ignores object key order when comparing category data", () => {
  // dataEqual drives mergedDataDiffers, the change counts, and the failsafe. Plain
  // JSON.stringify is key-order sensitive, so a locally rebuilt object compared against the
  // same data parsed back from Drive reported phantom changes — which could trip the
  // failsafe's (changed + deleted) / beforeCount rule and block an automatic sync.
  const root = loadDriveSync();
  const flags = { aliases: false, groups: true, history: false, options: false, profiles: false, urlRules: false };
  // Same group, same content — only the key order inside the group object differs, exactly
  // what happens when a locally rebuilt object meets the same data parsed back from Drive.
  const before = {
    categories: {
      groups: {
        updatedAt: 1,
        data: { groupOrder: ["g1"], groups: { g1: { name: "Work", extensionIds: ["ext1"], color: "red" } } }
      }
    }
  };
  const after = {
    categories: {
      groups: {
        updatedAt: 2,
        data: { groups: { g1: { color: "red", name: "Work", extensionIds: ["ext1"] } }, groupOrder: ["g1"] }
      }
    }
  };

  const summary = plain(root.ExtensityDriveSync.buildChangeSummary(before, after, flags));

  assert.equal(summary.length, 1);
  assert.equal(summary[0].changed, 0);
  assert.equal(summary[0].added, 0);
  assert.equal(summary[0].deleted, 0);
  // Byte estimates must be order-independent too, or they drift for identical data.
  assert.equal(summary[0].beforeBytes, summary[0].afterBytes);
});

test("findFailsafeViolation ignores pure additions but still catches deletions", () => {
  const root = loadDriveSync();
  const automatic = { driveAutomaticTrigger: true, driveFailsafeThresholdPercent: 20 };

  // Adding 40 items is not destructive: a first automatic sync from a device with many
  // extensions or rules must not be blocked by the destructive-change safeguard.
  const additions = [{
    added: 40, afterBytes: 400, afterCount: 45, beforeBytes: 50, beforeCount: 5,
    categoryId: "aliases", changed: 0, deleted: 0, deletionPercent: 0
  }];
  assert.equal(root.ExtensityDriveSync.findFailsafeViolation(additions, automatic), null);

  // Deletions above the threshold still trip it.
  const deletions = [{
    added: 0, afterBytes: 10, afterCount: 1, beforeBytes: 100, beforeCount: 10,
    categoryId: "aliases", changed: 0, deleted: 9, deletionPercent: 90
  }];
  const violation = root.ExtensityDriveSync.findFailsafeViolation(deletions, automatic);
  assert.equal(violation.categoryId, "aliases");
  assert.equal(violation.deleted, 9);
});

test("three-way merge keys id-less array items by content, not array position", () => {
  // Without content keys, position is identity: prepending one remote item re-keys every
  // later item, so the merge reports them all as changed on both sides and invents conflicts.
  const root = loadDriveSync();
  const flags = { aliases: false, groups: false, history: false, options: false, profiles: false, urlRules: true };
  // Local appends one rule, remote prepends another. With positional keys the shared rules
  // shift index, so index "2" holds the local addition on one side and an untouched base
  // rule on the other — a phantom conflict that silently drops "Rule B".
  const base = [{ name: "Rule A" }, { name: "Rule B" }];
  const localEnvelope = {
    categories: { urlRules: { data: [{ name: "Rule A" }, { name: "Rule B" }, { name: "Rule L" }], updatedAt: 20 } }
  };
  const remoteEnvelope = {
    categories: { urlRules: { data: [{ name: "Rule Z" }, { name: "Rule A" }, { name: "Rule B" }], updatedAt: 30 } }
  };

  const result = root.ExtensityDriveSync.buildThreeWayEnvelope(
    localEnvelope, remoteEnvelope, { urlRules: base }, flags, null, "device-a"
  );

  assert.deepEqual(plain(result.conflicts), []);
  assert.deepEqual(
    plain(result.envelope.categories.urlRules.data).map((rule) => rule.name).sort(),
    ["Rule A", "Rule B", "Rule L", "Rule Z"]
  );
});

test("a token refresh does not consume the transient-failure retry budget", async () => {
  // The 401 refresh branch used to increment `attempt`, leaving only one of three attempts
  // for the transient failures the retry budget exists for.
  let fetchCalls = 0;
  const root = loadDriveSync({
    chrome: {
      identity: {
        getAuthToken(options, callback) { callback("fresh-token"); },
        removeCachedAuthToken(details, callback) { callback(); }
      }
    },
    fetch: async function(url, options) {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return textResponse(401, "unauthorized");
      }
      // Two transient failures — the full DRIVE_MAX_RETRIES budget must still be available
      // after the refresh. Charging the refresh an attempt made this exhaust and throw.
      if (fetchCalls === 2 || fetchCalls === 3) {
        return textResponse(503, "unavailable");
      }
      assert.equal(options.headers.Authorization, "Bearer fresh-token");
      return jsonResponse(200, { ok: true });
    }
  });

  const result = await root.ExtensityDriveSync.retryDriveApiRequest("stale-token", "/drive/v3/files", {
    interactive: false,
    sleep: async function() {}
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(fetchCalls, 4);
});

test("malformed remote category data is skipped, never applied as an empty wipe", () => {
  // A corrupt or hand-edited Drive file must not be able to clear a device. Previously a
  // null/wrong-typed payload either crashed (profiles, groups) or was coerced to an empty
  // object/array and written over the user's real data (aliases, urlRules, history).
  const root = loadDriveSync();
  const flags = { aliases: true, groups: true, history: true, options: true, profiles: true, urlRules: true };
  const envelope = {
    categories: {
      aliases: { data: null, updatedAt: 1 },
      groups: { data: "not-an-object", updatedAt: 1 },
      history: { data: { nope: true }, updatedAt: 1 },
      options: { data: null, updatedAt: 1 },
      profiles: { data: { meta: {} }, updatedAt: 1 },
      urlRules: { data: null, updatedAt: 1 }
    }
  };

  const patches = plain(root.ExtensityDriveSync.buildPatchesFromEnvelope(envelope, flags));

  assert.deepEqual(patches, {}, "no patch may be produced from malformed category data");
});

test("well-formed category data still produces patches", () => {
  const root = loadDriveSync();
  const flags = { aliases: true, groups: false, history: false, options: false, profiles: false, urlRules: true };
  const envelope = {
    categories: {
      aliases: { data: { ext1: "Alias" }, updatedAt: 1 },
      urlRules: { data: [{ id: "r1" }], updatedAt: 1 }
    }
  };

  const patches = plain(root.ExtensityDriveSync.buildPatchesFromEnvelope(envelope, flags));

  assert.deepEqual(patches.localState.aliases, { ext1: "Alias" });
  assert.deepEqual(patches.localState.urlRules, [{ id: "r1" }]);
});

test("applyCategoryToPatches rejects an unknown category instead of silently ignoring it", () => {
  const root = loadDriveSync();
  assert.throws(
    () => root.ExtensityDriveSync.applyCategoryToPatches("bogus", {}, {}),
    /Unknown Drive sync category/
  );
});
