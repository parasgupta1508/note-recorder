// Keeps the project layout honest. node tests/structure.js
//  - every file index.html and the manifest point to exists
//  - the service worker caches every one of them (otherwise the app breaks offline)
//  - js/core is pure (no DOM / window / document), so it keeps running in Node tests
//  - no loose images in the project root
const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const html = read('index.html'), manifest = JSON.parse(read('manifest.webmanifest')), sw = read('sw.js');
const refs = [...html.matchAll(/(?:src|href)="((?:js|css|icons)\/[^"]+)"/g)].map(m => m[1]).concat(manifest.icons.map(i => i.src), ['manifest.webmanifest']);
for (const r of new Set(refs)) { ok(fs.existsSync(path.join(root, r)), `exists: ${r}`); ok(sw.includes(`'./${r}'`), `cached offline: ${r}`); }
const loose = fs.readdirSync(root).filter(f => /\.(png|jpe?g|gif|svg|ico)$/i.test(f));
ok(!loose.length, 'no loose images in the project root' + (loose.length ? ': ' + loose.join(', ') : ''));
const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
const coreFiles = walk('js/core').map(f => f.slice('js/core/'.length)), appFiles = walk('js/app').map(f => f.slice('js/app/'.length));
for (const f of coreFiles) {
  const code = read('js/core/' + f).replace(/\/\/[^\n]*/g, '');
  ok(!/\b(document|window|navigator|localStorage|getElementById)\b/.test(code), `core is pure: js/core/${f}`);
}
const coreOrder = [...html.matchAll(/src="js\/core\/([^"]+)"/g)].map(m => m[1]), onDisk = coreFiles;
ok(onDisk.every(f => coreOrder.includes(f)), 'every js/core file is loaded by index.html');
const appOrder = [...html.matchAll(/src="js\/app\/([^"]+)"/g)].map(m => m[1]);
ok(appFiles.every(f => appOrder.includes(f)), 'every js/app file is loaded by index.html');
ok(appOrder[appOrder.length - 2] === 'main.js', 'main.js loads after the other app files (install.js is independent)');
process.exit(fail ? 1 : 0);
