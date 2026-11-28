// Performance synthesiser: renders a human-like PERFORMANCE of a timeline (a scale or a piece) as audio, with the truth of what was played.
// Used by the speaker-to-microphone self test (js/app/speaker-test.js, tests/mic-loopback.js --mode speaker) and by the Node tests, so the real detector and grader
// can be run on sound that has a known answer. Pure logic: no DOM, no storage, no Web Audio; it returns plain Float32Array samples.
//
//   psRender({ inst, sr, tl, level|player, seed, tonic, a4, peak }) -> { sr, samples, padS, durationS, truth, player, inst, seed }
//     inst    'violin' | 'guitar' | 'ukulele'
//     tl      the timeline the drill scores: [{ index, midi, startMs, durationMs }] (js/core/scales.js buildTimeline, or timelineFromPart)
//     level   a PS_PLAYERS preset name ('expert' | 'good' | 'average' | 'weak'); player: overrides on top of the preset
//     padS    seconds of audio before the drill's first beat (so a note played early is not cut off): start playback at (first-beat time - padS)
//     truth   one entry per timeline note: { index, midi (target), playedMidi, kind: 'played'|'skipped'|'wrong', cents (the player's real deviation from equal
//             temperament of playedMidi, vibrato centre), startMs, endMs (when it was really played, from the first beat), vib: { hz, depth } | null, amp }
// What is modelled, so the sound is a player and not a beep:
//   violin   bowed: sawtooth-like harmonic series shaped by body resonances, bow hiss, an attack "bite" and scratch, a slow bow-pressure wander, slurred notes that join
//            without a new attack, a scoop into each note and a short slide into a shift, and vibrato (rate 5-6.5 Hz that wanders, depth that wanders, starts late, only on long notes)
//   guitar / ukulele  plucked: inharmonic partials that die at their own rates, pluck position, pick noise, the pitch rising a few cents at the pluck, a string-dependent decay
//   player   intonation scatter, a whole-scale offset, just intonation on a bowed string, onsets early/late with a constant lag and drifting tempo, notes shorter than written,
//            level changes, and (weaker players) out-of-tune notes, wrong notes and skipped notes

const PS_JI = [0, 11.7, 3.9, 15.6, -13.7, -2.0, -9.8, 2.0, 13.7, -15.6, -3.9, -11.7];   // just intonation, cents from equal temperament, by semitones above the tonic
const PS_PLAYERS = {
  expert:  { label: 'Expert',  sigma: 3,  offset: 0,  just: true,  vibrato: true, vibHz: 5.8, vibDepth: 14, vibDelay: 0.22, scoop: 6,  slide: 0.6, jitter: 10, lag: 0,  drift: 0,     durFrac: 0.93, ampVar: 0.05, bow: 0.22, faultP: 0,    wrongP: 0,    skipP: 0 },
  good:    { label: 'Good',    sigma: 6,  offset: 3,  just: true,  vibrato: true, vibHz: 5.6, vibDepth: 18, vibDelay: 0.25, scoop: 12, slide: 0.8, jitter: 25, lag: 30, drift: 0,     durFrac: 0.90, ampVar: 0.08, bow: 0.30, faultP: 0.02, wrongP: 0,    skipP: 0 },
  average: { label: 'Average', sigma: 12, offset: 7,  just: false, vibrato: true, vibHz: 5.2, vibDepth: 24, vibDelay: 0.30, scoop: 22, slide: 1,   jitter: 45, lag: 60, drift: 0.010, durFrac: 0.86, ampVar: 0.12, bow: 0.40, faultP: 0.06, wrongP: 0.02, skipP: 0 },
  weak:    { label: 'Weak',    sigma: 22, offset: 15, just: false, vibrato: true, vibHz: 5.0, vibDepth: 28, vibDelay: 0.35, scoop: 35, slide: 1,   jitter: 90, lag: 90, drift: 0.030, durFrac: 0.80, ampVar: 0.18, bow: 0.55, faultP: 0.15, wrongP: 0.05, skipP: 0.05 },
};
const PS_INSTRUMENTS = ['violin', 'guitar', 'ukulele', 'piano'];

