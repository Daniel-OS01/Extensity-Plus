// Integration harness: real js/*.js modules in a vm sandbox per "device", sharing one fake Drive.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = process.env.EXTENSITY_REPO || "C:/Users/Daniel/Extensity-Plus";

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class FakeDrive {
  constructor() {
    this.files = new Map();
    this.nextId = 1;
    this.clock = Date.parse("2026-11-21T10:00:00Z");
    this.log = [];
    this.beforeRequest = null; // async hook(method, url) -> optional Response-like override
  }

  tick() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  put(id, content, name) {
    const existing = this.files.get(id);
    this.files.set(id, {
      content: content,
      id: id,
      modifiedTime: this.tick(),
      name: name || (existing && existing.name) || "extensity-plus-sync.json",
      version: existing ? existing.version + 1 : 1
    });
    return this.files.get(id);
  }

  json(id) {
    const file = this.files.get(id);
    return file ? JSON.parse(file.content) : null;
  }

  only() {
    if (this.files.size !== 1) {
      throw new Error("expected exactly one Drive file, found " + this.files.size);
    }
    return Array.from(this.files.values())[0];
  }

  meta(file) {
    return {
      id: file.id,
      modifiedTime: file.modifiedTime,
      name: file.name,
      size: String(Buffer.byteLength(file.content)),
      version: String(file.version)
    };
  }

  respond(status, body, contentType) {
    const text = typeof body === "string" ? body : JSON.stringify(body === undefined ? null : body);
    return {
      headers: {
        get(name) {
          return String(name).toLowerCase() === "content-type" ? (contentType || "application/json") : null;
        }
      },
      json: async () => JSON.parse(text),
      ok: status >= 200 && status < 300,
      status: status,
      text: async () => text
    };
  }

  async fetch(url, init) {
    const method = (init && init.method) || "GET";
    const parsed = new URL(url);
    this.log.push(method + " " + parsed.pathname + parsed.search.slice(0, 60));
    if (this.beforeRequest) {
      const override = await this.beforeRequest(method, parsed, init);
      if (override) {
        return override;
      }
    }
    const p = parsed.pathname;
    if (p === "/drive/v3/files/generateIds") {
      return this.respond(200, { ids: ["file-" + this.nextId++] });
    }
    if (p === "/drive/v3/files" && method === "GET") {
      const files = Array.from(this.files.values())
        .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))
        .map((f) => this.meta(f));
      return this.respond(200, { files: files });
    }
    if (p === "/upload/drive/v3/files" && method === "POST") {
      const body = String(init.body);
      const boundary = /boundary=(.+)$/.exec(init.headers["Content-Type"])[1];
      const parts = body.split("--" + boundary).slice(1, -1).map((part) => part.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, ""));
      const metadata = JSON.parse(parts[0]);
      if (this.files.has(metadata.id)) {
        return this.respond(409, { error: "conflict" });
      }
      this.put(metadata.id, parts[1], metadata.name);
      return this.respond(200, { id: metadata.id });
    }
    let match = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (match && method === "PATCH") {
      const id = decodeURIComponent(match[1]);
      if (!this.files.has(id)) {
        return this.respond(404, { error: "not found" });
      }
      return this.respond(200, this.meta(this.put(id, String(init.body))));
    }
    match = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const file = this.files.get(id);
      if (!file) {
        return this.respond(404, { error: "not found" });
      }
      if (method === "DELETE") {
        this.files.delete(id);
        return this.respond(204, "", "text/plain");
      }
      if (parsed.searchParams.get("alt") === "media") {
        return this.respond(200, file.content, "application/json");
      }
      return this.respond(200, this.meta(file));
    }
    throw new Error("FakeDrive: unhandled " + method + " " + url);
  }
}

