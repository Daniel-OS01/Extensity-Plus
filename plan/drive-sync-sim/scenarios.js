const { FakeDrive, createDevice, plain, settle } = require("./harness");

const E1 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";
const E2 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2";
const E3 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3";
const results = [];
const only = process.argv[2] || "";

function rule(id, extra) {
  return Object.assign({ active: true, disableIds: [], enableIds: [E1], id: id, matchMethod: "wildcard", name: id, timeout: 0, urlPattern: "*://" + id + ".example/*" }, extra || {});
}

async function boot(name, drive, opts) {
  const d = createDevice(name, drive);
  await settle(120);
  await d.ok({ type: "SAVE_OPTIONS", options: Object.assign({ driveSync: true, driveTimeBasedSync: false }, opts || {}) });
  return d;
}

async function saveProfiles(d, map, meta) {
  // The profile editor page writes through ExtensityStorage.saveProfiles directly (js/profiles.js:589).
  await d.self.ExtensityStorage.saveProfiles(map, meta);
}

async function view(d) {
  const s = await d.state();
  const ls = (key) => plain(d.chrome.storage.local._data[key]);
  return {
    aliases: ls("aliases") || {},
    groupOrder: ls("groupOrder") || [],
    groups: Object.keys(ls("groups") || {}),
    history: (ls("eventHistory") || []).length,
    pending: s.options.drivePendingConflict ? s.options.drivePendingConflict.reason : null,
    profiles: s.profiles.map,
    profileMeta: s.profiles.meta,
    rules: (ls("urlRules") || []).map((r) => r.id + ":" + r.name),
    sortMode: s.options.sortMode,
    viewMode: s.options.viewMode
  };
}

async function sync(d, label) {
  const r = await d.send({ type: "SYNC_DRIVE" });
  if (!r.ok) {
    return "ERROR[" + r.code + "] " + r.error;
  }
  const res = r.payload.result;
  return res.status + (res.reason ? "(" + res.reason + ")" : "") + (res.conflicts && res.conflicts.length ? " conflicts=" + res.conflicts.map((c) => c.label).join("|") : "");
}

// Sync A,B alternately until two consecutive rounds are all noop; returns the trace.
async function converge(devices, maxRounds) {
  const trace = [];
  for (let round = 0; round < (maxRounds || 6); round += 1) {
    const statuses = [];
    for (const d of devices) {
      statuses.push(d.name + "=" + await sync(d));
    }
    trace.push(statuses.join(" "));
    if (statuses.every((s) => /=noop/.test(s))) {
      break;
    }
  }
  return trace;
}

function scenario(name, fn) {
  results.push({ fn: fn, name: name });
}

function out(label, value) {
  console.log("   " + label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
}

// ---------------------------------------------------------------------------------------------

scenario("S01 two devices converge and then stay quiet (idempotence)", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", extensionId: E1, alias: "One-A" });
  await a.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r1")] });
  await b.ok({ type: "SAVE_ALIAS", extensionId: E2, alias: "Two-B" });
  await b.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r2")] });
  out("trace", await converge([a, b]));
  const writes = drive.log.filter((l) => /^(PATCH|POST)/.test(l)).length;
  out("A", await view(a));
  out("B", await view(b));
  out("drive writes total", writes);
  const before = drive.only().version;
  out("extra round", await converge([a, b], 1));
  out("version unchanged after extra round", drive.only().version === before);
});

scenario("S02 one-sided edit propagates", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", extensionId: E1, alias: "One" });
  await converge([a, b]);
  await a.ok({ type: "SAVE_ALIAS", extensionId: E1, alias: "Renamed" });
  await a.ok({ type: "SAVE_OPTIONS", options: { sortMode: "alpha" } });
  await b.ok({ type: "SAVE_OPTIONS", options: { viewMode: "grid" } });
  out("trace", await converge([a, b]));
  out("A", await view(a));
  out("B", await view(b));
});