const psHz = (midi, a4 = 440) => a4 * Math.pow(2, (midi - 69) / 12);
const psClamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
// A small seeded generator (mulberry32), so the same seed always renders the same performance.
function psRng(seed) {
  let a = (seed >>> 0) || 1;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.g = () => { let s = 0; for (let i = 0; i < 6; i++) s += r(); return (s - 3) / 0.70711; };   // roughly normal, unit spread
  return r;
}

// ---- one bowed note (violin). o: { midi, cents, t0, dur, amp, attack, release, legato, scoop, slide (cents, shift into the note), vib: { hz, depth, delay } | null, bow, bright }
function psViolinNote(buf, sr, o, rnd) {
  const f0 = psHz(o.midi + o.cents / 100, o.a4), n = Math.round(o.dur * sr), s0 = Math.round(o.t0 * sr), nh = Math.max(4, Math.min(30, Math.floor(sr * 0.45 / f0)));
  const amps = new Float64Array(nh), cph = new Float64Array(nh), sph = new Float64Array(nh);
  for (let h = 1; h <= nh; h++) {
    const f = f0 * h;   // the harmonic series is shaped by the body: air and wood resonances near 290 and 450 Hz, the bridge hill near 2.5 kHz
    amps[h - 1] = Math.pow(h, -0.95 / (o.bright || 1)) * (1 + 0.9 * Math.exp(-Math.pow((f - 290) / 60, 2)) + 1.5 * Math.exp(-Math.pow((f - 450) / 160, 2)) + 1.2 * Math.exp(-Math.pow((f - 2600) / 700, 2)));
    const q = rnd() * 6.2832; cph[h - 1] = Math.cos(q); sph[h - 1] = Math.sin(q);
  }
  const w1 = rnd() * 6.2832, w2 = rnd() * 6.2832, vib = o.vib; let ph = rnd() * 6.2832, vph = rnd() * 6.2832, lp = 0;
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    if (s0 + i < 0) continue;
    const t = i / sr;
    let cents = -(o.scoop || 0) * Math.exp(-t / 0.05) + (o.slide || 0) * Math.exp(-t / 0.014);
    let am = 1;
    if (vib) {
      const depth = vib.depth * psClamp((t - vib.delay) / 0.25) * (1 + 0.15 * Math.sin(6.2832 * 0.8 * t + w1)), rate = vib.hz * (1 + 0.04 * Math.sin(6.2832 * 0.5 * t + w2));
      vph += 6.2832 * rate / sr; cents += depth * Math.sin(vph); am += 0.07 * (depth / vib.depth) * Math.sin(vph + 1);   // vibrato also moves the loudness a little (the body resonances)
    }
    ph += 6.2832 * f0 * Math.pow(2, cents / 1200) / sr;
    let env = Math.min(1, t / o.attack) * Math.min(1, (o.dur - t) / o.release) * am * (1 + 0.06 * Math.sin(6.2832 * 1.7 * t + w1) + 0.04 * Math.sin(6.2832 * 0.6 * t + w2));
    if (!o.legato) env *= 1 + 0.35 * Math.exp(-t / 0.03);   // a new bow bites a little
    const s1 = Math.sin(ph), c1 = Math.cos(ph); let sh = s1, ch = c1, v = 0;   // sin and cos of every harmonic from the first one (angle addition): two trig calls a sample, not thirty
    for (let h = 0; h < nh; h++) { v += amps[h] * (sh * cph[h] + ch * sph[h]); const ns = sh * c1 + ch * s1; ch = ch * c1 - sh * s1; sh = ns; }
    lp += 0.25 * ((rnd() * 2 - 1) - lp);                      // bow hiss
    const scratch = !o.legato && t < 0.014 ? (rnd() * 2 - 1) * (1 - t / 0.014) * o.bow * 0.9 : 0;
    buf[s0 + i] += o.amp * env * (v * 0.3 + o.bow * lp * 0.5 + scratch);
  }
}

