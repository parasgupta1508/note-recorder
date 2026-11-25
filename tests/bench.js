// Detection regression benchmark. Run: node tests/bench.js          (fails if any case got worse than tests/baselines/bench.json)
//                                      node tests/bench.js --update (ratchet: only saves the baseline if nothing got worse)
// It loads the real detector code out of js/core, so it always tests what ships.
const fs = require('fs'), path = require('path');
const lib = require('./lib/load.js');
const SR = 44100;

// ---- synthetic instruments ----
function tone(buf, midi, t0, dur, o = {}) {
  const f0 = lib.noteToFreq(midi), amp = o.amp ?? 0.4, vib = o.vib ?? 0, harm = o.harm ?? [1, 0.6, 0.4, 0.25, 0.15, 0.1];
  const a = o.attack ?? 0.015, rel = o.rel ?? 0.02, decay = o.decay ?? 0, s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  let ph = 0;
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / SR, f = f0 * (1 + vib * 0.0087 * Math.sin(2 * Math.PI * 5.5 * t));
    ph += 2 * Math.PI * f / SR;
    let env = Math.min(1, t / a) * Math.min(1, (dur - t) / rel) * Math.exp(-decay * t) * (1 - (o.am ?? 0) * 0.5 * (1 - Math.cos(2 * Math.PI * (o.amHz ?? 5.5) * t))), v = 0;
    for (let h = 0; h < harm.length; h++) v += harm[h] * Math.sin(ph * (h + 1));
    buf[s0 + i] += amp * env * v;
  }
}
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const noise = (buf, amp) => { for (let i = 0; i < buf.length; i++) buf[i] += amp * (rnd() * 2 - 1); };
const mk = sec => new Float32Array(Math.ceil(sec * SR));

const cases = [];
{ const b = mk(4), exp = []; [69, 71, 73, 74, 76, 78, 80, 81].forEach((m, i) => { tone(b, m, 0.2 + i * 0.45, 0.45, { vib: 1, attack: 0.04, rel: 0.04 }); exp.push({ midi: m, start: 0.2 + i * 0.45 }); }); noise(b, 0.002); cases.push({ name: 'legato scale (violin, vibrato)', b, exp }); }
{ const b = mk(4), exp = []; for (let i = 0; i < 6; i++) { tone(b, 76, 0.3 + i * 0.5, 0.5, { attack: 0.03, rel: 0.12, amp: 0.4 }); exp.push({ midi: 76, start: 0.3 + i * 0.5 }); } noise(b, 0.002); cases.push({ name: 'detache: repeated E5 (level dips only)', b, exp }); }
{ const b = mk(4), exp = []; for (let i = 0; i < 6; i++) { tone(b, 69, 0.3 + i * 0.5, 0.42, { attack: 0.01, rel: 0.02 }); exp.push({ midi: 69, start: 0.3 + i * 0.5 }); } noise(b, 0.002); cases.push({ name: 'staccato: repeated A4 (clear gaps)', b, exp }); }
{ const b = mk(4), exp = []; for (let i = 0; i < 12; i++) { const m = 72 + [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5][i]; tone(b, m, 0.2 + i * 0.2, 0.19, { attack: 0.01, rel: 0.01 }); exp.push({ midi: m, start: 0.2 + i * 0.2 }); } noise(b, 0.002); cases.push({ name: 'fast run (5 notes/s)', b, exp }); }
{ const b = mk(3), exp = [{ midi: 64, start: 0.8 }]; noise(b, 0.01); tone(b, 64, 0.8, 1.2, { vib: 1 }); cases.push({ name: 'one note in room noise (no false notes)', b, exp }); }
{ const b = mk(3); noise(b, 0.02); cases.push({ name: 'noise only (expect nothing)', b, exp: [] }); }
{ const b = mk(5), exp = []; [76, 79, 83, 79].forEach((m, i) => { tone(b, m, 0.3 + i * 1.1, 1.1, { vib: 1, amp: 0.35, attack: 0.05, rel: 0.05 }); exp.push({ midi: m, start: 0.3 + i * 1.1 }); });
  [[48, 0], [55, 1.1], [52, 2.2], [57, 3.3]].forEach(([m, t]) => { tone(b, m, t, 1.4, { amp: 0.12, decay: 2.5, harm: [1, 0.5, 0.3, 0.2], attack: 0.003 }); tone(b, m + 7, t, 1.4, { amp: 0.09, decay: 2.5, harm: [1, 0.5, 0.3], attack: 0.003 }); });
  noise(b, 0.002); cases.push({ name: 'violin melody over soft piano', b, exp }); }

{ const b = mk(5), exp = []; [67, 72, 76, 72].forEach((m, i) => { tone(b, m, 0.6 + i * 1.0, 0.9, { vib: 1, amp: 0.3, attack: 0.04, rel: 0.05 }); exp.push({ midi: m, start: 0.6 + i * 1.0 }); }); noise(b, 0.09); cases.push({ name: 'melody in loud room noise', b, exp }); }