function makeStorageArea(areaName, listeners) {
  const data = {};
  function pick(keys) {
    if (keys == null) {
      return plain(data);
    }
    const out = {};
    if (typeof keys === "string") {
      if (Object.prototype.hasOwnProperty.call(data, keys)) { out[keys] = plain(data[keys]); }
      return out;
    }
    if (Array.isArray(keys)) {
      keys.forEach((k) => { if (Object.prototype.hasOwnProperty.call(data, k)) { out[k] = plain(data[k]); } });
      return out;
    }
    Object.keys(keys).forEach((k) => {
      out[k] = Object.prototype.hasOwnProperty.call(data, k) ? plain(data[k]) : keys[k];
    });
    return out;
  }
  return {
    _data: data,
    QUOTA_BYTES: areaName === "sync" ? 102400 : 10485760,
    QUOTA_BYTES_PER_ITEM: 8192,
    get(keys, cb) {
      const result = pick(keys);
      if (typeof cb === "function") { cb(result); return undefined; }
      return Promise.resolve(result);
    },
    getBytesInUse(keys, cb) {
      const size = Buffer.byteLength(JSON.stringify(pick(keys)));
      if (typeof cb === "function") { cb(size); return undefined; }
      return Promise.resolve(size);
    },
    remove(keys, cb) {
      [].concat(keys).forEach((k) => { delete data[k]; });
      if (typeof cb === "function") { cb(); return undefined; }
      return Promise.resolve();
    },
    set(values, cb) {
      const changes = {};
      Object.keys(values).forEach((k) => {
        changes[k] = { newValue: plain(values[k]), oldValue: plain(data[k]) };
        data[k] = plain(values[k]);
      });
      listeners.forEach((fn) => fn(changes, areaName));
      if (typeof cb === "function") { cb(); return undefined; }
      return Promise.resolve();
    }
  };
}

function event() {
  const fns = [];
  return { _fns: fns, addListener(fn) { fns.push(fn); } };
}

