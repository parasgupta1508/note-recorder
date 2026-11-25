// Browser part of the Basic Pitch transcriber: loads the model (vendor/) and runs it. The note clean-up is in js/core/engines/transcriber-basicpitch.js.
// Shared by the Recorder and the Lab page. Needs loadBP and BP_PARAMS from recorder.js at call time.
//   run(x, o): x = 22,050 Hz samples;  o: { lo, hi (Hz), poly, a4, onStatus(text), onProgress(0..1) }  ->  notes
extendEngine('transcriber', 'basicpitch', {
  async run(x, o) {
    o.onStatus && o.onStatus('Loading detailed analysis…'); await loadBP(); const BP = window.BP;
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
    if (!BP.model) { const m = BP.tf.loadGraphModel('vendor/model/model.json'); m.catch(() => { if (BP.model === m) BP.model = null; }); BP.model = m; }
    await new Promise(r => setTimeout(r, 30));
    const bp = new BP.BasicPitch(BP.model), F = [], O = [], C = [];
    await bp.evaluateModel(x, (f, ons, c) => { for (let i = 0; i < f.length; i++) { F.push(f[i]); O.push(ons[i]); } for (let i = 0; i < c.length; i++) C.push(c[i]); }, p => { o.onProgress && o.onProgress(p); });
    const raw = BP.noteFramesToTime(BP.addPitchBendsToNoteEvents(C, BP.outputToNotesPoly(F, O, BP_PARAMS.onset, BP_PARAMS.frame, BP_PARAMS.minLen, true, o.hi, o.lo)));
    return this.postprocess(raw, x, 22050, o);
  },
});
