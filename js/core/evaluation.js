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

// Onsets: a constant lag (microphone, Bluetooth or just playing a little behind) is reported but not punished; only the unevenness is.
function evalPulse(errs, beatMs, free = 0.08, span = 0.37) {
  const e = errs.filter(x => typeof x === 'number'); if (!e.length) return null;
  const lag = evalMedian(e);
  return { lag, score: 100 * evalMean(e.map(x => evalClamp(1 - Math.max(0, Math.abs(x - lag) - free * beatMs) / (span * beatMs)))) };
}
// Steadiness of one held note: wobble up to a quarter of the instrument's allowance costs nothing, the full allowance earns nothing.
const evalSteady = (s, cap) => typeof s === 'number' ? evalClamp(1 - Math.max(0, s - 0.25 * cap) / (0.75 * cap)) : 0.75;

// evaluateRun(slots, { beatMs, mode:'tempo'|'wait', wobbleCap, curve }) -> result, or null for an empty run
// curve (optional, used by the "practical" grader): { free, span (cents), pulseFree, pulseSpan (beats), wrongPenalty, wrongCap }; the defaults below are the strict grader.
function evaluateRun(slots, opts = {}) {
  const n = slots.length; if (!n) return null;
  const beatMs = opts.beatMs || 750, cap = opts.wobbleCap || 25, tempo = opts.mode !== 'wait';
  const cv = Object.assign({ free: 6, span: 44, pulseFree: 0.08, pulseSpan: 0.37, wrongPenalty: EVAL_WRONG_PENALTY, wrongCap: EVAL_WRONG_CAP }, opts.curve);
  const hits = slots.filter(x => x.k === 'h'), dev = x => (typeof x.m === 'number' ? x.m : x.c);
  const wrongNotes = slots.reduce((s, x) => s + (x.wrong || 0), 0), retries = slots.reduce((s, x) => s + (x.rt || 0), 0);

  // pitch
  const notePitch = slots.map(x => x.k === 'h' ? evalPitchOf(dev(x), x.a, cv.free, cv.span) : 0);
  const pitch = evalClamp(evalMean(notePitch) - Math.min(cv.wrongCap, cv.wrongPenalty * wrongNotes), 0, 100);

  // fluency: pulse (Tempo-locked only) and continuity
  const pu = tempo ? evalPulse(hits.map(x => x.e), beatMs, cv.pulseFree, cv.pulseSpan) : null;
  const ordered = hits.filter(x => typeof x.e === 'number').sort((a, b) => a.index - b.index);
  let stalls = 0; for (let i = 1; i < ordered.length; i++) if (ordered[i].index === ordered[i - 1].index + 1 && ordered[i].e - ordered[i - 1].e > 0.75 * beatMs) stalls++;   // a gap of most of a beat or more: the player stopped and restarted
  const continuity = 100 * evalClamp((hits.length - 0.5 * retries - stalls) / n);
  const fluency = pu ? 0.6 * pu.score + 0.4 * continuity : continuity;

  // tone
  const noteTone = hits.map(x => 100 * (0.65 * evalSteady(x.s, cap) + 0.35 * evalClamp(1 - (typeof x.sp === 'number' ? x.sp : 0) / 40) * (x.wrong ? 0.6 : 1)));
  const tone = hits.length ? evalMean(noteTone) : 0;

  const total = Math.round(EVAL_WEIGHTS.pitch * pitch + EVAL_WEIGHTS.fluency * fluency + EVAL_WEIGHTS.tone * tone);
  const dir = d => {
    const idx = slots.map((x, i) => x.d === d ? i : -1).filter(i => i >= 0), h = idx.filter(i => slots[i].k === 'h');
    return { n: idx.length, played: h.length, bias: h.length ? evalMean(h.map(i => dev(slots[i]))) : null, abs: h.length ? evalMean(h.map(i => Math.abs(dev(slots[i])))) : null,
      pitch: idx.length ? evalMean(idx.map(i => notePitch[i])) : null };
  };
  return {
    total, band: evalBand(total), pitch, fluency, tone,
    pulse: pu ? pu.score : null, lagMs: pu ? pu.lag : null, continuity, stalls, retries, wrongNotes,
    slots: n, played: hits.length, skipped: n - hits.length, tempoMode: tempo,
    up: dir('up'), down: dir('down'),
    notes: slots.map((x, i) => ({ name: x.name, midi: x.midi, d: x.d, played: x.k === 'h', dev: x.k === 'h' ? dev(x) : null, s: x.k === 'h' ? x.s : null, e: x.e, pitch: notePitch[i] })),
  };
}
