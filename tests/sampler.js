// The instrument sampler (js/core/sampler.js) and the real recordings it plays (data/samples/, CC0, tools/samples/build.js): a note comes out at the pitch it is asked for, starts where
// it should, keeps its natural vibrato or decay, and a performance rendered with these recordings reads back as the truth says.
// Needs ffmpeg to decode the MP3s (tests/lib/samples-node.js); without it the recording tests say SKIP.  Run: node tests/sampler.js
const lib = require('./lib/load.js'), S = require('./lib/samples-node.js'), fs = require('fs'), path = require('path'); let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const SR = 44100, med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const rmsOf = (x, a, b) => Math.sqrt(x.subarray(Math.round(a * SR), Math.round(b * SR)).reduce((s, v) => s + v * v, 0) / Math.round((b - a) * SR));

// ---- the files themselves
for (const inst of ['violin', 'guitar', 'ukulele', 'piano']) {
  const dir = path.join(__dirname, '..', 'data', 'samples', inst), idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  ok(idx.files.length >= 10 && idx.files.every(f => fs.existsSync(path.join(dir, f.file)) && Number.isFinite(f.cents) && Math.abs(f.cents) < 30 && f.rms > 0) && /CC0/.test(idx.license), `${inst}: ${idx.files.length} recordings, each with a measured tuning offset, a level, and a CC0 licence`);
}
ok(/CC0/.test(fs.readFileSync(path.join(__dirname, '..', 'data', 'samples', 'README.txt'), 'utf8')), 'data/samples/README.txt records the sources and licences');

// ---- picking and planning (no audio needed)
{
  const mk = (midis, kind) => ({ inst: 'x', kind, sr: SR, notes: midis.map(m => ({ midi: m, layer: null, cents: 0, rms: 0.1, peak: 0.5, vib: null, dur: 3, data: new Float32Array(SR * 3), sr: SR, onset: 0 })) });
  const b = mk([60, 64, 67], 'plucked');
  ok(lib.smPick(b, 62).midi === 60 && lib.smPick(b, 63).midi === 64 && lib.smPick(b, 66).midi === 67 && lib.smPick(b, 40).midi === 60 && lib.smPick(b, 90).midi === 67, 'the nearest recording is picked (the lower one on a tie)');
  const P = lib.smPlan(b, { midi: 62, cents: 0 }), Q = lib.smPlan(b, { midi: 60, cents: 10 }), R = lib.smPlan(b, { midi: 60, cents: 0, a4: 442 });
  ok(Math.abs(Math.log2(P.rate) * 12 - 2) < 1e-9 && Math.abs(Math.log2(Q.rate) * 1200 - 10) < 1e-6 && Math.abs(Math.log2(R.rate) * 1200 - 1200 * Math.log2(442 / 440)) < 1e-6, 'the playback rate is the pitch wanted: 2 semitones, +10 cents, A4 = 442');
  const t = mk([60], 'plucked'); t.notes[0].cents = 7;
  ok(Math.abs(Math.log2(lib.smPlan(t, { midi: 60, cents: 0 }).rate) * 1200 + 7) < 1e-6, 'a recording that is 7 cents sharp of its key is played 7 cents lower to be in tune');
  const lay = { inst: 'v', kind: 'bowed', sr: SR, notes: [60, 60].map((m, i) => ({ midi: m, layer: i ? 'p' : 'f', cents: 0, rms: 0.1, peak: 0.5, vib: null, dur: 5, data: new Float32Array(SR * 5), sr: SR, onset: 0 })) };
  ok(lib.smPick(lay, 60, 'p').layer === 'p' && lib.smPick(lay, 60, 'f').layer === 'f' && lib.smPlan(lay, { midi: 60, vel: 0.8 }).gain < lib.smPlan(lay, { midi: 60, vel: 1.1 }).gain, 'a soft note uses the soft layer and is quieter');
  const onset = new Float32Array(SR); for (let i = Math.floor(SR * 0.2); i < SR; i++) onset[i] = 0.5 * Math.sin(i);
  ok(Math.abs(lib.smOnset(onset, SR) - 0.2) < 0.002, 'the onset is where the sound starts');
}

if (!S.hasFfmpeg()) { console.log('SKIP the recording tests: ffmpeg not found'); console.log(fail ? `\n${fail} FAILED` : '\nsampler checks pass (recordings skipped)'); process.exit(fail ? 1 : 0); }

