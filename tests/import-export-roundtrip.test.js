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
    () => root.ExtensityImportExport.validateBackupEnvelope({ version: "2.0.0" }),
    /required/i
  );
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
