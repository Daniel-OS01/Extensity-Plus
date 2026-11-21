const { FakeDrive, createDevice, plain, settle } = require("./harness");
const E1 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1", E2 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2", E3 = "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3";
const FULL = { __always_on: [E1], __base: [E1], __favorites: [E1] };
async function boot(name, drive, opts) {
  const d = createDevice(name, drive); await settle(120);
  await d.ok({ type: "SAVE_OPTIONS", options: Object.assign({ driveSync: true, driveTimeBasedSync: false }, opts || {}) });
  await d.self.ExtensityStorage.saveProfiles(FULL, {});
  return d;
}
async function sync(d) { const r = await d.send({ type: "SYNC_DRIVE" }); return r.ok ? r.payload.result.status : "ERROR " + r.error; }
(async () => {
  const cats = { aliases: true, groups: true, history: true, options: true, profiles: true, urlRules: true };
  { const drive = new FakeDrive(); const a = await boot("A", drive, { driveSyncCategories: cats });
    const t = []; for (let i = 0; i < 6; i++) t.push(await sync(a));
    console.log("history enabled, single device, 6 idle syncs:", t.join(" "), "| drive writes:", drive.log.filter(l => /^(PATCH|POST)/.test(l)).length); }
  { const drive = new FakeDrive(); const a = await boot("A", drive); const b = await boot("B", drive);
    await a.self.ExtensityStorage.saveProfiles(Object.assign({}, FULL, { Work: [E1, E2] }), {});
    await sync(a); await sync(b);
    await a.self.ExtensityStorage.saveProfiles(Object.assign({}, FULL, { Work: [E1, E2, E3] }), {});
    await b.self.ExtensityStorage.saveProfiles(Object.assign({}, FULL, { Work: [E1, E2, "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0"] }), {});
    const t = []; for (let i = 0; i < 4; i++) { t.push("A=" + await sync(a)); t.push("B=" + await sync(b)); }
    console.log("profile member order:", t.join(" "));
    console.log("  A", JSON.stringify((await a.state()).profiles.map.Work.map(x => x.slice(-1))), "B", JSON.stringify((await b.state()).profiles.map.Work.map(x => x.slice(-1)))); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
