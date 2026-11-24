// Engine: McLeod Pitch Method via the `pitchy` package (MIT). Follows ONE melody line (monophonic). Classic signal processing, no model,
// and a different algorithm from the app's YIN, so where it agrees with the app the note is very likely right.
// usage: node mpm.js <in.wav (22,050 Hz mono 16-bit)> <out.json>
const fs = require('fs'), path = require('path');
let PitchDetector;
try { ({ PitchDetector } = require(path.join(__dirname, '..', '..', 'node_modules', 'pitchy'))); } catch { console.error('pitchy is not installed. Run: cd tools && npm install'); process.exit(2); }

function readWav(file) {
  const b = fs.readFileSync(file); let p = 12, rate = 22050;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(p + 12);
    if (id === 'data') { const n = Math.floor(Math.min(len, b.length - p - 8) / 2), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = b.readInt16LE(p + 8 + i * 2) / 32768; return { x, rate }; }
    p += 8 + len + (len & 1);
  }
  throw new Error('No audio data in the WAV file');
}

// pitch track -> notes: round to semitones, 5-frame median, join runs, join same-pitch runs split by a tiny gap, drop very short notes
function toNotes(midi, step, t0 = 0, minDur = 0.06, maxGap = 0.05) {
  const n = midi.length, r = new Array(n).fill(null);
  for (let i = 0; i < n; i++) if (midi[i] != null) { const w = []; for (let k = -2; k <= 2; k++) if (midi[i + k] != null) w.push(Math.round(midi[i + k])); w.sort((a, b) => a - b); r[i] = w[w.length >> 1]; }
  const runs = []; let i = 0;
  while (i < n) { if (r[i] == null) { i++; continue; } let j = i; while (j + 1 < n && r[j + 1] === r[i]) j++; runs.push({ m: r[i], s: t0 + i * step, d: (j - i + 1) * step }); i = j + 1; }
  const out = [];
  for (const q of runs) { const l = out[out.length - 1]; if (l && l.m === q.m && q.s - (l.s + l.d) <= maxGap) l.d = q.s + q.d - l.s; else out.push({ ...q }); }
  return out.filter(q => q.d >= minDur).map(q => ({ midi: q.m, start: +q.s.toFixed(4), dur: +(q.d * 1000).toFixed(1), vel: 80 }));
}

try {
  const [inp, out] = process.argv.slice(2), { x, rate } = readWav(inp), N = 2048, hop = 256, det = PitchDetector.forFloat32Array(N), t0 = Date.now(), midi = [];
  const frame = new Float32Array(N), rms = [];
  for (let o = 0; o + N <= x.length; o += hop) { frame.set(x.subarray(o, o + N)); let s = 0; for (let i = 0; i < N; i++) s += frame[i] * frame[i]; rms.push(Math.sqrt(s / N)); }
  const sorted = rms.slice().sort((a, b) => a - b), gate = Math.max(0.003, (sorted[Math.floor(sorted.length * 0.95)] || 0) * 0.05);   // quiet parts are silence, loud and quiet songs both work
  let f = 0, last = -1;
  for (let o = 0; o + N <= x.length; o += hop, f++) {
    let m = null;
    if (rms[f] > gate) { frame.set(x.subarray(o, o + N)); const [hz, clarity] = det.findPitch(frame, rate); if (clarity >= 0.9 && hz > 60 && hz < 2200) m = 69 + 12 * Math.log2(hz / 440); }
    midi.push(m); const q = Math.floor(f / rms.length * 20); if (q !== last) { last = q; console.log('PROGRESS ' + (f / rms.length).toFixed(3)); }
  }
  const notes = toNotes(midi, hop / rate, N / 2 / rate);   // each frame is stamped with the time of its centre
  fs.writeFileSync(out, JSON.stringify({ engine: 'mpm', notes, took: (Date.now() - t0) / 1000 }));
  console.log('DONE ' + notes.length);
} catch (e) { console.error(e && e.message || e); process.exit(1); }
