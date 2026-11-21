// Two-device Drive sync scenarios. Each device runs the real js/background.js in its own vm
// sandbox (tests/helpers/sync-sim.js) and both share one in-memory fake Drive, so these tests
// exercise the full message -> merge -> Drive -> storage path rather than hand-built envelopes.
// Every scenario ends with assertSettled: one more sync on each device must be a no-op that
// does not write to Drive.
const assert = require("node:assert/strict");
const test = require("node:test");

const { FakeDrive, createDevice, plain, settle } = require("./helpers/sync-sim");

const E0 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0";
const E1 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";
const E2 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2";
const E3 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3";
const ALL_CATEGORIES = { aliases: true, groups: true, history: true, options: true, profiles: true, urlRules: true };
const MAX_ROUNDS = 6;

function rule(id) {
  return { active: true, disableIds: [], enableIds: [E1], id: id, matchMethod: "wildcard", name: id, timeout: 0, urlPattern: "*://" + id + ".example/*" };
}

function group(id, name, extensionIds) {
  return { color: "#000000", extensionIds: extensionIds, fixed: false, id: id, name: name };
}

async function boot(name, drive, options) {
  const device = createDevice(name, drive);
  await settle(120);
  await device.ok({
    type: "SAVE_OPTIONS",
    options: Object.assign({ driveSync: true, driveTimeBasedSync: false }, options || {})
  });
  return device;
}

// The profile editor page writes through ExtensityStorage.saveProfiles directly.
async function saveProfilesDirect(device, map, meta) {
  await device.self.ExtensityStorage.saveProfiles(map, meta);
}

function local(device, key) {
  return plain(device.chrome.storage.local._data[key]);
}

async function profiles(device) {
  return (await device.state()).profiles;
}

function ruleIds(device) {
  return (local(device, "urlRules") || []).map((entry) => entry.id);
}

function driveWrites(drive) {
  return drive.log.filter((line) => /^(PATCH|POST)/.test(line)).length;
}

function driveCategories(drive) {
  return drive.json(drive.only().id).categories;
}

async function sync(device) {
  const response = await device.send({ type: "SYNC_DRIVE" });
  if (!response.ok) {
    return { error: "[" + response.code + "] " + response.error, status: "error" };
  }
  return response.payload.result;
}

function describeResult(result) {
  return result.status
    + (result.reason ? "(" + result.reason + ")" : "")
    + (result.error ? " " + result.error : "")
    + (result.conflicts && result.conflicts.length ? " conflicts=" + result.conflicts.map((c) => c.label).join("|") : "");
}

// Syncs each device in turn until a full round is all noop, or MAX_ROUNDS pass.
async function converge(devices) {
  const trace = [];
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const statuses = [];
    for (const device of devices) {
      statuses.push(device.name + "=" + describeResult(await sync(device)));
    }
    trace.push(statuses.join(" "));
    if (statuses.every((status) => /=noop/.test(status))) {
      break;
    }
  }
  return trace;
}

function assertNoConflicts(trace) {
  trace.forEach((line) => {
    assert.doesNotMatch(line, /conflict|failsafe|error/, "unexpected conflict in trace: " + trace.join(" / "));
  });
}

// One more sync per device must be noop and must not write to Drive.
async function assertSettled(drive, devices) {
  const writesBefore = driveWrites(drive);
  for (const device of devices) {
    const result = await sync(device);
    assert.equal(describeResult(result), "noop", device.name + " did not settle");
  }
  assert.equal(driveWrites(drive), writesBefore, "an idle sync wrote to Drive");
}

test("D5: two devices converge and then stay quiet on a default install", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", extensionId: E1, alias: "One-A" });
  await a.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r1")] });
  await b.ok({ type: "SAVE_ALIAS", extensionId: E2, alias: "Two-B" });
  const trace = await converge([a, b]);
  assertNoConflicts(trace);
  assert.match(trace[trace.length - 1], /A=noop B=noop/, "never reached noop: " + trace.join(" / "));
  assert.deepEqual(local(a, "aliases"), { [E1]: "One-A", [E2]: "Two-B" });
  assert.deepEqual(local(b, "aliases"), local(a, "aliases"));
  assert.deepEqual(ruleIds(b), ["r1"]);
  await assertSettled(drive, [a, b]);
});

