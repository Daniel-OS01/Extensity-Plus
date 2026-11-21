const { FakeDrive, createDevice, plain, settle } = require("./harness");
const E1 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1", E2 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2", E3 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3";
const rule = (id) => ({ active: true, disableIds: [], enableIds: [E1], id, matchMethod: "wildcard", name: id, timeout: 0, urlPattern: "*://" + id + ".example/*" });
const FULL = { __always_on: [E1], __base: [E1], __favorites: [E1] };
async function boot(name, drive, opts, unmask) {
  const d = createDevice(name, drive); await settle(120);
  await d.ok({ type: "SAVE_OPTIONS", options: Object.assign({ driveSync: true, driveTimeBasedSync: false }, opts || {}) });
  if (unmask) { await d.self.ExtensityStorage.saveProfiles(FULL, {}); }
  return d;
}
async function sync(d) { const r = await d.send({ type: "SYNC_DRIVE" }); return r.ok ? r.payload.result.status + (r.payload.result.conflicts && r.payload.result.conflicts.length ? "[" + r.payload.result.conflicts.map(c => c.label).join("|") + "]" : "") : "ERROR " + r.error; }
async function rounds(devs, n) { const t = []; for (let i = 0; i < n; i++) { const s = []; for (const d of devs) s.push(d.name + "=" + await sync(d)); t.push(s.join(" ")); } return t; }
const writes = (drive) => drive.log.filter(l => /^(PATCH|POST)/.test(l)).length;
(async () => {
  { console.log("\n(a) reserved profiles non-empty -> does sync settle to noop?");
    const drive = new FakeDrive(); const a = await boot("A", drive, {}, true); const b = await boot("B", drive, {}, true);
    await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
    console.log("  ", JSON.stringify(await rounds([a, b], 4)), "writes:", writes(drive)); }
  { console.log("\n(b) same rules, different order on each device");
    const drive = new FakeDrive(); const a = await boot("A", drive, {}, true); const b = await boot("B", drive, {}, true);
    await a.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r1")] }); await b.ok({ type: "SAVE_URL_RULES", urlRules: [rule("r2")] });
    console.log("  ", JSON.stringify(await rounds([a, b], 5)));
    const w0 = writes(drive); await rounds([a, b], 3);
    console.log("   extra Drive writes over 3 more rounds:", writes(drive) - w0,
      "A:", plain(a.chrome.storage.local._data.urlRules).map(r => r.id), "B:", plain(b.chrome.storage.local._data.urlRules).map(r => r.id)); }
  { console.log("\n(c) aliases unchecked on B only");
    const drive = new FakeDrive(); const a = await boot("A", drive, {}, true);
    const b = await boot("B", drive, { driveSyncCategories: { aliases: false, groups: true, history: false, options: true, profiles: true, urlRules: true } }, true);
    await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
    console.log("  ", JSON.stringify(await rounds([a, b], 3)));
    await b.ok({ type: "SAVE_URL_RULES", urlRules: [rule("rB")] });
    console.log("   B edits a rule then syncs:", await sync(b), "-> drive categories:", Object.keys(drive.json(drive.only().id).categories).join(","));
    console.log("  ", JSON.stringify(await rounds([a, b], 3)), "-> drive categories:", Object.keys(drive.json(drive.only().id).categories).join(",")); }
  { console.log("\n(d) default install (empty reserved profiles): backup ring + undo after idle syncs");
    const drive = new FakeDrive(); const a = await boot("A", drive); const b = await boot("B", drive);
    await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "One" } });
    await rounds([a, b], 2);
    await a.ok({ type: "SAVE_ALIAS", aliases: { [E1]: "RENAMED-ON-A" } }); await sync(a);
    console.log("   B receives the rename:", await sync(b), JSON.stringify(plain(b.chrome.storage.local._data.aliases)));
    const hist0 = plain(b.chrome.storage.local._data.eventHistory).length;
    const syncWrites0 = b.chrome.storage.sync._data.syncOptionsUpdatedAt;
    console.log("   3 idle syncs on B:", JSON.stringify(await rounds([b], 3)));
    const backups = plain(b.chrome.storage.local._data.driveSyncBackups);
    console.log("   backups kept:", backups.length, "aliases inside each backup:", backups.map(x => JSON.stringify(x.localBackup.aliases)).join(" "));
    console.log("   history entries added by idle syncs:", plain(b.chrome.storage.local._data.eventHistory).length - hist0,
      "| chrome.storage.sync options rewritten:", b.chrome.storage.sync._data.syncOptionsUpdatedAt !== syncWrites0);
    await b.ok({ type: "RESTORE_DRIVE_SYNC_BACKUP" });
    console.log("   after 'Undo last sync' on B:", JSON.stringify(plain(b.chrome.storage.local._data.aliases))); }
  { console.log("\n(e) fresh second device, first device changed one option");
    const drive = new FakeDrive(); const a = await boot("A", drive, { sortMode: "alpha" }, true); const b = await boot("B", drive, {}, true);
    console.log("  ", JSON.stringify(await rounds([a, b], 1))); }
  { console.log("\n(f) history enabled, additive policy: growth over time");
    const cats = { aliases: true, groups: true, history: true, options: true, profiles: true, urlRules: true };
    const drive = new FakeDrive(); const a = await boot("A", drive, { driveSyncCategories: cats }, true); const b = await boot("B", drive, { driveSyncCategories: cats }, true);
    const H = a.self.ExtensityHistory; let t = 1000;
    for (let cycle = 0; cycle < 6; cycle++) {
      for (const d of [a, b]) {
        const ls = await d.self.ExtensityStorage.loadLocalState();
        const recs = Array.from({ length: 200 }, (_, i) => ({ action: "manual", id: d.name + "-" + cycle + "-" + i, label: "", timestamp: (t += 1) }));
        await d.self.ExtensityStorage.saveLocalState({ eventHistory: d.self.ExtensityHistory.appendHistory(ls.eventHistory, recs) });
        await sync(d);
      }
      console.log("   cycle", cycle, "local A/B:", plain(a.chrome.storage.local._data.eventHistory).length, plain(b.chrome.storage.local._data.eventHistory).length,
        "drive records:", drive.json(drive.only().id).categories.history.data.length, "drive bytes:", Buffer.byteLength(drive.only().content));
    } }
  { console.log("\n(g) groups");
    const drive = new FakeDrive(); const a = await boot("A", drive, {}, true); const b = await boot("B", drive, {}, true);
    const g = (id, name, ids) => ({ color: "#000000", extensionIds: ids, fixed: false, id, name });
    await a.ok({ type: "SAVE_GROUPS", groups: { g1: g("g1", "G1", [E1]), g2: g("g2", "G2", [E2]) }, groupOrder: ["g1", "g2"] });
    await rounds([a, b], 2);
    await a.ok({ type: "SAVE_GROUPS", groups: { g1: g("g1", "G1", [E1, E3]), g2: g("g2", "G2", [E2]) }, groupOrder: ["g2", "g1"] });
    await b.ok({ type: "SAVE_GROUPS", groups: { g1: g("g1", "G1", [E1]), g2: g("g2", "G2", [E2]), g3: g("g3", "G3", [E3]) }, groupOrder: ["g1", "g2", "g3"] });
    console.log("  ", JSON.stringify(await rounds([a, b], 4)));
    for (const d of [a, b]) console.log("   ", d.name, JSON.stringify(plain(d.chrome.storage.local._data.groupOrder)), JSON.stringify(Object.values(plain(d.chrome.storage.local._data.groups)).map(x => x.id + ":" + x.extensionIds.length))); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
