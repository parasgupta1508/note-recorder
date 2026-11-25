// Note-level accuracy for violin / guitar / ukulele phrases with KNOWN notes and detuning, through the real Live path.
// node tests/strings.js            print table
// node tests/strings.js --update   ratchet tests/baselines/strings.json (fails when anything got worse)
// Per case: hit = right note name (and right octave) with onset within 120 ms. cents error = |found pitch - true pitch| on hits.
const fs = require('fs'), path = require('path');
const S = require('./lib/synth.js');
const lib = require('./lib/load.js');
const src = fs.readFileSync(path.join(lib.root, 'js', 'app', 'profiles.js'), 'utf8');   // the instrument profiles (pitch ranges) live here
// pitch ranges come from the app's own instrument profiles, so the test always uses what ships
const rangeOf = k => { const line = src.split('\n').find(l => l.includes("k: '" + k + "'") && l.includes('range:')), m = line.match(/range: \[(\d+), (\d+)\]/); return [+m[1], +m[2]]; };
const PROF = { violin: { lowM: 55, highM: 88, topM: [88, 100] }, guitar: { lowM: 40, highM: 76, topM: [76, 88] }, ukulele: { lowM: 60, highM: 81, topM: [76, 84] } };
for (const k in PROF) [PROF[k].lo, PROF[k].hi] = rangeOf(k);

// phrase builder: [{midi, t, d, detune, ...}]
function phrase(inst, kind, seed) {
  S.setSeed(seed); const P = PROF[inst], notes = [], hi = kind === 'high'; let t = 0.4, m = hi ? Math.round((P.topM[0] + P.topM[1]) / 2) : Math.round((P.lowM + P.highM) / 2 - 3 + S.rnd() * 6);
  const n = kind === 'fast' ? 16 : kind === 'slow' ? 7 : kind === 'repeat' ? 14 : 11, dur = kind === 'fast' ? 0.24 : kind === 'slow' ? 0.9 : kind === 'repeat' ? 0.5 : 0.45, lowB = hi ? P.topM[0] : P.lowM, highB = hi ? P.topM[1] : P.highM, bord = kind === 'border';
  for (let i = 0; i < n; i++) {
    const step = kind === 'repeat' ? [0, 0, 0, 2, -2, 0, 5, 0, 0, -3, 0, 2][Math.floor(S.rnd() * 12)] : [-5, -4, -2, -2, -1, 1, 2, 2, 3, 4, 5, 7][Math.floor(S.rnd() * 12)]; m = Math.max(lowB, Math.min(highB, m + step));
    notes.push({ midi: m, t, d: dur * (kind === 'repeat' ? 0.86 : 0.9 + S.rnd() * 0.25), detune: bord ? Math.round((S.rnd() < 0.5 ? -1 : 1) * (38 + S.rnd() * 10)) : Math.round((S.rnd() * 2 - 1) * 25) }); t += dur * (1 + (S.rnd() - 0.5) * 0.15);
  }
  return { notes, len: t + 0.8 };
}
function render(inst, ph, sr, nz, over = {}) {
  const b = S.mk(ph.len, sr);
  ph.notes.forEach((n, i) => {
    const o = { sr, detune: n.detune, ...over };
    if (inst === 'violin') { o.vib = over.vib ?? (S.rnd() < 0.6 ? 14 + S.rnd() * 12 : 0); o.scoop = over.scoop ?? (S.rnd() < 0.5 ? 25 : 0); o.attack = 0.04; o.rel = 0.04; }
    if (over.ring && inst !== 'violin') { o.amp = (o.amp ?? 0.35) * 1; S.INST[inst](b, n.midi, n.t, i + 1 < ph.notes.length ? Math.min(3, (ph.notes[i + 1].t - n.t) + 1.2) : 2, { ...o, amp: 0.35 * (i + 1 < ph.notes.length ? 0.5 : 1) }); } else
      S.INST[inst](b, n.midi, n.t, inst === 'violin' ? n.d : Math.min(n.d, 3), o);
  });
  S.noise(b, nz); return b;
}
function match(found, notes) {
  const used = new Set(), errs = []; let hit = 0, oct = 0, wrong = 0;
  for (const e of notes) {
    let k = found.findIndex((f, i) => !used.has(i) && f.midi === e.midi && Math.abs(f.start - e.t) < 0.12);
    if (k < 0) { const j = found.findIndex((f, i) => !used.has(i) && Math.abs(f.start - e.t) < 0.12); if (j >= 0) { used.add(j); (Math.abs(found[j].midi - e.midi) % 12 === 0 ? oct++ : wrong++); } continue; }
    used.add(k); hit++; const f = found[k]; errs.push(Math.abs((f.midi + f.cents / 100) - (e.midi + e.detune / 100)) * 100);
  }
  const extra = found.filter((f, i) => !used.has(i));
  return { hit, oct, wrong, extra: extra.length, errs, n: notes.length };
}
const res = {};
const HARD = { 'mic-hp+reverb': (b, sr) => { S.highpass(b, sr, 150); S.reverb(b, sr, 0.6, 0.35); S.noise(b, 0.004); },
  'quiet+hum': (b, sr) => { S.scale(b, 0.15); S.hum(b, sr, 0.004); S.noise(b, 0.0015); },
  'chatter': (b, sr) => { S.chatter(b, sr, 0.05); S.noise(b, 0.004); },
  'loud-clip': (b, sr) => { S.scale(b, 3); S.sat(b, 2.5); S.noise(b, 0.004); },
  'ringing': null, 'beating': null };
