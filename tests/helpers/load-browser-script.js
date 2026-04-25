const fs = require("node:fs");
const vm = require("node:vm");

function loadBrowserScript(filePath, globals = {}) {
  const code = fs.readFileSync(filePath, "utf8");
  const sandbox = {
    URL,
    URLSearchParams,
    console,
    Date,
    JSON,
    Math,
    Object,
    Array,
    RegExp,
    clearTimeout,
    setTimeout,
    ...globals
  };

  if (!sandbox.self) {
    sandbox.self = {};
  }

  sandbox.globalThis = sandbox.self;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: filePath });
  return sandbox.self;
}

module.exports = {
  loadBrowserScript
};
