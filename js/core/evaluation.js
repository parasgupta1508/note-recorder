// Trinity-style evaluation of one scale run (one pass up and down): a 100-point rubric, an attainment band, and per-direction figures.
// Pure logic: no DOM, so it also runs in Node (tests load this same file).
//
//   Pitch & intonation  50%  median deviation of each note after its attack, and a penalty for wrong notes (65 cents or more away)
//   Fluency & pulse     30%  note onsets against the click, and continuity (skips, retries and mid-scale stops)
//   Tone & steadiness   20%  how steady the pitch is (each instrument has its own wobble allowance) and how cleanly each note was entered
//
// A slot is the result for one scale position: { name, midi, d:'up'|'down', k:'h'|'s', c (mean cents), m (median cents after the attack, optional),
// a (share of frames in tolerance), s (wobble, cents), e (timing error ms or null), sp (cents between the first frame and the steady pitch, optional),
// wrong (wrong notes heard while this one was expected), rt (retries) }.

const EVAL_WEIGHTS = { pitch: 0.5, fluency: 0.3, tone: 0.2 };
const EVAL_BANDS = [[87, 'Distinction'], [75, 'Merit'], [60, 'Pass'], [0, 'Below Pass']];
const evalBand = score => { const r = Math.round(score); return (EVAL_BANDS.find(b => r >= b[0]) || EVAL_BANDS[EVAL_BANDS.length - 1])[1]; };

const evalClamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const evalMean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const evalMedian = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

// Pitch score of one played note, from its deviation in cents (sign ignored): full marks within 6 cents, nothing from 50 cents.
const evalPitchOf = (dev, share = 1, free = 6, span = 44) => 100 * (0.8 * evalClamp(1 - Math.max(0, Math.abs(dev) - free) / span) + 0.2 * evalClamp(share));   // free: cents with full marks, span: cents over which the marks fall to zero
const EVAL_WRONG_PENALTY = 3, EVAL_WRONG_CAP = 30;   // points off the pitch score per wrong note, and the most a run can lose that way
// A note this many cents from its pitch is a fault a listener hears whatever the length of the scale: it costs points on top of its share of the mean, so one bad note in a
// three-octave scale is not averaged away.
const EVAL_FAULT_AT = 30, EVAL_FAULT_PENALTY = 2, EVAL_FAULT_CAP = 20;
// No pillar can be carried by the others: a run whose intonation, fluency or tone is poor cannot reach a higher band however good the rest is. [pillar below this, best total allowed]
const EVAL_CAPS = { pitch: [[50, 74], [80, 86]], fluency: [[45, 74], [65, 86]], tone: [[35, 86]] };

// Onsets: a constant lag (microphone, Bluetooth or just playing a little behind) is reported but not punished; only the unevenness is.
function evalPulse(errs, beatMs, free = 0.08, span = 0.37) {
  const e = errs.filter(x => typeof x === 'number'); if (!e.length) return null;
  const lag = evalMedian(e);
  return { lag, score: 100 * evalMean(e.map(x => evalClamp(1 - Math.max(0, Math.abs(x - lag) - free * beatMs) / (span * beatMs)))) };
}
// Evenness: how much each gap between neighbouring notes differs from the beat, which a constant lag, a slowly changing tempo and the click grid cannot hide.
// ordered: the played notes in scale order, { index, e (onset error in ms) }; only notes next to each other are compared.
function evalEven(ordered, beatMs, free = 0.06, span = 0.18) {
  const d = []; for (let i = 1; i < ordered.length; i++) if (ordered[i].index === ordered[i - 1].index + 1) d.push(Math.abs(ordered[i].e - ordered[i - 1].e));
  return d.length ? 100 * evalMean(d.map(x => evalClamp(1 - Math.max(0, x - free * beatMs) / (span * beatMs)))) : null;
}
// Steadiness of one held note: wobble up to a quarter of the instrument's allowance costs nothing, the full allowance earns nothing.
const evalSteady = (s, cap) => typeof s === 'number' ? evalClamp(1 - Math.max(0, s - 0.25 * cap) / (0.75 * cap)) : 0.75;

