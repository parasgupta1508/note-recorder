// Gold-clip harness (Phase A, A2): scores every engine in the registry that can run in Node against recorded clips with known truth.
//   node tests/gold.js                       every clip in tests/audio/gold/ that has a truth file, every f0 + segmenter engine
//   node tests/gold.js --clip name           one clip      --engine yin,classic   only these engine ids      --bp   also run Basic Pitch (slow, needs tools/node_modules)
//   node tests/gold.js --synthetic           built-in synthetic fixtures (tests/lib/synth.js). REGRESSION ONLY, never the quality number.
//   node tests/gold.js --synthetic --write   also write them to tests/audio/gold/ (exercises the file loader)
//   node tests/gold.js --selftest            checks the metrics themselves (a perfect engine scores 100, a 50-cent-off one scores 0)
//   node tests/gold.js --agree violin1.f32   no truth needed: runs every f0 engine over tests/audio/<file>.f32 (44.1 kHz) and prints how often the engines agree. AGREEMENT IS NOT ACCURACY.
//   node tests/gold.js --list                shows clips, truth kind, and engines that can run
// Not a ratchet: nothing here is compared with tests/baselines/. Results are printed and saved as tests/audio/gold/<clip>.result.json (git-ignored with the audio).
//
// ---- Gold clip format (everything lives in tests/audio/gold/, which is git-ignored; never commit audio) ----
//   <name>.f32          mono float32 little-endian samples (ffmpeg -i x.mp3 -ac 1 -f f32le x.f32; keep the device's own rate)  -- or --
//   <name>.wav          PCM 16-bit or float32 WAV, any channel count (mixed to mono), any rate
//   <name>.truth.json   the truth. All fields except notes/frames/mid are optional:
//     { "sr": 44100,                 sample rate of the .f32 (a .wav carries its own); default 44100
//       "instrument": "violin",      violin | guitar | ukulele | piano; sets the pitch range the engines are given; default violin
//       "a4": 440,
//       "offset": 0,                 seconds added to every truth time (use it if the clip starts late versus the score)
//       "notes": [{ "midi": 69, "start": 1.20, "dur": 480, "cents": -8, "hz": 438.1 }],
//                                    the notes as PLAYED (hand-corrected). start in seconds, dur in MILLISECONDS (the app's note shape).
//                                    cents (deviation from equal temperament) or hz (exact) are optional: if present the pitch truth uses them,
//                                    otherwise the note's nominal pitch is the truth and the player's own intonation counts against the engine.
//       "frames": [{ "t": 0.01, "hz": 440.2 }],
//                                    optional "silver" pitch truth (hz 0 = silent), for example a clean close-mic take tracked and refined. Beats notes for the pitch metrics.
//       "mid": "name.mid",           optional: take the notes from a MIDI file next to the clip instead (written by tools or exported from a score)
//       "device": "phone", "mic": "built-in", "room": "small", "player": "A"   metadata only, never names
//     }
//   Pitch truth from notes: a frame counts as voiced when it is inside a note and 60 ms or more from both its ends, as unvoiced when it is 60 ms or more
//   outside every note; frames in between (attack, release, overlapping notes) are not scored, so engine latency is not mistaken for a pitch error.
//
// ---- What is measured (docs/practice-companion-plan.md Phase A, A2) ----
//   rpa50 / rpa20 / rpa10   share of truth-voiced frames where the engine's pitch is within that many cents. A frame the engine calls unvoiced counts as wrong.
//   rpa20det                the same, over frames the engine did call voiced (separates "found no pitch" from "found the wrong pitch")
//   oct / harm              share of truth-voiced frames that are an octave (x2, /2, x4, /4) or a twelfth (x3, /3) error
//   vRec / vPrec / fa       voiced recall; voiced precision (frames); false-alarm rate on truth-unvoiced frames
//   f1 / f1s                note F1, onset tolerance 50 ms, pitch = same semitone (within 50 cents), with NO known score; f1s = after the best constant time shift (+-200 ms, reported as shift)
//   f1k                     note F1 WITH a known score: each found note within 150 ms of a score note and at most one semitone from it takes that note's pitch, then F1 as above.
//                           This is a stand-in for the Phase 1-2 evaluator (which does not exist yet); it measures detection and timing, not the final scorer.
//   f1_100                  note F1 with a 100 ms onset tolerance (an intermediate player's timing)
//   s/min                   seconds of compute per minute of audio
//   f0 engines have no notes of their own, so they are given the harness's simple frames-to-notes step (median filter, same-pitch runs, minimum 50 ms). That step is the same
//   for every f0 engine, so the comparison is fair; it is not a product component.
const fs = require('fs'), path = require('path');
const lib = require('./lib/load.js'), root = lib.root, GOLD = path.join(__dirname, 'audio', 'gold');