test("D1: a profile name containing a colon survives sync on both devices", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await saveProfilesDirect(a, { "Work: dev": [E1, E2], "a:b:c": [E3] }, {});
  const trace = await converge([a, b]);
  for (const device of [a, b]) {
    const map = (await profiles(device)).map;
    assert.deepEqual(plain(map["Work: dev"]).sort(), [E1, E2], device.name + " Work: dev");
    assert.deepEqual(plain(map["a:b:c"]), [E3], device.name + " a:b:c");
    assert.equal(Object.prototype.hasOwnProperty.call(map, "Work"), false, device.name + " grew a Work profile");
    assert.equal(Object.prototype.hasOwnProperty.call(map, "a"), false, device.name + " grew an a profile");
  }
  assertNoConflicts(trace);
  await assertSettled(drive, [a, b]);
});

test("D2: an empty profile survives sync on both devices", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await saveProfilesDirect(a, { Empty: [], Full: [E1] }, {});
  const trace = await converge([a, b]);
  for (const device of [a, b]) {
    const state = await profiles(device);
    assert.deepEqual(plain(state.map.Empty), [], device.name + " lost the empty profile");
    assert.deepEqual(plain(state.map.Full), [E1]);
  }
  assertNoConflicts(trace);
  await assertSettled(drive, [a, b]);
});

test("D2b: members added on both devices settle to one order", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await saveProfilesDirect(a, { Work: [E1, E2] }, {});
  assertNoConflicts(await converge([a, b]));
  await saveProfilesDirect(a, { Work: [E1, E2, E3] }, {});
  await saveProfilesDirect(b, { Work: [E1, E2, E0] }, {});
  assertNoConflicts(await converge([a, b]));
  const workA = plain((await profiles(a)).map.Work);
  const workB = plain((await profiles(b)).map.Work);
  assert.deepEqual(workA.slice().sort(), [E0, E1, E2, E3]);
  assert.deepEqual(workA, workB);
  await assertSettled(drive, [a, b]);
});

test("D3: a stale file ID merges with the file that exists instead of overwriting it", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive, { driveSyncDeletionPolicy: "mirror" });
  const b = await boot("B", drive, { driveSyncDeletionPolicy: "mirror" });
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E3]: "Three" } });
  assertNoConflicts(await converge([a, b]));
  const oldId = drive.only().id;
  // The replacement file was written elsewhere: it lacks E3, which A's baseline (for the old
  // file) still lists, and has E2. Read against the old baseline, mirror would delete E3.
  const content = drive.json(oldId);
  delete content.categories.aliases.data[E3];
  content.categories.aliases.data[E2] = "Two-from-elsewhere";
  drive.files.delete(oldId);
  drive.put("file-replacement", JSON.stringify(content));
  const result = await sync(a);
  assert.notEqual(result.reason, "initial_upload", "replaced the Drive file without merging");
  const expected = { [E1]: "One", [E2]: "Two-from-elsewhere", [E3]: "Three" };
  assert.deepEqual(driveCategories(drive).aliases.data, expected);
  assert.deepEqual(local(a, "aliases"), expected);
  assertNoConflicts(await converge([a, b]));
  assert.deepEqual(local(b, "aliases"), local(a, "aliases"));
  await assertSettled(drive, [a, b]);
});

test("D3: deleting the shared duplicate keeps the other device's data", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  assertNoConflicts(await converge([a, b]));
  const original = drive.only().id;
  drive.put("file-dup", JSON.stringify({ categories: { aliases: { data: { [E2]: "Dup" }, updatedAt: 5 } }, version: "2.0.0" }));
  assert.equal((await sync(a)).reason, "duplicate_remote_files");
  assert.equal((await a.send({ type: "DELETE_DRIVE_FILE", fileId: original })).ok, true);
  await sync(a);
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E3]: "Three-B" } });
  const result = await sync(b);
  assert.notEqual(result.reason, "initial_upload", "B replaced the Drive file without merging");
  assert.deepEqual(driveCategories(drive).aliases.data, { [E1]: "One", [E2]: "Dup", [E3]: "Three-B" });
  assertNoConflicts(await converge([a, b]));
  assert.deepEqual(local(a, "aliases"), { [E1]: "One", [E2]: "Dup", [E3]: "Three-B" });
  assert.deepEqual(local(b, "aliases"), local(a, "aliases"));
  await assertSettled(drive, [a, b]);
});

