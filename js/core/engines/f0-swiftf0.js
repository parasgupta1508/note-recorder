// Engine wrapper: SwiftF0 (Lars Nieradzik, MIT), a 14k-parameter neural pitch tracker, run with ONNX. A CANDIDATE for the "f0" role (docs/accuracy-report.md).
// It is registered so the gold harness (tests/gold.js) and the contract test can measure it, but it is switched OFF for the app (caps.offline false, caps.live false):
// Settings > Engines does not list it and getEngine never picks it. "auto" stays on yin until the owner approves the Phase A memo.
// To switch it on after approval: ship the runtime under vendor/swiftf0/, attach infer() in a js/app/engines file (as basicpitch.js does) and set caps.offline true.
//
// This file holds everything that needs no runtime (the model call itself is infer(), attached by the host):
//   infer(audio, fmin, fmax) -> Promise<{ pitch: ArrayLike<number> (Hz), confidence: ArrayLike<number> }>   audio = Float32Array of 16 kHz samples; one value per 256 samples
//   run({ x, sr, fmin, fmax }, opts) -> Promise<[{ t, hz, conf }]>   x MUST already be 16 kHz (caps.sampleRate); hz 0 = unvoiced; t = frame index * 16 ms, as in the reference code
// Windowing, the silence gate and the 0.5 voicing threshold follow swift_f0/core.py of the 0.3.0 release (reference only; none of its code is copied).
const SWIFTF0 = { sr: 16000, hop: 256, fmin: 46.875, fmax: 2093.75, block: 1875, left: 11, ahead: 10, silencePeak: 1e-3, voiced: 0.5 };
// pitch/confidence per frame + the audio they came from -> engine frames. Pure, so it is tested without the runtime.
function swiftf0Frames(pitch, conf, x, o = {}) {
  const lo = o.fmin || SWIFTF0.fmin, hi = o.fmax || SWIFTF0.fmax, thr = o.voiced == null ? SWIFTF0.voiced : o.voiced, first = o.first || 0, out = [];
  for (let i = 0; i < pitch.length; i++) {
    let c = conf[i], pk = 0; const a = (first + i) * SWIFTF0.hop;
    for (let k = a; k < a + SWIFTF0.hop && k < x.length; k++) { const v = Math.abs(x[k]); if (v > pk) pk = v; }
    if (pk < SWIFTF0.silencePeak) c = 0;                                        // a hop with no signal is never voiced
    const hz = pitch[i], ok = c >= thr && hz >= lo && hz <= hi;
    out.push({ t: (first + i) * SWIFTF0.hop / SWIFTF0.sr, hz: ok ? hz : 0, conf: Math.max(0, Math.min(1, c)) });
  }
  return out;
}
registerEngine({
  id: 'swiftf0', role: 'f0', label: 'SwiftF0 (candidate, ONNX)', version: '0.3.0',
  caps: { live: false, offline: false, candidate: true, needsRuntime: true, polyphonic: false, instruments: ['violin', 'guitar', 'ukulele', 'piano', 'all'], needsHelper: false, needsDownloadMB: 15.4, license: 'MIT', sampleRate: 16000, rangeHz: [46.875, 2093.75] },
  params: { voiced: { label: 'Voicing threshold', default: 0.5, min: 0.2, max: 0.9, step: 0.05 }, normalise: { label: 'Scale quiet recordings up first', type: 'switch', default: false } },
  async run(input, opts = {}) {
    if (typeof this.infer !== 'function') throw new Error('SwiftF0: no runtime attached (infer is missing)');
    if (input.sr !== SWIFTF0.sr) throw new Error('SwiftF0 takes 16 kHz audio; resample first (caps.sampleRate)');
    const lo = Math.max(SWIFTF0.fmin, input.fmin || opts.fmin || SWIFTF0.fmin), hi = Math.min(SWIFTF0.fmax, input.fmax || opts.fmax || SWIFTF0.fmax), H = SWIFTF0.hop;
    let x = input.x; const n = Math.max(1, Math.floor(x.length / H)), out = [], par = Object.assign({}, this.paramValues, opts.params);
    if (par.normalise) { let pk = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; } if (pk > 0) { const g = 0.5 / pk; x = Float32Array.from(x, v => v * g); } }
    for (let a = 0; a < n; a += SWIFTF0.block) {                               // long audio goes through in windows, with context on both sides (as the reference does)
      const b = Math.min(n, a + SWIFTF0.block), ca = Math.max(0, a - SWIFTF0.left), cb = Math.min(n, b + SWIFTF0.ahead), seg = new Float32Array(Math.max(H, (cb - ca) * H));
      seg.set(x.subarray(ca * H, Math.min(x.length, cb * H)));
      const r = await this.infer(seg, lo, hi);
      out.push(...swiftf0Frames(Array.from(r.pitch).slice(a - ca, b - ca), Array.from(r.confidence).slice(a - ca, b - ca), x, { fmin: lo, fmax: hi, voiced: par.voiced, first: a }));
    }
    return out;
  },
  dispose() { if (typeof this.release === 'function') this.release(); },
});
