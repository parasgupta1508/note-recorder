// Optional pitch engines you can pick for the Tuner (Settings > Engines > "Tuner algorithm"): pYIN and McLeod (MPM).
// "Auto" is still YIN + harmonic check (f0-yin.js). Nothing here changes what Auto does.
//   frame(buf, sr, fmin, fmax) -> { freq, clarity, p2 } | null      (the live path: one analysis window, no memory between calls)
//   run({ x, sr, fmin, fmax, win, hop }) -> [{ t, hz, conf }]       (offline: frames over a recording; hz 0 = unvoiced)
// Both are written from the published papers (no code copied):
//   pYIN  - Mauch & Dixon 2014, "pYIN: a fundamental frequency estimator using probabilistic threshold distributions".
//   MPM   - McLeod & Wyvill 2005, "A smarter way to find pitch" (normalised square difference function, key-maximum peak picking).

const _clampTau = (sr, fmin, fmax, W) => [Math.max(2, Math.floor(sr / fmax)), Math.min(W - 1, Math.ceil(sr / fmin))];
function _p2(buf, tau) {   // same "does it still repeat two periods later" check yin() reports: ~1 = periodic, ~0 = noise
  const N = buf.length, W = N >> 1; if (2 * tau > N - W) return null;
  let s = 0, e = 0; for (let i = 0; i < W; i++) { const a = buf[i], b = buf[i + 2 * tau]; s += (a - b) * (a - b); e += a * a + b * b; }
  return e > 0 ? 1 - s / e : 0;
}
// ---- pYIN: YIN's cumulative-mean-normalised difference curve, but instead of ONE threshold it tries many, weighted by a Beta(2,18) prior (mean 0.1).
// Every threshold nominates a period; the nominations are added up, so a period that survives strict AND loose thresholds wins. This is what stops
// the octave jumps a single threshold makes. Returns the candidate periods with probabilities and the chance that the frame is voiced at all.
const PYIN_TH = Array.from({ length: 40 }, (_, i) => 0.01 + i * 0.0125);                        // thresholds 0.01 .. 0.4975
const PYIN_W = (() => { const w = PYIN_TH.map(t => t * Math.pow(1 - t, 17)), s = w.reduce((a, b) => a + b, 0); return w.map(x => x / s); })();   // Beta(2,18) density, normalised
function pyinCandidates(buf, sr, fmin, fmax) {
  const N = buf.length, W = N >> 1, [tauMin, tauMax] = _clampTau(sr, fmin, fmax, W);
  if (tauMax <= tauMin + 2) return null;
  const d = new Float32Array(tauMax + 2), raw = new Float32Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1 && tau < W; tau++) { let s = 0; for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; } d[tau] = raw[tau] = s; }
  let run = 0; d[0] = 1; for (let tau = 1; tau <= tauMax + 1 && tau < W; tau++) { run += d[tau]; d[tau] = run === 0 ? 1 : d[tau] * tau / run; }
  const acc = new Map(); let voiced = 0, gmin = tauMin;
  for (let t = tauMin; t <= tauMax; t++) if (d[t] < d[gmin]) gmin = t;
  for (let k = 0; k < PYIN_TH.length; k++) {
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) if (d[t] < PYIN_TH[k]) { while (t + 1 <= tauMax && d[t + 1] < d[t]) t++; tau = t; break; }
    if (tau < 0) { acc.set(gmin, (acc.get(gmin) || 0) + PYIN_W[k] * 0.01); continue; }   // nothing under this threshold: the best dip gets a tiny share (as in the paper)
    acc.set(tau, (acc.get(tau) || 0) + PYIN_W[k]); voiced += PYIN_W[k];
  }
  const cands = [];
  for (const [tau, prob] of acc) {
    let better = tau; if (tau > 1 && tau < tauMax) { const a = raw[tau - 1], b = raw[tau], c = raw[tau + 1], den = a + c - 2 * b; if (den > 0) better = tau + (a - c) / (2 * den); }
    cands.push({ tau, freq: sr / better, prob, clarity: 1 - d[tau] });
  }
  cands.sort((a, b) => b.prob - a.prob || a.tau - b.tau);   // most probable first; on a tie the shorter period (higher note) is not preferred over a longer one that repeats as well
  return { cands, voiced: Math.min(1, voiced) };
}
registerEngine({
  id: 'pyin', role: 'f0', label: 'pYIN (probabilistic YIN)', version: '1',
  caps: { live: true, offline: true, polyphonic: false, instruments: ['violin', 'guitar', 'ukulele', 'piano', 'all'], needsHelper: false, needsDownloadMB: 0, dev: true, license: 'own code from the pYIN paper', sampleRate: null },
  params: {},
  frame(buf, sr, fmin, fmax) {
    const c = pyinCandidates(buf, sr, fmin, fmax); if (!c || !c.cands.length || c.voiced < 0.15) return null;
    const b = c.cands[0]; return { freq: b.freq, clarity: b.clarity, p2: _p2(buf, b.tau) };
  },
  run(input, opts = {}) {
    const x = input.x, sr = input.sr, lo = input.fmin || opts.fmin || 70, hi = input.fmax || opts.fmax || 2000, win = input.win || (lo < 60 ? 8192 : 4096), hop = input.hop || Math.round(sr / 60), fr = [];
    for (let o = 0; o + win <= x.length; o += hop) { const c = pyinCandidates(x.subarray(o, o + win), sr, lo, hi); fr.push({ t: (o + win / 2) / sr, c: c && c.cands.length ? { cands: c.cands.slice(0, 5), voiced: c.voiced } : null }); }
    // Viterbi over the whole recording: states = the frame's top candidates + "unvoiced". A pitch jump costs (Gaussian in semitones), a voiced/unvoiced switch costs a little.
    const SIG = 3, SWITCH = Math.log(0.02), lg = p => Math.log(Math.max(p, 1e-9)), st = fr.map(f => { const s = [{ hz: 0, ll: f.c ? lg(1 - f.c.voiced) : 0, conf: 0 }]; if (f.c) f.c.cands.forEach(k => s.push({ hz: k.freq, ll: lg(k.prob * f.c.voiced / Math.max(1e-9, f.c.cands.reduce((a, b) => a + b.prob, 0))), conf: k.clarity })); return s; });
    const cost = (a, b) => a.hz && b.hz ? -Math.pow(12 * Math.log2(a.hz / b.hz), 2) / (2 * SIG * SIG) : (a.hz || b.hz) ? SWITCH : 0, score = [], back = [];
    st.forEach((s, i) => { score[i] = []; back[i] = []; s.forEach((q, j) => { if (!i) { score[i][j] = q.ll; back[i][j] = -1; return; } let best = -Infinity, bi = 0; st[i - 1].forEach((p, k) => { const v = score[i - 1][k] + cost(p, q); if (v > best) { best = v; bi = k; } }); score[i][j] = best + q.ll; back[i][j] = bi; }); });
    const out = new Array(fr.length); let j = 0; if (fr.length) { const last = score[fr.length - 1]; for (let k = 1; k < last.length; k++) if (last[k] > last[j]) j = k; }
    for (let i = fr.length - 1; i >= 0; i--) { const q = st[i][j]; out[i] = { t: fr[i].t, hz: q.hz, conf: q.conf }; j = back[i][j]; }
    return out;
  },
  dispose() {},
});

