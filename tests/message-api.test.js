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
  "PIN_EXTENSION_TO_TOOLBAR",
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
    debugger: {
      attach(target, version, callback) { callback(); },
      detach(target, callback) { callback(); },
      sendCommand(target, method, params, callback) {
        callback({});
      }
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
      remove() {},
      sendMessage() {},
      update() {}
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
  const urlRulesOverrides = options.urlRulesOverrides || {};
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
        makeId(prefix) { return `${prefix}-stub`; },
        uniqueArray(items) { return Array.from(new Set(items || [])); },
        ...storageOverrides
      },
      ExtensityUrlRules: {
        ...urlRulesOverrides
      }
    }
  });
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
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

test("toolbar pin automation expression supports switch buttons and pointer coordinates", () => {
  const root = loadBackground();
  const expression = root.ExtensityBackground.buildToolbarPinAutomationExpression(false);

  assert.match(expression, /button\[role="switch"\]/);
  assert.match(expression, /pointerReady/);
  assert.match(expression, /getBoundingClientRect/);
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

test("pinExtensionToToolbar attempts pointer input before DOM click fallback and closes temporary tabs on success", async () => {
  const attachCalls = [];
  const commandCalls = [];
  const createdTabs = [];
  const detachedTargets = [];
  const removedTabs = [];
  let evaluateCount = 0;
  const root = loadBackground({
    chromeOverrides: {
      debugger: {
        attach(target, version, callback) {
          attachCalls.push({ target: { ...target }, version });
          callback();
        },
        detach(target, callback) {
          detachedTargets.push({ ...target });
          callback();
        },
        sendCommand(target, method, params, callback) {
          commandCalls.push({
            method,
            params: params ? JSON.parse(JSON.stringify(params)) : null,
            target: { ...target }
          });
          if (method === "Input.dispatchMouseEvent") {
            callback({});
            return;
          }
          if (method !== "Runtime.evaluate") {
            callback({});
            return;
          }

          evaluateCount += 1;
          if (evaluateCount === 1) {
            callback({ result: { value: {
              clicked: false,
              found: true,
              isPinned: false,
              pointerReady: true,
              pointerX: 120,
              pointerY: 260,
              stateKnown: true
            } } });
            return;
          }
          if (evaluateCount === 2) {
            callback({ result: { value: {
              clicked: false,
              found: true,
              isPinned: false,
              pointerReady: true,
              pointerX: 120,
              pointerY: 260,
              stateKnown: true
            } } });
            return;
          }
          if (evaluateCount === 3) {
            callback({ result: { value: {
              clicked: true,
              found: true,
              isPinned: false,
              pointerReady: true,
              pointerX: 120,
              pointerY: 260,
              stateKnown: true
            } } });
            return;
          }
          callback({ result: { value: {
            clicked: false,
            found: true,
            isPinned: true,
            pointerReady: true,
            pointerX: 120,
            pointerY: 260,
            stateKnown: true
          } } });
        }
      },
      tabs: {
        create(details, callback) {
          createdTabs.push(JSON.parse(JSON.stringify(details)));
          callback({ active: false, id: 55, status: "loading", url: details.url });
        },
        get(tabId, callback) {
          callback({ active: false, id: tabId, status: "complete", url: createdTabs[0].url });
        },
        query(queryInfo, callback) {
          callback([]);
        },
        remove(tabId, callback) {
          removedTabs.push(tabId);
          callback();
        },
        update(tabId, updateProperties, callback) {
          callback({ active: !!updateProperties.active, id: tabId, status: "complete", url: createdTabs[0].url });
        }
      }
    }
  });

  const result = await root.ExtensityBackground.pinExtensionToToolbar({ extensionId: "ext-1" });

  assert.deepEqual(createdTabs, [
    {
      active: false,
      url: root.ExtensityBackground.buildManageExtensionUrl("ext-1")
    }
  ]);
  assert.deepEqual(attachCalls, [
    {
      target: { tabId: 55 },
      version: "1.3"
    }
  ]);
  assert.deepEqual(commandCalls.map((entry) => entry.method), [
    "Runtime.evaluate",
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
    "Runtime.evaluate",
    "Runtime.evaluate",
    "Runtime.evaluate"
  ]);
  assert.deepEqual(commandCalls.slice(1, 4).map((entry) => entry.params.type), [
    "mouseMoved",
    "mousePressed",
    "mouseReleased"
  ]);
  assert.deepEqual(detachedTargets, [{ tabId: 55 }]);
  assert.deepEqual(removedTabs, [55]);
  assert.deepEqual(normalize(result), {
    result: "pinned",
    tabId: 55,
    url: root.ExtensityBackground.buildManageExtensionUrl("ext-1")
  });
});

test("pinExtensionToToolbar skips clicking when the toolbar pin is already enabled", async () => {
  const commandCalls = [];
  const detachedTargets = [];
  const removedTabs = [];
  let evaluateCount = 0;
  const root = loadBackground({
    chromeOverrides: {
      debugger: {
        attach(target, version, callback) {
          callback();
        },
        detach(target, callback) {
          detachedTargets.push({ ...target });
          callback();
        },
        sendCommand(target, method, params, callback) {
          commandCalls.push(method);
          if (method !== "Runtime.evaluate") {
            callback({});
            return;
          }
          evaluateCount += 1;
          callback({ result: { value: { clicked: false, found: true, isPinned: true, stateKnown: true } } });
        }
      },
      tabs: {
        create(details, callback) {
          callback({ active: false, id: 77, status: "complete", url: details.url });
        },
        get(tabId, callback) {
          callback({ active: false, id: tabId, status: "complete", url: root.ExtensityBackground.buildManageExtensionUrl("ext-2") });
        },
        query(queryInfo, callback) {
          callback([]);
        },
        remove(tabId, callback) {
          removedTabs.push(tabId);
          callback();
        },
        update(tabId, updateProperties, callback) {
          callback({ active: !!updateProperties.active, id: tabId, status: "complete", url: root.ExtensityBackground.buildManageExtensionUrl("ext-2") });
        }
      }
    }
  });

  const result = await root.ExtensityBackground.pinExtensionToToolbar({ extensionId: "ext-2" });

  assert.equal(evaluateCount, 1);
  assert.deepEqual(commandCalls, ["Runtime.evaluate"]);
  assert.deepEqual(detachedTargets, [{ tabId: 77 }]);
  assert.deepEqual(removedTabs, [77]);
  assert.deepEqual(normalize(result), {
    result: "already_pinned",
    tabId: 77,
    url: root.ExtensityBackground.buildManageExtensionUrl("ext-2")
  });
});

test("pinExtensionToToolbar falls back to the browser details page when debugger attach fails", async () => {
  const createdTabs = [];
  const updatedTabs = [];
  const removedTabs = [];
  const root = loadBackground({
    chromeOverrides: {
      debugger: {
        attach() {
          throw new Error("attach failed");
        },
        detach(target, callback) {
          callback();
        },
        sendCommand(target, method, params, callback) {
          callback({});
        }
      },
      tabs: {
        create(details, callback) {
          createdTabs.push(JSON.parse(JSON.stringify(details)));
          callback({ active: !!details.active, id: 88, status: "complete", url: details.url });
        },
        get(tabId, callback) {
          callback({ active: false, id: tabId, status: "complete", url: root.ExtensityBackground.buildManageExtensionUrl("ext-3") });
        },
        query(queryInfo, callback) {
          callback([]);
        },
        remove(tabId, callback) {
          removedTabs.push(tabId);
          callback();
        },
        update(tabId, updateProperties, callback) {
          updatedTabs.push({ tabId, updateProperties: JSON.parse(JSON.stringify(updateProperties)) });
          callback({ active: !!updateProperties.active, id: tabId, status: "complete", url: root.ExtensityBackground.buildManageExtensionUrl("ext-3") });
        }
      }
    }
  });

  const result = await root.ExtensityBackground.pinExtensionToToolbar({ extensionId: "ext-3" });

  assert.deepEqual(createdTabs, [
    {
      active: false,
      url: root.ExtensityBackground.buildManageExtensionUrl("ext-3")
    }
  ]);
  assert.deepEqual(updatedTabs, [
    {
      tabId: 88,
      updateProperties: { active: true }
    }
  ]);
  assert.deepEqual(removedTabs, []);
  assert.deepEqual(normalize(result), {
    reason: "attach failed",
    result: "opened_fallback",
    tabId: 88,
    url: root.ExtensityBackground.buildManageExtensionUrl("ext-3")
  });
});

test("pinExtensionToToolbar reuses an existing details tab without auto-closing it", async () => {
  const removedTabs = [];
  let createCalls = 0;
  const existingTab = {
    active: true,
    id: 99,
    status: "complete",
    url: "chrome://extensions/?id=ext-4"
  };
  let evaluateCount = 0;
  const root = loadBackground({
    chromeOverrides: {
      debugger: {
        attach(target, version, callback) {
          callback();
        },
        detach(target, callback) {
          callback();
        },
        sendCommand(target, method, params, callback) {
          if (method !== "Runtime.evaluate") {
            callback({});
            return;
          }
          evaluateCount += 1;
          if (evaluateCount === 1) {
            callback({ result: { value: { clicked: false, found: true, isPinned: false, stateKnown: true } } });
            return;
          }
          if (evaluateCount === 2) {
            callback({ result: { value: { clicked: true, found: true, isPinned: false, stateKnown: true } } });
            return;
          }
          callback({ result: { value: { clicked: false, found: true, isPinned: true, stateKnown: true } } });
        }
      },
      tabs: {
        create(details, callback) {
          createCalls += 1;
          callback({ active: false, id: 100, status: "complete", url: details.url });
        },
        get(tabId, callback) {
          callback(existingTab);
        },
        query(queryInfo, callback) {
          callback([existingTab]);
        },
        remove(tabId, callback) {
          removedTabs.push(tabId);
          callback();
        },
        update(tabId, updateProperties, callback) {
          callback(existingTab);
        }
      }
    }
  });

  const result = await root.ExtensityBackground.pinExtensionToToolbar({ extensionId: "ext-4" });

  assert.equal(createCalls, 0);
  assert.deepEqual(removedTabs, []);
  assert.deepEqual(normalize(result), {
    result: "pinned",
    tabId: 99,
    url: root.ExtensityBackground.buildManageExtensionUrl("ext-4")
  });
});

// --- OPEN_DASHBOARD deepLink ---

test("buildDashboardTargetPath returns plain dashboard.html when no deepLink", async () => {
  const root = loadBackground();
  const path = await root.ExtensityBackground.buildDashboardTargetPath(undefined);
  assert.equal(path, "dashboard.html");
});

test("buildDashboardTargetPath builds a draft hash for a supported active tab", async () => {
  const root = loadBackground({
    chromeOverrides: {
      tabs: {
        create() {},
        get() {},
        onActivated: { addListener() {} },
        onRemoved: { addListener() {} },
        onUpdated: { addListener() {} },
        query(queryInfo, callback) {
          callback([{ id: 1, url: "https://www.github.com/openai/foo" }]);
        },
        remove() {},
        sendMessage() {},
        update() {}
      }
    },
    urlRulesOverrides: {
      buildHostnamePattern() {
        return {
          canonicalHost: "github.com",
          hostname: "www.github.com",
          pattern: "*://github.com/*",
          reason: "",
          suggestWww: true,
          supported: true
        };
      }
    }
  });

  const path = await root.ExtensityBackground.buildDashboardTargetPath({ tab: "rules", source: "add_active_site" });
  assert.ok(path.startsWith("dashboard.html#rules?"));
  const params = new URLSearchParams(path.split("?")[1]);
  assert.equal(params.get("host"), "github.com");
  assert.equal(params.get("pattern"), "*://github.com/*");
  assert.equal(params.get("suggestWww"), "1");
  assert.equal(params.get("source"), "add_active_site");
  assert.ok(params.get("draftId"));
});

test("buildDashboardTargetPath returns error hash when active tab URL is unsupported", async () => {
  const root = loadBackground({
    chromeOverrides: {
      tabs: {
        create() {},
        get() {},
        onActivated: { addListener() {} },
        onRemoved: { addListener() {} },
        onUpdated: { addListener() {} },
        query(queryInfo, callback) {
          callback([{ id: 2, url: "chrome://extensions" }]);
        },
        remove() {},
        sendMessage() {},
        update() {}
      }
    },
    urlRulesOverrides: {
      buildHostnamePattern() {
        return {
          canonicalHost: "",
          hostname: "",
          pattern: "",
          reason: "unsupported_scheme",
          suggestWww: false,
          supported: false
        };
      }
    }
  });

  const path = await root.ExtensityBackground.buildDashboardTargetPath({ tab: "rules", source: "add_active_site" });
  assert.equal(path, "dashboard.html#rules?error=unsupported_scheme");
});

test("buildDashboardTargetPath uses deepLink.tabUrl when provided, skipping tabs.query", async () => {
  const root = loadBackground({
    urlRulesOverrides: {
      buildHostnamePattern() {
        return {
          canonicalHost: "github.com",
          hostname: "github.com",
          pattern: "*://github.com/*",
          reason: "",
          suggestWww: true,
          supported: true
        };
      }
    }
  });

  const path = await root.ExtensityBackground.buildDashboardTargetPath({
    tab: "rules",
    source: "add_active_site",
    tabUrl: "https://github.com/openai/foo"
  });
  assert.ok(path.startsWith("dashboard.html#rules?"));
  const params = new URLSearchParams(path.split("?")[1]);
  assert.equal(params.get("host"), "github.com");
  assert.equal(params.get("suggestWww"), "1");
});

test("focusOrCreateDashboardTab updates an existing dashboard tab when present", async () => {
  let createCalls = 0;
  let updateCalls = [];
  const root = loadBackground({
    chromeOverrides: {
      runtime: {
        getManifest() { return { version: "2.0.0" }; },
        getURL(p) { return "chrome-extension://test-id/" + p; },
        id: "test-id",
        lastError: null,
        onInstalled: { addListener() {} },
        onMessage: { addListener() {} },
        onStartup: { addListener() {} }
      },
      tabs: {
        create(props, callback) {
          createCalls += 1;
          callback({ id: 5 });
        },
        get() {},
        onActivated: { addListener() {} },
        onRemoved: { addListener() {} },
        onUpdated: { addListener() {} },
        query(queryInfo, callback) {
          callback([{ id: 99, url: "chrome-extension://test-id/dashboard.html" }]);
        },
        remove() {},
        sendMessage() {},
        update(tabId, props, callback) {
          updateCalls.push({ tabId, props });
          callback({ id: tabId });
        }
      }
    }
  });

  await root.ExtensityBackground.focusOrCreateDashboardTab("dashboard.html#rules?draftId=x&host=h&pattern=*&suggestWww=1&source=add_active_site");

  assert.equal(createCalls, 0);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].tabId, 99);
  assert.equal(updateCalls[0].props.active, true);
  assert.ok(updateCalls[0].props.url.indexOf("#rules?") !== -1);
  assert.ok(updateCalls[0].props.url.indexOf("?_r=") !== -1, "url must contain cache-bust param to force full reload");
});

test("focusOrCreateDashboardTab creates a new tab when none exists", async () => {
  let createCalls = [];
  const root = loadBackground({
    chromeOverrides: {
      runtime: {
        getManifest() { return { version: "2.0.0" }; },
        getURL(p) { return "chrome-extension://test-id/" + p; },
        id: "test-id",
        lastError: null,
        onInstalled: { addListener() {} },
        onMessage: { addListener() {} },
        onStartup: { addListener() {} }
      },
      tabs: {
        create(props, callback) {
          createCalls.push(props);
          callback({ id: 7 });
        },
        get() {},
        onActivated: { addListener() {} },
        onRemoved: { addListener() {} },
        onUpdated: { addListener() {} },
        query(queryInfo, callback) {
          callback([]);
        },
        remove() {},
        sendMessage() {},
        update() {}
      }
    }
  });

  await root.ExtensityBackground.focusOrCreateDashboardTab("dashboard.html");

  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].active, true);
  assert.ok(createCalls[0].url.indexOf("dashboard.html") !== -1);
});
