// AttemptDetector (js/core/segmenter.js): the drills' note detector. A repeated note with no pause is found only when a repeat is expected, and only by a deep dip in level.
// Also the capture helpers that feed the grader (clarity, held length, listening share) and the piece coach's per-place memory.
// Run: node tests/attempt-detector.js
const lib = require('./lib/load.js'); let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const hz = m => lib.noteToFreq(m, 440), DT = 1 / 60;

// frames: [{ n: midi or null, lv: level }] one per 1/60 s. Returns the attempts the detector reported.
function run(frames, repeat) {
  const out = [], d = new lib.AttemptDetector(a => out.push(a)); let t = 0;
  for (const fr of frames) { d.frame(t, fr.n ? hz(fr.n) : null, 440, fr.lv, repeat); t += DT; }
  return { out, d };
}
const note = (n, k, lv = 0.3) => Array.from({ length: k }, () => ({ n, lv }));
const gap = (k, lv = 0.01) => Array.from({ length: k }, () => ({ n: null, lv }));

// ---- today's behaviour is unchanged
let r = run(note(60, 20).concat(gap(4), note(60, 20)), false);
ok(r.out.length === 2, `a repeat after a pause (4 quiet frames) is two attempts (${r.out.length})`);
r = run(note(60, 20).concat(gap(2), note(60, 20)), false);
ok(r.out.length === 1, `a repeat after only 2 quiet frames is still one note (${r.out.length})`);
r = run(note(60, 20).concat(note(62, 20)), false);
ok(r.out.length === 2 && r.out[0].midi === 60 && r.out[1].midi === 62, 'a change of pitch is a new attempt');

// ---- a repeat with no pause: a deep, quick dip in level (a bow change)
const bowChange = note(60, 20, 0.3).concat([{ n: 60, lv: 0.05 }, { n: 60, lv: 0.04 }, { n: 60, lv: 0.08 }], note(60, 20, 0.3));
r = run(bowChange, true);
ok(r.out.length === 2 && r.d.rearmed === true, `repeat expected: a bow change on the same pitch (level falls to 15%) is a new note (${r.out.length} attempts)`);
r = run(bowChange, false);
ok(r.out.length === 1, 'no repeat expected: the same dip is ignored, so a scale never gets a false retry');
// the dip may fall on frames with no pitch at all
r = run(note(60, 20).concat(gap(2, 0.02), note(60, 20)), true);
ok(r.out.length === 2, `repeat expected: a dip on silent frames counts too (${r.out.length} attempts)`);

// ---- vibrato moving the loudness is not a new note
const vib = Array.from({ length: 90 }, (_, i) => ({ n: 60, lv: 0.3 * (1 + 0.35 * Math.sin(2 * Math.PI * 5.5 * i * DT)) }));
r = run(vib, true);
ok(r.out.length === 1, `vibrato that moves the level by 35% is one note even when a repeat is expected (${r.out.length})`);
// a slow fade and swell is not a new note either
const swell = note(60, 15, 0.3).concat(Array.from({ length: 70 }, (_, i) => ({ n: 60, lv: 0.3 - 0.27 * Math.min(1, i / 20) + (i > 25 ? 0.27 * Math.min(1, (i - 25) / 36) : 0) })));
r = run(swell, true);
ok(r.out.length === 1, `a slow fade and swell (back to strength over 0.6 s) is one note (${r.out.length})`);

// ---- helpers that feed the grader
ok(lib.holdClarity([0.9, 0.9, 0.97, 0.98, 0.96, 0.97], 2) === 0.97 && lib.holdClarity([0.97, 0.97], 0) === null, 'holdClarity: median after the attack; too few frames gives nothing');
ok(Math.abs(lib.heldRatio(1.0, 1.7, 800) - 0.9) < 0.03 && lib.heldRatio(1, 1, 0) === null && lib.heldRatio(1, 5, 500) === 1.5, 'heldRatio: time sounded against written length, capped at 1.5');
ok(lib.heardShare(40, 1000) > 0.7 && lib.heardShare(12, 1000) < 0.3 && lib.heardShare(500, 1000) === 1 && lib.heardShare(10, 0) === null, 'heardShare: share of a note that was heard');

// ---- a re-struck plucked or struck note (piano, guitar): no dip, the level jumps up while the old note still rings
{
  const decay = (k, from, tau = 0.25) => Array.from({ length: k }, (_, i) => ({ n: 60, lv: from * Math.exp(-i * DT / tau) }));
  const strike = decay(24, 0.5, 0.5).concat(decay(24, 0.5, 0.5));                                            // struck, rings for 0.4 s, struck again at the same strength
  let q = run(strike, 'rise');
  ok(q.out.length === 2 && q.d.rearmed === true, `repeat expected, struck instrument: a re-strike while the first note still rings is a new note (${q.out.length} attempts)`);
  q = run(strike, true);
  ok(q.out.length === 1, 'the bowed-note (dip) rule does not see a re-strike');
  q = run(strike, false);
  ok(q.out.length === 1, 'no repeat expected: a re-strike of the same pitch is not a new note (a scale never gets a false retry)');
  q = run(decay(60, 0.5), 'rise');
  ok(q.out.length === 1, `one note that simply dies away is one note even when a repeat is expected (${q.out.length})`);
  const soft = decay(24, 0.5).concat(decay(24, 0.06));                                              // a faint noise bump (12% of the first strike) is not a strike
  q = run(soft, 'rise');
  ok(q.out.length === 1, `a bump to under 40% of the first note's peak is not a new note (${q.out.length})`);
  const tooSoon = decay(5, 0.5).concat(decay(30, 0.5));                                             // a second strike inside 80 ms of the first is the same attack
  q = run(tooSoon, 'rise');
  ok(q.out.length === 1, `a jump within 80 ms of the start is the same attack (${q.out.length})`);
}