test("D4: pull succeeds when the Drive file lacks a category enabled here", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  let b = await boot("B", drive, { driveSyncCategories: ALL_CATEGORIES });
  await a.ok({ type: "SAVE_ALIAS", extensionId: E1, alias: "One" });
  await sync(a);
  assert.equal(Object.prototype.hasOwnProperty.call(driveCategories(drive), "history"), false);
  const pulled = await b.uiSync({ direction: "pull" });
  assert.equal(pulled.result.status, "pulled");
  assert.deepEqual(local(b, "aliases"), { [E1]: "One" });
  assert.equal(local(b, "driveSyncTxn"), null);
  assert.equal((await b.uiSync({ direction: "pull" })).result.status, "noop", "a repeated pull re-applied the same file");
  b = await b.restart();
  assert.deepEqual(local(b, "aliases"), { [E1]: "One" });
  assert.equal(local(b, "drivePendingConflict"), null);
  assertNoConflicts(await converge([a, b]));
  await assertSettled(drive, [a, b]);
});

test("D4: the automatic Use Drive strategy pulls without crashing", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive, {
    driveSyncCategories: ALL_CATEGORIES,
    driveSyncStrategy: "overwrite_local",
    driveTimeBasedSync: true
  });
  await a.ok({ type: "SAVE_ALIAS", extensionId: E1, alias: "One" });
  await sync(a);
  await b.fireAlarm("extensity-drive-auto-sync");
  await settle(200);
  assert.deepEqual(local(b, "aliases"), { [E1]: "One" });
  assert.equal((await b.state()).options.lastDriveSyncError, null);
  assert.equal(local(b, "driveSyncTxn"), null);
  const backups = (local(b, "driveSyncBackups") || []).length;
  await b.fireAlarm("extensity-drive-auto-sync");
  await settle(200);
  assert.equal((local(b, "driveSyncBackups") || []).length, backups, "a repeated automatic pull applied the same file again");
  assertNoConflicts(await converge([a, b]));
  await assertSettled(drive, [a, b]);
});

test("D3d: a malformed Drive category is ignored instead of wiping local data", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive, { driveFailsafeEnabled: false, driveSyncDeletionPolicy: "mirror" });
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two" } });
  await sync(a);
  const content = drive.json(drive.only().id);
  content.categories.aliases.data = ["corrupt"];
  drive.put(drive.only().id, JSON.stringify(content));
  await sync(a);
  assert.deepEqual(local(a, "aliases"), { [E1]: "One", [E2]: "Two" });
  assert.deepEqual(driveCategories(drive).aliases.data, { [E1]: "One", [E2]: "Two" });
  await assertSettled(drive, [a]);
});

test("D6: under the default policy a deletion stays on the device that made it", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two", [E3]: "Three" } });
  await a.ok({ type: "SAVE_URL_RULES", urlRules: ["r1", "r2", "r3", "r4", "r5", "r6"].map(rule) });
  await saveProfilesDirect(a, { Play: [E1], Work: [E1, E2, E3] }, {});
  assertNoConflicts(await converge([a, b]));
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two" } });
  await a.ok({ type: "SAVE_URL_RULES", urlRules: ["r1", "r2", "r3", "r4", "r5"].map(rule) });
  await saveProfilesDirect(a, { Work: [E1, E2] }, {});
  assertNoConflicts(await converge([a, b]));
  assert.deepEqual(local(a, "aliases"), { [E1]: "One", [E2]: "Two" });
  assert.deepEqual(ruleIds(a), ["r1", "r2", "r3", "r4", "r5"]);
  const mapA = (await profiles(a)).map;
  assert.deepEqual(plain(mapA.Work).sort(), [E1, E2]);
  assert.equal(Object.prototype.hasOwnProperty.call(mapA, "Play"), false, "deleted profile came back on A");
  // Nothing is removed from the other device.
  assert.deepEqual(local(b, "aliases"), { [E1]: "One", [E2]: "Two", [E3]: "Three" });
  assert.deepEqual(ruleIds(b), ["r1", "r2", "r3", "r4", "r5", "r6"]);
  const mapB = (await profiles(b)).map;
  assert.deepEqual(plain(mapB.Work).sort(), [E1, E2, E3]);
  assert.deepEqual(plain(mapB.Play), [E1]);
  await assertSettled(drive, [a, b]);
});

