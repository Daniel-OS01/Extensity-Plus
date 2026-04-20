const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadBrowserScript } = require("./helpers/load-browser-script");

const repoRoot = path.resolve(__dirname, "..");
const storageStub = {
  clone(value) {
    return JSON.parse(JSON.stringify(value));
  },
  makeId(prefix) {
    return `${prefix}-id`;
  },
  normalizeProfileMap(profileMap) {
    const source = profileMap || {};
    return Object.keys(source).reduce((result, key) => {
      result[key] = Array.from(new Set(source[key] || []));
      return result;
    }, {});
  },
  uniqueArray(items) {
    return Array.from(new Set(items || []));
  }
};

function loadModule(relativePath, extraGlobals = {}) {
  return loadBrowserScript(path.join(repoRoot, relativePath), {
    self: {
      ExtensityStorage: storageStub,
      ...extraGlobals
    }
  });
}

function createChromeBackgroundStub(overrides = {}) {
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
    notifications: {
      clear() {},
      create() {}
    },
    runtime: {
      getManifest() {
        return { version: "2.0.0" };
      },
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
    permissions: {
      contains(descriptor, callback) { callback(true); },
      request(descriptor, callback) { callback(false); }
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

function loadBackgroundModule(extraSelf = {}, overrides = {}) {
  const storageOverrides = extraSelf.ExtensityStorage || {};
  const selfOverrides = {
    ...extraSelf
  };
  delete selfOverrides.ExtensityStorage;

  return loadBrowserScript(path.join(repoRoot, "js/background.js"), {
    chrome: createChromeBackgroundStub(overrides.chrome),
    fetch: overrides.fetch || (async function() {
      throw new Error("Unexpected fetch in unit test.");
    }),
    importScripts() {},
    self: {
      ExtensityDriveSync: {},
      ExtensityHistory: {},
      ExtensityImportExport: {},
      ExtensityMigrations: {
        migrateLegacyLocalStorage: async function() {
          return false;
        },
        migratePopupListStyle: async function() {
          return false;
        },
        migrateTo2_0_0: async function() {
          return false;
        }
      },
      ExtensityReminders: {},
      ExtensityStorage: {
        clone(value) {
          return JSON.parse(JSON.stringify(value));
        },
        uniqueArray(items) {
          return Array.from(new Set(items || []));
        },
        ...storageOverrides
      },
      ExtensityUrlRules: {},
      ...selfOverrides
    }
  });
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

test("isObject identifies objects and rejects other types", () => {
  const root = loadModule("js/storage.js");
  const isObject = root.ExtensityStorage.isObject;

  assert.equal(isObject({}), true);
  assert.equal(isObject({ a: 1 }), true);
  assert.equal(isObject(Object.create(null)), true);
  assert.equal(isObject(new Object()), true);

  assert.equal(isObject(null), false);
  assert.equal(isObject(undefined), false);
  assert.equal(isObject([]), false);
  assert.equal(isObject([1, 2, 3]), false);
  assert.equal(isObject(""), false);
  assert.equal(isObject("string"), false);
  assert.equal(isObject(0), false);
  assert.equal(isObject(1), false);
  assert.equal(isObject(true), false);
  assert.equal(isObject(false), false);
  assert.equal(isObject(function() {}), false);
  assert.equal(isObject(() => {}), false);
  assert.equal(isObject(new Date()), false);
  assert.equal(isObject(/regex/), false);
});

test("storage sync defaults expose popup and profile display settings", () => {
  const root = loadModule("js/storage.js");
  const defaults = root.ExtensityStorage.getSyncDefaults();
  const localDefaults = root.ExtensityStorage.getLocalDefaults();

  assert.equal(defaults.itemPaddingXPx, 0);
  assert.equal(defaults.itemNameGapPx, 0);
  assert.equal(defaults.dynamicSizing, false);
  assert.equal(defaults.popupListStyle, "table");
  assert.equal(defaults.popupProfilePillShowIcons, false);
  assert.equal(defaults.popupProfilePillSingleWordChars, 4);
  assert.equal(defaults.popupProfilePillTextMode, "icons_only");
  assert.equal(defaults.popupHeaderIconSize, "compact");
  assert.equal(defaults.popupMainPaddingPx, 0);
  assert.equal(defaults.popupScrollbarMode, "invisible");
  assert.equal(defaults.profileDisplay, "landscape");
  assert.equal(defaults.profileLayoutDirection, "ltr");
  assert.equal(defaults.profileNameDirection, "ltr");
  assert.equal(defaults.popupProfileBadgeTextMode, "compact");
  assert.equal(defaults.popupProfileBadgeSingleWordChars, 4);
  assert.equal(defaults.popupTableActionPanelPosition, "below_name");
  assert.equal(defaults.showPopupVersionChips, false);
  assert.equal(defaults.sortMode, "recent");
  assert.equal(defaults.showProfilesExtensionMetadata, true);
  assert.deepEqual(normalize(localDefaults.webStoreMetadata), {});
});

test("normalizeProfileMap always includes reserved Base", () => {
  const root = loadModule("js/storage.js");

  assert.deepEqual(normalize(root.ExtensityStorage.normalizeProfileMap({
    Work: ["ext-1"]
  })), {
    __always_on: [],
    __base: [],
    __favorites: [],
    Work: ["ext-1"]
  });
});


test("ensureSyncDefaults backfills missing profile direction keys", async () => {
  const syncState = {};
  const root = loadBrowserScript(path.join(repoRoot, "js/storage.js"), {
    chrome: {
      runtime: { lastError: null },
      storage: {
        sync: {
          get(keys, callback) {
            const payload = {};
            (Array.isArray(keys) ? keys : Object.keys(keys)).forEach((key) => {
              if (Object.prototype.hasOwnProperty.call(syncState, key)) {
                payload[key] = syncState[key];
              }
            });
            callback(payload);
          },
          set(values, callback) {
            Object.assign(syncState, values);
            callback();
          }
        }
      }
    },
    self: {}
  });

  await root.ExtensityStorage.ensureSyncDefaults();

  assert.deepEqual(normalize(syncState), {
    profileLayoutDirection: "ltr",
    profileNameDirection: "ltr"
  });
});

test("ensureSyncDefaults preserves existing profile direction values", async () => {
  const syncState = {
    profileLayoutDirection: "ltr",
    profileNameDirection: "rtl"
  };
  const root = loadBrowserScript(path.join(repoRoot, "js/storage.js"), {
    chrome: {
      runtime: { lastError: null },
      storage: {
        sync: {
          get(keys, callback) {
            const payload = {};
            (Array.isArray(keys) ? keys : Object.keys(keys)).forEach((key) => {
              if (Object.prototype.hasOwnProperty.call(syncState, key)) {
                payload[key] = syncState[key];
              }
            });
            callback(payload);
          },
          set(values, callback) {
            Object.assign(syncState, values);
            callback();
          }
        }
      }
    },
    self: {}
  });

  await root.ExtensityStorage.ensureSyncDefaults();

  assert.deepEqual(normalize(syncState), {
    profileLayoutDirection: "ltr",
    profileNameDirection: "rtl"
  });
});

test("popup profile badge labels support full and compact formatting", () => {
  const root = {};
  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    ko: { extenders: {} },
    window: root
  });

  assert.equal(root.ExtensityPopupLabels.formatProfileBadgeLabel("__always_on", "compact", 4), "AO");
  assert.equal(root.ExtensityPopupLabels.formatProfileBadgeLabel("__base", "compact", 4), "Base");
  assert.equal(root.ExtensityPopupLabels.formatProfileBadgeLabel("Bookmark Organization", "compact", 4), "BO");
  assert.equal(root.ExtensityPopupLabels.formatProfileBadgeLabel("Testing", "compact", 4), "Test");
  assert.equal(root.ExtensityPopupLabels.formatProfileBadgeLabel("Bookmark Organization", "full", 4), "Bookmark Organization");
  assert.equal(root.ExtensityPopupLabels.formatProfileBadgeLabel("Bookmark Organization", "icons_only", 4), "");
});

test("clampInteger enforces boundaries through utility function", () => {
  const root = {};
  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    ko: { extenders: {} },
    window: root
  });

  const clampInteger = root.ExtensityUtils.clampInteger;

  assert.equal(clampInteger("5", 10, 1, 100), 5);
  assert.equal(clampInteger(5, 10, 1, 100), 5);
  assert.equal(clampInteger(-5, 10, 1, 100), 1);
  assert.equal(clampInteger(105, 10, 1, 100), 100);
  assert.equal(clampInteger("abc", 10, 1, 100), 10);
  assert.equal(clampInteger(NaN, 10, 1, 100), 10);
  assert.equal(clampInteger("4.9", 10, 1, 100), 4);
});

test("extension toggle icon reflects the current enabled state", () => {
  function observable(initial) {
    let value = initial;
    const fn = function(next) {
      if (arguments.length) {
        value = next;
      }
      return value;
    };
    return fn;
  }

  function observableArray(initial) {
    const fn = observable(initial || []);
    fn.push = function(item) {
      const next = fn().slice();
      next.push(item);
      fn(next);
    };
    fn.indexOf = function(item) {
      return fn().indexOf(item);
    };
    fn.extend = function() {
      return fn;
    };
    return fn;
  }

  const ko = {
    extenders: {},
    observable,
    observableArray,
    computed(evaluator) {
      const fn = function() {
        return evaluator();
      };
      fn.extend = function() {
        return fn;
      };
      return fn;
    },
    pureComputed(evaluator) {
      const fn = function() {
        return evaluator();
      };
      fn.extend = function() {
        return fn;
      };
      return fn;
    }
  };
  const root = { ExtensityStorage: storageStub };
  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    ko,
    window: root
  });

  const enabledExtension = new root.ExtensionModel({ enabled: true, id: "ext-1", name: "Enabled" });
  const disabledExtension = new root.ExtensionModel({ enabled: false, id: "ext-2", name: "Disabled" });

  assert.equal(enabledExtension.toggleIconClass(), "fa-toggle-on");
  assert.equal(disabledExtension.toggleIconClass(), "fa-toggle-off");
});

