const assert = require("node:assert/strict");
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
    const result = {};
    Object.keys(source).forEach(key => {
      result[key] = Array.from(new Set(source[key] || []));
    });
    if (!result.__always_on) {
      result.__always_on = [];
    }
    if (!result.__favorites) {
      result.__favorites = [];
    }
    return result;
  },
  uniqueArray(items) {
    return Array.from(new Set(items || []));
  }
};

function loadImportExport() {
  return loadBrowserScript(path.join(repoRoot, "js/import-export.js"), {
    self: { ExtensityStorage: storageStub }
  });
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeExt(overrides = {}) {
  return {
    enabled: true,
    id: "ext-1",
    isApp: false,
    mayDisable: true,
    ...overrides
  };
}

function makeInput(overrides = {}) {
  return {
    extensions: [makeExt()],
    localState: {
      aliases: {},
      eventHistory: [],
      groupOrder: [],
      groups: {},
      reminderQueue: [],
      recentlyUsed: [],
      undoStack: [],
      urlRules: [],
      usageCounters: {}
    },
    options: { activeProfile: null, sortMode: "alpha" },
    profiles: { map: { __always_on: [], __favorites: [] } },
    ...overrides
  };
}

// --- buildBackupEnvelope ---

test("buildBackupEnvelope produces a v2.0.0 envelope with required top-level keys", () => {
  const root = loadImportExport();
  const envelope = root.ExtensityImportExport.buildBackupEnvelope(makeInput());
  assert.equal(envelope.version, "2.0.0");
  assert.equal(envelope.exportScope, "full");
  assert.ok(envelope.settings, "envelope.settings must be present");
  assert.ok(envelope.localState, "envelope.localState must be present");
  assert.ok(envelope.profiles, "envelope.profiles must be present");
});

test("buildBackupEnvelope includes only mayDisable extensions in extensionStates", () => {
  const root = loadImportExport();
  const envelope = root.ExtensityImportExport.buildBackupEnvelope(makeInput({
    extensions: [
      makeExt({ id: "toggleable", mayDisable: true, enabled: false }),
      makeExt({ id: "locked", mayDisable: false, enabled: true })
    ]
  }));

  assert.ok(
    Object.prototype.hasOwnProperty.call(envelope.localState.extensionStates, "toggleable"),
    "mayDisable extension must appear in extensionStates"
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(envelope.localState.extensionStates, "locked"),
    "non-mayDisable extension must NOT appear in extensionStates"
  );
});

test("buildBackupEnvelope records correct enabled boolean for each extension", () => {
  const root = loadImportExport();
  const envelope = root.ExtensityImportExport.buildBackupEnvelope(makeInput({
    extensions: [
      makeExt({ id: "on-ext", enabled: true, mayDisable: true }),
      makeExt({ id: "off-ext", enabled: false, mayDisable: true })
    ]
  }));

  assert.equal(envelope.localState.extensionStates["on-ext"], true);
  assert.equal(envelope.localState.extensionStates["off-ext"], false);
});

test("buildScopedExport supports profiles-only, settings-only, and profiles+settings exports", () => {
  const root = loadImportExport();
  const input = makeInput({
    options: { activeProfile: "Work", sortMode: "alpha" },
    profiles: { map: { Work: ["ext-1"], __always_on: [], __favorites: [] } }
  });

  const profilesOnly = root.ExtensityImportExport.buildScopedExport(input, "profiles");
  assert.deepEqual(normalize(Object.keys(profilesOnly).sort()), ["exportScope", "exportedAt", "profiles", "version"]);
  assert.equal(profilesOnly.exportScope, "profiles");
  assert.deepEqual(normalize(profilesOnly.profiles), { Work: ["ext-1"], __always_on: [], __favorites: [] });

  const settingsOnly = root.ExtensityImportExport.buildScopedExport(input, "settings");
  assert.deepEqual(normalize(Object.keys(settingsOnly).sort()), ["exportScope", "exportedAt", "settings", "version"]);
  assert.equal(settingsOnly.exportScope, "settings");
  assert.deepEqual(normalize(settingsOnly.settings), { activeProfile: "Work", sortMode: "alpha" });

  const profilesAndSettings = root.ExtensityImportExport.buildScopedExport(input, "profiles_settings");
  assert.deepEqual(normalize(Object.keys(profilesAndSettings).sort()), ["exportScope", "exportedAt", "profiles", "settings", "version"]);
  assert.equal(profilesAndSettings.exportScope, "profiles_settings");
  assert.deepEqual(normalize(profilesAndSettings.settings), { activeProfile: "Work", sortMode: "alpha" });
  assert.deepEqual(normalize(profilesAndSettings.profiles), { Work: ["ext-1"], __always_on: [], __favorites: [] });
});

test("buildScopedExport rejects unknown export scopes", () => {
  const root = loadImportExport();
  assert.throws(
    () => root.ExtensityImportExport.buildScopedExport(makeInput(), "unsupported"),
    /Unknown export scope/
  );
});

// --- validateBackupEnvelope ---

test("validateBackupEnvelope rejects unsupported version strings", () => {
  const root = loadImportExport();
  assert.throws(
    () => root.ExtensityImportExport.validateBackupEnvelope({ version: "99.0.0" }),
    /Unsupported backup version/
  );
});

test("validateBackupEnvelope rejects version 1.0.0", () => {
  const root = loadImportExport();
  assert.throws(
    () => root.ExtensityImportExport.validateBackupEnvelope({ version: "1.0.0" }),
    /Unsupported backup version/
  );
});

test("validateBackupEnvelope rejects missing required keys", () => {
  const root = loadImportExport();
  assert.throws(
    () => root.ExtensityImportExport.validateBackupEnvelope({
      version: "2.0.0",
      profiles: { __always_on: [], __favorites: [] },
      settings: {}
    }),
    /required/i
  );
});

test("validateImportPayload rejects unrecognized backup JSON", () => {
  const root = loadImportExport();
  assert.throws(
    () => root.ExtensityImportExport.validateImportPayload({ version: "2.0.0" }),
    /Unrecognized backup JSON/
  );
});

test("detectImportScope prefers exportScope field when present", () => {
  const root = loadImportExport();
  assert.equal(
    root.ExtensityImportExport.detectImportScope({
      version: "2.0.0",
      exportScope: "settings",
      profiles: { Work: ["ext-1"] }
    }),
    "settings"
  );
});

test("validateImportPayload accepts profiles-only export", () => {
  const root = loadImportExport();
  const validated = root.ExtensityImportExport.validateImportPayload({
    version: "2.0.0",
    profiles: { Work: ["ext-1", "ext-1"], __always_on: [], __favorites: [] }
  });
  assert.equal(validated.scope, "profiles");
  assert.deepEqual(validated.profiles.Work, ["ext-1"]);
});

test("validateImportPayload accepts settings-only export", () => {
  const root = loadImportExport();
  const validated = root.ExtensityImportExport.validateImportPayload({
    version: "2.0.0",
    settings: { activeProfile: "Work", sortMode: "alpha" }
  });
  assert.equal(validated.scope, "settings");
  assert.deepEqual(validated.settings, { activeProfile: "Work", sortMode: "alpha" });
});

test("validateImportPayload accepts profiles and settings export without localState", () => {
  const root = loadImportExport();
  const validated = root.ExtensityImportExport.validateImportPayload({
    version: "2.0.0",
    profiles: { Work: ["ext-1"], __always_on: [], __favorites: [] },
    settings: { activeProfile: "Work", sortMode: "alpha" }
  });
  assert.equal(validated.scope, "profiles_settings");
});

test("round-trip: buildScopedExport output passes validateImportPayload for each scope", () => {
  const root = loadImportExport();
  const input = makeInput({
    options: { activeProfile: "Work", sortMode: "alpha" },
    profiles: { map: { Work: ["ext-1"], __always_on: [], __favorites: [] } }
  });

  ["profiles", "settings", "profiles_settings"].forEach((scope) => {
    const exported = root.ExtensityImportExport.buildScopedExport(input, scope);
    const validated = root.ExtensityImportExport.validateImportPayload(exported);
    assert.equal(validated.scope, scope);
  });

  const fullExported = root.ExtensityImportExport.buildScopedExport(input, "full");
  const fullValidated = root.ExtensityImportExport.validateImportPayload(fullExported);
  assert.equal(fullValidated.scope, "full");
});

test("validateBackupEnvelope deduplicates extension IDs in profiles", () => {
  const root = loadImportExport();
  const valid = root.ExtensityImportExport.validateBackupEnvelope({
    version: "2.0.0",
    settings: {},
    profiles: { Work: ["ext-1", "ext-1", "ext-2"] },
    aliases: {},
    localState: { extensionStates: { "ext-1": true } }
  });
  assert.deepEqual(normalize(valid.profiles.Work), ["ext-1", "ext-2"]);
});

// --- round-trip ---

test("round-trip: envelope built by buildBackupEnvelope passes validateBackupEnvelope unchanged", () => {
  const root = loadImportExport();
  const input = makeInput({
    extensions: [
      makeExt({ id: "ext-a", enabled: true }),
      makeExt({ id: "ext-b", enabled: false })
    ],
    options: { activeProfile: "Work", sortMode: "alpha" },
    profiles: { map: { Work: ["ext-a"], __always_on: ["ext-a"], __favorites: [] } }
  });

  const envelope = root.ExtensityImportExport.buildBackupEnvelope(input);

  let validated;
  assert.doesNotThrow(
    () => { validated = root.ExtensityImportExport.validateBackupEnvelope(envelope); },
    "Envelope built by buildBackupEnvelope must pass validateBackupEnvelope without modification"
  );

  assert.equal(validated.localState.extensionStates["ext-a"], true);
  assert.equal(validated.localState.extensionStates["ext-b"], false);
});

// --- buildExtensionsCsv ---

test("buildExtensionsCsv header row contains all expected column names", () => {
  const root = loadImportExport();
  const csv = root.ExtensityImportExport.buildExtensionsCsv([]);
  const header = csv.split("\n")[0];
  for (const col of ["id", "name", "alias", "enabled", "type", "usageCount", "lastUsed", "groups"]) {
    assert.ok(header.includes(col), `Header must include column "${col}"`);
  }
});

test("buildExtensionsCsv with empty extension list produces only a header row", () => {
  const root = loadImportExport();
  const lines = root.ExtensityImportExport.buildExtensionsCsv([]).trim().split("\n");
  assert.equal(lines.length, 1, "Empty list must produce exactly the header row and nothing else");
});

test("buildExtensionsCsv: commas inside alias are wrapped in double quotes", () => {
  const root = loadImportExport();
  const csv = root.ExtensityImportExport.buildExtensionsCsv([
    { id: "e1", name: "Ext", alias: "A, B", enabled: true, type: "extension",
      usageCount: 0, lastUsed: 0, groupIds: [] }
  ]);
  assert.match(csv, /"A, B"/, "Alias containing a comma must be double-quoted in CSV output");
});

test("buildExtensionsCsv: double-quotes in alias are escaped as double double-quotes", () => {
  const root = loadImportExport();
  const csv = root.ExtensityImportExport.buildExtensionsCsv([
    { id: "e1", name: "Ext", alias: 'Say "hi"', enabled: true, type: "extension",
      usageCount: 0, lastUsed: 0, groupIds: [] }
  ]);
  assert.match(csv, /"Say ""hi"""/, 'Double-quotes in alias must be escaped as "" per RFC 4180');
});

test("buildExtensionsCsv: multiple groups are pipe-separated and double-quoted", () => {
  const root = loadImportExport();
  const csv = root.ExtensityImportExport.buildExtensionsCsv([
    { id: "e1", name: "Ext", alias: "", enabled: true, type: "extension",
      usageCount: 0, lastUsed: 0, groupIds: ["grp-a", "grp-b"] }
  ]);
  assert.match(csv, /"grp-a\|grp-b"/, "Multiple group IDs must be pipe-separated and wrapped in double quotes");
});

test("buildExtensionsCsv: empty groupIds produces empty groups cell", () => {
  const root = loadImportExport();
  const csv = root.ExtensityImportExport.buildExtensionsCsv([
    { id: "e1", name: "Ext", alias: "", enabled: true, type: "extension",
      usageCount: 0, lastUsed: 0, groupIds: [] }
  ]);
  // The groups column should not contain a pipe
  assert.ok(!csv.split("\n").slice(1).join("").includes("|"), "Empty groupIds must not produce pipe characters");
});
