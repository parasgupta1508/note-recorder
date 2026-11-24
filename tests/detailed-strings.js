// Detailed path (real Basic Pitch model in Node + the app's bpToEvents / refine / extractMelody) on the same synthetic string phrases.
// node tests/detailed-strings.js            print table (about 3-5 min on CPU)
// node tests/detailed-strings.js --update   ratchet tests/baselines/detailed.json
// Needs tools/node_modules (cd tools && npm install). Scoring is identical to tests/strings.js.
const fs = require('fs'), path = require('path');
const S = require('./lib/synth.js');
const lib = require('./lib/load.js'), root = lib.root, src = fs.readFileSync(path.join(root, 'js', 'app', 'profiles.js'), 'utf8');
const nm = path.join(root, 'tools', 'node_modules');
const tf = require(path.join(nm, '@tensorflow', 'tfjs')), BPm = require(path.join(nm, '@spotify', 'basic-pitch'));
const rangeOf = k => { const line = src.split('\n').find(l => l.includes("k: '" + k + "'") && l.includes('range:')), m = line.match(/range: \[(\d+), (\d+)\]/); return [+m[1], +m[2]]; };
const PROF = { violin: { lowM: 55, highM: 88, topM: [88, 100], poly: false }, guitar: { lowM: 40, highM: 76, topM: [76, 88], poly: true }, ukulele: { lowM: 60, highM: 81, topM: [76, 84], poly: true } };
for (const k in PROF) [PROF[k].lo, PROF[k].hi] = rangeOf(k);
const SR = 22050;