// evaluateRun(slots, { beatMs, mode:'tempo'|'wait', wobbleCap, curve }) -> result, or null for an empty run
// curve (optional, used by the "practical" grader): { free, span (cents), pulseFree, pulseSpan (beats), wrongPenalty, wrongCap }; the defaults below are the strict grader.
function evaluateRun(slots, opts = {}) {
  const n = slots.length; if (!n) return null;
  const beatMs = opts.beatMs || 750, cap = opts.wobbleCap || 25, tempo = opts.mode !== 'wait';
  const cv = Object.assign({ free: 6, span: 44, pulseFree: 0.08, pulseSpan: 0.37, evenFree: 0.06, evenSpan: 0.18, wrongPenalty: EVAL_WRONG_PENALTY, wrongCap: EVAL_WRONG_CAP }, opts.curve);
  const hits = slots.filter(x => x.k === 'h'), dev = x => (typeof x.m === 'number' ? x.m : x.c);
  const wrongNotes = slots.reduce((s, x) => s + (x.wrong || 0), 0), retries = slots.reduce((s, x) => s + (x.rt || 0), 0);

  // pitch
  const notePitch = slots.map(x => x.k === 'h' ? evalPitchOf(dev(x), x.a, cv.free, cv.span) : 0);
  const faults = hits.filter(x => Math.abs(dev(x)) >= EVAL_FAULT_AT).length;
  const pitch = evalClamp(evalMean(notePitch) - Math.min(cv.wrongCap, cv.wrongPenalty * wrongNotes) - Math.min(EVAL_FAULT_CAP, EVAL_FAULT_PENALTY * faults), 0, 100);

  // fluency: pulse (Tempo-locked only) and continuity
  const pu = tempo ? evalPulse(hits.map(x => x.e), beatMs, cv.pulseFree, cv.pulseSpan) : null;
  const ordered = hits.filter(x => typeof x.e === 'number').sort((a, b) => a.index - b.index);
  let stalls = 0; for (let i = 1; i < ordered.length; i++) if (ordered[i].index === ordered[i - 1].index + 1 && ordered[i].e - ordered[i - 1].e > 0.75 * beatMs) stalls++;   // a gap of most of a beat or more: the player stopped and restarted
  const shorts = hits.filter(x => typeof x.r === 'number' && x.r < 0.6).length;   // notes cut short: held for under 60% of their written length (only measured where a note can be held)
  const continuity = 100 * evalClamp((hits.length - 0.5 * retries - stalls - 0.5 * shorts) / n);
  const even = tempo ? evalEven(ordered, beatMs, cv.evenFree, cv.evenSpan) : null, pulse = pu ? (even == null ? pu.score : 0.5 * pu.score + 0.5 * even) : null;
  const fluency = pu ? 0.6 * pulse + 0.4 * continuity : continuity;

  // tone
  // Each note is judged on what could be measured: steadiness (wobble), the entry (how far the first frame was from where the pitch settled) and cleanliness (how clearly pitched
  // the sound was: scratch and bow noise lower it). A part that could not be measured is left out, not filled in with a neutral mark.
  // Cleanliness is judged against this player's own run (the 80th percentile of the notes' clarity), not an absolute level: a noisy room or a poor microphone lowers every note
  // alike and is not the player's tone. It needs at least 5 measured notes.
  const cls = hits.map(x => x.cl).filter(v => typeof v === 'number').sort((a, b) => a - b), clRef = cls.length >= 5 ? cls[Math.floor(0.8 * (cls.length - 1))] : null;
  const noteTone = hits.map(x => {
    if (typeof x.s !== 'number') return null;   // too short to measure its wobble: it is not judged on tone at all (a short note must not earn full marks, or lose them)
    const part = [[0.5, evalSteady(x.s, cap)], [0.3, typeof x.sp === 'number' ? evalClamp(1 - x.sp / 40) : null], [0.2, clRef != null && typeof x.cl === 'number' ? evalClamp(1 - (clRef - x.cl) / 0.06) : null]].filter(q => q[1] != null);
    if (!part.length) return null; const w = part.reduce((a, q) => a + q[0], 0);
    return 100 * part.reduce((a, q) => a + q[0] * q[1], 0) / w * (x.wrong ? 0.6 : 1);
  }).filter(v => v != null);
  const tone = noteTone.length ? evalMean(noteTone) : hits.length ? 75 : 0;   // nothing measurable (every note too short): a neutral mark, flagged by toneMeasured

  // How well the microphone heard the player: the median share of each bowed note for which a pitch was heard. Poor means the room, the microphone or its distance, not the playing.
  const covs = hits.map(x => x.cov).filter(v => typeof v === 'number'), coverage = covs.length >= 5 ? evalMedian(covs) : null, listen = coverage == null ? null : coverage >= 0.75 ? 'good' : coverage >= 0.5 ? 'fair' : 'poor';
  let total = Math.round(EVAL_WEIGHTS.pitch * pitch + EVAL_WEIGHTS.fluency * fluency + EVAL_WEIGHTS.tone * tone), capped = null;
  for (const k of ['pitch', 'fluency', 'tone']) { const v = { pitch, fluency, tone }[k]; for (const [below, best] of EVAL_CAPS[k]) if (v < below && total > best) { total = best; capped = k; } }
  const dir = d => {
    const idx = slots.map((x, i) => x.d === d ? i : -1).filter(i => i >= 0), h = idx.filter(i => slots[i].k === 'h');
    return { n: idx.length, played: h.length, bias: h.length ? evalMean(h.map(i => dev(slots[i]))) : null, abs: h.length ? evalMean(h.map(i => Math.abs(dev(slots[i])))) : null,
      pitch: idx.length ? evalMean(idx.map(i => notePitch[i])) : null };
  };
  return {
    total, band: evalBand(total), pitch, fluency, tone,
    coverage, listen, pulse, even, lagMs: pu ? pu.lag : null, continuity, stalls, retries, shorts, wrongNotes, faults, capped, toneMeasured: noteTone.length > 0,
    slots: n, played: hits.length, skipped: n - hits.length, tempoMode: tempo,
    up: dir('up'), down: dir('down'),
    notes: slots.map((x, i) => ({ name: x.name, midi: x.midi, d: x.d, played: x.k === 'h', dev: x.k === 'h' ? dev(x) : null, s: x.k === 'h' ? x.s : null, e: x.e, pitch: notePitch[i] })),
  };
}
