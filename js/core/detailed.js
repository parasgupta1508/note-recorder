// Detailed analysis helpers: resampler, Basic Pitch notes -> app notes, attack marking, YIN pitch refinement, melody extraction.
// Pure logic: no DOM, so it also runs in Node (tests load these same files).

// High-quality resampler (windowed sinc, low-pass at the lower of the two Nyquist rates so nothing aliases). x = Float32Array or Int16Array
// (scale = what to divide Int16 by). Used to feed Basic Pitch its 22,050 Hz audio from whatever the device records at (44.1 or 48 kHz).
function resample(x, from, to, scale = 1) {
  if (from === to && scale === 1) return Float32Array.from(x);
  const ratio = from / to, n = Math.floor((x.length - 1) / ratio), out = new Float32Array(n), cut = Math.min(1, to / from) * 0.94, half = Math.ceil(16 / cut);
  const tab = new Float32Array(2049), at = u => { const a = Math.abs(u); return a >= half ? 0 : (a < 1e-9 ? 1 : Math.sin(Math.PI * cut * a) / (Math.PI * cut * a)) * (0.5 + 0.5 * Math.cos(Math.PI * a / half)) * cut; };
  for (let i = 0; i <= 2048; i++) tab[i] = at(i / 2048 * half);
  for (let o = 0; o < n; o++) {
    const p = o * ratio, c = Math.floor(p); let acc = 0;
    for (let j = c - half + 1; j <= c + half; j++) { if (j < 0 || j >= x.length) continue; const u = Math.abs(j - p) / half * 2048, k = u | 0, w = tab[k] + (tab[Math.min(2048, k + 1)] - tab[k]) * (u - k); acc += x[j] * w; }
    out[o] = acc / scale;
  }
  return out;
}
// Basic Pitch notes -> the app's note shape. bends are in 1/3 semitone per frame (11.6 ms per frame).
function bpToEvents(bp, a4 = 440) {
  return bp.map(n => {
    // Basic Pitch's notes sit on a fixed A = 440 grid and its pitch bend has only 1/3-semitone steps. Work out the frequency on that grid first,
    // then name the note from the user's own A4. (refineEvents below measures the pitch properly from the sound.)
    const b = (n.pitchBends || []).map(v => v - 1), mean = b.length ? b.reduce((x, y) => x + y, 0) / b.length : 0;   // this Basic Pitch build counts bends from 1: 1.0 = exactly on the note (measured: in tune 1.0, +30¢ 2.0, -30¢ 0.0)
    const hz = 440 * Math.pow(2, (n.pitchMidi - 69) / 12 + mean / 36), nn = freqToNote(hz, a4);
    const step = Math.max(1, Math.ceil(b.length / 120)), pts = [];
    for (let i = 0; i < b.length; i += step) pts.push([Math.round(i * 256 / 22050 * 1000), +((b[i] - mean) * 100 / 3 + nn.cents).toFixed(1)]);
    return { midi: nn.midi, note: midiName(nn.midi), hz, cents: nn.cents, start: n.startTimeSeconds, dur: n.durationSeconds * 1000, lvl: +(20 * Math.log10(Math.max(1e-4, n.amplitude))).toFixed(1), pts, vib: vibratoOf(pts), amp: n.amplitude, src: 'bp' };
  }).sort((a, b) => a.start - b.start);
}
// Energy at one pitch over time: its 1st + 2nd harmonic, 46 ms Hann window every 6 ms. Looking only at the note's own pitch means other
// instruments (a piano under a violin) cannot disturb it. Returns { m: magnitudes, t: window-centre times in seconds }.
function bandEnv(x, sr, hz, from, to) {
  const W = Math.round(sr * 0.046), hop = Math.round(sr * 0.006), m = [], t = [], w1 = 2 * Math.PI * hz / sr, w2 = 2 * w1;
  bandEnv.win = bandEnv.win && bandEnv.win.length === W ? bandEnv.win : Float32Array.from({ length: W }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (W - 1)));
  const win = bandEnv.win, a0 = Math.max(0, Math.round(from * sr) - W / 2), a1 = Math.min(x.length - W, Math.round(to * sr) - W / 2);
  for (let a = a0; a <= a1; a += hop) {
    let r1 = 0, i1 = 0, r2 = 0, i2 = 0;
    for (let i = 0; i < W; i++) { const v = x[a + i] * win[i]; r1 += v * Math.cos(w1 * i); i1 -= v * Math.sin(w1 * i); r2 += v * Math.cos(w2 * i); i2 -= v * Math.sin(w2 * i); }
    m.push(Math.hypot(r1, i1) + Math.hypot(r2, i2)); t.push((a + W / 2) / sr);
  }
  return { m, t };
}
// Marks notes that begin with a fresh attack: the energy at the note's own pitch jumps to 2.5x what it was just before the start, or doubles
// right after a clear dip (a bow change or a re-pluck). A slow swell, or a piano attack that only nudges the level, does not count.
// extractMelody uses it so that a REPEATED note is not glued onto the previous one, while one note that Basic Pitch broke in two still is.
function markAttacks(ev, x, sr) {
  return ev.map(e => {
    const { m, t } = bandEnv(x, sr, e.hz, e.start - 0.3, e.start + 0.14); if (m.length < 6) return e;
    let pre = Infinity, post = 0, prePeak = 0;
    for (let i = 0; i < m.length; i++) { if (t[i] <= e.start + 0.02) { if (t[i] >= e.start - 0.12) pre = Math.min(pre, m[i]); if (t[i] <= e.start - 0.04) prePeak = Math.max(prePeak, m[i]); } else post = Math.max(post, m[i]); }
    return post >= 2.5 * pre || (post >= 2 * pre && prePeak >= 1.5 * pre) ? { ...e, split: true } : e;
  });
}
// Basic Pitch is very good at WHICH notes were played and WHEN, but its pitch is coarse. Re-measure each note on the original sound with the same
// YIN the Live path uses, searching only within 1.5 semitones of Basic Pitch's pitch, so the octave and the note can never be changed to something else.
// ev = notes from bpToEvents, x = Float32 sound, sr = its sample rate. o: { a4, poly }. Notes with no clear pitch keep Basic Pitch's value.
function refineEvents(ev, x, sr, o = {}) {
  const a4 = o.a4 || 440, minClar = o.poly ? 0.9 : 0.8;
  return ev.map(e => {
    const lo = e.hz * Math.pow(2, -1.5 / 12), hi = e.hz * Math.pow(2, 1.5 / 12), N = Math.max(1024, 3 * Math.ceil(sr / lo)), hop = Math.round(sr * 0.012);
    const skip = e.dur > 150 ? 0.04 : 0.015, s0 = Math.round((e.start + skip) * sr), s1 = Math.round((e.start + e.dur / 1000 - 0.02) * sr);
    const fr = [];
    for (let a = s0; a <= Math.max(s0, s1 - N); a += hop) {
      const st = Math.max(0, Math.min(x.length - N, a)); if (st < 0 || st + N > x.length) continue;
      const w = x.subarray(st, st + N); let r2 = 0; for (let i = 0; i < N; i += 2) r2 += w[i] * w[i];
      const r = yin(w, sr, lo, hi); if (r && r.clarity >= minClar && (r.p2 == null || r.p2 > 0.4)) fr.push({ t: (st + N / 2) / sr - e.start, f: r.freq, lv: Math.sqrt(r2 / (N / 2)) });
    }
    if (fr.length < 2) return e;
    const top = Math.max(...fr.map(q => q.lv)), good = fr.filter(q => q.lv >= top * 0.3);       // drop the faint decay tail
    if (good.length < 2) return e;
    const hz = median(good.map(q => q.f)), nn = freqToNote(hz, a4), ref = noteToFreq(nn.midi, a4);
    let pts = e.pts, vib = e.vib;
    if (good.length >= 6) { pts = good.map(q => [Math.round(q.t * 1000), +centsBetween(q.f, ref).toFixed(1)]); vib = vibratoOf(pts); }
    return { ...e, midi: nn.midi, note: midiName(nn.midi), hz, cents: nn.cents, pts, vib, refined: true };
  });
}
// Picks the melody out of a polyphonic note list (violin over piano). Works on app notes (start s, dur ms).
// o: { lo, hi (MIDI range), minDur (ms), mergeGap (ms) }
function extractMelody(ev, o = {}) {
  const lo = o.lo ?? 0, hi = o.hi ?? 127, minDur = o.minDur ?? 90, mergeGap = o.mergeGap ?? 70;
  let n = ev.filter(e => e.midi >= lo && e.midi <= hi && e.dur >= minDur);
  const end = e => e.start + e.dur / 1000, ov = (a, b) => Math.max(0, Math.min(end(a), end(b)) - Math.max(a.start, b.start));
  const keep = n.map(() => true);
  for (let i = 0; i < n.length; i++) for (let j = 0; j < n.length; j++) {            // pass 1: overtones (an octave / twelfth / double octave above a stronger note that starts with it)
    if (i === j) continue; const a = n[i], b = n[j], d = b.midi - a.midi;
    if ((d === -12 || d === -19 || d === -24) && b.amp >= a.amp * (o.poly ? 1.6 : 0.8) && Math.abs(a.start - b.start) < 0.08 && ov(a, b) / (a.dur / 1000) >= 0.6) keep[i] = false;
  }
  n = n.filter((_, i) => keep[i]);
  const keep2 = n.map(() => true);
  if (o.skyline !== false && !o.poly) for (let i = 0; i < n.length; i++) for (let j = 0; j < n.length; j++) {   // pass 2: a clearly stronger note above covers most of this one = accompaniment
    if (i === j) continue; const a = n[i], b = n[j], d = b.midi - a.midi;
    if (d >= 1 && d <= 36 && b.amp >= a.amp * 0.6 && ov(a, b) / (a.dur / 1000) >= 0.6 && ov(a, b) / (b.dur / 1000) > 0.5) keep2[i] = false;
  }
  n = n.filter((_, i) => keep2[i]);
  // one tune: strongest and longest notes win; a weaker note that mostly overlaps an already chosen one is accompaniment
  if (o.poly) return mergeSame(n);                  // chord instruments (guitar, ukulele, piano): keep every note, only tidy
  const chosen = [], order = n.map((e, i) => i).sort((i, j) => (n[j].amp || 0.1) * Math.sqrt(n[j].dur) - (n[i].amp || 0.1) * Math.sqrt(n[i].dur));
  for (const i of order) { const e = n[i]; if (chosen.every(c => ov(e, c) / (e.dur / 1000) < 0.35)) chosen.push(e); }
  n = chosen.sort((x, y) => x.start - y.start).map(e => ({ ...e }));
  for (let i = 0; i + 1 < n.length; i++) if (end(n[i]) > n[i + 1].start) n[i].dur = Math.max(minDur * 0.6, (n[i + 1].start - n[i].start) * 1000);   // trim the small overlap
  return mergeSame(n);
  function mergeSame(n) {
  const out = [], lastOf = new Map();
  for (const e of n.slice().sort((x, y) => x.start - y.start)) {                               // merge fragments of one note (per pitch, so chords work too)
    const p = lastOf.get(e.midi);
    if (p && p.midi === e.midi && !e.split && e.start - end(p) < mergeGap / 1000) { p.dur = (end(e) - p.start) * 1000; p.pts = (p.pts || []).concat((e.pts || []).map(q => [q[0] + Math.round((e.start - p.start) * 1000), q[1]])); p.amp = Math.max(p.amp || 0, e.amp || 0); p.vib = vibratoOf(p.pts); }
    else { const q = { ...e }; out.push(q); lastOf.set(e.midi, q); }
  }
  return out;
  }
}

