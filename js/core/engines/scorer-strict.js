// Scale-drill grader "strict": today's behaviour. Every note is judged against the equal-tempered pitch, full marks only within 6 cents, nothing from 50 cents,
// timing tolerance 8% of a beat. Kept as a choice for players (and exams) who want the machine-exact view.
//   dev(cents, ctx)           -> the deviation the note is judged by (here: unchanged)
//   shift(devs, ctx)          -> cents of the player's overall offset to forgive while playing (here: none)
//   tol(T, ctx)               -> the "in tune" tolerance for the live traffic light (here: the Tuner's tolerance setting)
//   evaluate(slots, opts)     -> the run result (js/core/evaluation.js)
registerEngine({
  id: 'strict', role: 'scorer', label: 'Strict (equal temperament, exam-style)', version: '1',
  caps: { live: true, offline: true, needsHelper: false, needsDownloadMB: 0, license: 'own code' },
  params: {},
  dev(cents) { return cents; },
  shift() { return 0; },
  tol(T) { return T; },
  evaluate(slots, opts = {}) { const r = evaluateRun(slots, opts); if (r) r.engine = 'strict'; return r; },
  run(slots, opts) { return this.evaluate(slots, opts); },
});
