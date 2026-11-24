// Pitch detection: YIN (de Cheveigne & Kawahara 2002) with a harmonic check. The single entry point every module uses (tuner, practice, recorder, file analysis).
// Pure logic: no DOM, so it also runs in Node (tests load these same files).

// Magnitude of one frequency in a Hann-windowed buffer (a single DFT bin; cheap, no FFT needed for a handful of frequencies).
function binMag(buf, sr, f) {
  const N = buf.length, w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;   // Goertzel
  for (let i = 0; i < N; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)), s0 = buf[i] * h + c * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2);
}
function yin(buf, sr, fmin, fmax, threshold = 0.15) {
  const N = buf.length, W = N >> 1;
  const tauMin = Math.max(2, Math.floor(sr / fmax));
  const tauMax = Math.min(W - 1, Math.ceil(sr / fmin));
  const d = new Float32Array(tauMax + 2), raw = new Float32Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1 && tau < W; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    d[tau] = raw[tau] = s;
  }
  let run = 0; d[0] = 1;
  for (let tau = 1; tau <= tauMax + 1 && tau < W; tau++) {
    run += d[tau];
    d[tau] = run === 0 ? 1 : d[tau] * tau / run;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) { while (t + 1 <= tauMax && d[t + 1] < d[t]) t++; tau = t; break; }
  }
  if (tau < 0) return null;
  // Harmonic check (the idea in fgnass/tuner and aubio: YIN gives a coarse period, the spectrum confirms it is the FUNDAMENTAL).
  // The first dip under the threshold can be a half or a third of the true period, i.e. a strong 2nd or 3rd harmonic (a bowed violin note
  // swelling or fading, a violin E string): that reads as a note an octave or a twelfth too high. If there is real energy at f/2 or f/3
  // and the signal also repeats much more cleanly at 2x / 3x the period, then f/k is the true pitch. A clear peak at f/k is required, so two notes that merely
  // share a common sub-period (a ringing fifth) are NOT mistaken for a missing fundamental.
  const dmin = t => {
    let m = t; for (let j = Math.max(1, t - 2); j <= t + 2 && j <= tauMax; j++) if (d[j] < d[m]) m = j;
    if (m > 1 && m <= tauMax) { const a = d[m - 1], b = d[m], c = d[m + 1], den = a + c - 2 * b; if (den > 0) return { v: b - (a - c) * (a - c) / (8 * den), m }; }
    return { v: d[m], m };
  };
  const d0 = dmin(tau).v;
  if (d0 > 0.04) {
    const f = sr / tau, mf = Math.max(binMag(buf, sr, f * 0.993), binMag(buf, sr, f), binMag(buf, sr, f * 1.007));
    let best = tau, bm = 0;
    for (let k = 2; k <= 3 && tau * k + 2 <= tauMax; k++) {
      const q = dmin(tau * k), fs = sr / q.m;
      if (q.v > 0.5 * d0 || q.v > 0.1) continue;                  // must repeat clearly better at k times the period
      const ms = Math.max(binMag(buf, sr, fs * 0.993), binMag(buf, sr, fs), binMag(buf, sr, fs * 1.007));
      const floor = Math.max(binMag(buf, sr, fs * 0.5), binMag(buf, sr, fs * 0.75));   // where nothing should sound: the noise floor
      if (ms >= 0.1 * mf && ms >= 6 * floor && ms > bm) { best = q.m; bm = ms; }   // a real peak at f/k (a violin's 3rd harmonic can be 5x louder than its fundamental)
    }
    if (best !== tau) tau = best;
  }
  let better = tau;
  if (tau > 1 && tau < tauMax) {
    // Interpolate on the RAW difference curve: the normalised one is tilted by the running mean, which shifts the minimum a little.
    const a = raw[tau - 1], b = raw[tau], c = raw[tau + 1], den = a + c - 2 * b;
    if (den > 0) better = tau + (a - c) / (2 * den);
  }
  // Second opinion: a real pitch repeats, so the signal two periods later must still match.
  // Noise, breath and rustle can dip below the threshold once but rarely twice (p2 ≈ 1 = periodic, ≈ 0 = noise).
  let p2 = null;
  if (2 * tau <= N - W) {
    let s = 0, e = 0;
    for (let i = 0; i < W; i++) { const a = buf[i], b = buf[i + 2 * tau]; s += (a - b) * (a - b); e += a * a + b * b; }
    p2 = e > 0 ? 1 - s / e : 0;
  }
  return { freq: sr / better, clarity: 1 - d[tau], p2 };
}