// ---------- loading ----------
function readWav(b) {
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) { const id = b.toString('latin1', p, p + 4), len = b.readUInt32LE(p + 4); if (id === 'fmt ') fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) }; else if (id === 'data') { data = b.subarray(p + 8, Math.min(b.length, p + 8 + len)); break; } p += 8 + len + (len & 1); }
  if (!fmt || !data) throw new Error('WAV has no fmt or data chunk');
  const bytes = fmt.bits >> 3, n = Math.floor(data.length / (bytes * fmt.ch)), x = new Float32Array(n);
  if (!((fmt.tag === 1 && fmt.bits === 16) || (fmt.tag === 3 && fmt.bits === 32))) throw new Error(`WAV format ${fmt.tag}/${fmt.bits} bit is not supported (use 16-bit PCM or float32)`);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < fmt.ch; c++) { const o = (i * fmt.ch + c) * bytes; s += fmt.bits === 16 ? data.readInt16LE(o) / 32768 : data.readFloatLE(o); } x[i] = s / fmt.ch; }
  return { x, sr: fmt.sr };
}
function loadClip(name, dir = GOLD) {
  const truthFile = path.join(dir, name + '.truth.json'), tj = fs.existsSync(truthFile) ? JSON.parse(fs.readFileSync(truthFile, 'utf8')) : null;
  let audio;
  if (fs.existsSync(path.join(dir, name + '.f32'))) { const b = fs.readFileSync(path.join(dir, name + '.f32')); audio = { x: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3))), sr: (tj && tj.sr) || 44100 }; }
  else if (fs.existsSync(path.join(dir, name + '.wav'))) audio = readWav(fs.readFileSync(path.join(dir, name + '.wav')));
  else throw new Error(`no ${name}.f32 or ${name}.wav in ${dir}`);
  let notes = tj && tj.notes;
  const midName = (tj && tj.mid) || (fs.existsSync(path.join(dir, name + '.mid')) ? name + '.mid' : null);
  if (!notes && midName) notes = lib.parseMidi(new Uint8Array(fs.readFileSync(path.join(dir, midName)))).notes;
  const off = (tj && tj.offset) || 0;
  const truth = tj || notes ? { instrument: (tj && tj.instrument) || 'violin', a4: (tj && tj.a4) || 440, notes: (notes || []).map(n => ({ ...n, start: n.start + off })), frames: tj && tj.frames ? tj.frames.map(f => ({ t: f.t + off, hz: f.hz })) : null, meta: tj || {} } : null;
  return { name, x: audio.x, sr: audio.sr, dur: audio.x.length / audio.sr, truth };
}

