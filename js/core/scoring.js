// Scale-practice scoring: cents, frame classes, per-note status and comments, run summary and "Spots to fix".
// Pure logic: no DOM, so it also runs in Node (tests load this same file).
//
// Play events (what the scorecard stores per note): hit { k:'h', c: mean cents, a: share of frames in tolerance, s: wobble (std-dev cents), e: timing error ms, d: 'up'|'down' },
// skip { k:'s', d }, wrong note while this one was expected { k:'w', d }. Events saved before directions existed have no d and count for both directions.

// Cents offset of a frequency from a target note (positive = sharp).
const centsOffset = (f, targetMidi, a4 = 440) => (69 + 12 * Math.log2(f / a4) - targetMidi) * 100;
const clamp01 = x => Math.max(0, Math.min(1, x));

// YIN sometimes reports an octave (1200c) or a twelfth (1902c) away from the real pitch for a frame or two. Those frames are noise, not wrong notes.
const GLITCH_SHIFTS = [1200, 1902, 2400];
function isOctaveGlitch(c, slack = 65) {
  const a = Math.abs(c);
  return GLITCH_SHIFTS.some(s => Math.abs(a - s) <= slack);
}
// One frame against its target: ok / flat / sharp (within wrongAt cents), glitch (octave error, ignore it), wrong (some other note).
function classifyFrame(c, tol, wrongAt = 65) {
  const a = Math.abs(c);
  if (a <= tol) return 'ok';
  if (a <= wrongAt) return c > 0 ? 'sharp' : 'flat';
  return isOctaveGlitch(c) ? 'glitch' : 'wrong';
}

// Running median over an odd window: takes the vibrato (or a stray frame) out of a pitch track without delaying it much.
function smoothCents(arr, win) {
  const w = win | 1; if (w <= 1 || arr.length < 3) return arr.slice();
  const h = w >> 1;
  return arr.map((_, i) => { const s = arr.slice(Math.max(0, i - h), i + h + 1).sort((x, y) => x - y); return s[s.length >> 1]; });
}
// Mean pitch, wobble and in-tune share of a held note (frames in cents from the target). Smoothing window comes from the instrument.
function holdStats(frames, tol, win = 3) {
  const f = smoothCents(frames, win), n = f.length; if (!n) return null;
  const c = f.reduce((x, y) => x + y, 0) / n, s = Math.sqrt(f.reduce((x, y) => x + (y - c) * (y - c), 0) / n);
  return { c, s, a: f.filter(x => Math.abs(x) <= tol).length / n, n };
}