// ---- the drills' fixed-rate gate must survive a restart of the microphone clock (it once froze every drill after the mic was switched off and on)
{
  const fires = (times, minDt = 0.012) => { let last = -1, n = 0; for (const t of times) { const g = lib.fixedRate(last, t, minDt); last = g.last; if (g.fire) n++; } return n; };
  const ramp = (a, b, dt) => { const o = []; for (let i = 0; a + i * dt < b - 1e-9; i++) o.push(a + i * dt); return o; };
  ok(fires(ramp(0, 1, 1 / 60)) === 60 && fires(ramp(0, 1, 1 / 120)) === 60 && fires(ramp(0, 1, 1 / 40)) === 40, 'the gate lets through about 60 frames a second at most (60 Hz: all, 120 Hz: every other one, 40 Hz: all)');
  ok(fires(ramp(0, 90, 1 / 60).concat(ramp(0, 5, 1 / 60))) === 5400 + 300, 'after the clock restarts from zero (microphone off and on) the next session is not frozen: all 300 of its frames get through');
  ok(lib.fixedRate(90, 3, 0.012).fire === true && lib.fixedRate(-1, 0, 0.012).fire === true && lib.fixedRate(1, 1.005, 0.012).fire === false, 'the gate: a clock that went backwards starts over; the very first frame fires; a frame too soon does not');
}

// ---- the listening fits the shortest written note (real scores: notes with under 150 ms to the next were found 10% of the time with the ordinary settings)
{
  const mk = g => Array.from({ length: 10 }, (_, i) => ({ startMs: i * g })), L = (g, lo = 196) => lib.listenFor(mk(g), 44100, lo);
  ok(L(857).win === 4096 && L(857).need === 6 && L(350).win === 4096 && L(300).need === 6, 'slow music keeps the ordinary window (4096) and 6 frames');
  ok(L(250).win === 2048 && L(150).win === 2048 && L(125).win === 1024 && L(100).need === 3, 'quick music gets a shorter window (250 ms gaps: 2048; 125 ms: 1024) and fewer frames (3 at 100 ms)');
  ok(L(125, 60).win === 2048 && L(125, 40).win >= 2048, 'the window never gets too short to hold 2.2 periods of the lowest note (60 Hz: not 1024)');
  ok(lib.listenFor([], 44100, 100).win === 4096 && lib.listenFor([{ startMs: 0 }], 44100, 100).win === 4096 && lib.listenFor(mk(10), 44100, 100).win === 4096, 'no gap to follow (empty, one note, or only a chord\'s 10 ms spread): ordinary settings');
  ok(lib.listenFor(mk(208), 48000, 175).need === 6 && lib.listenFor(mk(208), 48000, 175, 1 / 40).need === 4 && lib.listenFor(mk(208), 48000, 175, 1 / 30).need === 3, 'the frames an attempt needs follow the time, not a count: 208 ms gaps need 6 frames at 60 a second, 4 at 40, 3 at 30');
  const withGrace =[{ startMs: 0 }, { startMs: 15 }, { startMs: 800 }, { startMs: 1600 }];
  ok(lib.listenFor(withGrace, 44100, 196).gap === 785, 'a grace note or chord spread under 40 ms is not taken as the gap');
}

// ---- listening confidence reaches the result
const slots = (cov, n = 15) => Array.from({ length: n }, (_, i) => ({ index: i, pass: 1, name: 'n' + i, midi: 60 + i, d: 'up', k: 'h', c: 0, m: 0, a: 1, s: 3, e: 0, sp: 0, cov, wrong: 0, rt: 0 }));
const ev = c => lib.findEngine('scorer', 'strict').evaluate(slots(c), { beatMs: 750, mode: 'tempo', wobbleCap: 40 });
ok(ev(0.9).listen === 'good' && ev(0.6).listen === 'fair' && ev(0.3).listen === 'poor' && ev(undefined).listen === null, 'the result reports how well the microphone heard the player (good / fair / poor / unknown)');
ok(lib.histRecord(ev(0.4), { t: 1, inst: 'violin', type: 'major', root: 0, span: 1, bpm: 70, mode: 'tempo' }).cov === 0.4, 'the saved run keeps the listening share');

// ---- piece coach: the same pitch in different bars is different notes
{
  const mk = (cs) => ({ type: 'piece', inst: 'violin', total: 80, pitch: 80, fluency: 80, tone: 80, notes: cs.map((c, i) => ({ n: 'A4', m: 69, k: 1, c, b: i + 1 })) });
  const flatAt2 = () => mk([0, -22, 1, 2, -3]), runs = [flatAt2(), flatAt2(), flatAt2(), flatAt2()], rec = lib.coachRecurringNotes(runs, runs[3]);
  ok(rec.length === 1 && rec[0].runs === 4 && /bar 2/.test(rec[0].name) && !rec[0].sharp, `a note that is flat in the same bar in 4 runs is named with its bar (${rec[0] && rec[0].name})`);
  const asScale = runs.map(x => Object.assign({}, x, { type: 'major' })), byPitch = lib.coachRecurringNotes(asScale, asScale[3]);
  ok(byPitch.length === 0, 'the same notes in a scale run are one pitch whose average is not flat (so nothing recurs)');
  const old = runs.slice(0, 2).map(x => Object.assign({}, x, { notes: [] })).concat(runs.slice(2)), rec2 = lib.coachRecurringNotes(old, old[3]);
  ok(rec2.length === 0, 'older runs that kept only their summary are skipped, not mistaken for good runs');
}

console.log(fail ? `\n${fail} FAILED` : '\nall attempt-detector checks pass'); process.exit(fail ? 1 : 0);
