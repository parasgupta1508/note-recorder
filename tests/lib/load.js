// Loads the app's pure logic (js/core/*.js, in the order index.html lists them) into a Node vm context, so tests run the exact files that ship.
// const lib = require('./lib/load.js'); lib.yin(...), lib.REC_MODES ... : any top-level function, class, const or let of the core files.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const files = [...html.matchAll(/src="(js\/core\/[^"]+)"/g)].map(m => m[1]);
const ctx = vm.createContext({ console, Math, performance: { now: () => Date.now() }, setTimeout, clearTimeout });
for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
module.exports = new Proxy({ root }, { get: (t, name) => (name in t ? t[name] : typeof name === 'string' ? vm.runInContext(`typeof ${name} === 'undefined' ? undefined : ${name}`, ctx) : undefined) });