// ---------- truth ----------
const hzOfNote = (n, a4) => n.hz || a4 * Math.pow(2, (n.midi - 69 + (n.cents || 0) / 100) / 12);
// -> [{ t, hz, voiced, skip }] on a 10 ms grid (or at the silver frames)
function truthGrid(truth, dur, margin = 0.06) {
  const out = [];
  if (truth.frames) { for (const f of truth.frames) out.push({ t: f.t, hz: f.hz, voiced: f.hz > 0, skip: false }); return out; }
  const N = truth.notes.map(n => ({ hz: hzOfNote(n, truth.a4), a: n.start, b: n.start + n.dur / 1000 }));
  for (let t = 0; t < dur; t += 0.01) {
    const inside = N.filter(n => t >= n.a + margin && t <= n.b - margin), near = N.filter(n => t >= n.a - margin && t <= n.b + margin);
    if (inside.length === 1 && near.length === 1) out.push({ t, hz: inside[0].hz, voiced: true, skip: false });
    else if (near.length === 0) out.push({ t, hz: 0, voiced: false, skip: false });
    else out.push({ t, hz: 0, voiced: false, skip: true });
  }
  return out;
}

// ---------- pitch metrics ----------
const cents = (a, b) => 1200 * Math.log2(a / b), nearIdx = (fr, t) => { let lo = 0, hi = fr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (fr[m].t < t) lo = m + 1; else hi = m; } return lo > 0 && Math.abs(fr[lo - 1].t - t) <= Math.abs(fr[lo].t - t) ? lo - 1 : lo; };
function scoreF0(grid, frames) {
  const sorted = frames.slice().sort((a, b) => a.t - b.t), hops = []; for (let i = 1; i < sorted.length && hops.length < 200; i++) hops.push(sorted[i].t - sorted[i - 1].t);
  const hop = hops.length ? hops.sort((a, b) => a - b)[hops.length >> 1] : 0.02, tol = Math.max(0.005, 0.6 * hop);
  const c = { nV: 0, nU: 0, det: 0, w50: 0, w20: 0, w10: 0, oct: 0, harm: 0, fa: 0, signed: [] };
  for (const g of grid) {
    if (g.skip) continue;
    const e = sorted.length ? sorted[nearIdx(sorted, g.t)] : null, has = e && Math.abs(e.t - g.t) <= tol && e.hz > 0;
    if (!g.voiced) { c.nU++; if (has) c.fa++; continue; }
    c.nV++; if (!has) continue; c.det++;
    const d = cents(e.hz, g.hz), a = Math.abs(d);
    if (a <= 50) { c.w50++; c.signed.push(d); if (a <= 20) c.w20++; if (a <= 10) c.w10++; }
    else if ([-2, -1, 1, 2].some(k => Math.abs(d - 1200 * k) <= 50)) c.oct++;
    else if ([-1902, 1902].some(k => Math.abs(d - k) <= 50)) c.harm++;
  }
  const r = (a, b) => b ? a / b : null, med = a => a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : null;
  return { frames: c.nV, rpa50: r(c.w50, c.nV), rpa20: r(c.w20, c.nV), rpa10: r(c.w10, c.nV), rpa20det: r(c.w20, c.det), oct: r(c.oct, c.nV), harm: r(c.harm, c.nV), vRec: r(c.det, c.nV), vPrec: r(c.det, c.det + c.fa), fa: r(c.fa, c.nU), biasCents: med(c.signed) };
}