for (const policy of ["additive", "mirror"]) {
  scenario("S03 deletions under policy=" + policy, async () => {
    const drive = new FakeDrive();
    const a = await boot("A", drive, { driveSyncDeletionPolicy: policy });
    const b = await boot("B", drive, { driveSyncDeletionPolicy: policy });
    await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two", [E3]: "Three" } });
    await a.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r1"), rule("r2"), rule("r3"), rule("r4"), rule("r5"), rule("r6")] });
    await saveProfiles(a, { Work: [E1, E2, E3], Play: [E1] }, {});
    out("setup", await converge([a, b]));
    // A deletes one alias, one rule, removes one profile member and deletes a whole profile.
    await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two" } });
    await a.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r1"), rule("r2"), rule("r3"), rule("r4"), rule("r5")] });
    await saveProfiles(a, { Work: [E1, E2] }, {});
    out("A before sync", await view(a));
    out("trace", await converge([a, b]));
    out("A after", await view(a));
    out("B after", await view(b));
  });
}

scenario("S04 empty user profile survives a sync", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await saveProfiles(a, { Empty: [], Full: [E1] }, { Empty: { color: "#ff0000" } });
  out("A before", (await view(a)).profiles);
  out("trace", await converge([a, b]));
  out("A after", (await view(a)).profiles);
  out("B after", (await view(b)).profiles);
  out("B meta", (await view(b)).profileMeta);
});

scenario("S05 profile name containing a colon", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await saveProfiles(a, { "Work: dev": [E1, E2], "a:b:c": [E3] }, {});
  out("A before", (await view(a)).profiles);
  out("trace", await converge([a, b]));
  out("A after", (await view(a)).profiles);
  out("B after", (await view(b)).profiles);
});

scenario("S06 URL rule order: reorder and front insertion", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r1"), rule("r2"), rule("r3")] });
  await converge([a, b]);
  await a.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r3"), rule("r1"), rule("r2")] });
  out("A reordered", (await view(a)).rules);
  out("trace", await converge([a, b]));
  out("A after reorder sync", (await view(a)).rules);
  out("B after reorder sync", (await view(b)).rules);
  await a.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r0-new")].concat(plain(a.chrome.storage.local._data.urlRules)) });
  out("A front insert", (await view(a)).rules);
  out("trace", await converge([a, b]));
  out("A after insert sync", (await view(a)).rules);
  out("B after insert sync", (await view(b)).rules);
});

scenario("S07 profile meta edited for different profiles on each device", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await saveProfiles(a, { X: [E1], Y: [E2] }, {});
  out("setup", await converge([a, b]));
  await saveProfiles(a, { X: [E1], Y: [E2] }, { X: { color: "#111111" } });
  await saveProfiles(b, { X: [E1], Y: [E2] }, { Y: { color: "#222222" } });
  out("trace", await converge([a, b]));
  out("A", await view(a));
  out("B", await view(b));
});

scenario("S08 activeProfile differs per device", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await saveProfiles(a, { X: [E1], Y: [E2] }, {});
  out("setup", await converge([a, b]));
  await a.ok({ type: "APPLY_PROFILE", profileName: "X" });
  await b.ok({ type: "APPLY_PROFILE", profileName: "Y" });
  out("trace", await converge([a, b]));
  out("A active", (await a.state()).options.activeProfile);
  out("B active", (await b.state()).options.activeProfile);
  out("A pending", (await view(a)).pending);
  out("B pending", (await view(b)).pending);
});

for (const resolution of ["keep_local", "keep_remote"]) {
  scenario("S09 same-item conflict resolved with " + resolution, async () => {
    const drive = new FakeDrive();
    const a = await boot("A", drive);
    const b = await boot("B", drive);
    await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two" } });
    out("setup", await converge([a, b]));
    await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One-A", [E2]: "Two", [E3]: "Three-A" } });
    await b.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One-B", [E2]: "Two-B" } });
    out("A sync", await sync(a));
    out("B sync", await sync(b));
    out("B pending", (await view(b)).pending);
    out("B auto-sync while pending", await b.self.ExtensityBackground && "n/a");
    const resolved = await b.uiResolve(resolution);
    out("B resolve", resolved.result && resolved.result.status);
    out("trace", await converge([a, b]));
    out("A", (await view(a)).aliases);
    out("B", (await view(b)).aliases);
    out("B pending after", (await view(b)).pending);
  });
}

