// Scale-drill graders on simulated human playing. Humans do not play machine-exact pitch: attacks scoop, vibrato swings, the whole scale can sit a little flat, bowed
// strings play just intonation, timing wobbles. This builds runs like that (frame by frame, the way the app measures them: after the grader's dev() and the same hold statistics)
// and prints what the Strict and Practical graders give. It checks the ORDER and the intent, not exact numbers:
//   a good amateur must pass well under Practical; a just-intonation violin scale must not be punished; a consistent offset is forgiven but reported;
//   a sloppy run and a single wrong note must still be marked down; Strict stays the machine-exact view.
// Run: node tests/scale-scorers.js
const lib = require('./lib/load.js'), strict = lib.findEngine('scorer', 'strict'), prac = lib.findEngine('scorer', 'practical');
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
const JI = [0, 11.7, 3.9, 15.6, -13.7, -2.0, -9.8, 2.0, 13.7, -15.6, -3.9, -11.7];
const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0], ROOT = 60, BEAT = 750;
// One simulated run. P: { sig (cents, per-note intonation scatter), off (whole-scale offset), vib (peak cents), scoop, ji (plays just intonation), tj (timing scatter ms), lag (ms), wrongN, badNote:[index, cents] }
function run(P, inst, engine) {
  const fretless = !!lib.ruleFor(inst).bowing, rule = lib.ruleFor(inst), slots = [];
  const ctxP = { params: { tolerance: 12, expressive: 1, drift: 70 } };
  MAJOR.forEach((iv, i) => {
    const midi = ROOT + iv, deg = iv % 12, intent = (P.ji ? JI[deg] : 0) + (P.badNote && P.badNote[0] === i ? P.badNote[1] : 0), noteErr = gauss() * P.sig, frames = [];
    for (let f = 0; f < 30; f++) {
      let c = intent + P.off + noteErr + gauss() * 3 + (P.vib || 0) * Math.sin(2 * Math.PI * 5.5 * f / 30);
      if (P.scoop && f < 4) c -= P.scoop * (1 - f / 4);
      frames.push(engine.dev(c, { midi, root: ROOT % 12, fretless, params: ctxP.params }));   // the app stores frames after dev()
    }
    const st = lib.holdStats(frames, 10, rule.smooth), body = lib.smoothCents(frames.slice(Math.min(3, frames.length >> 2)), rule.smooth), m = lib.evalMedian(body), sp = Math.abs(frames[0] - m);
    slots.push({ index: i, pass: 1, name: 'n' + i, midi, d: i < 8 ? 'up' : 'down', k: 'h', c: st.c, m, a: st.a, s: st.s, e: (P.lag || 0) + gauss() * P.tj, sp, wrong: 0, rt: 0 });
  });
  for (let w = 0; w < (P.wrongN || 0); w++) slots[3 + w * 4].wrong = 1;
  return engine.evaluate(slots, { beatMs: BEAT, mode: 'tempo', wobbleCap: rule.wobble, params: ctxP.params });
}
const CASES = [
  ['machine (exact, no vibrato)',            { sig: 1, off: 0, vib: 0, scoop: 0, tj: 10, lag: 0 }],
  ['good amateur (scatter 9c, vibrato, scoop, +6c, timing +-45ms)', { sig: 9, off: 6, vib: 12, scoop: 35, tj: 45, lag: 120 }],
  ['just-intonation violinist (precise)',    { sig: 4, off: 0, vib: 6, scoop: 15, tj: 30, lag: 60, ji: true }],
  ['consistently 25c flat (precise)',        { sig: 5, off: -25, vib: 6, scoop: 10, tj: 30, lag: 60 }],
  ['one note 40c flat, rest exact',          { sig: 2, off: 0, vib: 0, scoop: 0, tj: 15, lag: 0, badNote: [6, -40] }],
  ['sloppy (scatter 25c, 3 wrong notes, timing +-150ms)', { sig: 25, off: -8, vib: 20, scoop: 40, tj: 150, lag: 200, wrongN: 3 }],
];
let bad = 0; const ck = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) bad++; };
const out = {};
for (const inst of ['violin', 'guitar']) {
  console.log(`\n${inst}`.toUpperCase() + '\n' + 'case'.padEnd(66) + 'strict'.padStart(8) + 'practical'.padStart(11) + '  offset');
  for (const [name, P] of CASES) {
    seed = 777; const a = run(P, inst, strict); seed = 777; const b = run(P, inst, prac);
    out[inst + '|' + name] = { s: a.total, p: b.total, off: b.offset };
    console.log(name.padEnd(66) + String(a.total).padStart(8) + String(b.total).padStart(11) + '  ' + (b.offset > 0 ? '+' : '') + b.offset + 'c');
  }
}
console.log('');
const g = (inst, i) => out[inst + '|' + CASES[i][0]];
ck('machine run: both graders give 95 or more', g('violin', 0).s >= 95 && g('violin', 0).p >= 95);
ck('good amateur: Practical gives Distinction (87+) and is above Strict', g('violin', 1).p >= 87 && g('violin', 1).p > g('violin', 1).s);
ck('just-intonation violinist: Practical 95+ (Strict marks the thirds and sixths down)', g('violin', 2).p >= 95 && g('violin', 2).s < g('violin', 2).p);
ck('the same just-intonation run on a guitar (equal-tempered) is NOT given the just-intonation zone: it scores below the violin', g('guitar', 2).p < g('violin', 2).p);
ck('consistently flat: Practical forgives most of it (above Strict, below a perfect run) and reports the offset (about -25c)', g('violin', 3).p > g('violin', 3).s && g('violin', 3).p < g('violin', 0).p && g('violin', 3).off < -18 && g('violin', 3).off > -30);
ck('one note 40c flat: still marked down by Practical (at least 2 points under a perfect run; it is 1 note in 15)', g('violin', 4).p <= g('violin', 0).p - 2);
ck('sloppy run: Practical stays under Merit (75)', g('violin', 5).p < 75 && g('guitar', 5).p < 75);
ck('order is right for both graders on violin: machine >= amateur > sloppy', ['s', 'p'].every(k => g('violin', 0)[k] >= g('violin', 1)[k] && g('violin', 1)[k] > g('violin', 5)[k]));
process.exit(bad ? 1 : 0);
