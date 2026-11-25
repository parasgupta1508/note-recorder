// Live listening: modes, Auto mode, the per-frame note gate, and offline analysis of a whole recording with the same detector.
// Pure logic: no DOM, so it also runs in Node (tests load these same files).

// How strict the note listener is. onset/sustain = pitch clarity needed to start / keep a note,
// p2 = "the pitch must repeat" check that rejects noise, confirm = frames before a note counts.
const REC_MODES = {
  fast:    { onset: 0.86, sustain: 0,    p2: 0.4, confirm: 2, minDur: 30,  gateX: 1, miss: 3, gap: 1, win: 2048, own: true },   // quick runs: short analysis window, 2-frame onset
  relaxed: { onset: 0,    sustain: 0,    p2: 0,   confirm: 3, minDur: 0,   gateX: 1, miss: 5 },
  normal:  { onset: 0.90, sustain: 0,    p2: 0.5, confirm: 4, minDur: 0,   gateX: 1, miss: 5 },
  strict:  { onset: 0.92, sustain: 0.88, p2: 0.65, confirm: 4, minDur: 100, gateX: 1.6, miss: 5 },
};

// Auto listening: watches the sound while it runs and picks the best listening mode for it.
// It measures the noise floor, how much of the loud sound is NOT a clean pitch (accompaniment, noise, reverb),
// and how fast the notes come, then switches (with a short hold, so it never flickers).
const REC_NAMES = { auto: 'Auto', fast: 'Fast tempo', normal: 'Standard', strict: 'Noisy room', relaxed: 'Soft & quiet' };
class AutoMode {
  constructor() { this.reset(); }
  reset() { this.mode = 'fast'; this.why = 'listening…'; this.nf = 0; this.sig = 0; this.dirty = 0.2; this.prev = 0; this.n = 0; this.last = -99; this.ons = []; this.cand = 'fast'; this.hold = 0; }
  // rms = frame level, r = pitch result (or null), n frame index (60 per second)
  frame(rms, r) {
    const n = ++this.n, t = n / 60;
    this.nf = this.nf ? (rms < this.nf ? this.nf * 0.9 + rms * 0.1 : this.nf * 1.0003 + 1e-7) : rms;
    this.sig = rms > this.sig ? rms : this.sig * 0.998;
    const active = rms > Math.max(this.nf * 2.5, this.sig * 0.12, 0.003);
    if (active) { const bad = !r || r.clarity < 0.8 || (r.p2 != null && r.p2 < 0.5) ? 1 : 0; this.dirty += (bad - this.dirty) * 0.03; }
    if (active && rms > this.prev * 1.5 && t - this.last > 0.08) { this.last = t; this.ons.push(t); }
    this.prev = this.prev * 0.7 + rms * 0.3;
    while (this.ons.length && this.ons[0] < t - 2) this.ons.shift();
    if (n < 45) return this.mode;
    const snr = this.sig / Math.max(this.nf, 1e-6), rate = this.ons.length / 2;
    let c, why;
    if (snr < 3 || this.dirty > 0.75) { c = 'strict'; why = 'noisy or busy sound'; }
    else if (snr < 7 || this.dirty > 0.45) { c = 'normal'; why = 'some background sound'; }
    else if (this.sig < 0.02 && snr > 12 && this.dirty < 0.3) { c = 'relaxed'; why = 'soft and quiet'; }
    else { c = 'fast'; why = rate > 3 ? 'fast notes, clean sound' : 'clean sound'; }
    if (c === this.cand) { if (++this.hold >= 30 && c !== this.mode) { this.mode = c; this.why = why; } } else { this.cand = c; this.hold = 0; }
    return this.mode;
  }
}

