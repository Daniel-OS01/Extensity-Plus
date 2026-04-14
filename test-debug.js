const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('js/storage.js', 'utf8');
const context = vm.createContext({ chrome: { storage: { sync: {}, local: {} } } });
context.self = context;
vm.runInContext(code, context);
const result = context.ExtensityStorage.normalizeProfileMap(null);
console.log(Object.keys(result));