scenario("S10 pull when the Drive file lacks a category enabled on this device", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive, { driveSyncCategories: { aliases: true, groups: true, history: true, options: true, profiles: true, urlRules: true } });
  await a.ok({ type: "SAVE_ALIAS", extensionId: E1, alias: "One" });
  out("A sync", await sync(a));
  out("drive categories", Object.keys(drive.json(drive.only().id).categories));
  const r = await b.send({ type: "PREVIEW_DRIVE_SYNC", direction: "pull" });
  out("B preview", r.ok ? r.payload.preview.status : r.error);
  let pulled;
  try {
    pulled = await b.uiSync({ direction: "pull" });
    out("B pull", pulled.result.status);
  } catch (e) {
    out("B pull THREW", e.message);
  }
  out("B aliases after pull", (await view(b)).aliases);
  out("B txn retained", !!(await b.local("driveSyncTxn")));
  out("B lastDriveSyncError", (await b.state()).options.lastDriveSyncError);
  const b2 = await b.restart();
  out("B after restart aliases", (await view(b2)).aliases);
  out("B after restart pending", (await view(b2)).pending);
});

scenario("S10b automatic 'Use Drive' strategy (overwrite_local) with the same missing category", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive, { driveSyncStrategy: "overwrite_local", driveTimeBasedSync: true, driveSyncCategories: { aliases: true, groups: true, history: true, options: true, profiles: true, urlRules: true } });
  await a.ok({ type: "SAVE_ALIAS", extensionId: E1, alias: "One" });
  out("A sync", await sync(a));
  await b.fireAlarm("extensity-drive-auto-sync");
  await settle(200);
  out("B aliases", (await view(b)).aliases);
  out("B lastDriveSyncError", (await b.state()).options.lastDriveSyncError);
  out("B txn retained", !!(await b.local("driveSyncTxn")));
});

scenario("S11 device points at a deleted Drive file while another file exists", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive, { driveSyncDeletionPolicy: "mirror" });
  const b = await boot("B", drive, { driveSyncDeletionPolicy: "mirror" });
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  out("setup", await converge([a, b]));
  const oldId = drive.only().id;
  // The shared file is replaced: old id gone, a new file holds data device A has never seen.
  const content = drive.json(oldId);
  content.categories.aliases.data[E2] = "Two-from-elsewhere";
  drive.files.delete(oldId);
  drive.put("file-replacement", JSON.stringify(content));
  out("A meta.fileId", (await a.local("driveSyncMeta")).fileId + " (drive now has " + drive.only().id + ")");
  out("A sync", await sync(a));
  out("drive aliases after A sync", drive.json(drive.only().id).categories.aliases.data);
  out("A aliases", (await view(a)).aliases);
});

scenario("S12 failsafe sensitivity on small collections (automatic trigger)", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive, { driveTimeBasedSync: true });
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two" } });
  out("setup", await converge([a, b]));
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One-renamed", [E2]: "Two" } });
  out("A sync", await sync(a));
  await b.fireAlarm("extensity-drive-auto-sync");
  await settle(200);
  out("B aliases after periodic sync", (await view(b)).aliases);
  out("B pending", (await view(b)).pending);
  out("B manual sync", await sync(b));
  out("B aliases after manual sync", (await view(b)).aliases);
  out("B pending after manual", (await view(b)).pending);
});

scenario("S12b failsafe on a manual mirror delete of 1 of 4 rules", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive, { driveSyncDeletionPolicy: "mirror" });
  const b = await boot("B", drive, { driveSyncDeletionPolicy: "mirror" });
  await a.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r1"), rule("r2"), rule("r3"), rule("r4")] });
  out("setup", await converge([a, b]));
  await a.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r1"), rule("r2"), rule("r3")] });
  out("A sync", await sync(a));
  out("A pending", (await view(a)).pending);
});

scenario("S13 undo last sync, then sync again", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  out("setup", await converge([a, b]));
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One-renamed", [E2]: "Two" } });
  out("A sync", await sync(a));
  out("B sync", await sync(b));
  out("B after sync", (await view(b)).aliases);
  const undone = await b.send({ type: "RESTORE_DRIVE_SYNC_BACKUP" });
  out("B undo ok", undone.ok ? true : undone.error);
  out("B after undo", (await view(b)).aliases);
  out("trace", await converge([a, b]));
  out("A final", (await view(a)).aliases);
  out("B final", (await view(b)).aliases);
});