test("ExtensityApi profile assignment methods emit expected chrome messages", async () => {
  const sentMessages = [];
  const windowRoot = {};

  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          sentMessages.push(normalize(message));
          callback({ ok: true, payload: { acknowledged: true } });
        }
      }
    },
    ko: { extenders: {} },
    window: windowRoot
  });

  assert.equal(typeof windowRoot.ExtensityApi.assignExtensionProfile, "function");
  assert.equal(typeof windowRoot.ExtensityApi.pinExtensionToToolbar, "function");
  assert.equal(typeof windowRoot.ExtensityApi.updateExtensionProfileMembership, "function");
  assert.equal(typeof windowRoot.ExtensityApi.testUrlRules, "function");

  await windowRoot.ExtensityApi.assignExtensionProfile("ext-123", "Work");
  await windowRoot.ExtensityApi.assignExtensionProfile("ext-456", null);
  await windowRoot.ExtensityApi.pinExtensionToToolbar("ext-321");
  await windowRoot.ExtensityApi.updateExtensionProfileMembership("ext-789", "Focus", true);
  await windowRoot.ExtensityApi.updateExtensionProfileMembership("ext-789", "Focus", false);
  await windowRoot.ExtensityApi.testUrlRules("https://github.com/openai");

  assert.deepEqual(sentMessages, [
    {
      extensionId: "ext-123",
      profileName: "Work",
      type: "ASSIGN_EXTENSION_PROFILE"
    },
    {
      extensionId: "ext-456",
      profileName: null,
      type: "ASSIGN_EXTENSION_PROFILE"
    },
    {
      extensionId: "ext-321",
      type: "PIN_EXTENSION_TO_TOOLBAR"
    },
    {
      extensionId: "ext-789",
      profileName: "Focus",
      shouldInclude: true,
      type: "UPDATE_EXTENSION_PROFILE_MEMBERSHIP"
    },
    {
      extensionId: "ext-789",
      profileName: "Focus",
      shouldInclude: false,
      type: "UPDATE_EXTENSION_PROFILE_MEMBERSHIP"
    },
    {
      type: "TEST_URL_RULES",
      url: "https://github.com/openai"
    }
  ]);
});

test("extension profile summary uses em dash separator and omits empty values", () => {
  function observable(initial) {
    let value = initial;
    const fn = function(next) {
      if (arguments.length) {
        value = next;
      }
      return value;
    };
    return fn;
  }

  function observableArray(initial) {
    const fn = observable(initial || []);
    fn.push = function(item) {
      const next = fn().slice();
      next.push(item);
      fn(next);
    };
    fn.indexOf = function(item) {
      return fn().indexOf(item);
    };
    fn.extend = function() {
      return fn;
    };
    return fn;
  }

  const ko = {
    extenders: {},
    observable,
    observableArray,
    computed(evaluator) {
      const fn = function() {
        return evaluator();
      };
      fn.extend = function() {
        return fn;
      };
      return fn;
    },
    pureComputed(evaluator) {
      const fn = function() {
        return evaluator();
      };
      fn.extend = function() {
        return fn;
      };
      return fn;
    }
  };

  const windowRoot = {
    ExtensityStorage: storageStub
  };

  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    ko,
    window: windowRoot
  });

  const withBoth = new windowRoot.ExtensionModel({
    category: "Accessibility",
    descriptionLine: "Dark mode for every website."
  });
  const onlyCategory = new windowRoot.ExtensionModel({
    category: "Productivity",
    descriptionLine: ""
  });
  const onlyDescription = new windowRoot.ExtensionModel({
    descriptionLine: "Single line description"
  });
  onlyDescription.category("");

  assert.equal(withBoth.profileSummary(), "Dark mode for every website. — Accessibility");
  assert.equal(onlyCategory.profileSummary(), "Productivity");
  assert.equal(onlyDescription.profileSummary(), "Single line description");
});

test("default category only returns Developer for development installs", () => {
  const windowRoot = {
    ExtensityStorage: storageStub
  };
  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    ko: { extenders: {} },
    window: windowRoot
  });
  const backgroundRoot = loadBackgroundModule();

  assert.equal(windowRoot.ExtensityExtensionMetadata.defaultCategoryForInstallType("development"), "Developer");
  assert.equal(windowRoot.ExtensityExtensionMetadata.defaultCategoryForInstallType("normal"), "");
  assert.equal(backgroundRoot.ExtensityBackground.defaultCategoryForInstallType("development"), "Developer");
  assert.equal(backgroundRoot.ExtensityBackground.defaultCategoryForInstallType("normal"), "");
});

test("extension model keeps empty category for normal installs", () => {
  function observable(initial) {
    let value = initial;
    const fn = function(next) {
      if (arguments.length) {
        value = next;
      }
      return value;
    };
    return fn;
  }

  function observableArray(initial) {
    const fn = observable(initial || []);
    fn.push = function(item) {
      const next = fn().slice();
      next.push(item);
      fn(next);
    };
    fn.indexOf = function(item) {
      return fn().indexOf(item);
    };
    fn.extend = function() {
      return fn;
    };
    return fn;
  }

  const ko = {
    extenders: {},
    observable,
    observableArray,
    computed(evaluator) {
      const fn = function() {
        return evaluator();
      };
      fn.extend = function() {
        return fn;
      };
      return fn;
    },
    pureComputed(evaluator) {
      const fn = function() {
        return evaluator();
      };
      fn.extend = function() {
        return fn;
      };
      return fn;
    }
  };

  const windowRoot = {
    ExtensityStorage: storageStub
  };

  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    ko,
    window: windowRoot
  });

  const normal = new windowRoot.ExtensionModel({
    installType: "normal"
  });
  const development = new windowRoot.ExtensionModel({
    installType: "development"
  });

  assert.equal(normal.category(), "");
  assert.equal(normal.profileSummary(), "");
  assert.equal(development.category(), "Developer");
});

test("popup list style migration maps legacy flatPopupList to popupListStyle", async () => {
  let removed = null;
  let savedPatch = null;

  const root = loadBrowserScript(path.join(repoRoot, "js/migration.js"), {
    self: {
      ExtensityStorage: {
        ensureSyncDefaults: async function() {},
        getArea: async function() {
          return {
            flatPopupList: true,
            migration_popupListStyle: null,
            popupListStyle: "card"
          };
        },
        removeArea: async function(area, keys) {
          removed = { area: area, keys: keys };
        },
        saveSyncOptions: async function(values) {
          savedPatch = values;
        }
      }
    }
  });

  const changed = await root.ExtensityMigrations.migratePopupListStyle();

  assert.equal(changed, true);
  assert.deepEqual(normalize(savedPatch), {
    migration_popupListStyle: "2.1.0",
    popupListStyle: "flat"
  });
  assert.deepEqual(normalize(removed), {
    area: "sync",
    keys: ["flatPopupList"]
  });
});

test("background parser extracts Web Store description, category, and canonical url", () => {
  const fixture = fs.readFileSync(path.join(repoRoot, "tests", "fixtures", "chrome-web-store-dark-reader.html"), "utf8");
  const root = loadBackgroundModule();
  const parsed = root.ExtensityBackground.parseChromeWebStoreHtml(
    fixture,
    "https://chromewebstore.google.com/detail/extension/eimadpbcbfnmbkopoojfekhnkhdbieeh"
  );

  assert.equal(parsed.descriptionLine, "Dark mode for every website. Take care of your eyes, use dark theme for night and daily browsing.");
  assert.equal(parsed.category, "Accessibility");
  assert.equal(parsed.storeUrl, "https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh");
});

test("background parser can extract category without users text near category links", () => {
  const root = loadBackgroundModule();
  const parsed = root.ExtensityBackground.parseChromeWebStoreHtml(
    [
      '<link rel="canonical" href="https://chromewebstore.google.com/detail/example/abcdefghijklmnop" />',
      '<meta name="description" content="Example extension description." />',
      '<a href="./category/extensions">Extension</a>',
      '<a href="./category/extensions/productivity">Productivity</a>'
    ].join("\n"),
    "https://chromewebstore.google.com/detail/extension/abcdefghijklmnop"
  );

  assert.equal(parsed.descriptionLine, "Example extension description.");
  assert.equal(parsed.category, "Productivity");
});

test("background parser extracts category from structured markers without relying on users text", () => {
  const fixture = fs.readFileSync(path.join(repoRoot, "tests", "fixtures", "chrome-web-store-localized-no-users.html"), "utf8");
  const root = loadBackgroundModule();
  const parsed = root.ExtensityBackground.parseChromeWebStoreHtml(
    fixture,
    "https://chromewebstore.google.com/detail/extension/abcdefghijklmnopabcdefghijklmnop"
  );

  assert.equal(parsed.descriptionLine, "Stay focused and organize your tab workflow.");
  assert.equal(parsed.category, "Productivity");
  assert.equal(parsed.storeUrl, "https://chromewebstore.google.com/detail/focus-keeper/abcdefghijklmnopabcdefghijklmnop");
});

test("background metadata uses fresh cache category without throwing", async () => {
  let savedPatch = null;
  const root = loadBackgroundModule({
    ExtensityStorage: {
      loadLocalState: async function() {
        return {
          webStoreMetadata: {
            "ext-fresh": {
              category: "Productivity",
              descriptionLine: "Cached description.",
              fetchedAt: Date.now(),
              source: "store",
              storeUrl: "https://chromewebstore.google.com/detail/extension/ext-fresh"
            }
          }
        };
      },
      saveLocalState: async function(patch) {
        savedPatch = patch;
      }
    }
  }, {
    chrome: {
      management: {
        getAll(callback) {
          callback([{
            description: "Item description",
            homepageUrl: "",
            id: "ext-fresh",
            installType: "normal",
            mayDisable: true,
            type: "extension"
          }]);
        }
      }
    }
  });

  const metadata = await root.ExtensityBackground.loadExtensionMetadata(["ext-fresh"]);

  assert.equal(metadata["ext-fresh"].category, "Productivity");
  assert.equal(savedPatch, null);
});

test("background metadata allows blank fetched category to clear cached placeholder", async () => {
  let savedPatch = null;
  const root = loadBackgroundModule({
    ExtensityStorage: {
      loadLocalState: async function() {
        return {
          webStoreMetadata: {
            "ext-clear": {
              category: "Uncategorized",
              descriptionLine: "Old value",
              fetchedAt: Date.now() - (10 * 24 * 60 * 60 * 1000),
              source: "store",
              storeUrl: "https://chromewebstore.google.com/detail/extension/ext-clear"
            }
          }
        };
      },
      saveLocalState: async function(patch) {
        savedPatch = patch;
      }
    }
  }, {
    chrome: {
      management: {
        getAll(callback) {
          callback([{
            description: "Fresh description",
            homepageUrl: "",
            id: "ext-clear",
            installType: "normal",
            mayDisable: true,
            type: "extension"
          }]);
        }
      }
    },
    fetch: async function() {
      return {
        ok: true,
        text: async function() {
          return [
            '<link rel="canonical" href="https://chromewebstore.google.com/detail/blank-category/ext-clear" />',
            '<meta name="description" content="Fresh description from store." />'
          ].join("\n");
        }
      };
    }
  });

  const metadata = await root.ExtensityBackground.loadExtensionMetadata(["ext-clear"], { forceRefresh: true });

  assert.equal(metadata["ext-clear"].category, "");
  assert.equal(savedPatch.webStoreMetadata["ext-clear"].category, "");
});

