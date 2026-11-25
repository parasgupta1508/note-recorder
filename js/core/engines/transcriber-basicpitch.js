// Engine wrapper: Basic Pitch (Spotify, Apache-2.0) + the app's own refinement (detailed.js). Default "transcriber" engine.
// This file holds the part that needs no browser: postprocess() turns the model's raw notes into the app's notes.
// The browser file js/app/engines/basicpitch.js attaches run(), which loads the model and calls postprocess().
//   postprocess(raw, x, sr, o) -> notes     o: { a4, poly, lo, hi (Hz) }
registerEngine({
  id: 'basicpitch', role: 'transcriber', label: 'Basic Pitch + refinement (built in)', version: '1',
  caps: { live: false, offline: true, polyphonic: true, instruments: ['violin', 'guitar', 'ukulele', 'piano', 'all'], needsHelper: false, needsBrowser: true, needsDownloadMB: 0, license: 'Apache-2.0', sampleRate: 22050 },
  params: {},
  postprocess(raw, x, sr, o) {
    const toMidi = f => Math.round(69 + 12 * Math.log2(f / o.a4));
    return extractMelody(refineEvents(markAttacks(bpToEvents(raw, o.a4), x, sr), x, sr, { a4: o.a4, poly: o.poly }), { lo: toMidi(o.lo) - 1, hi: toMidi(o.hi) + 1, poly: o.poly });   // chord instruments keep every note; violin, voice etc. get one melody line
  },
  async run() { throw new Error('Basic Pitch needs the browser: js/app/engines/basicpitch.js attaches its runner.'); },
  dispose() {},
});