// ---- one plucked note (guitar, ukulele). o: { midi, cents, t0, dur, amp, inst }
function psPluckNote(buf, sr, o, rnd) {
  const uke = o.inst === 'ukulele', f0 = psHz(o.midi + o.cents / 100, o.a4), n = Math.round(o.dur * sr), s0 = Math.round(o.t0 * sr), B = uke ? 3e-5 : (o.midi < 52 ? 1.5e-4 : 6e-5);
  const nh = Math.max(3, Math.min(uke ? 12 : 24, Math.floor(sr * 0.45 / f0))), pos = (uke ? 0.15 : 0.12) + rnd() * 0.1;
  const T = uke ? 1.1 : (o.midi < 52 ? 3.2 : o.midi < 64 ? 2.4 : 1.6), weak = uke ? 1 : f0 < 140 ? 0.25 : f0 < 200 ? 0.6 : 1, parts = [];
  for (let h = 1; h <= nh; h++) {
    const f = f0 * h * Math.sqrt(1 + B * h * h); if (f > sr * 0.45) break;
    let a = Math.abs(Math.sin(Math.PI * h * pos)) / Math.pow(h, uke ? 1.5 : 1.05) * (h === 1 ? weak : 1);
    if (uke) a *= 1 + 1.3 * Math.exp(-Math.pow((f - 420) / 140, 2)); else if (f0 < 200) a *= 1 + 1.5 * Math.exp(-Math.pow((f - 280) / 120, 2));
    const k = 6.9 / (T / (1 + (uke ? 0.7 : 0.45) * (h - 1))), q = rnd() * 6.2832; parts.push({ f, a, d: Math.exp(-k / sr), re: Math.cos(q), im: Math.sin(q), cr: Math.cos(6.2832 * f / sr), ci: Math.sin(6.2832 * f / sr) });
  }
  const pk = uke ? 0.008 : 0.012;
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    if (s0 + i < 0) continue;
    const t = i / sr, mute = psClamp((o.dur - t) / 0.03), glide = t < 0.2 ? Math.pow(2, 6 * Math.exp(-t / 0.04) / 1200) : 1;   // the string is a few cents sharp just after the pluck
    let v = 0;
    for (const p of parts) {   // each partial is a turning vector that shrinks at its own rate
      v += p.a * p.im; let cr = p.cr, ci = p.ci; if (glide !== 1) { const w = 6.2832 * p.f * glide / sr; cr = Math.cos(w); ci = Math.sin(w); }
      const nr = p.re * cr - p.im * ci; p.im = p.re * ci + p.im * cr; p.re = nr; p.a *= p.d;
    }
    const pick = t < pk ? (rnd() * 2 - 1) * (1 - t / pk) * (uke ? 0.35 : 0.6) : 0;
    buf[s0 + i] += o.amp * mute * Math.min(1, t / 0.002) * (v + pick);
  }
}

