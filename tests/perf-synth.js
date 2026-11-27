// The performance synthesiser (js/core/perf-synth.js): the sound is deterministic, has the pitch it claims, and behaves like a player (vibrato, slurs, plucks, faults).
// These are the properties the speaker test relies on: if the truth were wrong, every accuracy figure measured with it would be wrong too.
// Run: node tests/perf-synth.js
const lib = require('./lib/load.js'); let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const SR = 44100, tl = lib.buildTimeline({ start: 55, type: 'major', span: 1, bpm: 80, slur: 1, rootPc: 7 });          // G major, one octave, one note a beat
// Pitch of a note as the app hears it: YIN over windows inside the note, median in cents against the equal-tempered pitch.
function measure(r, i, lo = 150, hi = 2200) {
  const t = r.truth[i], a = Math.round((r.padS + t.startMs / 1000 + 0.12) * r.sr), b = Math.round((r.padS + t.endMs / 1000 - 0.04) * r.sr), c = [];
  for (let o = a; o + 4096 <= b; o += 1024) { const f = lib.yin(r.samples.subarray(o, o + 4096), r.sr, lo, hi); if (f && f.clarity > 0.85) c.push(lib.centsBetween(f.freq, lib.noteToFreq(t.midi, 440))); }
  return c.length ? lib.evalMedian(c) : null;
}
const clean = { sigma: 0, offset: 0, just: false, vibrato: false, scoop: 0, slide: 0, jitter: 0, lag: 0, drift: 0, faultP: 0, wrongP: 0, skipP: 0 };

// determinism and shape
const a1 = lib.psRender({ inst: 'violin', sr: SR, tl, level: 'good', seed: 5, tonic: 7 }), a2 = lib.psRender({ inst: 'violin', sr: SR, tl, level: 'good', seed: 5, tonic: 7 }), a3 = lib.psRender({ inst: 'violin', sr: SR, tl, level: 'good', seed: 6, tonic: 7 });
ok(a1.samples.length === a2.samples.length && a1.samples.every((v, i) => v === a2.samples[i]), 'the same seed renders exactly the same sound');
ok(JSON.stringify(a1.truth) !== JSON.stringify(a3.truth), 'a different seed is a different performance');
ok(a1.truth.length === tl.length && a1.samples.every(v => Number.isFinite(v)) && a1.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) <= 0.7001, 'one truth entry per note, finite samples, peak at the requested level');

// each instrument sounds the pitch the truth says (no vibrato, no scatter: the YIN reading must be within 2 cents)
for (const inst of ['violin', 'guitar', 'ukulele']) {
  const t2 = lib.buildTimeline({ start: inst === 'guitar' ? 52 : 60, type: 'major', span: 1, bpm: 70, slur: 1, rootPc: inst === 'guitar' ? 4 : 0 }), r = lib.psRender({ inst, sr: SR, tl: t2, level: 'expert', player: clean, seed: 3, tonic: 0 });
  const err = r.truth.map((_, i) => measure(r, i, inst === 'guitar' ? 70 : 150, inst === 'violin' ? 2200 : 1400)).filter(x => x != null);
  ok(err.length >= 7 && err.every(e => Math.abs(e) < 2), `${inst}: a clean performance reads within 2 cents of the truth on ${err.length}/${t2.length} notes (worst ${Math.max(...err.map(Math.abs)).toFixed(2)})`);
}
// the truth carries the player's real intonation: a player 20 cents flat is read 20 cents flat
{ const r = lib.psRender({ inst: 'violin', sr: SR, tl, player: Object.assign({}, clean, { offset: -20 }), seed: 4, tonic: 7 }), e = r.truth.map((_, i) => measure(r, i));
  const d = e.map((x, i) => x == null ? null : Math.abs(x - r.truth[i].cents)).filter(x => x != null);
  ok(d.length >= 7 && d.every(x => x < 2.5), `the truth cents are what the detector reads (offset -20: worst difference ${Math.max(...d).toFixed(2)} cents on ${d.length} notes)`); }
// vibrato: the pitch really swings at the stated rate and depth, and it starts late
{ const long = [{ index: 0, midi: 69, startMs: 0, durationMs: 2000 }], r = lib.psRender({ inst: 'violin', sr: SR, tl: long, player: Object.assign({}, clean, { vibrato: true, vibHz: 5.8, vibDepth: 20, vibDelay: 0.2 }), seed: 2, tonic: 9 });
  const track = []; for (let o = Math.round((r.padS + 0.3) * SR); o + 2048 <= Math.round((r.padS + 1.9) * SR); o += 441) { const f = lib.yin(r.samples.subarray(o, o + 2048), SR, 300, 1200); track.push(f && f.clarity > 0.8 ? lib.centsBetween(f.freq, 440) : null); }
  const v = track.filter(x => x != null), mean = v.reduce((a, b) => a + b, 0) / v.length, amp = (Math.max(...v) - Math.min(...v)) / 2; let cross = 0; for (let i = 1; i < v.length; i++) if ((v[i - 1] - mean) * (v[i] - mean) < 0) cross++;
  const hz = cross / 2 / (v.length * 0.01);
  ok(r.truth[0].vib && Math.abs(r.truth[0].vib.hz - 5.8) < 0.6, 'the truth records the vibrato it rendered');
  ok(amp > 10 && amp < 32, `vibrato depth is audible in the pitch track (about ${amp.toFixed(0)} cents each way, asked 20)`);
  ok(hz > 4.5 && hz < 7, `vibrato rate is about ${hz.toFixed(1)} Hz (asked 5.8)`);
  ok(Math.abs(mean) < 5, `the vibrato is centred on the note (mean ${mean.toFixed(1)} cents)`); }
