const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(repoRoot, "js/background.js"), "utf8");

// All message types the handleMessage switch must handle
const EXPECTED_MESSAGE_TYPES = [
  "APPLY_PROFILE",
  "EXPORT_BACKUP",
  "GET_EXTENSION_METADATA",
  "GET_STATE",
  "IMPORT_BACKUP",
  "OPEN_DASHBOARD",
  "SAVE_ALIAS",
  "SAVE_GROUPS",
  "SAVE_OPTIONS",
  "SAVE_URL_RULES",
  "SET_EXTENSION_STATE",
  "SYNC_DRIVE",
  "TOGGLE_ALL",
  "UNDO_LAST",
  "UNINSTALL_EXTENSION",
  "UPDATE_EXTENSION_PROFILE_MEMBERSHIP",
  "UPDATE_EXTENSION_TOOLBAR_PINNED"
];

// Operation context source values attributed to mutations
const VALID_CONTEXT_SOURCES = ["manual", "bulk", "profile", "rule", "undo", "import"];

function createChromeStub(overrides = {}) {
  const stub = {
    alarms: {
      clear() {},
      create() {},
      onAlarm: { addListener() {} }
    },
    commands: {
      onCommand: { addListener() {} }
    },
    contextMenus: {
      create() {},
      onClicked: { addListener() {} },
      removeAll() {}
    },
    management: {
      onInstalled: { addListener() {} }
    },
    permissions: {
      contains(permissionObject, callback) {
        callback(false);
      }
    },
    notifications: {
      clear() {},
      create() {}
    },
    runtime: {
      getManifest() { return { version: "2.0.0" }; },
      id: "runtime-extension",
      lastError: null,
      onInstalled: { addListener() {} },
      onMessage: { addListener() {} },
      onStartup: { addListener() {} }
    },
    tabs: {
      create() {},
      get() {},
      onActivated: { addListener() {} },
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
      query() {},
      sendMessage() {}
    },
    webNavigation: {
      onHistoryStateUpdated: { addListener() {} }
    }
  };

  return {
    ...stub,
    ...overrides
  };
}

function loadBackground(options = {}) {
  const storageOverrides = options.storageOverrides || {};
  return loadBrowserScript(path.join(repoRoot, "js/background.js"), {
    chrome: createChromeStub(options.chromeOverrides),
    fetch: async function() { throw new Error("Unexpected fetch in unit test."); },
    importScripts() {},
    self: {
      ExtensityDriveSync: {},
      ExtensityHistory: {},
      ExtensityImportExport: {},
      ExtensityMigrations: {
        migrateLegacyLocalStorage: async function() { return false; },
        migratePopupListStyle: async function() { return false; },
        migrateTo2_0_0: async function() { return false; }
      },
      ExtensityReminders: {},
      ExtensityStorage: {
        clone(value) { return JSON.parse(JSON.stringify(value)); },
        uniqueArray(items) { return Array.from(new Set(items || [])); },
        ...storageOverrides
      },
      ExtensityUrlRules: {}
    }
  });
}

// --- Module load ---

test("background module loads without runtime errors", () => {
  assert.doesNotThrow(() => loadBackground(), "js/background.js must load without throwing");
});

test("background module exposes ExtensityBackground namespace on self", () => {
  const root = loadBackground();
  assert.ok(root.ExtensityBackground, "ExtensityBackground must be exported on self");
  assert.equal(typeof root.ExtensityBackground, "object");
});

// --- Exported API surface ---

test("ExtensityBackground exposes all required exported functions", () => {
  const root = loadBackground();
  const api = root.ExtensityBackground;
  const requiredFunctions = [
    "normalizeExtensions",
    "parseChromeWebStoreHtml",
    "buildFallbackMetadata",
    "buildGenericStoreUrl",
    "defaultCategoryForInstallType",
    "firstDescriptionLine",
    "normalizeStoreUrl"
  ];
  for (const fn of requiredFunctions) {
    assert.equal(
      typeof api[fn],
      "function",
      `ExtensityBackground.${fn} must be a function — check that it is added to the root.ExtensityBackground export object`
    );
  }
});

// --- Static contract: message type coverage ---

test("all expected message type strings are handled in background.js handleMessage switch", () => {
  for (const type of EXPECTED_MESSAGE_TYPES) {
    assert.ok(
      backgroundSource.includes(`"${type}"`),
      `Message type "${type}" must appear in background.js — ` +
      `if this is a new type, add a case for it in the handleMessage switch`
    );
  }
});

test("handleMessage switch has a default branch that throws for unknown types", () => {
  assert.ok(
    backgroundSource.includes("Unsupported message type"),
    "handleMessage must throw on unknown types — the default branch with 'Unsupported message type' appears to be missing"
  );
});

// --- Static contract: operation context sources ---

test("all valid operation context source values appear in background.js", () => {
  for (const source of VALID_CONTEXT_SOURCES) {
    assert.ok(
      backgroundSource.includes(`"${source}"`),
      `Context source "${source}" must appear in background.js — ` +
      `check that history logging and mutation paths use this source value`
    );
  }
});