scenario("S14 crash between Drive write and local write, then restart", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  let b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  out("setup", await converge([a, b]));
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two-A" } });
  out("A sync", await sync(a));
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E3]: "Three-B" } });
  // Fail the post-write verification download once.
  let patched = false;
  drive.beforeRequest = async (method, parsed) => {
    if (method === "PATCH") { patched = true; return null; }
    if (patched && parsed.searchParams.get("alt") === "media") {
      drive.beforeRequest = null;
      return drive.respond(200, JSON.stringify({ categories: {}, version: "2.0.0" }), "application/json");
    }
    return null;
  };
  out("B sync", await sync(b));
  out("B txn retained", !!(await b.local("driveSyncTxn")));
  out("B aliases", (await view(b)).aliases);
  b = await b.restart();
  out("B pending after restart", (await view(b)).pending);
  out("B aliases after restart", (await view(b)).aliases);
  out("B auto sync blocked", JSON.stringify(await b.self.ExtensityStorage.loadLocalState().then((s) => !!s.drivePendingConflict)));
  out("B manual sync", await sync(b));
  out("B cancel", (await b.uiResolve("cancel")).result.status);
  out("trace", await converge([a, b]));
  out("A final", (await view(a)).aliases);
  out("B final", (await view(b)).aliases);
});

scenario("S15 concurrent writer between read and write", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  out("setup", await converge([a, b]));
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two-A" } });
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E3]: "Three-B" } });
  // While B is mid-sync (after it downloaded the file), A completes a full sync.
  let injected = false;
  drive.beforeRequest = async (method, parsed) => {
    if (!injected && method === "GET" && parsed.searchParams.get("alt") === "media") {
      injected = true;
      const response = await drive.fetch("https://www.googleapis.com" + parsed.pathname + parsed.search, {});
      drive.beforeRequest = null;
      await sync(a);
      return response;
    }
    return null;
  };
  out("B sync", await sync(b));
  out("drive aliases", drive.json(drive.only().id).categories.aliases.data);
  out("trace", await converge([a, b]));
  out("A final", (await view(a)).aliases);
  out("B final", (await view(b)).aliases);
});

scenario("S16 a category disabled on one device", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive, { driveSyncCategories: { aliases: false, groups: true, history: false, options: true, profiles: true, urlRules: true } });
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E2]: "B-private" } });
  await b.ok({ type: "SAVE_URL_RULES", urlRules: [rule("rB")] });
  out("A sync", await sync(a));
  out("B sync", await sync(b));
  out("drive categories after B", Object.keys(drive.json(drive.only().id).categories));
  out("trace", await converge([a, b]));
  out("drive categories final", Object.keys(drive.json(drive.only().id).categories));
  out("A", await view(a));
  out("B", await view(b));
});

scenario("S17 history category: ordering and the 500-record cap", async () => {
  const drive = new FakeDrive();
  const cats = { aliases: true, groups: true, history: true, options: true, profiles: true, urlRules: true };
  const a = await boot("A", drive, { driveSyncCategories: cats });
  const b = await boot("B", drive, { driveSyncCategories: cats });
  const mk = (prefix, n, t0) => Array.from({ length: n }, (_, i) => ({ action: "manual", id: prefix + "-" + i, label: "", timestamp: t0 + i * 10 }));
  await a.self.ExtensityStorage.saveLocalState({ eventHistory: mk("a", 400, 1000) });
  await b.self.ExtensityStorage.saveLocalState({ eventHistory: mk("b", 400, 1005) });
  out("trace", await converge([a, b]));
  const ha = plain(a.chrome.storage.local._data.eventHistory);
  const sorted = ha.every((e, i) => i === 0 || ha[i - 1].timestamp <= e.timestamp);
  out("A history length", ha.length);
  out("A history sorted by timestamp", sorted);
  out("drive bytes", Buffer.byteLength(drive.only().content));
  out("B pending", (await view(b)).pending);
});

scenario("S18 push and pull through the UI preview/confirm flow", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One-A" } });
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One-B", [E2]: "Two-B" } });
  out("A push (first)", (await a.uiSync({ direction: "push" })).result.status);
  out("B pull", (await b.uiSync({ direction: "pull" })).result.status);
  out("B aliases", (await view(b)).aliases);
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E3]: "Three-B" } });
  out("B push", (await b.uiSync({ direction: "push" })).result.status);
  out("drive aliases", drive.json(drive.only().id).categories.aliases.data);
  out("A sync after B push", await sync(a));
  out("A aliases", (await view(a)).aliases);
  out("A pending", (await view(a)).pending);
});

