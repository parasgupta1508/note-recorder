// Builds the file lists of the suggested Piece libraries into data/library/*.json, so the app never has to ask GitHub's API (60 requests an hour per network) for them.
// The app reads these lists from its own site; only the scores themselves come from raw.githubusercontent.com when a piece is opened.
// Run it again when the suggested libraries change or now and then to pick up new scores:   node tools/build-library-index.js
// It uses the GitHub CLI (`gh`, signed in: 5,000 requests an hour) and the same filtering code as the app (js/core), so the lists match what the app would have built itself.
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const lib = require('../tests/lib/load.js');
const out = path.join(__dirname, '..', 'data', 'library'); fs.mkdirSync(out, { recursive: true });
const gh = process.platform === 'win32' && fs.existsSync('C:/Program Files/GitHub CLI/gh.exe') ? 'C:/Program Files/GitHub CLI/gh.exe' : 'gh';
for (const d of lib.plDefaults()) {
  const tree = JSON.parse(execFileSync(gh, ['api', `repos/${d.owner}/${d.repo}/git/trees/${d.ref || 'HEAD'}?recursive=1`], { maxBuffer: 1 << 28 }).toString());
  const m = lib.ghMusicFiles(tree, { prefix: d.prefix, includeXml: d.includeXml });
  const file = path.join(out, d.id.replace(/[^A-Za-z0-9]+/g, '_') + '.json');
  fs.writeFileSync(file, JSON.stringify({ v: 1, id: d.id, built: new Date().toISOString().slice(0, 10), truncated: m.truncated, skipped: m.skipped, files: m.files.map(f => [f.path, f.size]) }));
  console.log(d.id, m.files.length, 'scores', (fs.statSync(file).size / 1024).toFixed(0) + ' KB', m.truncated ? '(TRUNCATED)' : '');
}
