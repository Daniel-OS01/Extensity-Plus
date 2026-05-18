(function(root) {
  var LEVEL_RANK = { none: 0, error: 1, warn: 2, info: 3, debug: 4 };
  var LEVELS = ["none", "error", "warn", "info", "debug"];
  var MAX_ENTRIES = 200;
  var MAX_SHARED = 300;
  var STORAGE_KEY = "logLevel";
  var SHARED_KEY = "extensityLog";
  var DEFAULT_LEVEL = "warn";

  var _level = DEFAULT_LEVEL;
  var _entries = [];
  var _listeners = [];

  function setLevel(level) {
    _level = LEVEL_RANK.hasOwnProperty(level) ? level : DEFAULT_LEVEL;
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.set === "function"
    ) {
      var patch = {};
      patch[STORAGE_KEY] = _level;
      chrome.storage.local.set(patch);
    }
  }

  function getLevel() {
    return _level;
  }

  function shouldLog(entryLevel) {
    return LEVEL_RANK[_level] >= LEVEL_RANK[entryLevel];
  }

  function writeShared(entry) {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local ||
      typeof chrome.storage.local.get !== "function"
    ) {
      return;
    }
    var defaults = {};
    defaults[SHARED_KEY] = [];
    chrome.storage.local.get(defaults, function(result) {
      var list = Array.isArray(result[SHARED_KEY]) ? result[SHARED_KEY] : [];
      list.push(entry);
      if (list.length > MAX_SHARED) {
        list = list.slice(list.length - MAX_SHARED);
      }
      var patch = {};
      patch[SHARED_KEY] = list;
      chrome.storage.local.set(patch);
    });
  }

  function appendEntry(level, message, data) {
    if (!shouldLog(level)) {
      return;
    }
    var entry = {
      level: level,
      message: String(message || ""),
      data: data !== undefined ? data : null,
      timestamp: new Date().toISOString()
    };
    _entries.push(entry);
    if (_entries.length > MAX_ENTRIES) {
      _entries.shift();
    }
    for (var i = 0; i < _listeners.length; i++) {
      _listeners[i](entry);
    }
    writeShared(entry);
  }

  function info(message, data) {
    appendEntry("info", message, data);
  }

  function warn(message, data) {
    appendEntry("warn", message, data);
  }

  function error(message, data) {
    appendEntry("error", message, data);
  }

  function debug(message, data) {
    appendEntry("debug", message, data);
  }

  function getEntries() {
    return _entries.slice();
  }

  function clearEntries() {
    _entries = [];
  }

  function subscribe(fn) {
    if (typeof fn === "function") {
      _listeners.push(fn);
    }
  }

  function loadLevel(callback) {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === "function"
    ) {
      chrome.storage.local.get(STORAGE_KEY, function(result) {
        var saved = result && result[STORAGE_KEY];
        if (LEVEL_RANK.hasOwnProperty(saved)) {
          _level = saved;
        }
        if (typeof callback === "function") {
          callback(_level);
        }
      });
    } else {
      if (typeof callback === "function") {
        callback(_level);
      }
    }
  }

  function readShared(callback) {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local ||
      typeof chrome.storage.local.get !== "function"
    ) {
      callback([]);
      return;
    }
    var defaults = {};
    defaults[SHARED_KEY] = [];
    chrome.storage.local.get(defaults, function(result) {
      callback(Array.isArray(result[SHARED_KEY]) ? result[SHARED_KEY] : []);
    });
  }

  function clearShared() {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.remove === "function"
    ) {
      chrome.storage.local.remove(SHARED_KEY);
    }
  }

  root.ExtensityLogger = {
    LEVELS: LEVELS,
    clearEntries: clearEntries,
    clearShared: clearShared,
    debug: debug,
    error: error,
    getEntries: getEntries,
    getLevel: getLevel,
    info: info,
    loadLevel: loadLevel,
    readShared: readShared,
    setLevel: setLevel,
    subscribe: subscribe,
    warn: warn
  };
})(typeof window !== "undefined" ? window : self);