test("background metadata falls back to blank category for non-development extension without metadata", async () => {
  const root = loadBackgroundModule({
    ExtensityStorage: {
      loadLocalState: async function() {
        return {
          webStoreMetadata: {}
        };
      },
      saveLocalState: async function() {}
    }
  }, {
    chrome: {
      management: {
        getAll(callback) {
          callback([{
            description: "Missing metadata description",
            homepageUrl: "",
            id: "ext-missing",
            installType: "normal",
            mayDisable: true,
            type: "extension"
          }]);
        }
      }
    },
    fetch: async function() {
      return { ok: false, status: 404 };
    }
  });

  const metadata = await root.ExtensityBackground.loadExtensionMetadata(["ext-missing"], { forceRefresh: true });

  assert.equal(metadata["ext-missing"].category, "");
  assert.equal(metadata["ext-missing"].source, "fallback");
});


test("background normalization merges cached web store metadata into extension snapshots", () => {
  const now = 1700000000000;
  const dateNow = Date.now;
  Date.now = () => now;

  try {
    const root = loadBackgroundModule();
    const normalized = root.ExtensityBackground.normalizeExtensions([
      {
        description: "Line one\nLine two",
        enabled: true,
        homepageUrl: "https://chrome.google.com/webstore/detail/example/ext-cached",
        icons: [{ size: 16, url: "cached-icon.png" }],
        id: "ext-cached",
        installType: "normal",
        mayDisable: true,
        name: "Cached Extension",
        optionsUrl: "",
        type: "extension",
        version: "1.0.0"
      },
      {
        description: "Developer local build\nExtra details",
        enabled: false,
        homepageUrl: "",
        icons: [{ size: 16, url: "dev-icon.png" }],
        id: "ext-dev",
        installType: "development",
        mayDisable: true,
        name: "Dev Extension",
        optionsUrl: "",
        type: "extension",
        version: "0.1.0"
      }
    ], {
      localState: {
        aliases: {},
        groups: {},
        recentlyUsed: [],
        usageCounters: {},
        webStoreMetadata: {
          "ext-cached": {
            category: "  &quot;Accessibility&quot;  ",
            descriptionLine: "Cached summary line",
            fetchedAt: 1660000000000,
            source: "store",
            storeUrl: "https://chrome.google.com/webstore/detail/cached-extension/ext-cached"
          }
        }
      },
      profiles: {
        map: {
          __always_on: [],
          __favorites: []
        }
      }
    });

    assert.equal(normalized[0].id, "ext-cached");
    assert.equal(normalized[0].descriptionLine, "Cached summary line");
    assert.equal(normalized[0].category, '"Accessibility"');
    assert.equal(normalized[0].storeUrl, "https://chromewebstore.google.com/detail/cached-extension/ext-cached");
    assert.equal(normalized[0].metadataFetchedAt, 1660000000000);
    assert.equal(normalized[0].metadataSource, "store");

    assert.equal(normalized[1].id, "ext-dev");
    assert.equal(normalized[1].descriptionLine, "Developer local build");
    assert.equal(normalized[1].category, "Developer");
    assert.equal(normalized[1].storeUrl, "");
    assert.equal(normalized[1].metadataFetchedAt, now);
    assert.equal(normalized[1].metadataSource, "fallback");
  } finally {
    Date.now = dateNow;
  }
});

test("background normalization keeps managed extension version", () => {
  const root = loadBackgroundModule();
  const normalized = root.ExtensityBackground.normalizeExtensions([
    {
      description: "Sample description",
      enabled: true,
      homepageUrl: "",
      icons: [{ size: 16, url: "icon.png" }],
      id: "ext-1",
      installType: "normal",
      mayDisable: true,
      name: "Example Extension",
      optionsUrl: "",
      type: "extension",
      version: "4.9.121"
    }
  ], {
    localState: {
      aliases: {},
      groups: {},
      recentlyUsed: [],
      usageCounters: {}
    },
    profiles: {
      map: {
        __always_on: [],
        __favorites: []
      }
    }
  });

  assert.equal(normalized[0].version, "4.9.121");
});

test("ExtensityApi has no duplicate method keys", () => {
  const windowRoot = {};
  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          callback({ ok: true, payload: {} });
        }
      }
    },
    ko: { extenders: {} },
    window: windowRoot
  });

  const api = windowRoot.ExtensityApi;
  assert.equal(typeof api.assignExtensionProfile, "function");
  assert.equal(typeof api.pinExtensionToToolbar, "function");
  assert.equal(typeof api.updateExtensionProfileMembership, "function");

  // Verify updateExtensionProfileMembership casts shouldInclude to boolean.
  const sent = [];
  const windowRoot2 = {};
  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          sent.push(message);
          callback({ ok: true, payload: {} });
        }
      }
    },
    ko: { extenders: {} },
    window: windowRoot2
  });
  windowRoot2.ExtensityApi.updateExtensionProfileMembership("ext-1", "Work", 1);
  assert.strictEqual(sent[0].shouldInclude, true);
  windowRoot2.ExtensityApi.updateExtensionProfileMembership("ext-1", "Work", 0);
  assert.strictEqual(sent[1].shouldInclude, false);
});

test("background normalization preserves blank cached category for dev extension", () => {
  const root = loadBackgroundModule();
  const normalized = root.ExtensityBackground.normalizeExtensions([
    {
      description: "Local dev build",
      enabled: true,
      homepageUrl: "",
      icons: [{ size: 16, url: "dev-icon.png" }],
      id: "ext-dev-blank",
      installType: "development",
      mayDisable: true,
      name: "Dev Extension",
      optionsUrl: "",
      type: "extension",
      version: "0.1.0"
    }
  ], {
    localState: {
      aliases: {},
      groups: {},
      recentlyUsed: [],
      usageCounters: {},
      webStoreMetadata: {
        "ext-dev-blank": {
          category: "",
          descriptionLine: "Fetched with no category",
          fetchedAt: Date.now(),
          source: "store",
          storeUrl: "https://chromewebstore.google.com/detail/dev/ext-dev-blank"
        }
      }
    },
    profiles: { map: { __always_on: [], __favorites: [] } }
  });

  // Blank cached category should not be overridden by the "Developer" fallback.
  assert.equal(normalized[0].category, "");
});

test("background metadata fresh-cache path preserves blank cached category", async () => {
  const root = loadBackgroundModule({
    ExtensityStorage: {
      loadLocalState: async function() {
        return {
          webStoreMetadata: {
            "ext-blank": {
              category: "",
              descriptionLine: "No category found",
              fetchedAt: Date.now(),
              source: "store",
              storeUrl: "https://chromewebstore.google.com/detail/ext/ext-blank"
            }
          }
        };
      },
      saveLocalState: async function() {}
    }
  }, {
    chrome: {
      management: {
        getAll(callback) {
          callback([{
            description: "Dev build",
            homepageUrl: "",
            id: "ext-blank",
            installType: "development",
            mayDisable: true,
            type: "extension"
          }]);
        }
      }
    }
  });

  const metadata = await root.ExtensityBackground.loadExtensionMetadata(["ext-blank"]);

  // Fresh cache has blank category — must not fall back to "Developer".
  assert.equal(metadata["ext-blank"].category, "");
});

test("import/export builds a versioned backup envelope", () => {
  const root = loadModule("js/import-export.js");
  const envelope = root.ExtensityImportExport.buildBackupEnvelope({
    extensions: [
      { enabled: true, id: "enabled-ext", isApp: false, mayDisable: true },
      { enabled: false, id: "disabled-ext", isApp: false, mayDisable: true },
      { enabled: true, id: "app-item", isApp: true, mayDisable: true },
      { enabled: true, id: "fixed-item", isApp: false, mayDisable: false }
    ],
    localState: {
      aliases: { "enabled-ext": "Alias" },
      eventHistory: [{ id: "history-1" }],
      groupOrder: ["group-1"],
      groups: { "group-1": { id: "group-1", name: "Core" } },
      reminderQueue: [{ extensionId: "enabled-ext" }],
      recentlyUsed: ["enabled-ext"],
      undoStack: [{ action: "toggle" }],
      urlRules: [{ id: "rule-1" }],
      usageCounters: { "enabled-ext": 3 }
    },
    options: {
      activeProfile: "Work",
      viewMode: "grid"
    },
    profiles: {
      map: {
        Work: ["enabled-ext"],
        __always_on: ["enabled-ext"]
      }
    }
  });

  assert.equal(envelope.version, "2.0.0");
  assert.equal(envelope.settings.viewMode, "grid");
  assert.deepEqual(normalize(envelope.localState.extensionStates), {
    "disabled-ext": false,
    "enabled-ext": true
  });
});

test("import/export validates backups and rejects unsupported versions", () => {
  const root = loadModule("js/import-export.js");

  assert.throws(() => {
    root.ExtensityImportExport.validateBackupEnvelope({
      version: "1.0.0"
    });
  }, /Unsupported backup version/);

  const valid = root.ExtensityImportExport.validateBackupEnvelope({
    version: "2.0.0",
    settings: { sortMode: "alpha" },
    profiles: { Work: ["a", "a"] },
    aliases: { a: "Alias" },
    localState: {
      extensionStates: { a: true }
    }
  });

  assert.deepEqual(normalize(valid.profiles), { Work: ["a"] });
  assert.deepEqual(normalize(valid.aliases), { a: "Alias" });
});

test("import/export builds CSV rows with escaped content", () => {
  const root = loadModule("js/import-export.js");
  const csv = root.ExtensityImportExport.buildExtensionsCsv([
    {
      alias: 'Alias "One"',
      enabled: true,
      groupIds: ["alpha", "beta"],
      id: "ext-1",
      lastUsed: 7,
      name: "Example",
      type: "extension",
      usageCount: 4
    }
  ]);

  assert.match(csv, /^id,name,alias,enabled,type,usageCount,lastUsed,groups/m);
  assert.match(csv, /"Alias ""One"""/);
  assert.match(csv, /"alpha\|beta"/);
});