function psRender(spec) {
  const sr = spec.sr || 44100, inst = PS_INSTRUMENTS.includes(spec.inst) ? spec.inst : 'violin', a4 = spec.a4 || 440, tl = spec.tl || [];
  const P = Object.assign({}, PS_PLAYERS[spec.level] || PS_PLAYERS.good, typeof spec.player === 'object' && spec.player ? spec.player : {});
  if (inst === 'piano') Object.assign(P, { sigma: 0, offset: 0, just: false, scoop: 0, slide: 0, faultP: 0, vibrato: false });   // a piano's pitch is fixed by its tuning: the player cannot play a note flat
  // spec.voice (optional): (out, sr, note, rnd) -> true when it played the note (js/core/sampler.js smVoice: real recordings). spec.vibOf(midi, vel): the vibrato those recordings carry.
  const rnd = psRng(spec.seed == null ? 1 : spec.seed), tonic = spec.tonic != null ? spec.tonic : (tl.length ? tl[0].midi % 12 : 0), padS = 0.35;
  const n = tl.length, plan = [], truth = [];
  for (let i = 0; i < n; i++) {
    const t = tl[i], next = tl[i + 1], beatMs = next ? next.startMs - t.startMs : (i ? t.startMs - tl[i - 1].startMs : 750);
    const legato = !!(next && t.durationMs >= beatMs - 1);                                    // joined to the next note by a slur
    const skipped = rnd() < P.skipP, wrong = !skipped && rnd() < P.wrongP;
    const playedMidi = wrong ? t.midi + (rnd() < 0.5 ? 1 : -1) * (rnd() < 0.7 ? 1 : 2) : t.midi;
    const fault = !skipped && rnd() < P.faultP ? (rnd() < 0.5 ? -1 : 1) * (25 + rnd() * 20) : 0;
    const deg = (((playedMidi - tonic) % 12) + 12) % 12, just = P.just && inst === 'violin' ? PS_JI[deg] : 0;
    const cents = (spec.plant && spec.plant.index === i ? spec.plant.cents : P.offset + P.sigma * rnd.g() + fault) + just;   // spec.plant: one note made out of tune on purpose, to see whether the feedback finds it
    const startMs = t.startMs * (1 + P.drift * (n > 1 ? i / (n - 1) : 0)) + P.lag + P.jitter * rnd.g();
    const nextStart = next ? next.startMs * (1 + P.drift * ((i + 1) / (n - 1))) + P.lag : startMs + beatMs;
    const endMs = legato ? Math.max(startMs + 80, nextStart + 8) : startMs + Math.max(60, t.durationMs * P.durFrac * (1 + 0.05 * rnd.g()));
    const amp = psClamp(1 + P.ampVar * rnd.g(), 0.5, 1.5), long = endMs - startMs >= 300;
    const vib = spec.vibOf ? spec.vibOf(playedMidi, amp) : inst === 'violin' && P.vibrato && long ? { hz: P.vibHz * (1 + 0.05 * rnd.g()), depth: P.vibDepth * (1 + 0.15 * rnd.g()), delay: P.vibDelay } : null;
    plan.push({ i, skipped, playedMidi, cents, startMs, endMs, legato, amp, vib, wrong });
    truth.push({ index: t.index == null ? i : t.index, midi: t.midi, playedMidi: skipped ? null : playedMidi, kind: skipped ? 'skipped' : wrong ? 'wrong' : 'played', cents: skipped ? null : +cents.toFixed(2), startMs: +startMs.toFixed(1), endMs: +endMs.toFixed(1), vib: vib ? { hz: +vib.hz.toFixed(2), depth: +vib.depth.toFixed(1) } : null, amp: +amp.toFixed(3) });
  }
  const lastEnd = n ? Math.max(...plan.map(p => p.endMs)) : 0, durationS = padS + lastEnd / 1000 + (inst === 'violin' ? 0.5 : 1.8);
  const buf = new Float32Array(Math.max(1, Math.ceil(durationS * sr)));
  const bright = 0.9 + rnd() * 0.25;   // one violin's character for the whole take
  for (const p of plan) {
    if (p.skipped) continue;
    const prev = p.i ? plan[p.i - 1] : null, t0 = padS + p.startMs / 1000, dur = (p.endMs - p.startMs) / 1000 + (inst === 'violin' ? 0.02 : 0);
    const slurred = prev && !prev.skipped && prev.legato, shift = slurred ? Math.max(-150, Math.min(150, (prev.playedMidi - p.playedMidi) * 100)) : 0;
    const common = { midi: p.playedMidi, cents: p.cents, t0, dur, amp: 0.3 * p.amp, vel: p.amp, a4, inst };
    if (spec.voice && spec.voice(buf, sr, Object.assign({}, common, { legato: !!slurred, release: p.legato ? 0.012 : 0.05 }), rnd)) continue;
    if (inst === 'violin') psViolinNote(buf, sr, Object.assign(common, { attack: slurred ? 0.012 : 0.04 + rnd() * 0.03, release: p.legato ? 0.012 : 0.05, legato: slurred, scoop: slurred ? 0 : P.scoop * (0.5 + rnd()), slide: shift * P.slide, vib: p.vib, bow: P.bow, bright }), rnd);
    else psPluckNote(buf, sr, common, rnd);
  }
  let pk = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > pk) pk = a; }
  const g = pk > 0 ? (spec.peak || 0.7) / pk : 1; for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return { sr, samples: buf, padS, durationS, truth, player: P, inst, seed: spec.seed == null ? 1 : spec.seed };
}