// ---------- notes ----------
// f0 frames -> notes (the same simple step for every f0 engine)
function framesToNotes(frames, a4 = 440, minDur = 0.05) {
  const f = frames.slice().sort((a, b) => a.t - b.t); if (f.length < 2) return [];
  const hop = (f[f.length - 1].t - f[0].t) / (f.length - 1), m = f.map(x => x.hz > 0 ? 69 + 12 * Math.log2(x.hz / a4) : null);
  const sm = m.map((v, i) => { if (v == null) return null; const w = []; for (let k = i - 2; k <= i + 2; k++) if (m[k] != null) w.push(m[k]); w.sort((a, b) => a - b); return Math.round(w[w.length >> 1]); });
  const notes = []; let cur = null, gap = 0;
  for (let i = 0; i < sm.length; i++) {
    if (sm[i] == null) { if (cur && ++gap > 2) { notes.push(cur); cur = null; } continue; }
    if (cur && sm[i] === cur.midi) { cur.end = f[i].t + hop / 2; gap = 0; continue; }
    if (cur) notes.push(cur); cur = { midi: sm[i], start: f[i].t - hop / 2, end: f[i].t + hop / 2 }; gap = 0;
  }
  if (cur) notes.push(cur);
  return notes.map(n => ({ midi: n.midi, start: Math.max(0, n.start), dur: (n.end - n.start) * 1000 })).filter(n => n.dur >= minDur * 1000);
}
function snapToScore(notes, score, tol = 0.15) {
  return notes.map(n => { let best = null; for (const s of score) if (Math.abs(s.start - n.start) <= tol && Math.abs(s.midi - n.midi) <= 1 && (!best || Math.abs(s.start - n.start) < Math.abs(best.start - n.start))) best = s; return best ? { ...n, midi: best.midi } : n; });
}
function scoreNotes(truthNotes, found) {
  const ref = truthNotes.map(n => ({ midi: n.midi, start: n.start, dur: n.dur })), a = lib.compareNotes(ref, found, { onsetTol: 0.05 }), s = lib.compareNotes(ref, found, { onsetTol: 0.05, autoShift: true }),
    k = lib.compareNotes(ref, snapToScore(found, ref), { onsetTol: 0.05 }), l = lib.compareNotes(ref, found, { onsetTol: 0.1 });
  return { nTruth: ref.length, nFound: found.length, f1: a.f1, precision: a.precision, recall: a.recall, f1s: s.f1, shift: s.shift, f1k: k.f1, f1_100: l.f1, onsetMedianMs: a.onsetMedianMs, why: a.why };
}