test("import/export csvEscape handles edge cases", () => {
  const root = loadModule("js/import-export.js");
  const escape = root.ExtensityImportExport._csvEscape;

  assert.equal(escape(null), '""');
  assert.equal(escape(undefined), '""');
  assert.equal(escape("hello"), '"hello"');
  assert.equal(escape('hello "world"'), '"hello ""world"""');
  assert.equal(escape('""'), '""""""');
  assert.equal(escape(123), '"123"');
  assert.equal(escape(true), '"true"');
  assert.equal(escape(false), '"false"');
  assert.equal(escape(""), '""');
});

test("options none preset keeps font size and zeroes spacing options", async () => {
  function observable(initialValue) {
    let value = initialValue;
    const obs = function(nextValue) {
      if (arguments.length > 0) {
        value = nextValue;
        return obs;
      }
      return value;
    };
    return obs;
  }

  function OptionsCollection() {
    this.fontSizePx = observable(16);
    this.itemPaddingPx = observable(10);
    this.itemPaddingXPx = observable(12);
    this.itemNameGapPx = observable(10);
    this.itemSpacingPx = observable(8);
    this.popupListStyle = observable("card");
    this.lastDriveSync = observable(null);
    this.apply = function() {};
    this.toJS = function() {
      return {
        fontSizePx: this.fontSizePx(),
        itemPaddingPx: this.itemPaddingPx(),
        itemPaddingXPx: this.itemPaddingXPx(),
        itemNameGapPx: this.itemNameGapPx(),
        itemSpacingPx: this.itemSpacingPx(),
        popupListStyle: this.popupListStyle()
      };
    };
  }

  let domReady = null;
  let initDeferred = null;
  let capturedVm = null;
  let saveOptionsCalls = 0;

  loadBrowserScript(path.join(repoRoot, "js/options.js"), {
    OptionsCollection,
    ExtensityApi: {
      getState() {
        return Promise.resolve({
          state: {
            options: { colorScheme: "light" }
          }
        });
      },
      saveOptions() {
        saveOptionsCalls += 1;
        return Promise.resolve({});
      }
    },
    ExtensityIO: {},
    ExtensityUtils: {
      applyThemeClasses: function() {}
    },
    ExtensityImportExport: {},
    _: {
      defer(fn) {
        initDeferred = fn;
      }
    },
    ko: {
      observable,
      pureComputed(fn) {
        return fn;
      },
      secureBindingsProvider: function() {},
      bindingProvider: {},
      applyBindings(vm) {
        capturedVm = vm;
      }
    },
    chrome: {
      permissions: {
        contains(descriptor, callback) {
          callback(true);
        },
        request(descriptor, callback) {
          callback(false);
        }
      },
      tabs: {
        create() {}
      }
    },
    window: {
      close() {}
    },
    fadeOutMessage() {},
    document: {
      addEventListener(event, cb) {
        if (event === "DOMContentLoaded") {
          domReady = cb;
        }
      },
      body: {
        classList: {
          toggle() {}
        }
      },
      documentElement: {
        style: {
          setProperty() {}
        }
      },
      getElementById() {
        return {};
      }
    }
  });

  assert.ok(domReady);
  domReady();
  assert.ok(initDeferred);
  initDeferred();
  assert.ok(capturedVm);

  capturedVm.options.fontSizePx(17);
  capturedVm.options.itemPaddingPx(9);
  capturedVm.options.itemPaddingXPx(11);
  capturedVm.options.itemNameGapPx(7);
  capturedVm.options.itemSpacingPx(6);
  capturedVm.options.popupListStyle("compact");

  capturedVm.applyPresetNone();
  await Promise.resolve();

  assert.equal(capturedVm.options.fontSizePx(), 17);
  assert.equal(capturedVm.options.itemPaddingPx(), 0);
  assert.equal(capturedVm.options.itemPaddingXPx(), 0);
  assert.equal(capturedVm.options.itemNameGapPx(), 0);
  assert.equal(capturedVm.options.itemSpacingPx(), 0);
  assert.equal(capturedVm.options.popupListStyle(), "table");
  assert.equal(saveOptionsCalls, 1);
});

test("profiles add decorates custom profiles without parent-context bindings", async () => {
  function observable(initialValue) {
    let value = initialValue;
    const subscribers = [];
    const obs = function(nextValue) {
      if (arguments.length > 0) {
        value = nextValue;
        subscribers.forEach((fn) => fn(value));
        return obs;
      }
      return value;
    };
    obs.subscribe = function(fn) {
      subscribers.push(fn);
    };
    return obs;
  }

  function observableArray(initialValue) {
    const obs = observable(initialValue || []);
    obs.push = function(item) {
      const nextValue = obs().slice();
      nextValue.push(item);
      obs(nextValue);
    };
    obs.remove = function(predicateOrItem) {
      const predicate = typeof predicateOrItem === "function"
        ? predicateOrItem
        : function(item) { return item === predicateOrItem; };
      obs(obs().filter((item) => !predicate(item)));
    };
    obs.indexOf = function(item) {
      return obs().indexOf(item);
    };
    obs.extend = function() {
      return obs;
    };
    return obs;
  }

  const ko = {
    extenders: {},
    observable,
    observableArray,
    computed(fn) {
      const obs = function() {
        return fn();
      };
      obs.extend = function() {
        return obs;
      };
      return obs;
    },
    pureComputed(fn) {
      const obs = function() {
        return fn();
      };
      obs.extend = function() {
        return obs;
      };
      return obs;
    },
    bindingProvider: {},
    secureBindingsProvider: function() {},
    applyBindings(vm) {
      capturedVm = vm;
    }
  };

  function OptionsCollection() {
    this.colorScheme = observable("auto");
    this.profileDisplay = observable("landscape");
    this.profileExtensionSide = observable("right");
    this.profileLayoutDirection = observable("ltr");
    this.profileNameDirection = observable("ltr");
    this.showProfilesExtensionMetadata = observable(true);
    this.apply = function(nextState) {
      const state = nextState || {};
      this.colorScheme(state.colorScheme || "auto");
      this.profileDisplay(state.profileDisplay || "landscape");
      this.profileExtensionSide(state.profileExtensionSide || "right");
      this.profileLayoutDirection(state.profileLayoutDirection || "ltr");
      this.profileNameDirection(state.profileNameDirection || "ltr");
      this.showProfilesExtensionMetadata(
        typeof state.showProfilesExtensionMetadata === "boolean" ? state.showProfilesExtensionMetadata : true
      );
    };
    this.toJS = function() {
      return {
        colorScheme: this.colorScheme(),
        profileDisplay: this.profileDisplay(),
        profileExtensionSide: this.profileExtensionSide(),
        profileLayoutDirection: this.profileLayoutDirection(),
        profileNameDirection: this.profileNameDirection(),
        showProfilesExtensionMetadata: this.showProfilesExtensionMetadata()
      };
    };
  }

  function ProfileCollectionModel(initialState) {
    this.items = observableArray([]);
    this.localProfiles = observable(false);
    this.applyState = function(state) {
      const payload = state || {};
      this.localProfiles(!!payload.localProfiles);
      this.items((payload.items || []).map((profile) => {
        return new windowRoot.ProfileModel(profile.name, profile.items, {
          color: profile.color,
          icon: profile.icon
        });
      }));
    };
    this.add = function(name, items) {
      const profile = new windowRoot.ProfileModel(name, items || []);
      this.items.push(profile);
      return profile;
    };
    this.find = function(name) {
      return this.items().find((profile) => profile.name() === name);
    };
    this.remove = function(profile) {
      this.items.remove(profile);
    };
    this.toMap = function() {
      return this.items().reduce((result, profile) => {
        result[profile.name()] = normalize(profile.items());
        return result;
      }, {});
    };
    this.toMeta = function() {
      return {};
    };
    this.applyState(initialState || { items: [], localProfiles: false });
  }

  let capturedVm = null;
  let domReady = null;
  const windowRoot = {
    ExtensityStorage: storageStub
  };

  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    ko,
    _: Object.assign(function(items) {
      return {
        find(predicate) {
          return (items || []).find(predicate);
        }
      };
    }, {
      delay(fn) {
        fn();
      }
    }),
    window: windowRoot
  });

  loadBrowserScript(path.join(repoRoot, "js/profiles.js"), {
    DismissalsCollection: function() {
      this.dismiss = function() {};
    },
    ExtensionCollectionModel: windowRoot.ExtensionCollectionModel,
    ExtensityApi: {
      getExtensionMetadata() {
        return Promise.resolve({ metadata: {} });
      },
      getState() {
        return Promise.resolve({
          state: {
            metadata: { version: "2.0.2" },
            options: {
              colorScheme: "auto",
              profileDisplay: "landscape",
              profileExtensionSide: "right",
              profileLayoutDirection: "ltr",
              profileNameDirection: "ltr",
              showProfilesExtensionMetadata: true
            },
            extensions: [
              {
                enabled: true,
                id: "ext-1",
                isApp: false,
                mayDisable: true,
                name: "Example Extension"
              }
            ],
            profiles: {
              items: [
                { items: [], name: "__always_on" },
                { items: [], name: "__favorites" }
              ],
              localProfiles: false
            }
          }
        });
      }
    },
    OptionsCollection,
    ProfileCollectionModel,
    _: Object.assign(function(items) {
      return {
        find(predicate) {
          return (items || []).find(predicate);
        }
      };
    }, {
      defer(fn) {
        fn();
      }
    }),
    chrome: {
      permissions: {
        contains(descriptor, callback) {
          callback(true);
        },
        request(descriptor, callback) {
          callback(false);
        }
      },
      tabs: {
        create() {}
      }
    },
    document: {
      addEventListener(event, callback) {
        if (event === "DOMContentLoaded") {
          domReady = callback;
        }
      },
      body: {
        className: "",
        setAttribute() {}
      },
      getElementById() {
        return {};
      }
    },
    fadeOutMessage() {},
    ko,
    window: {
      ExtensityEngine: windowRoot.ExtensityEngine,
      ExtensityTooltips: {
        applyAutoTooltips() {}
      },
      close() {},
      confirm() {
        return true;
      }
    }
  });

  assert.ok(domReady);
  domReady();
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(capturedVm);
  capturedVm.add_name("Work");
  capturedVm.add();

  const workProfile = capturedVm.profiles.find("Work");
  assert.ok(workProfile);
  assert.equal(workProfile.listVisible(), true);
  assert.equal(typeof workProfile.activate, "function");
  assert.equal(typeof workProfile.requestRemove, "function");
  assert.equal(workProfile.isActive(), true);
  assert.deepEqual(normalize(workProfile.items()), ["ext-1"]);

  capturedVm.selectByName("__favorites");
  assert.equal(workProfile.isActive(), false);

  workProfile.activate();
  assert.equal(capturedVm.current_name(), "Work");
  assert.equal(workProfile.isActive(), true);
});

