// Frame-level pitch accuracy of yin() on realistic string tones with known pitch (no segmenter involved).
// node tests/pitch-sweep.js [--json]   -> per instrument: octave errors, missed frames, cents error (mean/p95/max)
const fs = require('fs'), path = require('path');
const S = require('./lib/synth.js');
const lib = require('./lib/load.js');
const PROF = { violin: { lo: 180, hi: 1800, m: [55, 93] }, guitar: { lo: 70, hi: 1400, m: [40, 84] }, ukulele: { lo: 140, hi: 1000, m: [60, 83] } };
const out = {};
for (const inst of ['violin', 'guitar', 'ukulele']) {
  const P = PROF[inst]; const errs = [], bad = []; let oct = 0, miss = 0, tot = 0;
  for (const sr of [44100, 48000]) for (const win of [2048, 4096]) for (const nz of [0.0005, 0.02]) for (let midi = P.m[0]; midi <= P.m[1]; midi++) for (let rep = 0; rep < 2; rep++) {
    S.setSeed(midi * 7 + rep + win);
    const det = Math.round((S.rnd() * 2 - 1) * 40), b = S.mk(1, sr);
    S.INST[inst](b, midi, 0, 1, { sr, detune: det, vib: 0, scoop: 0 }); S.noise(b, nz);
    const t0 = Math.floor(sr * (inst === 'violin' ? 0.4 : 0.12)), x = b.subarray(t0, t0 + win);
    const truth = S.hz(midi + det / 100), r = lib.getEngine('f0').frame(x, sr, P.lo, P.hi); tot++;
    if (!r || r.clarity < 0.85) { miss++; bad.push(`${midi}${det >= 0 ? '+' : ''}${det} sr${sr} w${win} n${nz} MISS`); continue; }
    const c = lib.centsBetween(r.freq, truth), oc = Math.round(c / 1200);
    if (Math.abs(c) > 150) { oct++; bad.push(`${midi}${det >= 0 ? '+' : ''}${det} sr${sr} w${win} n${nz} OFF ${c.toFixed(0)}c`); continue; }
    errs.push(Math.abs(c));
  }
  errs.sort((a, b) => a - b);
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  out[inst] = { frames: tot, missed: miss, wrongPitch: oct, meanCents: +mean.toFixed(2), p95: +errs[Math.floor(errs.length * 0.95)].toFixed(2), max: +errs[errs.length - 1].toFixed(2), badList: bad };
  console.log(inst.padEnd(8), `frames ${tot}  missed ${miss}  wrong(>150c) ${oct}  mean ${mean.toFixed(2)}c  p95 ${out[inst].p95}c  max ${out[inst].max}c`);
  if (process.argv.includes('-v')) bad.slice(0, 40).forEach(s => console.log('   ', s));
}
if (process.argv.includes('--json')) fs.writeFileSync(path.join(__dirname, 'pitch-sweep.out.json'), JSON.stringify(out, null, 1));