{ const b = mk(4), exp = [{ midi: 76, start: 0.3 }]; tone(b, 76, 0.3, 3, { vib: 2.5, am: 0.5, attack: 0.04, rel: 0.05 }); noise(b, 0.002); cases.push({ name: 'vibrato held note, volume wobbles = ONE note', b, exp }); }
{ const b = mk(5), exp = [{ midi: 76, start: 0.3 }, { midi: 76, start: 1.7 }]; tone(b, 76, 0.3, 1.4, { vib: 2.5, am: 0.4, attack: 0.04, rel: 0.05 }); tone(b, 76, 1.74, 1.5, { vib: 2.5, am: 0.4, attack: 0.05, rel: 0.05 }); noise(b, 0.002); cases.push({ name: 'vibrato + bow change on same note = TWO notes', b, exp }); }

function score(found, exp) {
  const used = new Set(); let tp = 0;
  for (const e of exp) { const k = found.findIndex((f, i) => !used.has(i) && f.midi === e.midi && Math.abs(f.start - e.start) < 0.12); if (k >= 0) { used.add(k); tp++; } }
  const p = found.length ? tp / found.length : (exp.length ? 0 : 1), r = exp.length ? tp / exp.length : 1;
  return { f1: p + r ? +(2 * p * r / (p + r)).toFixed(3) : 0, found: found.length, expected: exp.length };
}

const res = {};
for (const mode of ['auto', 'fast', 'normal']) for (const c of cases) {
  const m = lib.REC_MODES[mode === 'auto' ? 'fast' : mode], found = lib.getEngine('segmenter').run({ x: c.b, sr: SR }, { m, auto: mode === 'auto', fmin: 180, fmax: 2400, conf: 0.85, a4: 440 });
  res[mode + ' | ' + c.name] = score(found, c.exp);
}

// ---- melody extraction (works on note lists, e.g. from Basic Pitch): violin line out of piano + overtones ----
{
  const N = (midi, start, dur, amp) => ({ midi, note: '', start, dur, amp, pts: [] });
  const violin = [[76, 0.0, 800], [74, 0.8, 800], [72, 1.6, 900], [71, 2.5, 700], [72, 3.2, 1200]].map(([m, t, d]) => N(m, t, d, 0.8));
  const piano = [[48, 0.0, 1600, 0.35], [55, 0.0, 1600, 0.3], [52, 1.6, 1600, 0.35], [57, 1.6, 1600, 0.3], [64, 0.0, 600, 0.3], [60, 2.5, 1500, 0.3]].map(([m, t, d, a]) => N(m, t, d, a));
  const over = [N(88, 0.0, 700, 0.5), N(86, 0.8, 700, 0.5)];                      // octave overtones of the violin notes (+12)
  const frag = [N(72, 3.2, 500, 0.8), N(72, 3.75, 650, 0.8)];                    // one note split in two fragments (same pitch, short gap)
  const all = [...violin.slice(0, 4), ...frag, ...piano, ...over];
  const got = lib.extractMelody(all, { lo: 55, hi: 96 });
  const exp = violin.map(n => ({ midi: n.midi, start: n.start }));
  res['melody | violin out of piano + overtones'] = score(got.map(g => ({ midi: g.midi, start: g.start })), exp);
}

const keys = Object.keys(res), mean = +(keys.reduce((a, k) => a + res[k].f1, 0) / keys.length).toFixed(3);
keys.forEach(k => console.log(String(res[k].f1.toFixed(2)).padStart(5), ` ${res[k].found}/${res[k].expected}`.padEnd(7), k));
console.log('OVERALL', mean);

const bp = path.join(__dirname, 'baselines', 'bench.json'), base = fs.existsSync(bp) ? JSON.parse(fs.readFileSync(bp, 'utf8')) : null;
let worse = [];
if (base) for (const k of keys) if (base.cases[k] != null && res[k].f1 < base.cases[k] - 0.02) worse.push(`${k}: ${base.cases[k]} -> ${res[k].f1}`);
if (base && mean < base.overall - 0.005) worse.push(`OVERALL: ${base.overall} -> ${mean}`);
if (worse.length) { console.log('\nREGRESSION - the new code is worse than the saved baseline:\n  ' + worse.join('\n  ')); process.exit(1); }
if (process.argv.includes('--update') || !base) {
  const cs = {}; for (const k of keys) cs[k] = Math.max(res[k].f1, base?.cases[k] ?? 0);
  fs.writeFileSync(bp, JSON.stringify({ overall: Math.max(mean, base?.overall ?? 0), cases: cs }, null, 1)); console.log('baseline saved');
} else console.log('OK - nothing got worse' + (mean > base.overall ? ' (improved: run with --update to raise the baseline)' : ''));