scenario("S19 duplicate Drive files, delete one, resume", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  out("setup", await converge([a, b]));
  const original = drive.only().id;
  drive.put("file-dup", JSON.stringify({ categories: { aliases: { data: { [E2]: "Dup" }, updatedAt: 5 } }, version: "2.0.0" }));
  out("A sync", await sync(a));
  out("A pending", (await view(a)).pending);
  // User deletes the ORIGINAL (the one both devices point at) from A's conflict panel.
  out("A delete original", (await a.send({ type: "DELETE_DRIVE_FILE", fileId: original })).ok);
  out("A pending after delete", (await view(a)).pending);
  out("A sync", await sync(a));
  out("A aliases", (await view(a)).aliases);
  out("drive after A", drive.json(drive.only().id).categories.aliases.data);
  out("B meta.fileId", (await b.local("driveSyncMeta")).fileId + " vs drive " + drive.only().id);
  await b.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E3]: "Three-B" } });
  out("B sync", await sync(b));
  out("drive after B", drive.json(drive.only().id).categories.aliases.data);
  out("B aliases", (await view(b)).aliases);
});

scenario("S20 legacy v1 Drive file meets a fresh device", async () => {
  const drive = new FakeDrive();
  drive.put("file-v1", JSON.stringify({ categories: { aliases: { data: { [E2]: "Legacy" }, updatedAt: 5 } }, exportedAt: 5, version: "1.0.0", writerId: "old" }));
  const a = await boot("A", drive);
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  out("A sync", await sync(a));
  out("A aliases", (await view(a)).aliases);
  out("drive version field", drive.json("file-v1").version);
  out("A sync again", await sync(a));
});

scenario("S21 groups: independent edits and order", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive);
  const b = await boot("B", drive);
  const g = (name, ids) => ({ color: "#000000", extensionIds: ids, fixed: false, name: name });
  await a.ok({ type: "SAVE_GROUPS", groups: { g1: g("G1", [E1]), g2: g("G2", [E2]) }, groupOrder: ["g1", "g2"] });
  out("setup", await converge([a, b]));
  out("stored group", plain(a.chrome.storage.local._data.groups).g1);
  await a.ok({ type: "SAVE_GROUPS", groups: { g1: g("G1", [E1, E3]), g2: g("G2", [E2]) }, groupOrder: ["g2", "g1"] });
  await b.ok({ type: "SAVE_GROUPS", groups: { g1: g("G1", [E1]), g2: g("G2", [E2]), g3: g("G3", [E3]) }, groupOrder: ["g1", "g2", "g3"] });
  out("trace", await converge([a, b]));
  out("A", { order: (await view(a)).groupOrder, g1: plain(a.chrome.storage.local._data.groups).g1.extensionIds });
  out("B", { order: (await view(b)).groupOrder, g1: plain(b.chrome.storage.local._data.groups).g1.extensionIds });
});

scenario("S22 change-triggered auto sync fires after a background-routed edit", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive, { driveChangeBasedSync: true });
  out("A first sync", await sync(a));
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
  out("change alarm armed after SAVE_ALIAS", Object.keys(a.alarms));
  await a.fireAlarm("extensity-drive-change-sync");
  await settle(200);
  out("drive aliases", drive.json(drive.only().id).categories.aliases.data);
  delete a.alarms["extensity-drive-change-sync"];
  await saveProfiles(a, { Work: [E1] }, {});
  await settle(50);
  out("change alarm armed after profile-editor save", Object.keys(a.alarms));
  a.stopTimers();
});

scenario("S23 malformed remote category under mirror policy", async () => {
  const drive = new FakeDrive();
  const a = await boot("A", drive, { driveSyncDeletionPolicy: "mirror", driveFailsafeEnabled: false });
  await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One", [E2]: "Two" } });
  out("A sync", await sync(a));
  const content = drive.json(drive.only().id);
  content.categories.aliases.data = ["corrupt"];
  drive.put(drive.only().id, JSON.stringify(content));
  out("A sync", await sync(a));
  out("A aliases", (await view(a)).aliases);
  out("drive aliases", drive.json(drive.only().id).categories.aliases.data);
});

(async () => {
  for (const s of results) {
    if (only && s.name.indexOf(only) !== 0) {
      continue;
    }
    console.log("\n== " + s.name);
    try {
      await s.fn();
    } catch (error) {
      console.log("   !! SCENARIO THREW: " + (error && error.stack || error));
    }
  }
  process.exit(0);
})();