// ---- McLeod pitch method: normalised square difference function n(tau) = 2 r(tau) / m(tau), in -1..1 (1 = a perfect repeat).
// Take the FIRST clear peak (>= 0.93 of the highest), not the highest: that is what keeps it off the octave-down errors, with no spectrum check needed.
function mpmFrame(buf, sr, fmin, fmax, K = 0.93) {
  const N = buf.length, W = N >> 1, [tauMin, tauMax] = _clampTau(sr, fmin, fmax, W); if (tauMax <= tauMin + 2) return null;
  const sq = new Float64Array(N + 1); for (let i = 0; i < N; i++) sq[i + 1] = sq[i] + buf[i] * buf[i];
  const nsdf = new Float32Array(tauMax + 2); let e0 = sq[W];
  for (let tau = 1; tau <= tauMax + 1 && tau < W; tau++) {
    let r = 0; for (let i = 0; i < W; i++) r += buf[i] * buf[i + tau];
    const m = e0 + (sq[W + tau] - sq[tau]); nsdf[tau] = m > 1e-12 ? 2 * r / m : 0;
  }
  // key maxima: the highest point of every stretch where nsdf is positive (after it has first gone negative, so the lag-0 lobe is skipped)
  const peaks = []; let t = 1; while (t <= tauMax && nsdf[t] > 0) t++;
  while (t <= tauMax) {
    while (t <= tauMax && nsdf[t] <= 0) t++;
    let bi = -1; while (t <= tauMax && nsdf[t] > 0) { if (t >= tauMin && (bi < 0 || nsdf[t] > nsdf[bi])) bi = t; t++; }
    if (bi > 1 && bi < tauMax) peaks.push(bi);
  }
  if (!peaks.length) return null;
  const top = Math.max(...peaks.map(p => nsdf[p])), tau = peaks.find(p => nsdf[p] >= K * top);
  let better = tau; { const a = nsdf[tau - 1], b = nsdf[tau], c = nsdf[tau + 1], den = a + c - 2 * b; if (den < 0) better = tau + (a - c) / (2 * den); }
  return { freq: sr / better, clarity: Math.max(0, Math.min(1, nsdf[tau])), p2: _p2(buf, tau) };
}
registerEngine({
  id: 'mpm', role: 'f0', label: 'McLeod (MPM / NSDF)', version: '1',
  caps: { live: true, offline: true, polyphonic: false, instruments: ['violin', 'guitar', 'ukulele', 'piano', 'all'], needsHelper: false, needsDownloadMB: 0, dev: true, license: 'own code from the McLeod paper', sampleRate: null },
  params: {},
  frame(buf, sr, fmin, fmax) { return mpmFrame(buf, sr, fmin, fmax); },
  run(input, opts = {}) {
    const x = input.x, sr = input.sr, lo = input.fmin || opts.fmin || 70, hi = input.fmax || opts.fmax || 2000, win = input.win || (lo < 60 ? 8192 : 4096), hop = input.hop || Math.round(sr / 60), out = [];
    for (let o = 0; o + win <= x.length; o += hop) { const r = mpmFrame(x.subarray(o, o + win), sr, lo, hi), t = (o + win / 2) / sr; out.push(r && r.clarity > 0.5 ? { t, hz: r.freq, conf: r.clarity } : { t, hz: 0, conf: 0 }); }
    return out;
  },
  dispose() {},
});