// ---- what a perfect listener would have measured: the truth turned into the slots the drill stores (same figures the app computes from frames). Scoring these with the same
// grader gives the score the performance deserves; the difference from the score the microphone path gave is the error of listening.
//   psTruthSlots(truth, tl, { tol, smooth, fps }) -> slots for evaluateRun
function psTruthSlots(truth, tl, o = {}) {
  const tolC = o.tol || 10, smooth = o.smooth || 5, fps = o.fps || 60, out = [];
  truth.forEach((t, i) => {
    const base = { index: t.index, pass: 1, name: tl[i].noteName || 'n' + i, midi: tl[i].midi, d: tl[i].direction || 'up', wrong: t.kind === 'wrong' ? 1 : 0, rt: 0 };
    if (t.kind !== 'played') { out.push(Object.assign(base, { k: 's' })); return; }
    const n = Math.max(1, Math.round((t.endMs - t.startMs) / 1000 * fps)), frames = [], w = t.vib ? 6.2832 * t.vib.hz : 0;
    for (let f = 0; f < n; f++) frames.push(t.cents + (t.vib ? t.vib.depth * Math.sin(w * f / fps) : 0));
    const st = holdStats(frames, tolC, smooth), body = smoothCents(frames.slice(Math.min(3, frames.length >> 2)), smooth), m = evalMedian(body);
    out.push(Object.assign(base, { k: 'h', c: st.c, m, a: st.a, s: n >= 4 ? st.s : null, e: t.startMs - tl[i].startMs, sp: Math.abs(frames[0] - m) }));
  });
  return out;
}

// ---- what the microphone path measured against what was played. slots: the drill's slots for one pass. Returns the figures the speaker test reports.
function psCompare(truth, slots, tl, opts = {}) {
  const minHz = opts.minHz || 0, rig = truth.map(t => minHz > 0 && psHz(t.playedMidi == null ? t.midi : t.playedMidi) < minHz);   // notes a small speaker cannot reproduce are left out: that is the rig, not the app
  const q = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const rows = truth.map((t, i) => {
    if (rig[i]) return { index: t.index, kind: 'rig', heard: false, wrongFlag: false, meas: null, err: null, timeErr: null, vib: !!t.vib, rig: true };
    const s = slots.find(x => x.index === t.index), heard = !!s && s.k === 'h', meas = heard ? (typeof s.m === 'number' ? s.m : s.c) : null;
    return { index: t.index, kind: t.kind, heard, wrongFlag: !!s && s.wrong > 0, meas, err: heard && t.kind === 'played' && t.cents != null ? meas - t.cents : null,
      timeErr: heard && t.kind === 'played' && s.e != null ? s.e - (t.startMs - tl[i].startMs) : null, vib: !!t.vib };
  });
  // A note 45 cents or more from its target (or whose vibrato swings it across the halfway point: centre plus depth of 60 or more) is as near to the next semitone: whether it is
  // "badly out of tune" or "a wrong note" is a judgement, not a measurement, so it is counted apart.
  const played = rows.filter(r => r.kind === 'played'), found = played.filter(r => r.heard), clear = found.filter(r => { const t = truth.find(q => q.index === r.index); return Math.abs(t.cents) < 45 && Math.abs(t.cents) + (t.vib ? t.vib.depth : 0) < 60; }), ambiguous = found.length - clear.length;
  const err = clear.map(r => r.err).filter(x => x != null), abs = err.map(Math.abs), te = found.map(r => r.timeErr).filter(x => x != null);
  const bad = rows.filter(r => r.kind !== 'played');
  return {
    rows, rigLimited: rig.filter(Boolean).length,
    pitch: { n: err.length, ambiguous, bias: q(err, 0.5), medAbs: q(abs, 0.5), p95Abs: q(abs, 0.95), within5: abs.filter(x => x <= 5).length, within10: abs.filter(x => x <= 10).length },
    detection: { played: played.length, found: found.length, playedLong: played.filter(r => { const t = truth.find(q => q.index === r.index); return t.endMs - t.startMs >= 100; }).length, foundLong: found.filter(r => { const t = truth.find(q => q.index === r.index); return t.endMs - t.startMs >= 100; }).length, missed: played.filter(r => !r.heard).map(r => r.index), skippedTruth: bad.filter(r => r.kind === 'skipped').length, wrongTruth: bad.filter(r => r.kind === 'wrong').length,
      badFound: bad.filter(r => r.heard).length, wrongFlagged: bad.filter(r => r.wrongFlag).length, falseWrong: played.filter(r => r.wrongFlag && clear.includes(r)).length },
    timing: { latencyMs: q(te, 0.5), spreadMs: te.length ? q(te, 0.75) - q(te, 0.25) : null, n: te.length },
  };
}