test("profiles recent sort keeps enabled extensions above disabled ones and uses stable tie-breakers", async () => {
  function observable(initialValue) {
    let value = initialValue;
    const subscribers = [];
    const obs = function(nextValue) {
      if (arguments.length > 0) {
        value = nextValue;
        subscribers.forEach((fn) => fn(value));
        return obs;
      }
      return value;
    };
    obs.subscribe = function(fn) {
      subscribers.push(fn);
    };
    return obs;
  }

  function observableArray(initialValue) {
    const obs = observable(initialValue || []);
    obs.push = function(item) {
      const nextValue = obs().slice();
      nextValue.push(item);
      obs(nextValue);
    };
    obs.remove = function(predicateOrItem) {
      const predicate = typeof predicateOrItem === "function"
        ? predicateOrItem
        : function(item) { return item === predicateOrItem; };
      obs(obs().filter((item) => !predicate(item)));
    };
    obs.indexOf = function(item) {
      return obs().indexOf(item);
    };
    obs.extend = function() {
      return obs;
    };
    return obs;
  }

  let capturedVm = null;
  let domReady = null;
  const ko = {
    extenders: {},
    observable,
    observableArray,
    computed(fn) {
      const obs = function() {
        return fn();
      };
      obs.extend = function() {
        return obs;
      };
      return obs;
    },
    pureComputed(fn) {
      const obs = function() {
        return fn();
      };
      obs.extend = function() {
        return obs;
      };
      return obs;
    },
    bindingProvider: {},
    secureBindingsProvider: function() {},
    applyBindings(vm) {
      capturedVm = vm;
    }
  };

  function OptionsCollection() {
    this.colorScheme = observable("auto");
    this.profileDisplay = observable("landscape");
    this.profileExtensionSide = observable("right");
    this.profileLayoutDirection = observable("ltr");
    this.profileNameDirection = observable("ltr");
    this.showProfilesExtensionMetadata = observable(true);
    this.apply = function(nextState) {
      const state = nextState || {};
      this.colorScheme(state.colorScheme || "auto");
      this.profileDisplay(state.profileDisplay || "landscape");
      this.profileExtensionSide(state.profileExtensionSide || "right");
      this.profileLayoutDirection(state.profileLayoutDirection || "ltr");
      this.profileNameDirection(state.profileNameDirection || "ltr");
      this.showProfilesExtensionMetadata(
        typeof state.showProfilesExtensionMetadata === "boolean" ? state.showProfilesExtensionMetadata : true
      );
    };
  }

  function ProfileCollectionModel(initialState) {
    this.items = observableArray([]);
    this.localProfiles = observable(false);
    this.applyState = function(state) {
      const payload = state || {};
      this.localProfiles(!!payload.localProfiles);
      this.items((payload.items || []).map((profile) => new windowRoot.ProfileModel(profile.name, profile.items, {
        color: profile.color,
        icon: profile.icon
      })));
    };
    this.find = function(name) {
      return this.items().find((profile) => profile.name() === name);
    };
    this.applyState(initialState || { items: [], localProfiles: false });
  }

  const windowRoot = {
    ExtensityStorage: storageStub
  };

  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    ko,
    _: Object.assign(function(items) {
      return {
        find(predicate) {
          return (items || []).find(predicate);
        }
      };
    }, {
      delay(fn) {
        fn();
      }
    }),
    window: windowRoot
  });

  loadBrowserScript(path.join(repoRoot, "js/profiles.js"), {
    DismissalsCollection: function() {
      this.dismiss = function() {};
    },
    ExtensionCollectionModel: windowRoot.ExtensionCollectionModel,
    ExtensityApi: {
      getExtensionMetadata() {
        return Promise.resolve({ metadata: {} });
      },
      getState() {
        return Promise.resolve({
          state: {
            metadata: { version: "2.0.3" },
            options: {
              colorScheme: "auto",
              profileDisplay: "landscape",
              profileExtensionSide: "right",
              profileLayoutDirection: "ltr",
              profileNameDirection: "ltr",
              showProfilesExtensionMetadata: true
            },
            extensions: [
              { enabled: true, id: "ext-enabled-new", installedAt: 800, isApp: false, lastUsed: 1, mayDisable: true, name: "Enabled New" },
              { enabled: true, id: "ext-alpha-enabled", installedAt: 500, isApp: false, lastUsed: 30, mayDisable: true, name: "Alpha Enabled" },
              { enabled: true, id: "ext-zeta-enabled", installedAt: 500, isApp: false, lastUsed: 30, mayDisable: true, name: "Zeta Enabled" },
              { enabled: true, id: "ext-enabled-old", installedAt: 100, isApp: false, lastUsed: 999, mayDisable: true, name: "Enabled Old" },
              { enabled: false, id: "ext-disabled-new", installedAt: 900, isApp: false, lastUsed: 100, mayDisable: true, name: "Disabled New" },
              { enabled: false, id: "ext-disabled-old", installedAt: 50, isApp: false, lastUsed: 800, mayDisable: true, name: "Disabled Old" }
            ],
            profiles: {
              items: [
                { items: [], name: "__always_on" },
                { items: [], name: "__base" },
                { items: [], name: "__favorites" }
              ],
              localProfiles: false
            }
          }
        });
      }
    },
    OptionsCollection,
    ProfileCollectionModel,
    _: Object.assign(function(items) {
      return {
        find(predicate) {
          return (items || []).find(predicate);
        }
      };
    }, {
      defer(fn) {
        fn();
      }
    }),
    chrome: {
      permissions: {
        contains(descriptor, callback) {
          callback(true);
        },
        request(descriptor, callback) {
          callback(false);
        }
      }
    },
    document: {
      addEventListener(event, callback) {
        if (event === "DOMContentLoaded") {
          domReady = callback;
        }
      },
      body: {
        className: "",
        setAttribute() {}
      },
      getElementById() {
        return {};
      }
    },
    fadeOutMessage() {},
    ko,
    window: {
      ExtensityEngine: windowRoot.ExtensityEngine,
      ExtensityTooltips: {
        applyAutoTooltips() {}
      },
      close() {},
      confirm() {
        return true;
      }
    }
  });

  assert.ok(domReady);
  domReady();
  await Promise.resolve();
  await Promise.resolve();

  capturedVm.setSortRecent();

  assert.deepEqual(
    normalize(capturedVm.sortedExtensions().map((extension) => extension.id())),
    [
      "ext-enabled-new",
      "ext-alpha-enabled",
      "ext-zeta-enabled",
      "ext-enabled-old",
      "ext-disabled-new",
      "ext-disabled-old"
    ]
  );
});

test("url rules support wildcard, regex, and later-rule precedence", () => {
  const root = loadModule("js/url-rules.js");

  assert.equal(root.ExtensityUrlRules.isSupportedUrl("https://github.com/openai"), true);
  assert.equal(root.ExtensityUrlRules.isSupportedUrl("chrome://extensions"), false);
  assert.equal(root.ExtensityUrlRules.isSupportedUrl("not_a_valid_url"), false);
  assert.equal(root.ExtensityUrlRules.matchUrl("https://github.com/openai", "*://github.com/*", "wildcard"), true);
  assert.equal(root.ExtensityUrlRules.matchUrl("https://github.com/openai", "^https://github\\.com/.+$", "regex"), true);
  assert.equal(root.ExtensityUrlRules.matchUrl("https://github.com/openai", "[", "regex"), false);

  const changes = root.ExtensityUrlRules.resolveChanges("https://github.com/openai", [
    {
      active: true,
      disableIds: [],
      enableIds: ["ext-1"],
      id: "rule-1",
      matchMethod: "wildcard",
      name: "Enable GitHub helper",
      urlPattern: "*://github.com/*"
    },
    {
      active: true,
      disableIds: ["ext-1"],
      enableIds: [],
      id: "rule-2",
      matchMethod: "regex",
      name: "Disable helper on all GitHub pages",
      urlPattern: "^https://github\\.com/.+$"
    }
  ]);

  assert.deepEqual(normalize(changes), {
    "ext-1": {
      enabled: false,
      ruleId: "rule-2",
      ruleName: "Disable helper on all GitHub pages",
      urlPattern: "^https://github\\.com/.+$"
    }
  });

  const analysis = root.ExtensityUrlRules.analyzeUrl("https://github.com/openai", [
    {
      active: true,
      disableIds: [],
      enableIds: ["ext-1", "ext-2"],
      id: "rule-1",
      matchMethod: "wildcard",
      name: "Enable GitHub helper",
      urlPattern: "*://github.com/*"
    },
    {
      active: true,
      disableIds: ["ext-1"],
      enableIds: [],
      id: "rule-2",
      matchMethod: "regex",
      name: "Disable helper on all GitHub pages",
      urlPattern: "^https://github\\.com/.+$"
    }
  ]);

  assert.equal(analysis.result, "matched");
  assert.equal(analysis.matchedRules.length, 2);
  assert.deepEqual(normalize(analysis.perExtension["ext-1"]), [
    {
      enabled: true,
      ruleId: "rule-1",
      ruleName: "Enable GitHub helper",
      urlPattern: "*://github.com/*"
    },
    {
      enabled: false,
      ruleId: "rule-2",
      ruleName: "Disable helper on all GitHub pages",
      urlPattern: "^https://github\\.com/.+$"
    }
  ]);
  assert.deepEqual(normalize(analysis.finalChanges["ext-2"]), {
    enabled: true,
    ruleId: "rule-1",
    ruleName: "Enable GitHub helper",
    urlPattern: "*://github.com/*"
  });
});