// ---------- engines ----------
const RANGE = { violin: [180, 2800], guitar: [70, 1500], ukulele: [140, 1400], piano: [27, 4200] };
function rangeFor(inst) { try { const m = fs.readFileSync(path.join(root, 'js', 'app', 'profiles.js'), 'utf8').match(new RegExp("k: '" + inst + "'.*?range: \\[(\\d+), (\\d+)\\]")); if (m) return [+m[1], +m[2]]; } catch {} return RANGE[inst] || RANGE.violin; }
const nodeRunnable = e => !e.contractFail && !e.caps.needsHelper && !e.caps.needsBrowser && !e.caps.clipInput && (!e.caps.needsRuntime || typeof e.infer === 'function') && typeof e.run === 'function' && ['f0', 'segmenter'].includes(e.role);
let _bp = null;
async function bpRunner(clip, lo, hi, a4) {                // Basic Pitch with the real model in Node, as tests/detailed-strings.js does
  if (!_bp) {
    const nm = path.join(root, 'tools', 'node_modules'), tf = require(path.join(nm, '@tensorflow', 'tfjs')), BPm = require(path.join(nm, '@spotify', 'basic-pitch')), dir = path.join(nm, '@spotify', 'basic-pitch', 'model');
    const mj = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'))), bin = fs.readFileSync(path.join(dir, 'group1-shard1of1.bin'));
    _bp = { BPm, model: tf.loadGraphModel(tf.io.fromMemory({ modelTopology: mj.modelTopology, weightSpecs: mj.weightsManifest[0].weights, weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length), format: mj.format, generatedBy: mj.generatedBy, convertedBy: mj.convertedBy })) };
  }
  const x = lib.resample(clip.x, clip.sr, 22050), bp = new _bp.BPm.BasicPitch(_bp.model), F = [], O = [], C = [];
  await bp.evaluateModel(x, (f, o, c) => { for (let i = 0; i < f.length; i++) { F.push(f[i]); O.push(o[i]); } for (let i = 0; i < c.length; i++) C.push(c[i]); }, () => {});
  const raw = _bp.BPm.noteFramesToTime(_bp.BPm.addPitchBendsToNoteEvents(C, _bp.BPm.outputToNotesPoly(F, O, 0.5, 0.3, 11, true, hi, lo)));
  return lib.getEngine('transcriber').postprocess(raw, x, 22050, { a4, poly: false, lo, hi });
}
// Runs one engine over a clip. -> { frames?, notes, ms }
async function runEngine(e, clip, opts) {
  const inst = clip.truth ? clip.truth.instrument : 'violin', a4 = clip.truth ? clip.truth.a4 : 440, [lo, hi] = rangeFor(inst), t0 = Date.now();
  if (e.role === 'f0') {
    const rate = e.caps.sampleRate || clip.sr, x = rate === clip.sr ? clip.x : lib.resample(clip.x, clip.sr, rate), frames = await e.run({ x, sr: rate, fmin: lo, fmax: hi }, {});
    return { frames, notes: framesToNotes(frames, a4), ms: Date.now() - t0 };
  }
  if (e.role === 'segmenter') {                                                       // mic audio is 44.1/48 kHz; the classic listener is not tuned for less
    const sr = Math.max(clip.sr, 44100), x = sr === clip.sr ? clip.x : lib.resample(clip.x, clip.sr, sr);
    return { notes: await e.run({ x, sr }, { m: lib.REC_MODES.fast, fmin: lo, fmax: hi, conf: 0.85, a4 }), ms: Date.now() - t0 };
  }
  if (e.role === 'transcriber') return { notes: await bpRunner(clip, lo, hi, a4), ms: Date.now() - t0 };
  throw new Error('role not supported by the harness: ' + e.role);
}
async function scoreClip(clip, engines, opts = {}) {
  const res = { clip: clip.name, instrument: clip.truth.instrument, sr: clip.sr, durationSec: +clip.dur.toFixed(2), truthKind: clip.truth.frames ? 'silver frames' : 'notes (nominal pitch' + (clip.truth.notes.some(n => n.cents != null || n.hz) ? ' + per-note cents/hz' : '') + ')', generated: new Date().toISOString().slice(0, 10), engines: {} };
  const grid = truthGrid(clip.truth, clip.dur);
  for (const e of engines) {
    const key = e.role + '/' + e.id;
    try {
      const r = await runEngine(e, clip, opts), m = { version: e.version, spm: +(r.ms / 1000 / (clip.dur / 60)).toFixed(2) };
      if (r.frames) Object.assign(m, scoreF0(grid, r.frames));
      if (clip.truth.notes.length) Object.assign(m, scoreNotes(clip.truth.notes, r.notes));
      res.engines[key] = m;
    } catch (err) { res.engines[key] = { error: String(err && err.message || err) }; }
  }
  return res;
}

// ---------- output ----------
const pc = v => v == null ? '  -  ' : (v * 100).toFixed(1).padStart(5), f2 = v => v == null ? '  - ' : v.toFixed(2).padStart(4);
function printTable(res) {
  console.log(`\n${res.clip}  (${res.instrument}, ${res.durationSec}s @ ${res.sr} Hz, truth: ${res.truthKind})`);
  console.log('engine'.padEnd(22) + ' rpa50 rpa20 rpa10 r20det   oct  harm  vRec vPrec    fa |   f1  f1s shift  f1k f1_100 | s/min');
  for (const [k, m] of Object.entries(res.engines)) {
    if (m.error) { console.log(k.padEnd(22) + ' ERROR ' + m.error); continue; }
    console.log(k.padEnd(22) + [m.rpa50, m.rpa20, m.rpa10, m.rpa20det, m.oct, m.harm, m.vRec, m.vPrec, m.fa].map(pc).join(' ') + ' | ' + [f2(m.f1), f2(m.f1s), (m.shift == null ? '-' : m.shift.toFixed(2)).padStart(5), f2(m.f1k), f2(m.f1_100).padStart(6)].join(' ') + ' | ' + String(m.spm).padStart(5));
  }
}
const save = (res, dir = GOLD) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, res.clip + '.result.json'); fs.writeFileSync(f, JSON.stringify(res, null, 1)); return f; };