// --- normalizeExtensions ---

function makeRawExt(overrides = {}) {
  return {
    description: "A test extension",
    enabled: true,
    homepageUrl: "",
    icons: [],
    id: "test-ext",
    installType: "normal",
    mayDisable: true,
    name: "Test Extension",
    optionsUrl: "",
    type: "extension",
    version: "1.0.0",
    ...overrides
  };
}

function makeState() {
  return {
    localState: {
      aliases: {},
      groups: {},
      installFirstSeenAt: {},
      recentlyUsed: [],
      toolbarPins: [],
      usageCounters: {}
    },
    profiles: { map: { __always_on: [], __favorites: [] } }
  };
}

test("normalizeExtensions preserves the extension version field", () => {
  const root = loadBackground();
  const result = root.ExtensityBackground.normalizeExtensions(
    [makeRawExt({ version: "3.1.4" })],
    makeState()
  );
  assert.equal(result[0].version, "3.1.4");
});

test("normalizeExtensions marks hosted_app and packaged_app types as isApp:true", () => {
  const root = loadBackground();
  for (const type of ["hosted_app", "packaged_app"]) {
    const result = root.ExtensityBackground.normalizeExtensions(
      [makeRawExt({ id: `app-${type}`, type })],
      makeState()
    );
    assert.equal(result[0].isApp, true, `type "${type}" must be isApp:true`);
  }
});

test("normalizeExtensions marks extension type as isApp:false", () => {
  const root = loadBackground();
  const result = root.ExtensityBackground.normalizeExtensions(
    [makeRawExt({ type: "extension" })],
    makeState()
  );
  assert.equal(result[0].isApp, false);
});

test("normalizeExtensions applies alias from localState when present", () => {
  const root = loadBackground();
  const result = root.ExtensityBackground.normalizeExtensions(
    [makeRawExt({ id: "aliased-ext", name: "Original Name" })],
    {
      localState: {
        aliases: { "aliased-ext": "My Custom Name" },
        groups: {},
        recentlyUsed: [],
        usageCounters: {}
      },
      profiles: { map: { __always_on: [], __favorites: [] } }
    }
  );
  assert.equal(result[0].alias, "My Custom Name");
});

test("normalizeExtensions marks always-on extensions correctly", () => {
  const root = loadBackground();
  const result = root.ExtensityBackground.normalizeExtensions(
    [makeRawExt({ id: "pinned-ext" })],
    {
      localState: { aliases: {}, groups: {}, recentlyUsed: [], usageCounters: {} },
      profiles: { map: { __always_on: ["pinned-ext"], __favorites: [] } }
    }
  );
  assert.equal(result[0].alwaysOn, true);
});

test("normalizeExtensions marks toolbar pinned extensions from local state", () => {
  const root = loadBackground();
  const result = root.ExtensityBackground.normalizeExtensions(
    [makeRawExt({ id: "toolbar-ext" })],
    {
      localState: {
        aliases: {},
        groups: {},
        installFirstSeenAt: { "toolbar-ext": 12345 },
        recentlyUsed: [],
        toolbarPins: ["toolbar-ext"],
        usageCounters: {}
      },
      profiles: { map: { __always_on: [], __favorites: [] } }
    }
  );
  assert.equal(result[0].toolbarPinned, true);
  assert.equal(result[0].installedAt, 12345);
});

test("management onInstalled stores installFirstSeenAt for new items immediately", async () => {
  let managementInstalledListener = null;
  const savedLocalStates = [];
  const fixedNow = 1700000000000;

  loadBrowserScript(path.join(repoRoot, "js/background.js"), {
    Date: class extends Date {
      static now() {
        return fixedNow;
      }
    },
    chrome: createChromeStub({
      management: {
        onInstalled: {
          addListener(listener) {
            managementInstalledListener = listener;
          }
        }
      }
    }),
    fetch: async function() { throw new Error("Unexpected fetch in unit test."); },
    importScripts() {},
    self: {
      ExtensityDriveSync: {},
      ExtensityHistory: {},
      ExtensityImportExport: {},
      ExtensityMigrations: {
        migrateLegacyLocalStorage: async function() { return false; },
        migratePopupListStyle: async function() { return false; },
        migrateTo2_0_0: async function() { return false; }
      },
      ExtensityReminders: {},
      ExtensityStorage: {
        clone(value) { return JSON.parse(JSON.stringify(value)); },
        loadLocalState: async function() {
          return { installFirstSeenAt: { existing: 25 } };
        },
        saveLocalState: async function(patch) {
          savedLocalStates.push(JSON.parse(JSON.stringify(patch)));
        },
        uniqueArray(items) { return Array.from(new Set(items || [])); }
      },
      ExtensityUrlRules: {}
    }
  });

  assert.equal(typeof managementInstalledListener, "function");

  managementInstalledListener({ id: "new-ext", type: "extension" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(JSON.parse(JSON.stringify(savedLocalStates)), [
    {
      installFirstSeenAt: {
        existing: 25,
        "new-ext": fixedNow
      }
    }
  ]);
});