test("history records preserve source metadata and cap record count", () => {
  const root = loadModule("js/history-logger.js");
  const records = root.ExtensityHistory.createRecords([
    {
      enabled: true,
      id: "ext-1",
      name: "Example",
      profileId: "Work",
      ruleId: "rule-1"
    }
  ], {
    profileId: "Work",
    ruleId: "rule-1",
    source: "rule"
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].triggeredBy, "rule");
  assert.equal(records[0].profileId, "Work");
  assert.equal(records[0].ruleId, "rule-1");
  assert.equal(records[0].nextEnabled, true);
  assert.equal(records[0].result, "state_changed_on");

  const debugRecord = root.ExtensityHistory.createEventRecord({
    action: "url_rule_evaluation",
    debug: { result: "no_match", url: "https://example.com" },
    event: "evaluation",
    label: "URL rule evaluation",
    result: "no_match",
    triggeredBy: "rule",
    url: "https://example.com"
  });

  assert.equal(debugRecord.label, "URL rule evaluation");
  assert.equal(debugRecord.result, "no_match");
  assert.equal(debugRecord.triggeredBy, "rule");
  assert.match(debugRecord.debug, /"result":"no_match"/);

  const appended = root.ExtensityHistory.appendHistory(
    Array.from({ length: 499 }, (_, index) => ({ id: `existing-${index}` })),
    Array.from({ length: 5 }, (_, index) => ({ id: `new-${index}` }))
  );

  assert.equal(appended.length, 500);
  assert.equal(appended[0].id, "existing-4");
  assert.equal(appended[499].id, "new-4");
});

test("background install does not request optional web store permission without user gesture", () => {
  let installListener = null;
  const permissionRequests = [];

  loadBackgroundModule({}, {
    chrome: {
      permissions: {
        contains(descriptor, callback) { callback(true); },
        request(descriptor, callback) {
          permissionRequests.push(normalize(descriptor));
          callback(true);
        }
      },
      runtime: {
        getManifest() {
          return { version: "2.0.0" };
        },
        id: "runtime-extension",
        lastError: null,
        onInstalled: {
          addListener(listener) {
            installListener = listener;
          }
        },
        onMessage: { addListener() {} },
        onStartup: { addListener() {} }
      }
    }
  });

  assert.equal(typeof installListener, "function");
  installListener({ reason: "update" });
  installListener({ reason: "install" });

  assert.deepEqual(permissionRequests, []);
});

test("background isAppType identifies hosted and packaged apps", () => {
  const root = loadBackgroundModule();
  const isAppType = root.ExtensityBackground.isAppType;

  assert.equal(isAppType("hosted_app"), true);
  assert.equal(isAppType("legacy_packaged_app"), true);
  assert.equal(isAppType("packaged_app"), true);

  assert.equal(isAppType("extension"), false);
  assert.equal(isAppType("theme"), false);
  assert.equal(isAppType(""), false);
  assert.equal(isAppType(null), false);
  assert.equal(isAppType(undefined), false);
});

test("history logger handles circular references gracefully in safeJson", () => {
  const root = loadModule("js/history-logger.js");

  const circular = {};
  circular.self = circular;

  const errorRecord = root.ExtensityHistory.createEventRecord({
    action: "error_test",
    debug: circular,
    event: "error",
    label: "Error evaluation",
    result: "error"
  });

  assert.equal(errorRecord.debug, "");
});

test("normalizePopupTextMode returns compact/icons_only or defaults to full", async () => {
  let appliedOptions = null;
  function OptionsCollection() {
    this.apply = function(opts) {
      appliedOptions = opts;
    };
    this.lastDriveSync = function() { return null; };
  }

  let domReady = null;
  let capturedVm = null;

  loadBrowserScript(path.join(repoRoot, "js/options.js"), {
    OptionsCollection,
    ExtensityApi: {
      getState() { return Promise.resolve({ state: { options: {} } }); }
    },
    ExtensityIO: {
      exportFilename() { return ""; },
      readFileAsText() { return Promise.resolve(""); },
      downloadText() {}
    },
    ExtensityImportExport: {
      buildExtensionsCsv() { return ""; }
    },
    ExtensityUtils: {
      applyThemeClasses() {}
    },
    ko: {
      observable() { return function() {}; },
      pureComputed(fn) { return fn; },
      bindingProvider: {},
      secureBindingsProvider: function() {},
      applyBindings(vm) { capturedVm = vm; }
    },
    _: { defer(fn) { fn(); } },
    document: {
      addEventListener(event, cb) { if (event === "DOMContentLoaded") domReady = cb; },
      body: { classList: { toggle() {} }, style: {} },
      documentElement: { style: { setProperty() {} } },
      getElementById() { return {}; }
    },
    chrome: {
      permissions: { contains(desc, cb) { cb(true); } }
    },
    window: {}
  });

  domReady();

  capturedVm.applyState({ options: { popupProfilePillTextMode: "compact" } });
  assert.equal(appliedOptions.popupProfilePillTextMode, "compact");

  capturedVm.applyState({ options: { popupProfilePillTextMode: "icons_only" } });
  assert.equal(appliedOptions.popupProfilePillTextMode, "icons_only");

  capturedVm.applyState({ options: { popupProfilePillTextMode: "full" } });
  assert.equal(appliedOptions.popupProfilePillTextMode, "full");

  capturedVm.applyState({ options: { popupProfilePillTextMode: "invalid" } });
  assert.equal(appliedOptions.popupProfilePillTextMode, "full");

  capturedVm.applyState({ options: { popupProfilePillTextMode: null } });
  assert.equal(appliedOptions.popupProfilePillTextMode, "full");

  capturedVm.applyState({ options: { popupProfilePillTextMode: undefined } });
  assert.equal(appliedOptions.popupProfilePillTextMode, "full");
});

test("options page normalizes activeProfile against loaded profiles and saves None as null", async () => {
  function observable(initialValue) {
    let value = initialValue;
    const obs = function(nextValue) {
      if (arguments.length > 0) {
        value = nextValue;
        return obs;
      }
      return value;
    };
    return obs;
  }

  let domReady = null;
  let capturedVm = null;
  const savedPayloads = [];
  let appliedOptions = null;
  const profiles = [
    { name: "__favorites" },
    { name: "Work" }
  ];

  function OptionsCollection() {
    this.activeProfile = observable(null);
    this.lastDriveSync = observable(null);
    this.localProfiles = observable(false);
    this.apply = function(opts) {
      appliedOptions = opts;
      this.activeProfile(opts.activeProfile);
      this.lastDriveSync(opts.lastDriveSync);
      this.localProfiles(opts.localProfiles);
    };
    this.toJS = function() {
      return {
        activeProfile: this.activeProfile(),
        lastDriveSync: this.lastDriveSync(),
        localProfiles: this.localProfiles()
      };
    };
  }

  loadBrowserScript(path.join(repoRoot, "js/options.js"), {
    OptionsCollection,
    ExtensityApi: {
      getState() {
        return Promise.resolve({
          state: {
            options: {},
            profiles: { items: profiles }
          }
        });
      },
      saveOptions(payload) {
        savedPayloads.push(normalize(payload));
        return Promise.resolve({
          state: {
            options: payload,
            profiles: { items: profiles }
          }
        });
      }
    },
    ExtensityIO: {
      exportFilename() { return ""; },
      readFileAsText() { return Promise.resolve(""); },
      downloadText() {}
    },
    ExtensityImportExport: {
      buildExtensionsCsv() { return ""; }
    },
    ExtensityUtils: {
      applyThemeClasses() {}
    },
    fadeOutMessage() {},
    ko: {
      observable,
      pureComputed(fn) {
        return fn;
      },
      bindingProvider: {},
      secureBindingsProvider: function() {},
      applyBindings(vm) {
        capturedVm = vm;
      }
    },
    _: { defer(fn) { fn(); } },
    document: {
      addEventListener(event, cb) { if (event === "DOMContentLoaded") { domReady = cb; } },
      body: { style: {} },
      documentElement: { style: { setProperty() {} } },
      getElementById() { return {}; }
    },
    chrome: {
      permissions: {
        contains(descriptor, callback) { callback(true); }
      },
      tabs: {
        create() {}
      }
    },
    window: {}
  });

  domReady();

  capturedVm.applyState({
    options: {
      activeProfile: "Work",
      lastDriveSync: 1700000000000,
      localProfiles: true
    },
    profiles: { items: profiles }
  });
  assert.equal(appliedOptions.activeProfile, "Work");
  assert.deepEqual(normalize(capturedVm.activeProfileOptions()), [
    { label: "None", value: null },
    { label: "Favorites", value: "__favorites" },
    { label: "Work", value: "Work" }
  ]);
  assert.equal(capturedVm.localProfilesLabel(), "Local storage");

  capturedVm.applyState({
    options: {
      activeProfile: "Missing",
      lastDriveSync: null,
      localProfiles: false
    },
    profiles: { items: profiles }
  });
  assert.equal(appliedOptions.activeProfile, null);
  assert.equal(capturedVm.localProfilesLabel(), "Chrome sync storage");

  capturedVm.options.activeProfile(null);
  await capturedVm.save();

  assert.equal(savedPayloads.length, 1);
  assert.equal(savedPayloads[0].activeProfile, null);
  assert.equal(savedPayloads[0].localProfiles, false);
  assert.equal(savedPayloads[0].lastDriveSync, null);
});

test("popup template avoids secure-binding context variables", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const templateStart = html.indexOf('<script type="text/html" id="item-template">');
  const templateEnd = html.indexOf("</script>", templateStart);
  const template = html.slice(templateStart, templateEnd);
  const openings = template.match(/<!-- ko /g) || [];
  const closings = template.match(/<!-- \/ko -->/g) || [];

  assert.doesNotMatch(html, /\$parent|\$root|\$data|\$index/);
  assert.equal(openings.length, closings.length);
});

test("popup header uses a logo-only repository link", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");

  assert.match(
    html,
    /<a id="title"[^>]*title="Open Extensity-Plus repository"[^>]*aria-label="Open Extensity-Plus repository"[^>]*>\s*<img[^>]*alt="Extensity-Plus"[^>]*>\s*<\/a>/
  );
  assert.doesNotMatch(
    html,
    /<a id="title"[\s\S]*>\s*<img[^>]*>\s*Extensity-Plus\s*<\/a>/
  );
});

test("popup header is mounted only when showHeader is strictly enabled", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const indexScript = fs.readFileSync(path.join(repoRoot, "js/index.js"), "utf8");

  assert.match(html, /<div id="popup-header-mount"><\/div>/);
  assert.match(html, /<template id="popup-header-template">[\s\S]*<section id="header" class="main">/);
  assert.doesNotMatch(html, /<section id="header" class="main" data-sbind="visible: opts\.showHeader">/);
  assert.match(indexScript, /state\.options\.showHeader !== true/);
  assert.match(indexScript, /mountPopupHeaderIfEnabled\(state\);/);
});