// How the listening should be set for a timeline of written notes: the analysis window (samples) and the frames an attempt needs. The ordinary window is 4096 samples (93 ms at 44.1 kHz) and
// an attempt needs 6 steady frames (100 ms): a note with less than about 200 ms to the next one is then smeared into its neighbours and never found (measured on real scores: under 150 ms
// found 10% of the time, 150-200 ms 45%, 200 ms and over about 90%). Quick music gets a window of about a third of the shortest gap (never one that cannot hold 2.2 periods of the lowest note)
// and an attempt of about 45% of it IN TIME (so fewer frames when the loop runs slower than 60 a second). tl: [{ startMs }]. Returns { win, need, gap } (gap: the shortest gap in ms, or null).
function listenFor(tl, sr, loHz, framePeriod = 1 / 60) {   // framePeriod: seconds between the frames the drill really gets (a screen or a busy page can give 40 a second, not 60)
  // The gap to size the listening for: the 15th percentile of the gaps (an ornament or two must not shrink the window for the whole piece), or the shortest when there are few.
  // Under 40 ms is a grace note or a chord's spread, not a gap to follow.
  const gs = []; for (let i = 1; i < (tl ? tl.length : 0); i++) { const g = tl[i].startMs - tl[i - 1].startMs; if (g >= 40) gs.push(g); }
  gs.sort((a, b) => a - b); const gap = gs.length ? (gs.length >= 8 ? gs[Math.floor(0.15 * (gs.length - 1))] : gs[0]) : null;
  const slow = { win: 4096, need: 6, gap };
  if (gap == null || gap >= 300) return slow;
  const want = Math.max(1024, Math.min(4096, 2 ** Math.floor(Math.log2(gap / 1000 * sr * 0.35)))), floor = 2 ** Math.ceil(Math.log2(2.2 * sr / Math.max(40, loHz || 80)));
  return { win: Math.min(4096, Math.max(want, floor)), need: Math.max(3, Math.min(6, Math.round(gap * 0.45 / 1000 / framePeriod))), gap };
}
// The one fixed-rate gate for the drills' frames. last: the time of the last frame let through (-1 at the start), t: now, minDt: the shortest gap allowed.
// If the clock went BACKWARDS (the microphone was switched off and on again, which starts the loop's clock from zero) the gate starts over: without that the drills would sit still
// until the new session outlasted the old one. Returns { fire, last }.
function fixedRate(last, t, minDt) { if (t < last) last = -1; return t - last >= minDt ? { fire: true, last: t } : { fire: false, last }; }
// A note this short (under 120 ms, as written) is not reliably heard as a pitch by anyone, a pitch tracker included (a 32nd note at ♩=120 is 62 ms). One that was NOT played back is left out of the
// score instead of counting as skipped; one that was heard still counts. tooShortSkipped(slot, noteMs) -> true when the note should be left out.
const TOO_SHORT_MS = 120;   // measured on real scores: notes of 120 ms or more are found about 90% of the time, shorter ones well under that
const tooShortSkipped = (slot, noteMs) => slot.k !== 'h' && typeof noteMs === 'number' && noteMs < TOO_SHORT_MS;
// What a held note tells the grader besides its pitch. cl: the pitch detector's clarity for each frame of the note. skip: frames of the attack to leave out.
// holdClarity -> the median clarity after the attack, or null when there are too few frames. heldRatio -> how long the note really sounded against its written length
// (1 = all of it); the last frame stands for one frame period (about 1/60 s). Both are null when they cannot be measured.
const holdClarity = (cl, skip) => { const v = cl.slice(skip).filter(x => typeof x === 'number'); return v.length >= 4 ? evalMedian(v) : null; };
// The share of a note's written length for which a pitch was actually heard (frames that passed the gate and the clarity bar, about 60 a second, less the 6 the attempt needed).
// A low share on a bowed note is the room or the microphone, not the player, and the result says so.
const heardShare = (frames, durationMs, fps = 60) => durationMs > 0 ? Math.max(0, Math.min(1, frames / Math.max(4, durationMs / 1000 * fps - 6))) : null;
const heldRatio = (t0, last, durationMs, framePeriod = 1 / 60) => (durationMs > 0 && last >= t0) ? Math.min(1.5, ((last - t0 + framePeriod) * 1000) / durationMs) : null;

// Per-note score from its events (recent plays weigh more). wobbleCap: a number, or a function of an event, giving the wobble that earns zero steadiness credit (default: the instrument rule of the event). minPlays: fewer plays give no score.
const defaultWobble = e => ruleFor(e.i).wobble;
function noteScore(evs, wobbleCap = defaultWobble, minPlays = 3) {
  const n = evs.length; if (n < minPlays) return null;
  let W = 0, Wh = 0, Ws = 0, acc = 0, bias = 0, sd = 0, sdn = 0;
  evs.forEach((e, i) => {
    const w = Math.pow(0.9, n - 1 - i); W += w;
    if (e.k === 'h') {
      Wh += w; acc += w * e.a; bias += w * e.c;
      if (typeof e.s === 'number') { Ws += w; sd += w * e.s; sdn += w * e.s / (typeof wobbleCap === 'function' ? wobbleCap(e) : wobbleCap); }
    }
  });
  const hitRate = Wh / W; if (Wh) { acc /= Wh; bias /= Wh; }
  const sdv = Ws ? sd / Ws : 0, sdnv = Ws ? sdn / Ws : 0.5, hit = Wh > 0;
  const score = 100 * (0.4 * acc + (hit ? 0.25 * clamp01(1 - Math.abs(bias) / 30) + 0.15 * clamp01(1 - sdnv) : 0) + 0.2 * hitRate);
  return { score, bias, acc, sd: sdv, hitRate, n, hit };
}
// Badge: ok (green), flat (blue), sharp (red), wrong (purple), miss (never reached), null (no data yet).
function noteStatus(evs, s, tol) {
  if (!evs.length) return null;
  const hits = evs.filter(e => e.k === 'h').length, wr = evs.filter(e => e.k === 'w').length;
  if (wr > 0 && wr >= hits) return 'wrong';
  if (!s || !s.hit) return 'miss';
  return s.bias > tol ? 'sharp' : s.bias < -tol ? 'flat' : 'ok';
}
const STATUS_LABEL = { ok: 'In tune', flat: 'Flat', sharp: 'Sharp', wrong: 'Wrong note', miss: 'Missed' };

