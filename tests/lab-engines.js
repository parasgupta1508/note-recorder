// Checks the Lab helper's MIDI engines against notes we know: a synthetic violin phrase goes in, each engine's notes are scored with compareNotes.
// node tests/lab-engines.js [basicpitch pyin crepe]      (needs: node tools/lab/setup.js; engines that are not installed are skipped)
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const S = require('./lib/synth.js'), lib = require('./lib/load.js'), root = lib.root, lab = path.join(root, 'tools', 'lab');
const WIN = process.platform === 'win32', PY = path.join(lab, '.venv', WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python');
const want = process.argv.slice(2).length ? process.argv.slice(2) : ['basicpitch', 'mpm', 'pyin', 'crepe'];
const SR = 22050, truth = []; S.setSeed(7);
const b = S.mk(9, SR); let t = 0.4, m = 64;
for (const step of [0, 2, 2, -4, 5, -2, 0, 3, -5, 2, 4, -3, 2, 0, -2, 4]) { m += step; const d = 0.45; S.INST.violin(b, m, t, d * 0.92, { sr: SR, vib: 12, attack: 0.04, rel: 0.04, detune: 0 }); truth.push({ midi: m, start: t, dur: d * 920 }); t += d; }
S.noise(b, 0.003);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-')), wav = path.join(dir, 'in.wav'), pcm = Buffer.alloc(44 + b.length * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + b.length * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(b.length * 2, 40);
for (let i = 0; i < b.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, b[i])) * 32767), 44 + i * 2);
fs.writeFileSync(wav, pcm);
let fail = 0;
for (const e of want) {
  const out = path.join(dir, e + '.json'), t0 = Date.now();
  const r = e === 'basicpitch' || e === 'mpm' ? cp.spawnSync(process.execPath, [path.join(lab, 'engines', e + '.js'), wav, out], { encoding: 'utf8' }) : cp.spawnSync(PY, ['-I', path.join(lab, 'engines', 'f0engine.py'), '--method', e, wav, out], { encoding: 'utf8' });
  if (r.status === 2 || /Application Control/.test(r.stderr || '')) { console.log(`SKIP ${e}: ${r.status === 2 ? 'not installed' : 'blocked by the Application Control policy on this PC'}`); continue; }
  if (r.status !== 0) { console.log(`FAIL ${e}: ${(r.stderr || r.error || '').toString().trim().split('\n').slice(-2).join(' ')}`); fail++; continue; }
  const got = JSON.parse(fs.readFileSync(out, 'utf8')).notes, c = lib.compareNotes(truth, got, { onsetTol: 0.07 });
  const good = c.f1 >= 0.8; if (!good) fail++;
  console.log(`${good ? 'PASS' : 'FAIL'} ${e}: ${got.length} notes found for ${truth.length} played, F1 ${c.f1.toFixed(2)} (precision ${c.precision.toFixed(2)}, recall ${c.recall.toFixed(2)}), median timing ${c.onsetMedianMs == null ? '-' : c.onsetMedianMs.toFixed(0)} ms, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