const CONDS = [['clean', 44100, 0.002], ['48k+room', 48000, 0.012], ...Object.keys(HARD).map(k => [k, 44100, 0])];
for (const inst of ['violin', 'guitar', 'ukulele']) for (const kind of ['slow', 'mid', 'fast', 'high', 'border', 'repeat']) for (const [cond, sr, nz] of CONDS) for (const mode of (HARD[cond] !== undefined ? ['auto'] : kind === 'high' || kind === 'border' || kind === 'repeat' ? ['auto', 'normal'] : ['auto', 'fast', 'normal'])) {
  if (HARD[cond] !== undefined && (kind === 'slow' || kind === 'high' || kind === 'border' || kind === 'repeat')) continue;      // hard conditions: mid + fast phrases only
  if ((kind === 'high' || kind === 'border' || kind === 'repeat') && cond !== 'clean') continue;
  const P = PROF[inst]; let tot = { hit: 0, oct: 0, wrong: 0, extra: 0, n: 0, errs: [] };
  for (const seed of [3, 4]) {
    const ph = phrase(inst, kind, seed + inst.length * 10), b = render(inst, ph, sr, nz, cond === 'ringing' ? { ring: 1 } : cond === 'beating' ? { beat: 1.5 + S.rnd() * 2 } : {}); if (HARD[cond]) HARD[cond](b, sr);
    const found = lib.getEngine('segmenter').run({ x: b, sr }, { m: lib.REC_MODES[mode === 'auto' ? 'fast' : mode], auto: mode === 'auto', fmin: P.lo, fmax: P.hi, conf: 0.85, a4: 440 });
    if (process.env.DBG && `${inst} ${kind} ${cond} ${mode}`.includes(process.env.DBG)) { console.log('--', inst, kind, cond, mode, 'seed', seed); console.log(' expected', ph.notes.map(n => n.midi + (n.detune >= 0 ? '+' : '') + n.detune + '@' + n.t.toFixed(2)).join(' ')); console.log(' found   ', found.map(f => f.midi + (f.cents >= 0 ? '+' : '') + Math.round(f.cents) + '@' + f.start.toFixed(2) + '/' + Math.round(f.dur)).join(' ')); }
    const r = match(found, ph.notes); for (const k of ['hit', 'oct', 'wrong', 'extra', 'n']) tot[k] += r[k]; tot.errs.push(...r.errs);
  }
  const prec = tot.hit / Math.max(1, tot.hit + tot.oct + tot.wrong + tot.extra), rec = tot.hit / tot.n, f1 = prec + rec ? 2 * prec * rec / (prec + rec) : 0;
  tot.errs.sort((a, b) => a - b); const mean = tot.errs.length ? tot.errs.reduce((a, b) => a + b, 0) / tot.errs.length : 99;
  res[`${inst} ${kind} ${cond} ${mode}`] = { f1: +f1.toFixed(3), hit: `${tot.hit}/${tot.n}`, oct: tot.oct, wrong: tot.wrong, extra: tot.extra, cents: +mean.toFixed(1), p95: +(tot.errs[Math.floor(tot.errs.length * 0.95)] ?? 99).toFixed(1) };
}
const keys = Object.keys(res), mean = k => +(keys.filter(x => x.startsWith(k)).reduce((a, x) => a + res[x].f1, 0) / keys.filter(x => x.startsWith(k)).length).toFixed(3);
if (!process.argv.includes('-q')) for (const k of keys) { const r = res[k]; console.log(k.padEnd(30), 'F1', r.f1.toFixed(2), ' hit', r.hit.padEnd(6), 'octErr', r.oct, 'wrongNote', r.wrong, 'extra', String(r.extra).padEnd(3), 'cents', r.cents, 'p95', r.p95); }
const summary = { violin: mean('violin'), guitar: mean('guitar'), ukulele: mean('ukulele') }; summary.overall = +((summary.violin + summary.guitar + summary.ukulele) / 3).toFixed(3);
console.log('MEAN F1', JSON.stringify(summary));
const bp = path.join(__dirname, 'baselines', 'strings.json'), base = fs.existsSync(bp) ? JSON.parse(fs.readFileSync(bp, 'utf8')) : null; const worse = [];
if (base) { for (const k of keys) if (base.cases[k] != null && res[k].f1 < base.cases[k] - 0.03) worse.push(`${k}: ${base.cases[k]} -> ${res[k].f1}`); for (const i of ['violin', 'guitar', 'ukulele', 'overall']) if (summary[i] < base.summary[i] - 0.01) worse.push(`${i}: ${base.summary[i]} -> ${summary[i]}`); }
if (worse.length) { console.log('\nREGRESSION:\n  ' + worse.join('\n  ')); process.exit(1); }
if (base) console.log('OK - nothing got worse');
if (process.argv.includes('--update') || !base) { const cs = {}; for (const k of keys) cs[k] = Math.max(res[k].f1, base?.cases[k] ?? 0); const sm = {}; for (const i in summary) sm[i] = Math.max(summary[i], base?.summary[i] ?? 0); fs.writeFileSync(bp, JSON.stringify({ summary: sm, cases: cs }, null, 1)); console.log('baseline saved'); }