function createDevice(name, drive, config = {}) {
  const storageListeners = [];
  const extensions = (config.extensions || ["extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1", "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2", "extaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3"]).map((id) => ({
    description: "", enabled: true, homepageUrl: "", icons: [], id: id, installType: "normal",
    mayDisable: true, name: "Ext " + id.slice(-1), optionsUrl: "", type: "extension", version: "1.0"
  }));
  const alarms = {};
  const errors = [];
  const chrome = {
    alarms: {
      _alarms: alarms,
      clear(alarmName, cb) { delete alarms[alarmName]; if (cb) { cb(true); } },
      create(alarmName, info) { alarms[alarmName] = info; },
      onAlarm: event()
    },
    commands: { onCommand: event() },
    contextMenus: { create() {}, onClicked: event(), removeAll(cb) { if (cb) { cb(); } } },
    identity: {
      getAuthToken(details, cb) { cb("token-" + name); },
      getRedirectURL(p) { return "https://x.chromiumapp.org/" + (p || ""); },
      removeCachedAuthToken(details, cb) { if (cb) { cb(); } }
    },
    management: {
      get(id, cb) { cb(extensions.find((e) => e.id === id)); },
      getAll(cb) { cb(plain(extensions)); },
      getSelf(cb) { cb({ id: "self-" + name, installType: "normal" }); },
      onDisabled: event(), onEnabled: event(), onInstalled: event(), onUninstalled: event(),
      setEnabled(id, enabled, cb) { extensions.find((e) => e.id === id).enabled = enabled; if (cb) { cb(); } }
    },
    notifications: { clear() {}, create() {} },
    permissions: { contains(o, cb) { cb(false); } },
    runtime: {
      getManifest() {
        return { oauth2: { client_id: "775277874801-testclient.apps.googleusercontent.com" }, version: "4.7.4" };
      },
      id: "self-" + name,
      lastError: null,
      onInstalled: event(), onMessage: event(), onStartup: event(),
      sendMessage() { return Promise.resolve(); }
    },
    storage: { onChanged: { addListener(fn) { storageListeners.push(fn); } } },
    tabs: {
      create() {}, get() {}, onActivated: event(), onRemoved: event(), onUpdated: event(),
      query(q, cb) { if (cb) { cb([]); } }, remove() {}, sendMessage() {}, update() {}
    },
    webNavigation: { onHistoryStateUpdated: event() }
  };
  chrome.storage.local = makeStorageArea("local", storageListeners);
  chrome.storage.sync = makeStorageArea("sync", storageListeners);
  if (config.seed) {
    Object.assign(chrome.storage.local._data, plain(config.seed.local));
    Object.assign(chrome.storage.sync._data, plain(config.seed.sync));
  }

  const timers = [];
  const self = {};
  const sandbox = {
    AbortController, Array, Date, JSON, Math, Object, RegExp, TextEncoder, URL, URLSearchParams,
    chrome: chrome,
    clearTimeout(id) { clearTimeout(id); },
    console: {
      debug() {}, info() {}, log() {},
      error(...args) { errors.push(args.map(String).join(" ")); },
      warn() {}
    },
    crypto: require("node:crypto").webcrypto,
    fetch: (url, init) => drive.fetch(url, init),
    importScripts(...files) {
      files.forEach((file) => {
        const full = path.join(repoRoot, "js", file);
        vm.runInContext(fs.readFileSync(full, "utf8"), sandbox, { filename: full });
      });
    },
    navigator: {},
    self: self,
    setTimeout(fn, ms) { const id = setTimeout(fn, ms); id.unref(); timers.push(id); return id; }
  };
  sandbox.globalThis = self;
  vm.createContext(sandbox);
  const bg = path.join(repoRoot, "js", "background.js");
  vm.runInContext(fs.readFileSync(bg, "utf8"), sandbox, { filename: bg });

  const device = {
    alarms: alarms,
    chrome: chrome,
    errors: errors,
    name: name,
    self: self,
    async local(key) { return plain(chrome.storage.local._data[key]); },
    async send(message) {
      const response = await new Promise((resolve) => {
        chrome.runtime.onMessage._fns[0](message, {}, resolve);
      });
      return plain(response);
    },
    async ok(message) {
      const response = await device.send(message);
      if (!response.ok) {
        throw new Error(name + " " + message.type + " failed: [" + response.code + "] " + response.error);
      }
      return response.payload;
    },
    async state() { return (await device.ok({ type: "GET_STATE" })).state; },
    async fireAlarm(alarmName) {
      chrome.alarms.onAlarm._fns.forEach((fn) => fn({ name: alarmName }));
      await new Promise((r) => setTimeout(r, 60));
    },
    stopTimers() { timers.forEach((t) => clearTimeout(t)); },
    // Simulates a service-worker/browser restart: fresh module state, same persisted storage.
    async restart() {
      device.stopTimers();
      const next = createDevice(name, drive, Object.assign({}, config, {
        seed: { local: chrome.storage.local._data, sync: chrome.storage.sync._data }
      }));
      await settle(120);
      return next;
    },
    // Mirrors ExtensityApi.syncDrive in js/engine.js (push/pull go through preview + confirm).
    async uiSync(options) {
      const payload = { type: "SYNC_DRIVE" };
      if (options && options.direction) { payload.direction = options.direction; }
      if (payload.direction === "push" || payload.direction === "pull") {
        const previewPayload = await device.ok(Object.assign({}, payload, { type: "PREVIEW_DRIVE_SYNC" }));
        const preview = previewPayload.preview;
        if (!preview || preview.status !== "preview") { return { result: preview, state: previewPayload.state }; }
        payload.confirmationToken = preview.confirmationToken;
        payload.overrideFailsafe = !!(options && options.overrideFailsafe);
        payload.requireConfirmation = true;
      }
      return device.ok(payload);
    },
    // Mirrors ExtensityApi.resolveDriveConflict in js/engine.js.
    async uiResolve(resolution, overrideFailsafe) {
      if (resolution === "cancel") { return device.ok({ resolution: "cancel", type: "RESOLVE_DRIVE_CONFLICT" }); }
      const previewPayload = await device.ok({ direction: "sync", resolution: resolution, type: "PREVIEW_DRIVE_SYNC" });
      const preview = previewPayload.preview;
      if (!preview || preview.status !== "preview") { return { result: preview, state: previewPayload.state }; }
      return device.ok({ confirmationToken: preview.confirmationToken, overrideFailsafe: !!overrideFailsafe, resolution: resolution, type: "RESOLVE_DRIVE_CONFLICT" });
    }
  };
  return device;
}

async function settle(ms = 30) {
  await new Promise((r) => setTimeout(r, ms));
}

module.exports = { FakeDrive, createDevice, plain, settle };