test("popup sort toolbar is mounted only when showPopupSort is strictly enabled", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const indexScript = fs.readFileSync(path.join(repoRoot, "js/index.js"), "utf8");

  assert.match(html, /<div id="popup-sort-toolbar-mount"><\/div>/);
  assert.match(html, /<template id="popup-sort-toolbar-template">[\s\S]*<section id="toolbar" class="main">/);
  assert.match(html, /<template id="popup-sort-toolbar-error-template">[\s\S]*<section id="toolbar-error" class="main">/);
  assert.doesNotMatch(html, /<section id="toolbar" class="main" data-sbind="visible: opts\.showPopupSort">/);
  assert.match(indexScript, /state && state\.options && state\.options\.showPopupSort === true/);
  assert.match(indexScript, /mountPopupSortToolbar\(state\);/);
});

test("popup table action panel spans full width in below-name mode", () => {
  const css = fs.readFileSync(path.join(repoRoot, "styles/index.css"), "utf8");

  assert.match(
    css,
    /body\.table-action-panel-below-name\.popup-list-style-table\.list-view \.table-action-line\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*\}/
  );
});

test("popup profile pills keep icon and text on one line", () => {
  const css = fs.readFileSync(path.join(repoRoot, "styles/index.css"), "utf8");

  assert.match(
    css,
    /#profiles ul\.items li \.profile-row\s*\{[^}]*display:\s*inline-flex;[^}]*flex-wrap:\s*nowrap;[^}]*white-space:\s*nowrap;[^}]*\}/
  );
  assert.match(
    css,
    /#profiles ul\.items li \.profile-row span\s*\{[^}]*white-space:\s*nowrap;[^}]*\}/
  );
});

test("popup profile pills expose real profile titles and a Base icon", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");

  assert.match(
    html,
    /<div class="profile-row" data-sbind="click: selectProfile, attr:\{title: profileTooltip\}">/
  );
  assert.match(
    html,
    /<i class="fa fa-home" data-sbind="visible: showBaseIcon"><\/i>/
  );
  assert.match(
    html,
    /attr:\{style: badgeStyle, title: title\}/
  );
});

test("popup expanded action rows keep the profile selector inline", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(repoRoot, "styles/index.css"), "utf8");

  assert.match(
    html,
    /<div class="action-controls-row">[\s\S]*<div class="action-icon-row">[\s\S]*<select class="profile-assign-select"/
  );
  assert.match(
    css,
    /\.action-controls-row\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*nowrap;[^}]*min-width:\s*0;[^}]*\}/
  );
  assert.match(
    css,
    /\.action-icon-row\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;[^}]*\}/
  );
  assert.match(
    css,
    /\.table-action-line \.profile-assign-select,\s*\.compact-action-line \.profile-assign-select\s*\{[^}]*flex:\s*0 1 168px;[^}]*min-width:\s*148px;[^}]*\}/
  );
});

test("popup recent label and pin action reflect browser toolbar settings", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const profilesHtml = fs.readFileSync(path.join(repoRoot, "profiles.html"), "utf8");

  assert.match(
    html,
    /title="Sort by most recently installed" data-sbind="click: setSortRecent/
  );
  assert.match(
    profilesHtml,
    /title="Sort by most recently installed" data-sbind="click: setSortRecent/
  );
  assert.match(
    html,
    /data-sbind="click: pinToToolbarAction, clickBubble: false, attr:\{title: pinToToolbarTitle, 'aria-label': pinToToolbarTitle\}"/
  );
  assert.match(
    html,
    /data-sbind="css: pinToToolbarIconClass"/
  );
  assert.doesNotMatch(
    html,
    /css:\{pinned: favorite\(\)\}|<h1>Toolbar<\/h1>/
  );
  assert.doesNotMatch(
    html,
    /pinToFavoritesAction|pinToFavoritesTitle|pinToFavoritesIconClass/
  );
});

test("options page exposes active profile and debug status without unsafe sync internals", () => {
  const html = fs.readFileSync(path.join(repoRoot, "options.html"), "utf8");

  assert.match(
    html,
    /<legend>Advanced &amp; Debug<\/legend>/
  );
  assert.match(
    html,
    /<select id="activeProfile" data-sbind="options: activeProfileOptions, optionsText: 'label', optionsValue: 'value', value: options.activeProfile"><\/select>/
  );
  assert.match(
    html,
    /<span class="muted">Profile storage:<\/span> <span data-sbind="text: localProfilesLabel"><\/span>/
  );
  assert.match(
    html,
    /<span class="muted">Last Drive sync:<\/span> <span data-sbind="text: lastDriveSyncLabel"><\/span>/
  );
  assert.doesNotMatch(
    html,
    /id="migration"|id="migration_2_0_0"|id="migration_popupListStyle"|id="profileMeta"/
  );
});

