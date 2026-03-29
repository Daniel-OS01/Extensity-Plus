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
    management: {},
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
  assert.equal(root.ExtensityPopupLabels.formatProfileBadgeLabel("Bookmark Organization", "compact", 4), "BO");
  assert.equal(root.ExtensityPopupLabels.formatProfileBadgeLabel("Testing", "compact", 4), "Test");
  assert.equal(root.ExtensityPopupLabels.formatProfileBadgeLabel("Bookmark Organization", "full", 4), "Bookmark Organization");
  assert.equal(root.ExtensityPopupLabels.formatProfileBadgeLabel("Bookmark Organization", "icons_only", 4), "");
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
  assert.equal(typeof windowRoot.ExtensityApi.updateExtensionProfileMembership, "function");
  assert.equal(typeof windowRoot.ExtensityApi.testUrlRules, "function");

  await windowRoot.ExtensityApi.assignExtensionProfile("ext-123", "Work");
  await windowRoot.ExtensityApi.assignExtensionProfile("ext-456", null);
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

test("url rules support wildcard, regex, and later-rule precedence", () => {
  const root = loadModule("js/url-rules.js");

  assert.equal(root.ExtensityUrlRules.isSupportedUrl("https://github.com/openai"), true);
  assert.equal(root.ExtensityUrlRules.isSupportedUrl("chrome://extensions"), false);
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
