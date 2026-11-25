// Engine wrapper: the app's own note segmenter and listening rules (segmenter.js + listening.js). Default "segmenter" engine.
// It is a fused engine: the offline run() does f0 + segmenting together, exactly as analyseSamples always did.
//   create(onNote)            -> a live Segmenter (feed it frames with .frame(t, hz, level), finish with .end())
//   gate(...)                 -> recPitchCore: decides whether one analysed frame is a clean note
//   run({ x, sr }, opts)      -> notes   (opts as analyseSamples; returns a Promise when opts.chunk is set)
registerEngine({
  id: 'classic', role: 'segmenter', label: 'Classic listener (built in)', version: '1',
  caps: { live: true, offline: true, fused: true, polyphonic: false, instruments: ['violin', 'guitar', 'ukulele', 'piano', 'all'], needsHelper: false, needsDownloadMB: 0, license: 'own code', sampleRate: null },
  params: {},
  create(onNote) { return new Segmenter(onNote); },
  gate: recPitchCore,
  run(input, opts) { return analyseSamples(input.x, input.sr, opts); },
  dispose() {},
});
