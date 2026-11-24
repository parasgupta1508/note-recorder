// Checks resample(): a tone must keep its pitch and level, and a tone above the new Nyquist must NOT alias into the band.
// node tests/resample.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const lib = new Function(src.slice(src.indexOf('<script>') + 8, src.indexOf('// ---------- APP ----------')) + '\nreturn { resample, binMag };')();
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const tone = (f, sr, n) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(2 * Math.PI * f * i / sr));
for (const from of [44100, 48000]) {
  const y = lib.resample(tone(1000, from, from), from, 22050), mid = y.subarray(2000, 6096), rms = Math.sqrt(mid.reduce((a, v) => a + v * v, 0) / mid.length);
  ok(Math.abs(rms - 0.5 / Math.SQRT2) < 0.005, `${from}: 1 kHz tone level kept (rms ${rms.toFixed(3)})`);
  ok(lib.binMag(mid, 22050, 1000) > 50 * lib.binMag(mid, 22050, 1300), `${from}: 1 kHz tone keeps its pitch`);
  // 15 kHz is above the new 11.025 kHz Nyquist: a naive decimation folds it down to about 7 kHz (48k: 22.05k-15k) - it must be gone
  const z = lib.resample(tone(15000, from, from), from, 22050), zm = z.subarray(2000, 6096), zr = Math.sqrt(zm.reduce((a, v) => a + v * v, 0) / zm.length);
  ok(zr < 0.5 / Math.SQRT2 * 0.003, `${from}: 15 kHz tone removed, not folded back (${(20 * Math.log10(zr / (0.5 / Math.SQRT2))).toFixed(0)} dB)`);
}
const i16 = Int16Array.from(tone(440, 44100, 44100), v => Math.round(v * 32767)), r16 = lib.resample(i16, 44100, 22050, 32768);
ok(Math.abs(Math.max(...r16.subarray(1000, 3000)) - 0.5) < 0.01, 'Int16 input scales back to float');
process.exit(fail ? 1 : 0);