test("popup rows expose direct profile membership and sort handlers", async () => {
  function observable(initialValue) {
    let value = initialValue;
    const subscribers = [];
    const obs = function(nextValue) {
      if (arguments.length > 0) {
        value = nextValue;
        subscribers.forEach((fn) => fn(value));
        return obs;
      }
      return value;
    };
    obs.subscribe = function(fn) {
      subscribers.push(fn);
    };
    obs.extend = function(extenders) {
      Object.keys(extenders || {}).forEach((name) => {
        if (ko.extenders[name]) {
          ko.extenders[name](obs, extenders[name]);
        }
      });
      return obs;
    };
    return obs;
  }

  function observableArray(initialValue) {
    const obs = observable((initialValue || []).slice());
    obs.push = function(item) {
      const nextValue = obs().slice();
      nextValue.push(item);
      obs(nextValue);
    };
    obs.remove = function(predicateOrItem) {
      const predicate = typeof predicateOrItem === "function"
        ? predicateOrItem
        : function(item) { return item === predicateOrItem; };
      obs(obs().filter((item) => !predicate(item)));
    };
    obs.indexOf = function(item) {
      return obs().indexOf(item);
    };
    return obs;
  }

  let capturedVm = null;
  let domReady = null;
  const deferred = [];
  const membershipCalls = [];
  const openedTabs = [];
  const toolbarPinCalls = [];
  const pinResults = [
    { result: "pinned" },
    { result: "opened_fallback" }
  ];
  const saveOptionsCalls = [];
  const ko = {
    extenders: {},
    observable,
    observableArray,
    computed(fn) {
      const obs = function() {
        return fn();
      };
      obs.extend = function(extenders) {
        Object.keys(extenders || {}).forEach((name) => {
          if (ko.extenders[name]) {
            ko.extenders[name](obs, extenders[name]);
          }
        });
        return obs;
      };
      return obs;
    },
    pureComputed(fn) {
      const obs = function() {
        return fn();
      };
      obs.extend = function(extenders) {
        Object.keys(extenders || {}).forEach((name) => {
          if (ko.extenders[name]) {
            ko.extenders[name](obs, extenders[name]);
          }
        });
        return obs;
      };
      return obs;
    },
    bindingProvider: {},
    secureBindingsProvider: function() {},
    applyBindings(vm) {
      capturedVm = vm;
    }
  };
  const documentBody = {
    appendChild() {},
    className: "",
    removeChild() {},
    style: {}
  };
  const state = {
    options: {
      activeProfile: "__favorites",
      appsFirst: false,
      colorScheme: "auto",
      contrastMode: "normal",
      enabledFirst: true,
      extensionIconSizePx: 16,
      fontFamily: "",
      fontSizePx: 12,
      groupApps: false,
      itemNameGapPx: 0,
      itemPaddingPx: 0,
      itemPaddingXPx: 0,
      itemSpacingPx: 0,
      itemVerticalSpacePx: 0,
      popupActionRowLayout: "horizontal",
      popupBgColor: "",
      popupHeaderIconSize: "compact",
      popupListStyle: "table",
      popupMainPaddingPx: 0,
      popupProfileBadgeSingleWordChars: 4,
      popupProfileBadgeTextMode: "full",
      popupProfilePillShowIcons: false,
      popupProfilePillSingleWordChars: 4,
      popupProfilePillTextMode: "icons_only",
      popupScrollbarMode: "invisible",
      popupTableActionPanelPosition: "below_name",
      popupWidthPx: 380,
      searchBox: true,
      showAlwaysOnBadge: true,
      showHeader: true,
      showOptions: true,
      showPopupSort: true,
      showPopupVersionChips: true,
      showReserved: true,
      sortMode: "recent",
      viewMode: "list"
    },
    profiles: {
      items: [
        { items: ["ext-ao"], name: "__always_on" },
        { items: ["ext-1", "ext-ao"], name: "__base" },
        { items: ["ext-1", "ext-fav-off"], name: "__favorites" },
        { color: "#ff0000", icon: "fa-rocket", items: ["ext-1", "ext-ao"], name: "Work" },
        { color: "#00aa00", icon: "fa-bolt", items: ["ext-1"], name: "Focus" },
        { color: "#0000ff", icon: "fa-globe", items: ["ext-1"], name: "Travel" },
        { color: "#ffaa00", icon: "fa-leaf", items: ["ext-1"], name: "Home" }
      ],
      localProfiles: false
    },
    extensions: [
      {
        alwaysOn: true,
        alias: "",
        description: "Always-on extension description",
        enabled: true,
        groupBadges: [],
        groupIds: [],
        homepageUrl: "https://example.com/always-on",
        icon: "images/icon48.png",
        id: "ext-ao",
        installedAt: 400,
        installType: "normal",
        isApp: false,
        lastUsed: 2,
        mayDisable: true,
        name: "Always On Extension",
        optionsUrl: "https://example.com/always-on/options",
        storeUrl: "https://chrome.google.com/webstore/detail/example/ext-ao",
        usageCount: 4,
        version: "4.5.6"
      },
      {
        alias: "",
        description: "Tie extension A description",
        enabled: true,
        groupBadges: [],
        groupIds: [],
        homepageUrl: "https://example.com/alpha",
        icon: "images/icon48.png",
        id: "ext-alpha",
        installedAt: 300,
        installType: "normal",
        isApp: false,
        lastUsed: 3,
        mayDisable: true,
        name: "Alpha Tie Extension",
        optionsUrl: "",
        storeUrl: "https://chrome.google.com/webstore/detail/example/ext-alpha",
        usageCount: 1,
        version: "1.0.1"
      },
      {
        alias: "",
        description: "Tie extension Z description",
        enabled: true,
        groupBadges: [],
        groupIds: [],
        homepageUrl: "https://example.com/zeta",
        icon: "images/icon48.png",
        id: "ext-zeta",
        installedAt: 300,
        installType: "normal",
        isApp: false,
        lastUsed: 3,
        mayDisable: true,
        name: "Zeta Tie Extension",
        optionsUrl: "",
        storeUrl: "https://chrome.google.com/webstore/detail/example/ext-zeta",
        usageCount: 3,
        version: "1.0.2"
      },
      {
        alias: "",
        description: "Example extension description",
        enabled: true,
        favorite: true,
        groupBadges: [],
        groupIds: [],
        homepageUrl: "https://example.com",
        icon: "images/icon48.png",
        id: "ext-1",
        installedAt: 100,
        installType: "normal",
        isApp: false,
        lastUsed: 99,
        mayDisable: true,
        name: "Example Extension",
        optionsUrl: "https://example.com/options",
        storeUrl: "https://chrome.google.com/webstore/detail/example/ext-1",
        usageCount: 2,
        version: "1.2.3"
      },
      {
        alias: "",
        description: "Favorite disabled extension description",
        enabled: false,
        favorite: true,
        groupBadges: [],
        groupIds: [],
        homepageUrl: "https://example.com/favorite-disabled",
        icon: "images/icon48.png",
        id: "ext-fav-off",
        installedAt: 600,
        installType: "normal",
        isApp: false,
        lastUsed: 50,
        mayDisable: true,
        name: "Favorite Disabled Extension",
        optionsUrl: "",
        storeUrl: "https://chrome.google.com/webstore/detail/example/ext-fav-off",
        usageCount: 10,
        version: "0.5.0"
      },
      {
        alias: "",
        description: "Disabled extension description",
        enabled: false,
        groupBadges: [],
        groupIds: [],
        homepageUrl: "https://example.com/disabled",
        icon: "images/icon48.png",
        id: "ext-off",
        installedAt: 500,
        installType: "normal",
        isApp: false,
        lastUsed: 1,
        mayDisable: true,
        name: "Disabled Recent Extension",
        optionsUrl: "",
        storeUrl: "https://chrome.google.com/webstore/detail/example/ext-off",
        usageCount: 0,
        version: "0.1.0"
      }
    ],
    localState: {
      bulkToggleRestore: [],
      undoStack: []
    }
  };
  const windowRoot = {
    ExtensityStorage: loadBrowserScript(path.join(repoRoot, "js/storage.js"), {
      self: {}
    }).ExtensityStorage
  };

  loadBrowserScript(path.join(repoRoot, "js/engine.js"), {
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(payload, callback) {
          callback({ ok: true, payload: {} });
        }
      },
      storage: {
        sync: {
          get(defaults, callback) {
            callback({ dismissals: [] });
          },
          set() {}
        }
      },
      tabs: {
        create(details, callback) {
          openedTabs.push(normalize(details));
          if (callback) {
            callback({});
          }
        }
      }
    },
    document: {
      body: documentBody,
      createElement() {
        return {
          click() {},
          select() {},
          setAttribute() {},
          style: {}
        };
      },
      execCommand() {
        return true;
      },
      getElementById() {
        return null;
      }
    },
    ko,
    navigator: {
      clipboard: {
        writeText() {
          return Promise.resolve();
        }
      }
    },
    _: Object.assign(function(items) {
      return {
        find(predicate) {
          return (items || []).find(predicate);
        }
      };
    }, {
      delay(fn) {
        fn();
      }
    }),
    window: windowRoot
  });

  loadBrowserScript(path.join(repoRoot, "js/index.js"), {
    DismissalsCollection: windowRoot.DismissalsCollection,
    ExtensionModel: windowRoot.ExtensionModel,
    ExtensionCollectionModel: windowRoot.ExtensionCollectionModel,
    ExtensityApi: {
      getExtensionMetadata() {
        return Promise.resolve({ metadata: {} });
      },
      getState() {
        return Promise.resolve({ state });
      },
      saveOptions(nextOptions) {
        saveOptionsCalls.push(nextOptions.sortMode);
        state.options = Object.assign({}, state.options, nextOptions);
        return Promise.resolve({ state });
      },
      updateExtensionProfileMembership(extensionId, profileName, shouldInclude) {
        membershipCalls.push({ extensionId, profileName, shouldInclude });
        return Promise.resolve({ state });
      },
      pinExtensionToToolbar(extensionId) {
        toolbarPinCalls.push({ extensionId });
        return Promise.resolve(pinResults.shift() || { result: "pinned" });
      }
    },
    ExtensityPopupLabels: windowRoot.ExtensityPopupLabels,
    ExtensityUtils: windowRoot.ExtensityUtils,
    OptionsCollection: windowRoot.OptionsCollection,
    ProfileCollectionModel: windowRoot.ProfileCollectionModel,
    ProfileModel: windowRoot.ProfileModel,
    _: {
      defer(fn) {
        deferred.push(fn);
      }
    },
    chrome: {
      management: {
        launchApp() {}
      },
      tabs: {
        create() {}
      }
    },
    document: {
      addEventListener(event, callback) {
        if (event === "DOMContentLoaded") {
          domReady = callback;
        }
      },
      body: documentBody,
      documentElement: {
        className: "",
        style: {
          setProperty() {}
        }
      },
      getElementById() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    },
    ko,
    window: {
      ExtensityTooltips: {
        applyAutoTooltips() {}
      },
      close() {}
    }
  });

  assert.ok(domReady);
  domReady();
  assert.equal(deferred.length, 1);
  deferred[0]();
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(capturedVm);
  const profileNames = capturedVm.listedProfiles().map((profile) => profile.name());
  const profile = capturedVm.listedProfiles()[0];
  const recentSortedIds = capturedVm.listedExtensions().map((item) => item.id());
  const extension = capturedVm.listedExtensions().find((item) => item.id() === "ext-1");
  const alwaysOnExtension = capturedVm.listedExtensions().find((item) => item.id() === "ext-ao");
  const listedExtensionIds = capturedVm.listedExtensions().map((item) => item.id());

  assert.equal(typeof profile.selectProfile, "function");
  assert.equal(typeof extension.toggleTableRowAction, "function");
  assert.equal(typeof extension.onProfileMembershipChange, "function");
  assert.equal(typeof extension.pinToToolbarAction, "function");
  assert.equal(extension.pinToToolbarTitle(), "Pin to browser toolbar");
  assert.deepEqual(normalize(listedExtensionIds.slice(0, 6)), ["ext-ao", "ext-alpha", "ext-zeta", "ext-1", "ext-fav-off", "ext-off"]);
  assert.equal(extension.showTableRow(), true);
  assert.deepEqual(normalize(recentSortedIds.slice(0, 6)), [
    "ext-ao",
    "ext-alpha",
    "ext-zeta",
    "ext-1",
    "ext-fav-off",
    "ext-off"
  ]);
  assert.deepEqual(normalize(capturedVm.listedItems().map((item) => item.id()).slice(0, 6)), [
    "ext-ao",
    "ext-alpha",
    "ext-zeta",
    "ext-1",
    "ext-fav-off",
    "ext-off"
  ]);
  assert.deepEqual(normalize(profileNames), ["__always_on", "__base", "__favorites", "Work", "Focus", "Travel", "Home"]);
  assert.deepEqual(normalize(extension.profileDropdownOptions()), [
    { label: " Always On", value: "__always_on" },
    { label: "✓ Base", value: "__base" },
    { label: "✓ Favorites", value: "__favorites" },
    { label: "✓ Work", value: "Work" },
    { label: "✓ Focus", value: "Focus" },
    { label: "✓ Travel", value: "Travel" },
    { label: "✓ Home", value: "Home" }
  ]);
  assert.equal(capturedVm.profiles.find("__base").profileTooltip(), "Base");
  assert.deepEqual(normalize(extension.profileBadges()), [
    { badgeStyle: "", colorClass: "base-badge", name: "Base", title: "Base" },
    { badgeStyle: "border-left-color:#ff0000", colorClass: "", name: "Work", title: "Work" },
    { badgeStyle: "border-left-color:#00aa00", colorClass: "", name: "Focus", title: "Focus" },
    { badgeStyle: "border-left-color:#0000ff", colorClass: "", name: "Travel", title: "Travel" },
    { badgeStyle: "", colorClass: "profile-overflow-badge", name: "+1", title: "Hidden profiles: Home" }
  ]);
  assert.deepEqual(normalize(alwaysOnExtension.profileBadges()), [
    { badgeStyle: "", colorClass: "always-on-badge", name: "Always On", title: "Always On" },
    { badgeStyle: "", colorClass: "base-badge", name: "Base", title: "Base" }
  ]);

  await extension.pinToToolbarAction();
  assert.equal(capturedVm.error(), "");

  await extension.pinToToolbarAction();
  assert.equal(
    capturedVm.error(),
    "Couldn't pin automatically. Opened the browser details page so you can finish pinning there."
  );

  extension.onProfileMembershipChange(null, {
    target: {
      value: "__always_on"
    }
  });
  await Promise.resolve();

  extension.onProfileMembershipChange(null, {
    target: {
      value: "__favorites"
    }
  });
  await Promise.resolve();

  extension.onProfileMembershipChange(null, {
    target: {
      value: "__base"
    }
  });
  await Promise.resolve();

  assert.deepEqual(normalize(openedTabs), []);
  assert.deepEqual(normalize(toolbarPinCalls), [
    { extensionId: "ext-1" },
    { extensionId: "ext-1" }
  ]);

  const normalizedMembershipCalls = normalize(membershipCalls);
  const expectedTail = [
    {
      extensionId: "ext-1",
      profileName: "__always_on",
      shouldInclude: true
    },
    {
      extensionId: "ext-1",
      profileName: "__favorites",
      shouldInclude: false
    },
    {
      extensionId: "ext-1",
      profileName: "__base",
      shouldInclude: false
    }
  ];

  assert.deepEqual(normalizedMembershipCalls, expectedTail);

  capturedVm.setSortAlpha();
  await Promise.resolve();

  assert.deepEqual(normalize(capturedVm.listedExtensions().map((item) => item.id()).slice(0, 6)), [
    "ext-alpha",
    "ext-ao",
    "ext-zeta",
    "ext-1",
    "ext-fav-off",
    "ext-off"
  ]);

  capturedVm.setSortFrequency();
  await Promise.resolve();

  assert.deepEqual(normalize(capturedVm.listedExtensions().map((item) => item.id()).slice(0, 6)), [
    "ext-ao",
    "ext-zeta",
    "ext-alpha",
    "ext-1",
    "ext-fav-off",
    "ext-off"
  ]);

  assert.deepEqual(normalize(saveOptionsCalls), ["alpha", "frequency"]);
});
