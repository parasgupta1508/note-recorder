// Side-by-side comparison of every live pitch engine (YIN, pYIN, MPM) on synthetic strings with known pitch.
// node tests/f0-compare.js        Prints one table; it is a report, not a ratchet (Auto stays YIN until the owner approves a change).
// A frame counts as "heard" when the engine returns clarity >= 0.85 (the Tuner's default). wrong = more than 150 cents off (octave / harmonic errors).
const S = require('./lib/synth.js'), lib = require('./lib/load.js');
const PROF = { violin: { lo: 180, hi: 1800, m: [55, 93] }, guitar: { lo: 70, hi: 1400, m: [40, 84] }, ukulele: { lo: 140, hi: 1000, m: [60, 83] } };
const ids = ['yin', 'pyin', 'mpm'], CASES = [['clean', 0.0005, 4096], ['noisy', 0.03, 4096], ['very noisy', 0.1, 4096], ['short window', 0.0005, 2048]];
const rows = {};
for (const id of ids) {
  const eng = lib.findEngine('f0', id);
  for (const [cname, nz, win] of CASES) {
    let tot = 0, miss = 0, wrong = 0, ms = 0; const errs = [];
    for (const inst of Object.keys(PROF)) { const P = PROF[inst];
      for (const sr of [44100, 48000]) for (let midi = P.m[0]; midi <= P.m[1]; midi += 1) for (let rep = 0; rep < 2; rep++) {
        S.setSeed(midi * 7 + rep + win + Math.round(nz * 1000));
        const det = Math.round((S.rnd() * 2 - 1) * 40), b = S.mk(1, sr); S.INST[inst](b, midi, 0, 1, { sr, detune: det, vib: 0, scoop: 0 }); S.noise(b, nz);
        const t0 = Math.floor(sr * (inst === 'violin' ? 0.4 : 0.12)), x = b.subarray(t0, t0 + win), truth = S.hz(midi + det / 100);
        const a = process.hrtime.bigint(), r = eng.frame(x, sr, P.lo, P.hi); ms += Number(process.hrtime.bigint() - a) / 1e6; tot++;
        if (!r || r.clarity < 0.85) { miss++; continue; }
        const c = lib.centsBetween(r.freq, truth); if (Math.abs(c) > 150) { wrong++; continue; } errs.push(Math.abs(c));
      } }
    errs.sort((a, b) => a - b); const mean = errs.reduce((a, b) => a + b, 0) / (errs.length || 1);
    (rows[cname] = rows[cname] || {})[id] = { tot, heard: tot - miss - wrong, miss, wrong, mean, p95: errs[Math.floor(errs.length * 0.95)] || 0, ms: ms / tot };
  }
  // false alarms: how often does pure noise / a hum look like a note? (lower is better)
  let fa = 0, n = 0; for (const lvl of [0.01, 0.05, 0.2]) for (let k = 0; k < 40; k++) { S.setSeed(900 + k); const b = S.mk(0.2, 44100); S.noise(b, lvl); const r = eng.frame(b.subarray(0, 4096), 44100, 180, 1800); n++; if (r && r.clarity >= 0.85) fa++; }
  (rows['noise-only'] = rows['noise-only'] || {})[id] = { tot: n, falseAlarm: fa };
}
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('case', 14) + ids.map(i => pad(i, 38)).join(''));
for (const [cname] of CASES) console.log(pad(cname, 14) + ids.map(i => { const r = rows[cname][i]; return pad(`heard ${r.heard}/${r.tot} wrong ${r.wrong} miss ${r.miss} mean ${r.mean.toFixed(2)}c p95 ${r.p95.toFixed(1)}c ${r.ms.toFixed(1)}ms`, 38); }).join(''));
console.log(pad('noise-only', 14) + ids.map(i => pad(`false alarms ${rows['noise-only'][i].falseAlarm}/${rows['noise-only'][i].tot}`, 38)).join(''));
