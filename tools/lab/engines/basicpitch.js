// Engine: Spotify Basic Pitch (Apache-2.0), run in Node with TensorFlow.js. Polyphonic: finds chords and several instruments.
// usage: node basicpitch.js <in.wav (22,050 Hz mono 16-bit)> <out.json>
// This is the RAW model output (default thresholds). It does not use the app's own refinement, so it is a fair reference for what the app adds.
const fs = require('fs'), path = require('path');
const nm = path.join(__dirname, '..', '..', 'node_modules');
let tf, BPm;
try { tf = require(path.join(nm, '@tensorflow', 'tfjs')); BPm = require(path.join(nm, '@spotify', 'basic-pitch')); }
catch { console.error('Basic Pitch is not installed. Run: cd tools && npm install'); process.exit(2); }

function readWav(file) {                                            // 16-bit PCM mono WAV -> Float32Array
  const b = fs.readFileSync(file); let p = 12, rate = 22050;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(p + 12);
    if (id === 'data') { const n = Math.floor(Math.min(len, b.length - p - 8) / 2), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = b.readInt16LE(p + 8 + i * 2) / 32768; return { x, rate }; }
    p += 8 + len + (len & 1);
  }
  throw new Error('No audio data in the WAV file');
}

(async () => {
  const [inp, out] = process.argv.slice(2), { x, rate } = readWav(inp);
  if (rate !== 22050) throw new Error('Basic Pitch needs 22,050 Hz audio, got ' + rate);
  const dir = path.join(nm, '@spotify', 'basic-pitch', 'model'), mj = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'))), bin = fs.readFileSync(path.join(dir, 'group1-shard1of1.bin'));
  const model = tf.loadGraphModel(tf.io.fromMemory({ modelTopology: mj.modelTopology, weightSpecs: mj.weightsManifest[0].weights, weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length), format: mj.format, generatedBy: mj.generatedBy, convertedBy: mj.convertedBy }));
  const bp = new BPm.BasicPitch(model), F = [], O = [], t0 = Date.now(); let last = -1;
  await bp.evaluateModel(x, (f, o) => { for (let i = 0; i < f.length; i++) { F.push(f[i]); O.push(o[i]); } }, p => { const q = Math.round(p * 20); if (q !== last) { last = q; console.log('PROGRESS ' + p.toFixed(3)); } });
  const raw = BPm.noteFramesToTime(BPm.outputToNotesPoly(F, O, 0.5, 0.3, 11, true, null, null, true));
  const notes = raw.map(n => ({ midi: n.pitchMidi, start: n.startTimeSeconds, dur: n.durationSeconds * 1000, vel: Math.max(1, Math.min(127, Math.round(30 + n.amplitude * 97))) })).sort((a, b) => a.start - b.start || a.midi - b.midi);
  fs.writeFileSync(out, JSON.stringify({ engine: 'basicpitch', notes, took: (Date.now() - t0) / 1000 }));
  console.log('DONE ' + notes.length);
})().catch(e => { console.error(e && e.message || e); process.exit(1); });