// plucked notes die away, bowed notes sustain
{ const one = [{ index: 0, midi: 57, startMs: 0, durationMs: 1500 }], rms = (x, a, b) => Math.sqrt(x.subarray(Math.round(a * SR), Math.round(b * SR)).reduce((s, v) => s + v * v, 0) / Math.round((b - a) * SR));
  const g = lib.psRender({ inst: 'guitar', sr: SR, tl: one, player: clean, seed: 1 }), v = lib.psRender({ inst: 'violin', sr: SR, tl: one, player: clean, seed: 1 });
  ok(rms(g.samples, g.padS + 1.1, g.padS + 1.4) < 0.55 * rms(g.samples, g.padS + 0.1, g.padS + 0.4), 'a guitar note decays');
  ok(rms(v.samples, v.padS + 1.1, v.padS + 1.4) > 0.6 * rms(v.samples, v.padS + 0.1, v.padS + 0.4), 'a bowed note sustains'); }
// slurred notes join without a new attack; separate bows stop short
{ const sl = lib.buildTimeline({ start: 55, type: 'major', span: 1, bpm: 70, slur: 4, rootPc: 7 }), r = lib.psRender({ inst: 'violin', sr: SR, tl: sl, player: clean, seed: 8, tonic: 7 });
  ok(r.truth[0].endMs >= sl[1].startMs - 1 && r.truth[3].endMs < sl[4].startMs, 'inside a slur the note runs into the next; at a bow change it stops short'); }
// the player model: levels are ordered, faults and skipped notes show in the truth
{ const dev = lvl => { const r = lib.psRender({ inst: 'violin', sr: 22050, tl: lib.buildTimeline({ start: 55, type: 'major', span: 3, bpm: 80, slur: 1, rootPc: 7 }), level: lvl, seed: 9, tonic: 7 }); const c = r.truth.filter(t => t.kind !== 'skipped').map(t => Math.abs(t.cents)); return { m: c.reduce((a, b) => a + b, 0) / c.length, r }; };
  const e = dev('expert'), g = dev('good'), a = dev('average'), w = dev('weak');
  ok(e.m < a.m && g.m < a.m && a.m < w.m, `intonation worsens with the level (mean |cents| expert ${e.m.toFixed(1)}, good ${g.m.toFixed(1)}, average ${a.m.toFixed(1)}, weak ${w.m.toFixed(1)})`);
  ok(w.r.truth.some(t => t.kind !== 'played'), 'a weak player skips or plays wrong notes, and the truth says which'); }
// timing: a constant lag and tempo drift show in the truth
{ const r = lib.psRender({ inst: 'violin', sr: 22050, tl, player: Object.assign({}, clean, { lag: 100, drift: 0.05 }), seed: 1, tonic: 7 });
  ok(Math.abs(r.truth[0].startMs - 100) < 1 && r.truth[7].startMs > tl[7].startMs + 100 + 0.02 * tl[7].startMs, 'lag and tempo drift show in the truth start times'); }
// the comparison the speaker test reports: a perfect listener scores perfectly, a deaf one is found out, and notes 45 cents out are counted apart
{ const t2 = lib.buildTimeline({ start: 55, type: 'major', span: 1, bpm: 80, slur: 1, rootPc: 7 }), r = lib.psRender({ inst: 'violin', sr: 22050, tl: t2, level: 'good', seed: 3, tonic: 7 }), sl = lib.psTruthSlots(r.truth, t2, { tol: 10, smooth: 7 });
  const c = lib.psCompare(r.truth, sl, t2);
  ok(c.detection.found === c.detection.played && c.pitch.medAbs < 5 && c.pitch.within10 === c.pitch.n, `a perfect listener finds every note (${c.detection.found}/${c.detection.played}) and reads within 5 cents (median ${c.pitch.medAbs.toFixed(2)})`);
  const half = lib.psCompare(r.truth, sl.map((x, i) => i % 2 ? Object.assign({}, x, { k: 's' }) : x), t2);
  ok(half.detection.found < c.detection.found && half.detection.missed.length > 0, 'notes the drill did not hear are reported as missed');
  const far = r.truth.map(t => Object.assign({}, t, { cents: 50 })), fs = lib.psTruthSlots(far, t2, { tol: 10, smooth: 7 }), fc = lib.psCompare(far, fs, t2);
  ok(fc.pitch.n === 0 && fc.pitch.ambiguous === fc.detection.found, 'notes 45 cents or more off are counted as ambiguous, not as measurement error'); }
console.log(fail ? `\n${fail} FAILED` : '\nall performance-synth checks pass'); process.exit(fail ? 1 : 0);
