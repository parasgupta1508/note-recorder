// Loads the instrument sample banks (data/samples/<inst>/) into the shape js/core/sampler.js uses, in Node. The MP3s are decoded with ffmpeg (an argument list, no shell);
// when ffmpeg is not installed, bank() returns null and the tests that need real recordings say SKIP.
//   const bank = require('./lib/samples-node.js').bank(lib, 'violin')   // lib: require('./lib/load.js')
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', '..'), cache = {};
const hasFfmpeg = () => { const r = spawnSync('ffmpeg', ['-version']); return !r.error && r.status === 0; };
function bank(lib, inst) {
  if (cache[inst] !== undefined) return cache[inst];
  const dir = path.join(root, 'data', 'samples', inst), idx = path.join(dir, 'index.json');
  if (!fs.existsSync(idx) || !hasFfmpeg()) return (cache[inst] = null);
  const index = JSON.parse(fs.readFileSync(idx, 'utf8')), decoded = index.files.map(f => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path.join(dir, f.file), '-ac', '1', '-ar', String(index.sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
    return { data: new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 2).slice(), sr: index.sr };
  });
  return (cache[inst] = lib.smMakeBank(index, decoded));
}
module.exports = { bank, hasFfmpeg };