// ---- is the FEEDBACK right? The test knows what was really wrong (the truth), so the notes the app tells the player to work on can be checked against it.
//   psFeedbackCheck(truth, tl, spots, o) -> { worst, recall, named, falseSpots, signWrong }
//   spots: what the app named: [{ name, midi?, d?: 'up'|'down', bar?, bias? }] (bias: the cents the app measured, its sign is the "sharp / flat" it will have told the player)
//   worst: the (up to) 3 notes that were really worst: a note 15 cents or more out (o.min), or one that was skipped or wrong
//   recall: the share of those the app named (null when nothing was clearly wrong, so there is nothing to find)
//   falseSpots: spots that name a note that was in tune (under 10 cents) wherever it occurs; signWrong: spots whose sharp / flat is the wrong way round
function psFeedbackCheck(truth, tl, spots, o = {}) {
  const min = o.min == null ? 15 : o.min, at = i => tl[i] || {};
  const match = (s, i) => (s.midi == null || at(i).midi === s.midi) && (s.name == null || at(i).noteName === s.name) && (s.d == null || (at(i).direction || 'up') === s.d) && (s.bar == null || at(i).bar === s.bar);
  const bad = truth.map((t, i) => ({ i, w: t.kind !== 'played' ? 100 : Math.abs(t.cents) })).filter(x => x.w >= min).sort((a, b) => b.w - a.w).slice(0, 3);
  const recall = bad.length ? bad.filter(w => spots.some(s => match(s, w.i))).length / bad.length : null;
  const falseSpots = spots.filter(s => !truth.some((t, i) => match(s, i) && (t.kind !== 'played' || Math.abs(t.cents) >= 10))).length;
  let signWrong = 0; for (const s of spots) { if (s.bias == null || Math.abs(s.bias) < 8) continue; const cs = truth.map((t, i) => match(s, i) && t.kind === 'played' ? t.cents : null).filter(v => v != null); if (cs.length && Math.abs(cs.reduce((a, b) => a + b, 0) / cs.length) >= 8 && Math.sign(cs.reduce((a, b) => a + b, 0)) !== Math.sign(s.bias)) signWrong++; }
  return { worst: bad.map(w => ({ index: w.i, note: at(w.i).noteName, bar: at(w.i).bar, cents: truth[w.i].kind === 'played' ? Math.round(truth[w.i].cents) : truth[w.i].kind })), recall, named: spots.length, falseSpots, signWrong };
}
