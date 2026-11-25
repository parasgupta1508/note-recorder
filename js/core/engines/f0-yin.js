// Engine wrapper: YIN with the harmonic check (js/core/pitch.js). The default "f0" engine and the only one that may call yin() directly.
//   frame(buf, sr, fmin, fmax, threshold) -> raw yin result { freq, clarity, p2, ... } | null   (the live path; one analysis window)
//   run({ x, sr, fmin, fmax, win, hop })  -> [{ t, hz, conf }]  (offline: frames over a whole recording; hz 0 = unvoiced)
registerEngine({
  id: 'yin', role: 'f0', label: 'YIN + harmonic check (built in)', version: '1',
  caps: { live: true, offline: true, polyphonic: false, instruments: ['violin', 'guitar', 'ukulele', 'piano', 'all'], needsHelper: false, needsDownloadMB: 0, license: 'own code (MIT idea from fgnass/tuner)', sampleRate: null },
  params: {},
  frame(buf, sr, fmin, fmax, threshold) { return yin(buf, sr, fmin, fmax, threshold); },
  run(input, opts = {}) {
    const x = input.x, sr = input.sr, lo = input.fmin || opts.fmin || 70, hi = input.fmax || opts.fmax || 2000, win = input.win || (lo < 60 ? 8192 : 4096), hop = input.hop || Math.round(sr / 60), out = [];
    for (let o = 0; o + win <= x.length; o += hop) {
      const r = yin(x.subarray(o, o + win), sr, lo, hi), t = (o + win / 2) / sr;
      out.push(r ? { t, hz: r.freq, conf: r.clarity } : { t, hz: 0, conf: 0 });
    }
    return out;
  },
  dispose() {},
});