// ---------- synthetic fixtures (regression only) ----------
function syntheticClips() {
  const S = require('./lib/synth.js'), SR = 44100, out = [];
  const conds = { clean: b => S.noise(b, 0.002), 'mic-hp+reverb': b => { S.highpass(b, SR, 150); S.reverb(b, SR, 0.6, 0.35); S.noise(b, 0.004); }, noisy: b => S.noise(b, 0.02) };
  const phrases = { 'scale-and-leaps': [69, 71, 73, 74, 76, 78, 80, 81, 76, 69, 81, 88, 64, 57, 62], 'high-register': [84, 86, 88, 91, 93, 95, 91, 86] };
  for (const [pn, ms] of Object.entries(phrases)) for (const [cn, deg] of Object.entries(conds)) {
    S.setSeed(7); const notes = [], b = S.mk(0.4 + ms.length * 0.55 + 0.4, SR); let t = 0.4;
    ms.forEach((m, i) => { const detune = Math.round((S.rnd() * 2 - 1) * 12), dur = 0.44 + (i % 3) * 0.04; S.violin(b, m, t, dur, { sr: SR, detune, vib: i % 2 ? 14 : 4 }); notes.push({ midi: m, start: t, dur: dur * 1000, cents: detune }); t += 0.55; });
    deg(b, SR); out.push({ name: `synthetic-${pn}-${cn}`, x: b, sr: SR, dur: b.length / SR, truth: { instrument: 'violin', a4: 440, notes, frames: null, meta: {} } });
  }
  return out;
}
function writeClip(c) {
  fs.mkdirSync(GOLD, { recursive: true }); fs.writeFileSync(path.join(GOLD, c.name + '.f32'), Buffer.from(c.x.buffer, c.x.byteOffset, c.x.byteLength));
  fs.writeFileSync(path.join(GOLD, c.name + '.truth.json'), JSON.stringify({ sr: c.sr, instrument: c.truth.instrument, a4: c.truth.a4, notes: c.truth.notes, note: 'synthetic: regression only' }));
}