// Short advice from the average bias: "+16c sharp, slightly lower". Violin and others share the wording.
function guidance(bias, sd, wobbleCap = 25) {
  const a = Math.abs(bias);
  let t;
  if (a < 5) t = 'centred';
  else {
    const amt = a < 12 ? 'slightly ' : a < 30 ? '' : 'much ';
    t = `${bias > 0 ? '+' : '−'}${a.toFixed(0)}c ${bias > 0 ? 'sharp' : 'flat'}, ${amt}${bias > 0 ? 'lower' : 'higher'}`;
  }
  if (typeof sd === 'number' && sd > wobbleCap * 0.75) t += ' · keep the pitch steadier';
  return t;
}
function commentFor(evs, s, wobbleCap = 25) {
  const sk = evs.filter(e => e.k === 's').length, wr = evs.filter(e => e.k === 'w').length, p = [];
  p.push(s && s.hit ? guidance(s.bias, s.sd, wobbleCap) : evs.length ? (sk ? 'not reached yet' : 'no clean play yet') : 'not played yet');
  if (sk) p.push(`${sk} skipped`); if (wr) p.push(`${wr} wrong`);
  return p.join(' · ');
}
// Events of one scale position (a direction and a MIDI note). Old events without a direction count for both.
const eventsFor = (all, midi, d) => (all[midi] || []).filter(e => !e.d || !d || e.d === d);

// Timing score 0-100 from timing errors in ms (null = not measured): 100 on the beat, 0 at half a beat off or more.
function timingScore(errsMs, beatMs) {
  const e = errsMs.filter(x => typeof x === 'number'); if (!e.length) return null;
  return 100 * e.reduce((s, x) => s + clamp01(1 - Math.abs(x) / (0.5 * beatMs)), 0) / e.length;
}
// Summary of one practice run. slots: [{ name, midi, d, k:'h'|'s', c, a, s, e, wrong }] (one per scale position per pass).
function summariseRun(slots, opts) {
  const tol = opts.tol || 10, beatMs = opts.beatMs || 750;
  const hits = slots.filter(x => x.k === 'h'), skipped = slots.length - hits.length, wrongNotes = slots.reduce((s, x) => s + (x.wrong || 0), 0);
  if (!slots.length) return null;
  const intonation = 100 * slots.reduce((s, x) => s + (x.k === 'h' ? x.a : 0), 0) / slots.length;
  const inTune = hits.filter(x => Math.abs(x.c) <= tol).length;
  const avgErr = hits.length ? hits.reduce((s, x) => s + Math.abs(x.c), 0) / hits.length : null;
  const timing = timingScore(hits.map(x => x.e), beatMs);
  const te = hits.filter(x => typeof x.e === 'number'), drift = te.length ? te.reduce((s, x) => s + x.e, 0) / te.length : null;
  // weakest positions: a position's score mixes its in-tune share and how centred it was; a skipped position scores 0
  const by = new Map();
  for (const x of slots) { const k = x.d + x.midi; if (!by.has(k)) by.set(k, { name: x.name, midi: x.midi, d: x.d, v: [], c: [] }); const g = by.get(k); g.v.push(x.k === 'h' ? 100 * (0.6 * x.a + 0.4 * clamp01(1 - Math.abs(x.c) / 30)) : 0); if (x.k === 'h') g.c.push(x.c); }
  const spots = [...by.values()].map(g => ({ name: g.name, midi: g.midi, d: g.d, score: g.v.reduce((a, b) => a + b, 0) / g.v.length, bias: g.c.length ? g.c.reduce((a, b) => a + b, 0) / g.c.length : null }))
    .filter(g => g.score < 85).sort((a, b) => a.score - b.score).slice(0, 3)
    .map(g => ({ ...g, text: g.bias == null ? 'not played' : guidance(g.bias, null) }));
  return { slots: slots.length, played: hits.length, skipped, wrongNotes, inTune, intonation, avgErr, timing, timingDriftMs: drift, spots };
}