test("D6: under the default policy delete on one device and edit on the other is not a conflict", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two" } });
  assertNoConflicts(await converge([a, b]));
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two-edited" } });
  assertNoConflicts(await converge([a, b]));
  assert.deepEqual(local(a, "aliases"), { [E1]: "One" });
  assert.deepEqual(local(b, "aliases"), { [E1]: "One", [E2]: "Two-edited" });
  assert.deepEqual(driveCategories(drive).aliases.data, { [E1]: "One", [E2]: "Two-edited" });
  await assertSettled(drive, [a, b]);
});

test("mirror policy propagates deletions to the other device", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive, { driveSyncDeletionPolicy: "mirror" });
  const b = await boot("B", drive, { driveSyncDeletionPolicy: "mirror" });
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two", [E3]: "Three" } });
  await a.ok({ type: "SAVE_URL_RULES", urlRules: ["r1", "r2", "r3", "r4", "r5", "r6"].map(rule) });
  assertNoConflicts(await converge([a, b]));
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two" } });
  await a.ok({ type: "SAVE_URL_RULES", urlRules: ["r1", "r2", "r3", "r4", "r5"].map(rule) });
  assertNoConflicts(await converge([a, b]));
  for (const device of [a, b]) {
    assert.deepEqual(local(device, "aliases"), { [E1]: "One", [E2]: "Two" });
    assert.deepEqual(ruleIds(device), ["r1", "r2", "r3", "r4", "r5"]);
  }
  await assertSettled(drive, [a, b]);
});

test("D7: URL rule reorder and front insertion reach the other device", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_URL_RULES", urlRules: ["r1", "r2", "r3"].map(rule) });
  assertNoConflicts(await converge([a, b]));
  await a.ok({ type: "SAVE_URL_RULES", urlRules: ["r3", "r1", "r2"].map(rule) });
  assertNoConflicts(await converge([a, b]));
  assert.deepEqual(ruleIds(a), ["r3", "r1", "r2"]);
  assert.deepEqual(ruleIds(b), ["r3", "r1", "r2"]);
  await a.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r0")].concat(local(a, "urlRules")) });
  assertNoConflicts(await converge([a, b]));
  assert.deepEqual(ruleIds(a), ["r0", "r3", "r1", "r2"]);
  assert.deepEqual(ruleIds(b), ["r0", "r3", "r1", "r2"]);
  await assertSettled(drive, [a, b]);
});

test("D7: rules added separately on two devices settle to one order", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r1")] });
  await b.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r2")] });
  assertNoConflicts(await converge([a, b]));
  assert.deepEqual(ruleIds(a).slice().sort(), ["r1", "r2"]);
  assert.deepEqual(ruleIds(a), ruleIds(b));
  await assertSettled(drive, [a, b]);
});

test("D7: group order reaches the other device", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_GROUPS", groupOrder: ["g1", "g2"], groups: { g1: group("g1", "G1", [E1]), g2: group("g2", "G2", [E2]) } });
  assertNoConflicts(await converge([a, b]));
  await a.ok({ type: "SAVE_GROUPS", groupOrder: ["g2", "g1"], groups: { g1: group("g1", "G1", [E1, E3]), g2: group("g2", "G2", [E2]) } });
  await b.ok({ type: "SAVE_GROUPS", groupOrder: ["g1", "g2", "g3"], groups: { g1: group("g1", "G1", [E1]), g2: group("g2", "G2", [E2]), g3: group("g3", "G3", [E3]) } });
  assertNoConflicts(await converge([a, b]));
  const orderA = local(a, "groupOrder");
  assert.deepEqual(orderA, local(b, "groupOrder"));
  assert.deepEqual(orderA.slice().sort(), ["g1", "g2", "g3"]);
  assert.ok(orderA.indexOf("g2") < orderA.indexOf("g1"), "A's reorder was reverted: " + orderA.join(","));
  assert.deepEqual(local(b, "groups").g1.extensionIds, [E1, E3]);
  await assertSettled(drive, [a, b]);
});