// same phrase generator as strings.js (kept in sync by copy: seeds and shapes are identical)
function phrase(inst, kind, seed) {
  S.setSeed(seed); const P = PROF[inst], notes = [], hi = kind === 'high'; let t = 0.4, m = hi ? Math.round((P.topM[0] + P.topM[1]) / 2) : Math.round((P.lowM + P.highM) / 2 - 3 + S.rnd() * 6);
  const n = kind === 'fast' ? 16 : kind === 'slow' ? 7 : kind === 'repeat' ? 14 : 11, dur = kind === 'fast' ? 0.24 : kind === 'slow' ? 0.9 : kind === 'repeat' ? 0.5 : 0.45, lowB = hi ? P.topM[0] : P.lowM, highB = hi ? P.topM[1] : P.highM, bord = kind === 'border';
  for (let i = 0; i < n; i++) {
    const step = kind === 'repeat' ? [0, 0, 0, 2, -2, 0, 5, 0, 0, -3, 0, 2][Math.floor(S.rnd() * 12)] : [-5, -4, -2, -2, -1, 1, 2, 2, 3, 4, 5, 7][Math.floor(S.rnd() * 12)]; m = Math.max(lowB, Math.min(highB, m + step));
    notes.push({ midi: m, t, d: dur * (kind === 'repeat' ? 0.86 : 0.9 + S.rnd() * 0.25), detune: bord ? Math.round((S.rnd() < 0.5 ? -1 : 1) * (38 + S.rnd() * 10)) : Math.round((S.rnd() * 2 - 1) * 25) }); t += dur * (1 + (S.rnd() - 0.5) * 0.15);
  }
  return { notes, len: t + 0.8 };
}
function render(inst, ph, sr, nz) {
  const b = S.mk(ph.len, sr);
  ph.notes.forEach(n => { const o = { sr, detune: n.detune }; if (inst === 'violin') { o.vib = S.rnd() < 0.6 ? 14 + S.rnd() * 12 : 0; o.scoop = S.rnd() < 0.5 ? 25 : 0; o.attack = 0.04; o.rel = 0.04; } S.INST[inst](b, n.midi, n.t, inst === 'violin' ? n.d : Math.min(n.d, 3), o); });
  S.noise(b, nz); return b;
}
const HARD = { 'mic-hp+reverb': (b, sr) => { S.highpass(b, sr, 150); S.reverb(b, sr, 0.6, 0.35); S.noise(b, 0.004); }, 'chatter': (b, sr) => { S.chatter(b, sr, 0.05); S.noise(b, 0.004); } };
function match(found, notes) {
  const used = new Set(), errs = []; let hit = 0, oct = 0, wrong = 0;
  for (const e of notes) {
    const k = found.findIndex((f, i) => !used.has(i) && f.midi === e.midi && Math.abs(f.start - e.t) < 0.15);
    if (k < 0) { const j = found.findIndex((f, i) => !used.has(i) && Math.abs(f.start - e.t) < 0.15); if (j >= 0) { used.add(j); (Math.abs(found[j].midi - e.midi) % 12 === 0 ? oct++ : wrong++); } continue; }
    used.add(k); hit++; const f = found[k]; errs.push(Math.abs((f.midi + f.cents / 100) - (e.midi + e.detune / 100)) * 100);
  }
  return { hit, oct, wrong, extra: found.filter((f, i) => !used.has(i)).length, errs, n: notes.length };
}
(async () => {
  const dir = path.join(nm, '@spotify', 'basic-pitch', 'model'), mj = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'))), bin = fs.readFileSync(path.join(dir, 'group1-shard1of1.bin'));
  const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length);
  const model = tf.loadGraphModel(tf.io.fromMemory({ modelTopology: mj.modelTopology, weightSpecs: mj.weightsManifest[0].weights, weightData: ab, format: mj.format, generatedBy: mj.generatedBy, convertedBy: mj.convertedBy }));
  const BP = new BPm.BasicPitch(model), PARAMS = { onset: +(process.env.BP_ONSET || 0.5), frame: +(process.env.BP_FRAME || 0.3), minLen: +(process.env.BP_MINLEN || 11) }, a4 = 440, res = {};
  const only = process.env.ONLY; const jobs = []; for (const inst of ['violin', 'guitar', 'ukulele'].filter(i => !only || i === only)) { for (const kind of ['mid', 'fast', 'border', 'high', 'repeat'].filter(k => !process.env.KIND || k === process.env.KIND)) jobs.push([inst, kind, 'clean']); if (!process.env.KIND) for (const c of Object.keys(HARD)) jobs.push([inst, 'mid', c]); }
  for (const [inst, kind, cond] of jobs) {
    const P = PROF[inst]; const tot = { hit: 0, oct: 0, wrong: 0, extra: 0, n: 0, errs: [] };
    for (const seed of [3, 4]) {
      const ph = phrase(inst, kind, seed + inst.length * 10), b = render(inst, ph, SR, cond === 'clean' ? 0.002 : 0); if (HARD[cond]) HARD[cond](b, SR);
      const F = [], O = [], C = [];
      await BP.evaluateModel(b, (f, o, c) => { for (let i = 0; i < f.length; i++) { F.push(f[i]); O.push(o[i]); } for (let i = 0; i < c.length; i++) C.push(c[i]); }, () => {});
      const raw = BPm.noteFramesToTime(BPm.addPitchBendsToNoteEvents(C, BPm.outputToNotesPoly(F, O, PARAMS.onset, PARAMS.frame, PARAMS.minLen, true, P.hi, P.lo)));
      const toMidi = f => Math.round(69 + 12 * Math.log2(f / a4));
      let ev = lib.bpToEvents(raw, a4);
      if (process.env.DBG && `${inst} ${kind} ${cond}`.includes(process.env.DBG)) console.log(' BP raw  ', ev.map(e => e.midi + '@' + e.start.toFixed(2) + '/' + Math.round(e.dur) + ' hz' + e.hz.toFixed(0)).join(' '));
      if (lib.markAttacks && !process.env.NOSPLIT) ev = lib.markAttacks(ev, b, SR);
      if (process.env.DBG && `${inst} ${kind} ${cond}`.includes(process.env.DBG)) console.log(' split   ', ev.map(e => e.midi + '@' + e.start.toFixed(2) + '/' + Math.round(e.dur) + (e.split ? 's' : '')).join(' '));
      if (lib.refineEvents && !process.env.NOREFINE) ev = lib.refineEvents(ev, b, SR, { a4, poly: P.poly });
      const found = lib.extractMelody(ev, { lo: toMidi(P.lo) - 1, hi: toMidi(P.hi) + 1, poly: P.poly });
      if (process.env.DBG && `${inst} ${kind} ${cond}`.includes(process.env.DBG)) { console.log('--', inst, kind, cond, 'seed', seed); console.log(' expected', ph.notes.map(n => n.midi + (n.detune >= 0 ? '+' : '') + n.detune + '@' + n.t.toFixed(2)).join(' ')); console.log(' found   ', found.map(f => f.midi + (f.cents >= 0 ? '+' : '') + Math.round(f.cents) + '@' + f.start.toFixed(2) + '/' + Math.round(f.dur)).join(' ')); }
      const r = match(found, ph.notes); for (const k of ['hit', 'oct', 'wrong', 'extra', 'n']) tot[k] += r[k]; tot.errs.push(...r.errs);
    }
    const prec = tot.hit / Math.max(1, tot.hit + tot.oct + tot.wrong + tot.extra), rec = tot.hit / tot.n, f1 = prec + rec ? 2 * prec * rec / (prec + rec) : 0;
    tot.errs.sort((a, b) => a - b); const mean = tot.errs.length ? tot.errs.reduce((a, b) => a + b, 0) / tot.errs.length : 99;
    res[`${inst} ${kind} ${cond}`] = { f1: +f1.toFixed(3), hit: `${tot.hit}/${tot.n}`, oct: tot.oct, wrong: tot.wrong, extra: tot.extra, cents: +mean.toFixed(1), p95: +(tot.errs[Math.floor(tot.errs.length * 0.95)] ?? 99).toFixed(1) };
    const r = res[`${inst} ${kind} ${cond}`]; console.log(`${inst} ${kind} ${cond}`.padEnd(30), 'F1', r.f1.toFixed(2), ' hit', r.hit.padEnd(6), 'octErr', r.oct, 'wrongNote', r.wrong, 'extra', String(r.extra).padEnd(3), 'cents', r.cents, 'p95', r.p95);
  }
  const keys = Object.keys(res), avg = (f, k) => { const ks = keys.filter(x => x.startsWith(k)); return +(ks.reduce((a, x) => a + res[x][f], 0) / ks.length).toFixed(3); };
  const summary = { violin: avg('f1', 'violin'), guitar: avg('f1', 'guitar'), ukulele: avg('f1', 'ukulele') }; summary.overall = +((summary.violin + summary.guitar + summary.ukulele) / 3).toFixed(3);
  const cents = +(keys.reduce((a, x) => a + res[x].cents, 0) / keys.length).toFixed(2);
  console.log('MEAN F1', JSON.stringify(summary), ' mean cents error', cents);
  const bp = path.join(__dirname, 'baselines', 'detailed.json'), base = fs.existsSync(bp) ? JSON.parse(fs.readFileSync(bp, 'utf8')) : null; const worse = [];
  if (base) { for (const k of keys) if (base.cases[k] != null && res[k].f1 < base.cases[k] - 0.05) worse.push(`${k}: ${base.cases[k]} -> ${res[k].f1}`); for (const i of ['violin', 'guitar', 'ukulele', 'overall']) if (summary[i] < base.summary[i] - 0.02) worse.push(`${i}: ${base.summary[i]} -> ${summary[i]}`); if (cents > base.cents + 1) worse.push(`cents error: ${base.cents} -> ${cents}`); }
  if (worse.length) { console.log('\nREGRESSION:\n  ' + worse.join('\n  ')); process.exit(1); }
  if (base) console.log('OK - nothing got worse');
  if (process.argv.includes('--update') || !base) { const cs = {}; for (const k of keys) cs[k] = Math.max(res[k].f1, base?.cases[k] ?? 0); const sm = {}; for (const i in summary) sm[i] = Math.max(summary[i], base?.summary[i] ?? 0); fs.writeFileSync(bp, JSON.stringify({ summary: sm, cases: cs, cents: Math.min(cents, base?.cents ?? 99) }, null, 1)); console.log('baseline saved'); }
})().catch(e => { console.error(e); process.exit(1); });
