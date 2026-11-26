// Which pitch engine suits scale drills? Human-like scale notes (vibrato, scoop, detuned, room noise) on violin, guitar and ukulele, read the way a drill reads them:
// frames over the settled part of each note, then the MEDIAN of the note (that is what the grader uses), compared with the pitch the player aimed at (the centre of the vibrato).
// A report, not a ratchet: Auto stays YIN until the owner approves a change. Run: node tests/scale-f0.js
const S = require('./lib/synth.js'), lib = require('./lib/load.js');
const IN = { violin: { lo: 180, hi: 1800, scale: [60, 62, 64, 65, 67, 69, 71, 72] }, guitar: { lo: 70, hi: 1400, scale: [48, 50, 52, 53, 55, 57, 59, 60] }, ukulele: { lo: 140, hi: 1000, scale: [60, 62, 64, 65, 67, 69, 71, 72] } };
const COND = [['steady, clean', { vib: 0, scoop: 0 }, 0.0005], ['vibrato 12c', { vib: 12, scoop: 0 }, 0.0005], ['vibrato 20c + scoop 35c', { vib: 20, scoop: 35 }, 0.0005], ['vibrato 12c, noisy room', { vib: 12, scoop: 0 }, 0.03], ['scoop 35c, very noisy room', { vib: 0, scoop: 35 }, 0.08]];
const ids = ['yin', 'pyin', 'mpm'], sr = 44100, WIN = 4096, rows = {};
for (const id of ids) {
  const eng = lib.findEngine('f0', id);
  for (const [cname, o, nz] of COND) {
    const noteErr = [], frameWrong = []; let frames = 0, voiced = 0, wrong = 0, ms = 0;
    for (const inst of Object.keys(IN)) for (const midi of IN[inst].scale) for (let rep = 0; rep < 3; rep++) {
      S.setSeed(midi * 13 + rep * 101 + Math.round(nz * 1000) + o.vib * 7 + o.scoop);
      const det = Math.round((S.rnd() * 2 - 1) * 20), b = S.mk(1.2, sr); S.INST[inst](b, midi, 0, 1.1, { sr, detune: det, vib: o.vib, vibHz: 5.5, scoop: o.scoop }); S.noise(b, nz);
      const truth = S.hz(midi + det / 100), cs = [];
      for (let t = 0.3; t <= 0.95; t += 1 / 30) {
        const x = b.subarray(Math.floor(t * sr), Math.floor(t * sr) + WIN), a = process.hrtime.bigint(), r = eng.frame(x, sr, IN[inst].lo, IN[inst].hi); ms += Number(process.hrtime.bigint() - a) / 1e6; frames++;
        if (!r || r.clarity < 0.85) continue; const c = lib.centsBetween(r.freq, truth); if (Math.abs(c) > 150) { wrong++; continue; } voiced++; cs.push(c);
      }
      if (cs.length >= 4) noteErr.push(Math.abs(lib.evalMedian(cs))); else noteErr.push(null);
    }
    const ok = noteErr.filter(x => x != null).sort((a, b) => a - b);
    (rows[cname] = rows[cname] || {})[id] = { notes: noteErr.length, lost: noteErr.length - ok.length, med: ok[ok.length >> 1], p95: ok[Math.floor(ok.length * 0.95)], voiced: 100 * voiced / frames, wrong: 100 * wrong / frames, ms: ms / frames };
  }
}
const pad = (s, n) => String(s).padEnd(n);
console.log('Median error of each NOTE (what the grader uses), cents; p95; frames heard %; octave-type errors %; ms per frame');
console.log(pad('condition', 30) + ids.map(i => pad(i, 44)).join(''));
const tot = {}; for (const id of ids) tot[id] = { med: [], p95: [], wrong: [], lost: 0, ms: [] };
for (const [cname] of COND) {
  console.log(pad(cname, 30) + ids.map(i => { const r = rows[cname][i]; tot[i].med.push(r.med); tot[i].p95.push(r.p95); tot[i].wrong.push(r.wrong); tot[i].lost += r.lost; tot[i].ms.push(r.ms); return pad(`med ${r.med.toFixed(2)}c p95 ${r.p95.toFixed(1)}c heard ${r.voiced.toFixed(0)}% wrong ${r.wrong.toFixed(1)}% ${r.ms.toFixed(1)}ms`, 44); }).join(''));
}
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
console.log('\nOverall (mean of the five conditions)');
for (const id of ids) console.log(pad(id, 6) + `median note error ${avg(tot[id].med).toFixed(2)}c   p95 ${avg(tot[id].p95).toFixed(1)}c   octave-type errors ${avg(tot[id].wrong).toFixed(2)}%   notes lost ${tot[id].lost}   ${avg(tot[id].ms).toFixed(1)} ms/frame`);