// Decides whether one analysed frame is a clean note. m = listening-mode settings (REC_MODES entry).
function recPitchCore(r, rms, pk, conf, m, sg, gate, a4, relaxed) {
  if (!r) return null;
  if (relaxed) return r.clarity > conf ? r.freq : null;
  if (m.own) conf = Math.min(conf, 0.82);                // fast mode: a short window gives slightly lower clarity on real notes
  if (pk >= 0.98 && r.clarity < 0.95) return null;       // clipping distorts the wave but keeps its period: trust it only when the pitch is very clear (a loud close mic must still record)
  const same = sg.cur && Math.abs(centsBetween(r.freq, sg.refHz(sg.cur))) < 65;
  if (r.clarity < Math.max(conf, same ? m.sustain : m.onset)) return null;
  if (r.p2 != null && r.p2 < (same ? m.p2 * 0.8 : m.p2)) return null;
  if (!same && rms < gate * m.gateX) return null;
  return r.freq;
}

// Offline analysis of a whole recording (a decoded audio file): the same detector the live Recorder uses.
// opts: { fmin, fmax, conf, a4, m (REC_MODES entry), relaxed, onProgress, instrument, engines (Settings engines value) }  ->  array of notes.
// Runs synchronously unless opts.chunk is set, in which case it returns a Promise and yields to the UI between chunks.
function analyseSamples(x, sr, opts = {}) {
  let m = opts.m; const auto = opts.auto ? new AutoMode() : null, a4 = opts.a4 || 440, conf = opts.conf || 0.85, lo = opts.fmin || 70, hi = opts.fmax || 2000;
  const win = lo < 60 ? 8192 : 4096, hop = Math.round(sr / 60), n = Math.max(0, Math.floor((x.length - win) / hop));
  const out = [], sg = new Segmenter(ev => out.push(ev)), f0 = opts.f0 || getEngine('f0', opts.instrument, 'live', opts.engines);   // the pitch engine comes from the registry ("auto" = YIN)
  sg.a4 = a4; sg.minDur = m.minDur || 30; sg.confirm = m.confirm; sg.maxMiss = m.miss || 5; sg.gap = m.gap || 0;
  const rmsAt = f => { let s = 0, o = f * hop + win - 1024; for (let i = 0; i < 1024; i++) s += x[o + i] * x[o + i]; return Math.sqrt(s / 1024); };
  const lv = new Float32Array(n); for (let f = 0; f < n; f++) lv[f] = rmsAt(f);
  const sorted = Array.from(lv).sort((a, b) => a - b), q = p => sorted[Math.min(n - 1, Math.floor(n * p))] || 0;
  const gate = Math.max(0.002, q(0.1) * 3, q(0.95) * 0.06);             // adaptive: a quiet file and a loud file both work
  let f = 0;
  const step = lim => {
    for (; f < n && f < lim; f++) {
      const o = f * hop, w = m.win && lo >= 80 ? m.win : win, b = x.subarray(o + win - w, o + win);   // fast mode looks at only the newest 2048 samples, like the live Recorder
      let pk = 0; for (let i = 0; i < b.length; i += 4) { const a = Math.abs(b[i]); if (a > pk) pk = a; }
      let fR = null, rAuto = null;
      if (lv[f] > gate * 0.6) { const r = f0.frame(b, sr, lo, hi); rAuto = r; fR = recPitchCore(r, lv[f], pk, conf, m, sg, gate, a4, m === REC_MODES.relaxed); }
      if (auto) { auto.frame(lv[f], rAuto); if (REC_MODES[auto.mode] !== m) { m = REC_MODES[auto.mode]; sg.minDur = m.minDur || 30; sg.confirm = m.confirm; sg.maxMiss = m.miss || 5; sg.gap = m.gap || 0; } }
      sg.frame((o + win / 2) / sr, fR, lv[f]);
    }
  };
  const finish = () => { sg.end(); return out; };
  if (!opts.chunk) { step(n); return finish(); }
  return new Promise(res => { const tick = () => { step(f + 150); if (opts.onProgress) opts.onProgress(f / Math.max(1, n)); f < n ? setTimeout(tick, 0) : res(finish()); }; tick(); });
}

