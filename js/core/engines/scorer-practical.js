// Scale-drill grader "practical": how a human teacher listens, not how a tuner measures. People do not play exact equal-tempered frequencies, so:
//   1. Expressive intonation (bowed strings): a note is right anywhere between its equal-tempered, just and Pythagorean pitch for its place in the scale, and a high
//      leading tone is allowed to be sharp (professional violinists play it so; Lund University studies of concertmasters, Pythagorean/just tuning tendencies).
//      Fretted instruments and piano are equal-tempered, so they keep the single target.
//   2. Overall offset is forgiven: if the whole scale sits 10 cents flat the player is consistent, which is a tuning (or starting-note) matter, not 15 bad notes.
//      The median offset of the run is taken out (weight "drift") and reported separately so the player can fix it.
//   3. A tolerance zone, not a pin: full marks within `tolerance` cents of the target zone, falling to zero over 32 cents (the strict grader: 6 and 44).
//   4. Timing: a human drifts by a tenth of a beat; full marks within 12% of a beat of the player's own steady lag, zero by 52%.
//   5. Steadiness: normal vibrato and wobble get 25% more allowance. A wrong note costs the same as in strict (3 points, up to 30): that is not a human wobble.
// The score keeps the same shape and bands as strict, so history, charts and the coach work unchanged. Published figures behind the defaults: perceptual tolerance
// windows of about -10 to +15 cents in singing and intonation research; 5 to 10 cents is the smallest difference trained listeners can hear.
const PRAC_JI = [0, 11.7, 3.9, 15.6, -13.7, -2.0, -9.8, 2.0, 13.7, -15.6, -3.9, -11.7];       // 5-limit just intonation, cents from equal temperament, by semitones above the tonic
const PRAC_PY = [0, -9.8, 3.9, -5.9, 7.8, -2.0, 11.7, 2.0, -7.8, 5.9, -3.9, 9.8];             // Pythagorean (stacked fifths): thirds and leading tone higher
const PRAC_HI = { 11: 20 };                                                                     // a high leading tone (the semitone to the tonic narrowed)
const pracClamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pracMedian = a => { const s = a.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const pracP = (ctx, k, d) => ctx && ctx.params && ctx.params[k] != null ? +ctx.params[k] : d;
registerEngine({
  id: 'practical', role: 'scorer', label: 'Practical (human tolerance, expressive intonation)', version: '1',
  caps: { live: true, offline: true, needsHelper: false, needsDownloadMB: 0, license: 'own code' },
  params: {
    tolerance: { type: 'range', label: 'In-tune tolerance (cents)', min: 6, max: 30, step: 1, default: 12 },
    expressive: { type: 'switch', label: 'Allow just / Pythagorean intonation on bowed strings', default: 1 },
    drift: { type: 'range', label: 'Forgive overall offset (%)', min: 0, max: 100, step: 5, default: 70 },
  },
  // Deviation from the nearest acceptable pitch for this note. ctx: { midi, root (pitch class of the tonic), fretless, params }.
  dev(cents, ctx = {}) {
    if (!ctx.fretless || !pracP(ctx, 'expressive', 1)) return cents;
    const iv = (((ctx.midi - (ctx.root || 0)) % 12) + 12) % 12, lo = Math.min(0, PRAC_JI[iv], PRAC_PY[iv]), hi = Math.max(0, PRAC_JI[iv], PRAC_PY[iv], PRAC_HI[iv] || 0);
    return cents > hi ? cents - hi : cents < lo ? cents - lo : 0;
  },
  // The player's overall offset so far (median of the notes already played, needs 4), scaled by the drift setting: shifted out of the live meter and the grade.
  shift(devs, ctx) {
    if (!devs || devs.length < 4) return 0;
    return pracClamp(pracMedian(devs), -30, 30) * pracP(ctx, 'drift', 70) / 100;
  },
  tol(T, ctx) { return Math.max(T, pracP(ctx, 'tolerance', 12)); },
  evaluate(slots, opts = {}) {
    const ctx = { params: opts.params }, free = pracP(ctx, 'tolerance', 12), drift = pracP(ctx, 'drift', 70) / 100;
    const dv = x => (typeof x.m === 'number' ? x.m : x.c), played = slots.filter(x => x.k === 'h' && typeof dv(x) === 'number');
    const offset = played.length >= 4 ? pracClamp(pracMedian(played.map(dv)), -30, 30) : 0;
    const adj = slots.map(x => x.k === 'h' ? Object.assign({}, x, { c: x.c == null ? x.c : x.c - drift * offset, m: typeof x.m === 'number' ? x.m - drift * offset : x.m }) : x);
    const r = evaluateRun(adj, Object.assign({}, opts, { wobbleCap: (opts.wobbleCap || 25) * 1.25, curve: { free, span: 32, pulseFree: 0.12, pulseSpan: 0.40, wrongPenalty: 3, wrongCap: 30 } }));
    if (r) { r.engine = 'practical'; r.offset = Math.round(offset * 10) / 10; }
    return r;
  },
  run(slots, opts) { return this.evaluate(slots, opts); },
});