// ---------- self test of the metrics ----------
async function selfTest() {
  let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
  const notes = [{ midi: 69, start: 0.5, dur: 600 }, { midi: 72, start: 1.5, dur: 600 }, { midi: 76, start: 2.5, dur: 600, cents: -15 }], truth = { instrument: 'violin', a4: 440, notes, frames: null }, grid = truthGrid(truth, 3.5);
  const mk = (shift, fn) => grid.map(g => ({ t: g.t, hz: fn ? fn(g) : (g.voiced ? g.hz * Math.pow(2, shift / 1200) : 0), conf: 1 }));
  const perfect = scoreF0(grid, mk(0)), off30 = scoreF0(grid, mk(30)), off5 = scoreF0(grid, mk(5));
  ok(perfect.rpa10 === 1 && perfect.vRec === 1 && perfect.fa === 0 && perfect.oct === 0, 'a perfect engine scores 100% and has no false alarms');
  ok(off5.rpa10 === 1 && off5.rpa20 === 1, '5 cents off is inside the 10 cent tolerance');
  ok(off30.rpa20 === 0 && off30.rpa50 === 1 && Math.abs(off30.biasCents - 30) < 0.5, '30 cents off fails 20, passes 50, bias is reported (' + off30.biasCents.toFixed(1) + ')');
  const oct = scoreF0(grid, mk(0, g => g.voiced ? g.hz * 2 : 0)), thr = scoreF0(grid, mk(0, g => g.voiced ? g.hz / 3 : 0));
  ok(oct.oct === 1 && oct.rpa50 === 0, 'an octave-up engine scores 100% octave error'); ok(thr.harm === 1 && thr.oct === 0, 'a third-harmonic error is counted as harmonic, not octave');
  ok(scoreF0(grid, mk(0, () => 440)).fa > 0.9, 'an engine that always hears a pitch has false alarms');
  ok(scoreF0(grid, []).vRec === 0, 'an engine with no output has voiced recall 0');
  const edge = notes.flatMap(n => [n.start, n.start + n.dur / 1000]); ok(grid.some(g => g.skip) && grid.filter(g => g.voiced).every(g => edge.every(e => Math.abs(g.t - e) >= 0.0599)), 'frames near a note edge are skipped, not scored');
  const n76 = grid.find(g => g.voiced && g.t > 2.6); ok(Math.abs(cents(n76.hz, 440 * Math.pow(2, 7 / 12)) + 15) < 0.01, 'per-note cents move the pitch truth (-15)');
  const full = truthGrid(truth, 3.5, 0), fn = framesToNotes(full.map(g => ({ t: g.t, hz: g.voiced ? g.hz : 0 })), 440); ok(fn.length === 3 && fn.map(n => n.midi).join() === '69,72,76', 'frames-to-notes finds the three notes');
  const good = scoreNotes(notes, fn); ok(good.f1 === 1 && good.f1k === 1, 'notes from a perfect track score F1 1.00');
  const wrong = scoreNotes(notes, fn.map(n => ({ ...n, midi: n.midi + 1 }))); ok(wrong.f1 === 0 && wrong.f1k === 1, 'a semitone-off note scores 0 without the score and 1 with it');
  const late = scoreNotes(notes, fn.map(n => ({ ...n, start: n.start + 0.12 }))); ok(late.f1 === 0 && late.f1s === 1 && Math.abs(late.shift + 0.12) < 0.011, 'a constant lateness fails at 50 ms but is recovered by the shift (' + late.shift + ')');
  const w = Buffer.alloc(44 + 8); w.write('RIFF', 0); w.writeUInt32LE(36 + 8, 4); w.write('WAVEfmt ', 8); w.writeUInt32LE(16, 16); w.writeUInt16LE(1, 20); w.writeUInt16LE(2, 22); w.writeUInt32LE(8000, 24); w.writeUInt32LE(32000, 28); w.writeUInt16LE(4, 32); w.writeUInt16LE(16, 34); w.write('data', 36); w.writeUInt32LE(8, 40); w.writeInt16LE(16384, 44); w.writeInt16LE(-16384, 46); w.writeInt16LE(8192, 48); w.writeInt16LE(8192, 50);
  const wv = readWav(w); ok(wv.sr === 8000 && wv.x.length === 2 && wv.x[0] === 0 && Math.abs(wv.x[1] - 0.25) < 1e-6, 'the WAV reader mixes stereo to mono');
  console.log(fail ? `\n${fail} FAILED` : '\nmetrics self-test passes'); return fail;
}

// ---------- agreement on a clip without truth ----------
async function agree(file, engines) {
  const b = fs.readFileSync(path.join(__dirname, 'audio', file)), clip = { name: file, x: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3))), sr: 44100, truth: null }; clip.dur = clip.x.length / clip.sr;
  const runs = {}; for (const e of engines.filter(e => e.role === 'f0')) { const r = await runEngine(e, clip, {}); runs[e.id] = { frames: r.frames.slice().sort((a, c) => a.t - c.t), ms: r.ms }; }
  const ids = Object.keys(runs); console.log(`
${file}: ${clip.dur.toFixed(1)} s, no truth. Voiced share and pairwise agreement (agreement is not accuracy):`);
  for (const id of ids) console.log('  ' + id.padEnd(10) + ' voiced ' + (100 * runs[id].frames.filter(f => f.hz > 0).length / runs[id].frames.length).toFixed(1) + '%  ' + (runs[id].ms / 1000 / (clip.dur / 60)).toFixed(1) + ' s/min');
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const A = runs[ids[i]].frames, B = runs[ids[j]].frames; let both = 0, w20 = 0, oct = 0, onlyA = 0, onlyB = 0;
    for (const f of A) { const g = B[nearIdx(B, f.t)]; if (!g || Math.abs(g.t - f.t) > 0.02) continue; if (f.hz > 0 && g.hz > 0) { both++; const d = Math.abs(cents(f.hz, g.hz)); if (d <= 20) w20++; else if ([1, 2].some(k => Math.abs(d - 1200 * k) <= 50)) oct++; } else if (f.hz > 0) onlyA++; else if (g.hz > 0) onlyB++; }
    console.log(`  ${ids[i]} vs ${ids[j]}: both voiced ${both}, within 20 cents ${(100 * w20 / Math.max(1, both)).toFixed(1)}%, octave apart ${(100 * oct / Math.max(1, both)).toFixed(1)}%, only ${ids[i]} voiced ${onlyA}, only ${ids[j]} voiced ${onlyB}`);
  }
}