test("D8: applying different profiles on two devices is not a conflict", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await saveProfilesDirect(a, { X: [E1], Y: [E2] }, {});
  assertNoConflicts(await converge([a, b]));
  await a.ok({ type: "APPLY_PROFILE", profileName: "X" });
  await b.ok({ type: "APPLY_PROFILE", profileName: "Y" });
  assertNoConflicts(await converge([a, b]));
  assert.equal((await a.state()).options.activeProfile, "X");
  assert.equal((await b.state()).options.activeProfile, "Y");
  await assertSettled(drive, [a, b]);
});

test("D8: recolouring different profiles on two devices merges both", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await saveProfilesDirect(a, { X: [E1], Y: [E2] }, {});
  assertNoConflicts(await converge([a, b]));
  await saveProfilesDirect(a, { X: [E1], Y: [E2] }, { X: { color: "#111111" } });
  await saveProfilesDirect(b, { X: [E1], Y: [E2] }, { Y: { color: "#222222" } });
  assertNoConflicts(await converge([a, b]));
  for (const device of [a, b]) {
    const meta = (await profiles(device)).meta;
    assert.equal(meta.X.color, "#111111", device.name + " X colour");
    assert.equal(meta.Y.color, "#222222", device.name + " Y colour");
  }
  await assertSettled(drive, [a, b]);
});

test("D8: device-only options never reach the Drive file", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  await saveProfilesDirect(a, { X: [E1] }, {});
  await a.ok({ type: "APPLY_PROFILE", profileName: "X" });
  await sync(a);
  const options = driveCategories(drive).options.data;
  ["activeProfile", "profileMeta", "migration", "syncMode", "localProfiles", "syncProfilesPartial"].forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(options, key), false, key + " is in the Drive options");
  });
  Object.keys(options).forEach((key) => {
    assert.equal(key.indexOf("migration_"), -1, key + " is in the Drive options");
  });
  await assertSettled(drive, [a]);
});

test("D9: merged history is a sorted rolling log capped at 500 records", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive, { driveSyncCategories: ALL_CATEGORIES });
  const b = await boot("B", drive, { driveSyncCategories: ALL_CATEGORIES });
  const make = (prefix, count, start) => Array.from({ length: count }, (_, index) => ({ action: "manual", id: prefix + "-" + index, label: "", timestamp: start + index * 10 }));
  await a.self.ExtensityStorage.saveLocalState({ eventHistory: make("a", 400, 1000) });
  await b.self.ExtensityStorage.saveLocalState({ eventHistory: make("b", 400, 1005) });
  assertNoConflicts(await converge([a, b]));
  const seeded = make("a", 400, 1000).concat(make("b", 400, 1005)).sort((x, y) => x.timestamp - y.timestamp);
  for (const device of [a, b]) {
    const historyLog = local(device, "eventHistory");
    assert.equal(historyLog.length, 500, device.name + " history length");
    assert.ok(historyLog.every((entry, index) => index === 0 || historyLog[index - 1].timestamp <= entry.timestamp), device.name + " history out of order");
    // Sync audit records are newer than every seeded record; the rest must be the newest seeded ones.
    const kept = historyLog.filter((entry) => /^[ab]-/.test(entry.id)).map((entry) => entry.id);
    assert.deepEqual(kept, seeded.slice(seeded.length - kept.length).map((entry) => entry.id), device.name + " kept the wrong records");
    assert.ok(kept.length >= 490, device.name + " kept only " + kept.length + " seeded records");
  }
  assert.deepEqual(driveCategories(drive).history.data.map((entry) => entry.id), local(a, "eventHistory").map((entry) => entry.id));
  assert.equal(local(b, "drivePendingConflict"), null);
  await assertSettled(drive, [a, b]);
});

test("D9: history on Drive stays bounded over many sync cycles", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive, { driveSyncCategories: ALL_CATEGORIES });
  const b = await boot("B", drive, { driveSyncCategories: ALL_CATEGORIES });
  let timestamp = 1000;
  for (let cycle = 0; cycle < 4; cycle += 1) {
    for (const device of [a, b]) {
      const state = await device.self.ExtensityStorage.loadLocalState();
      const records = Array.from({ length: 200 }, (_, index) => ({ action: "manual", id: device.name + "-" + cycle + "-" + index, label: "", timestamp: (timestamp += 1) }));
      await device.self.ExtensityStorage.saveLocalState({ eventHistory: device.self.ExtensityHistory.appendHistory(state.eventHistory, records) });
      const result = await sync(device);
      assert.doesNotMatch(describeResult(result), /conflict|failsafe|error/);
    }
    assert.ok(driveCategories(drive).history.data.length <= 500, "cycle " + cycle + ": " + driveCategories(drive).history.data.length + " records on Drive");
  }
  assertNoConflicts(await converge([a, b]));
  await assertSettled(drive, [a, b]);
});