// ---- real recordings: read a rendered note with yin the way the app would
function pitchOf(x, lo, hi, a, b) { const c = []; for (let o = Math.floor(a * SR); o + 4096 <= Math.floor(b * SR); o += 735) { const f = lib.yin(x.subarray(o, o + 4096), SR, lo, hi); if (f && f.clarity > 0.9) c.push(f.freq); } return c; }
const render = (inst, midi, cents, dur = 1.2, o = {}) => { const b = S.bank(lib, inst), out = new Float32Array(Math.ceil((dur + 2.5) * SR)); lib.smVoice(b)(out, SR, Object.assign({ midi, cents, t0: 0.5, dur, amp: 0.3, vel: 1, a4: 440 }, o)); return out; };
const centsOf = (f, midi) => 1200 * Math.log2(f / (440 * Math.pow(2, (midi - 69) / 12)));
for (const [inst, lo, hi, notes] of [['violin', 150, 2500, [55, 58, 62, 66, 70, 75, 80, 86]], ['guitar', 70, 1400, [40, 45, 52, 59, 64, 70]], ['ukulele', 200, 1500, [60, 63, 67, 71, 76]], ['piano', 60, 2200, [40, 48, 60, 72, 84]]]) {
  const errs = [];
  for (const m of notes) for (const c of [0, -18, 14]) { const x = render(inst, m, c), f = pitchOf(x, lo, hi, 0.75, 1.5); if (f.length < 3) { errs.push(999); continue; } errs.push(Math.abs(centsOf(med(f), m) - c)); }
  ok(med(errs) < 3 && Math.max(...errs) < 8, `${inst}: notes asked at 0, -18 and +14 cents read back at that pitch (median error ${med(errs).toFixed(2)} cents, worst ${Math.max(...errs).toFixed(2)})`);
}
{ // natural character
  const x = render('violin', 69, 0, 3), f = pitchOf(x, 300, 700, 0.8, 3.2), c = f.map(v => centsOf(v, 69)), sw = (Math.max(...c) - Math.min(...c)) / 2;
  ok(sw > 6 && sw < 40, `a real violin note carries its own vibrato (about ${sw.toFixed(0)} cents each way)`);
  ok(rmsOf(x, 1.5, 2.0) > 0.5 * rmsOf(x, 0.9, 1.4), 'a bowed note sustains');
  const g = render('guitar', 57, 0, 3);
  ok(rmsOf(g, 1.9, 2.4) < 0.6 * rmsOf(g, 0.6, 1.1), 'a plucked note dies away');
  const long = render('violin', 69, 0, 7);
  ok(rmsOf(long, 5.6, 6.2) > 0.3 * rmsOf(long, 1.5, 2.1), `a 7-second note outlasts the recording (it loops): level late ${rmsOf(long, 5.6, 6.2).toFixed(3)} against ${rmsOf(long, 1.5, 2.1).toFixed(3)} early`);
  const y = render('violin', 69, 0, 1), pk = y.reduce((m, v) => Math.max(m, Math.abs(v)), 0); let first = 0; for (let i = 0; i < y.length; i++) if (Math.abs(y[i]) > 0.08 * pk) { first = i / SR; break; }
  ok(Math.abs(first - 0.5) < 0.03, `the sound starts on the beat (asked 0.500 s, heard ${first.toFixed(3)} s)`);
  const none = render('violin', 69, 0, 0.001); ok(none.length > 0 && none.every(Number.isFinite), 'a very short note does not break');
}

// ---- a whole performance rendered with the recordings reads back as the truth says
for (const [inst, start, root, lo, hi] of [['violin', 55, 7, 150, 2500], ['guitar', 52, 4, 70, 1400], ['ukulele', 60, 0, 200, 1500], ['piano', 48, 0, 60, 2200]]) {
  const b = S.bank(lib, inst), tl = lib.buildTimeline({ start, type: 'major', span: 1, bpm: 70, slur: 1, rootPc: root });
  const r = lib.psRender({ inst, sr: SR, tl, level: 'good', seed: 5, tonic: root, voice: lib.smVoice(b), vibOf: lib.smVibOf(b) }), errs = [], miss = [];
  r.truth.forEach((t, i) => { if (t.kind !== 'played') return; const f = pitchOf(r.samples, lo, hi, r.padS + t.startMs / 1000 + 0.3, r.padS + t.endMs / 1000 - 0.05); if (f.length < 2) { miss.push(i); return; } errs.push(centsOf(med(f), t.midi) - t.cents); });
  ok(miss.length <= 1 && med(errs.map(Math.abs)) < 6 && r.samples.every(Number.isFinite), `${inst}: a performance with the recordings reads as the truth says (${errs.length}/${tl.length} notes read, median error ${med(errs.map(Math.abs)).toFixed(2)} cents)`);
}
{ const b = S.bank(lib, 'violin'), tl = lib.buildTimeline({ start: 55, type: 'major', span: 1, bpm: 70, slur: 1, rootPc: 7 }), r = lib.psRender({ inst: 'violin', sr: SR, tl, level: 'good', seed: 5, tonic: 7, voice: lib.smVoice(b), vibOf: lib.smVibOf(b) });
  ok(r.truth.filter(t => t.kind === 'played').every(t => t.vib && t.vib.depth > 0.5 && t.vib.hz > 2 && t.vib.hz < 8), 'the truth carries the vibrato the recordings really have'); }

console.log(fail ? `\n${fail} FAILED` : '\nall sampler checks pass'); process.exit(fail ? 1 : 0);
