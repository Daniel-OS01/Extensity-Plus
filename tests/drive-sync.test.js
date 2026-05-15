const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");

function loadDriveSync() {
  return loadBrowserScript(path.join(repoRoot, "js/drive-sync.js"), {
    chrome: {
      identity: {
        getAuthToken() {},
        removeCachedAuthToken() {}
      },
      runtime: {
        getManifest() {
          return {
            oauth2: {
              client_id: "test-client-id.apps.googleusercontent.com",
              scopes: ["https://www.googleapis.com/auth/drive.appdata"]
            }
          };
        },
        lastError: null
      }
    },
    fetch: async function() {
      throw new Error("Unexpected fetch in unit test.");
    }
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