test("D9b: with History enabled, idle syncs do not write to Drive", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive, { driveSyncCategories: ALL_CATEGORIES });
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  await sync(a);
  // The audit record of the first run is new history and goes up with the next run; that
  // history-only run must not add another audit record.
  const trace = await converge([a]);
  assert.ok(trace.length <= 2, "history kept the device busy: " + trace.join(" / "));
  await assertSettled(drive, [a]);
  await assertSettled(drive, [a]);
});

test("a category unchecked on one device stays in the Drive file", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive, { driveSyncCategories: { aliases: false, groups: true, history: false, options: true, profiles: true, urlRules: true } });
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E2]: "B-private" } });
  await b.ok({ type: "SAVE_URL_RULES", urlRules: [rule("rB")] });
  await sync(a);
  await sync(b);
  assert.deepEqual(driveCategories(drive).aliases && driveCategories(drive).aliases.data, { [E1]: "One" }, "B stripped Aliases from Drive");
  assertNoConflicts(await converge([a, b]));
  assert.deepEqual(local(a, "aliases"), { [E1]: "One" });
  assert.deepEqual(local(b, "aliases"), { [E2]: "B-private" });
  assert.deepEqual(ruleIds(a), ["rB"]);
  await assertSettled(drive, [a, b]);
});

test("renaming one of two aliases does not pause automatic sync", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive, { driveTimeBasedSync: true });
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two" } });
  assertNoConflicts(await converge([a, b]));
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One-renamed", [E2]: "Two" } });
  await sync(a);
  await b.fireAlarm("extensity-drive-auto-sync");
  await settle(200);
  assert.equal(local(b, "drivePendingConflict"), null, "periodic sync paused on a one-item rename");
  assert.deepEqual(local(b, "aliases"), { [E1]: "One-renamed", [E2]: "Two" });
  assertNoConflicts(await converge([a, b]));
  await assertSettled(drive, [a, b]);
});

test("an interrupted sync leaves a readable recovery notice", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  let b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  assertNoConflicts(await converge([a, b]));
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E3]: "Three-B" } });
  // Fail the post-write verification download once, which keeps the recovery journal.
  let patched = false;
  drive.beforeRequest = async (method, parsed) => {
    if (method === "PATCH") {
      patched = true;
      return null;
    }
    if (patched && parsed.searchParams.get("alt") === "media") {
      drive.beforeRequest = null;
      return drive.respond(200, JSON.stringify({ categories: {}, version: "2.0.0" }), "application/json");
    }
    return null;
  };
  assert.equal((await sync(b)).status, "error");
  b = await b.restart();
  const pending = local(b, "drivePendingConflict");
  assert.equal(pending.reason, "transaction_recovered");
  const describe = b.self.ExtensityDriveSync.describeDrivePendingConflict;
  assert.match(describe(pending), /interrupted/i);
  assert.match(describe({ reason: "transaction_recovery_missing_backup" }), /interrupted/i);
  assert.equal((await b.uiResolve("cancel")).result.status, "cancelled");
  assertNoConflicts(await converge([a, b]));
  await assertSettled(drive, [a, b]);
});

test("SAVE_PROFILES saves through the background and schedules change sync", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive, { driveChangeBasedSync: true });
  await sync(a);
  delete a.alarms["extensity-drive-change-sync"];
  const response = await a.send({ meta: { Work: { color: "#123456" } }, profiles: { Work: [E1] }, type: "SAVE_PROFILES" });
  assert.equal(response.ok, true, response.error);
  a.stopTimers();
  assert.ok(Object.prototype.hasOwnProperty.call(a.alarms, "extensity-drive-change-sync"), "change sync was not scheduled");
  const state = await profiles(a);
  assert.deepEqual(plain(state.map.Work), [E1]);
  assert.equal(state.meta.Work.color, "#123456");
  assertNoConflicts(await converge([a]));
  await assertSettled(drive, [a]);
});

