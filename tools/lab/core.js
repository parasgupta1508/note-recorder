// Loads the app's pure logic (js/core/*.js) so the helper server writes MIDI with the exact same code the app and the tests use.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ctx = vm.createContext({ console, Math });
for (const f of [...html.matchAll(/src="(js\/core\/[^"]+)"/g)].map(m => m[1])) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
module.exports = { root, writeMidi: vm.runInContext('writeMidi', ctx), parseMidi: vm.runInContext('parseMidi', ctx) };