// ---------- main ----------
(async () => {
  const arg = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; }, has = n => process.argv.includes(n);
  if (arg('--agree')) { const sf0 = require('./lib/swiftf0-node.js').attachSwiftF0(lib); await agree(arg('--agree'), lib.listEngines().filter(e => nodeRunnable(e))); return; }
  if (has('--selftest')) process.exit(await selfTest() ? 1 : 0);
  const sf = require('./lib/swiftf0-node.js').attachSwiftF0(lib);                      // SwiftF0 joins in when onnxruntime-web and model.onnx are found (ORT_WEB, SWIFTF0_MODEL)
  const want = (arg('--engine') || '').split(',').filter(Boolean);
  let engines = lib.listEngines().filter(e => (nodeRunnable(e) || (has('--bp') && e.id === 'basicpitch')) && (!want.length || want.includes(e.id)));
  const skipped = lib.listEngines().filter(e => ['f0', 'segmenter', 'transcriber'].includes(e.role) && !engines.includes(e));
  let clips = [];
  if (has('--synthetic')) { clips = syntheticClips(); if (has('--write')) clips.forEach(writeClip); }
  else {
    const names = fs.existsSync(GOLD) ? [...new Set(fs.readdirSync(GOLD).filter(f => /\.(f32|wav)$/.test(f)).map(f => f.replace(/\.(f32|wav)$/, '')))] : [];
    const sel = arg('--clip') ? names.filter(n => n === arg('--clip')) : names;
    for (const n of sel) { try { const c = loadClip(n); if (c.truth && (c.truth.notes.length || c.truth.frames)) clips.push(c); else console.log(`skip ${n}: no truth (add ${n}.truth.json)`); } catch (e) { console.log(`skip ${n}: ${e.message}`); } }
  }
  if (has('--list')) { console.log('engines that run here: ' + engines.map(e => e.role + '/' + e.id).join(', ')); console.log('not run here: ' + skipped.map(e => e.role + '/' + e.id + (e.caps.needsRuntime ? ' (runtime not found: set ORT_WEB and SWIFTF0_MODEL)' : e.caps.needsBrowser ? ' (browser)' : e.caps.needsHelper ? ' (helper)' : '')).join(', ')); console.log('clips with truth: ' + (clips.map(c => c.name).join(', ') || 'none')); return; }
  if (!clips.length) { console.log(`No gold clips with truth in ${GOLD}. Real-microphone accuracy is NOT measured yet.\nRecord clips and add <name>.truth.json (format in the header of this file), or try --synthetic.`); return; }
  if (has('--synthetic')) console.log('SYNTHETIC fixtures: a regression check, not the quality number. Real-microphone accuracy is not measured by this run.');
  const all = [];
  for (const c of clips) { const r = await scoreClip(c, engines); printTable(r); all.push(r); if (!has('--no-save') && !has('--synthetic')) console.log('  saved ' + path.relative(root, save(r))); }
  if (has('--synthetic') && has('--save')) all.forEach(r => save(r));
  if (skipped.length) console.log('\nnot run in Node: ' + skipped.map(e => e.role + '/' + e.id).join(', ') + ' (browser or helper only; --bp adds Basic Pitch)');
})().catch(e => { console.error(e); process.exit(1); });