test("SAVE_PROFILES without a profiles map is rejected and changes nothing", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  await saveProfilesDirect(a, { Work: [E1] }, {});
  const response = await a.send({ type: "SAVE_PROFILES" });
  assert.equal(response.ok, false);
  assert.deepEqual(plain((await profiles(a)).map.Work), [E1]);
});

test("the connection test reports conflicts the way a real sync would", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  assertNoConflicts(await converge([a, b]));
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two-B" } });
  await sync(b);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E3]: "Three-A" } });
  const report = (await a.ok({ type: "TEST_DRIVE_CONNECTION" })).report;
  const dryRun = report.steps.find((entry) => entry.name === "dry_run_conflicts");
  assert.equal(dryRun.status, "ok", dryRun.detail);
  assert.equal((await sync(a)).status, "merged");
  assertNoConflicts(await converge([a, b]));
  await assertSettled(drive, [a, b]);
});

test("a first sync that finds identical data still records the baseline", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two" } });
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two" } });
  await sync(a);
  assert.equal((await sync(b)).status, "noop");
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  assertNoConflicts(await converge([a, b]));
  assert.deepEqual(local(b, "aliases"), { [E1]: "One" }, "B's deletion was undone by its next sync");
  await assertSettled(drive, [a, b]);
});

test("history records with equal timestamps settle to one order", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive, { driveSyncCategories: ALL_CATEGORIES });
  const b = await boot("B", drive, { driveSyncCategories: ALL_CATEGORIES });
  await a.self.ExtensityStorage.saveLocalState({ eventHistory: [{ action: "manual", id: "rec-a", label: "", timestamp: 5000 }] });
  await b.self.ExtensityStorage.saveLocalState({ eventHistory: [{ action: "manual", id: "rec-b", label: "", timestamp: 5000 }] });
  assertNoConflicts(await converge([a, b]));
  assert.deepEqual(local(a, "eventHistory").map((entry) => entry.id), local(b, "eventHistory").map((entry) => entry.id));
  await assertSettled(drive, [a, b]);
});

test("under the default policy a profile deleted here stays deleted when the other device adds to it", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await saveProfilesDirect(a, { Work: [E1] }, {});
  assertNoConflicts(await converge([a, b]));
  await saveProfilesDirect(a, {}, {});
  await saveProfilesDirect(b, { Work: [E1, E2] }, {});
  assertNoConflicts(await converge([a, b]));
  assert.equal(Object.prototype.hasOwnProperty.call((await profiles(a)).map, "Work"), false, "the deleted profile came back on A");
  assert.deepEqual(plain((await profiles(b)).map.Work), [E1, E2]);
  assert.deepEqual(driveCategories(drive).profiles.data.map.Work, [E1, E2]);
  await assertSettled(drive, [a, b]);
});

test("memberships stored under the old colon split are left as they are", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  // What the colon bug left behind: profile "Work" holding the member " dev:<id>" (decision D: no repair).
  const damaged = " dev:" + E2;
  await saveProfilesDirect(a, { Work: [E1, damaged] }, {});
  assert.deepEqual(plain((await profiles(a)).map.Work).sort(), [E1, damaged].sort(), "storage rejected the fixture");
  assertNoConflicts(await converge([a, b]));
  for (const device of [a, b]) {
    const map = (await profiles(device)).map;
    assert.deepEqual(plain(map.Work).sort(), [E1, damaged].sort(), device.name + " Work");
    assert.equal(Object.prototype.hasOwnProperty.call(map, "Work: dev"), false, device.name + " moved a membership");
  }
  await assertSettled(drive, [a, b]);
});

test("repeated pulls of a file written by an older version settle", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await saveProfilesDirect(a, { Work: [E1, E2] }, {});
  await sync(a);
  // An older version wrote device-only options and unsorted members into the file.
  const content = drive.json(drive.only().id);
  content.categories.options.data.activeProfile = "Work";
  content.categories.options.data.migration_example = true;
  content.categories.profiles.data.map.Work = [E2, E1];
  drive.put(drive.only().id, JSON.stringify(content));
  assert.equal((await b.uiSync({ direction: "pull" })).result.status, "pulled");
  assert.equal((await b.uiSync({ direction: "pull" })).result.status, "noop", "the second pull applied the same file again");
  assert.notEqual((await b.state()).options.activeProfile, "Work");
});
