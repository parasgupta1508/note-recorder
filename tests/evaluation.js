// Scale evaluation, history, teacher coach and notation geometry (all pure code). node tests/evaluation.js
const lib = require('./lib/load.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

// A run of n slots, half going up and half down. f(i) returns overrides for slot i.
const mkSlots = (n, f = () => ({})) => Array.from({ length: n }, (_, i) => Object.assign({ index: i, name: 'N' + i, midi: 60 + i, d: i < n / 2 ? 'up' : 'down', k: 'h', c: 0, m: 0, a: 1, s: 3, e: 0, sp: 0, wrong: 0, rt: 0 }, f(i)));
const BEAT = 750;

// ---- bands
ok(lib.evalBand(100) === 'Distinction' && lib.evalBand(87) === 'Distinction' && lib.evalBand(86.4) === 'Merit' && lib.evalBand(86.6) === 'Distinction', 'bands: 87+ Distinction (rounded), 86 Merit');
ok(lib.evalBand(75) === 'Merit' && lib.evalBand(74) === 'Pass' && lib.evalBand(60) === 'Pass' && lib.evalBand(59) === 'Below Pass' && lib.evalBand(0) === 'Below Pass', 'bands: 75 Merit, 60 Pass, below 60 Below Pass');
ok(Math.abs(lib.EVAL_WEIGHTS.pitch + lib.EVAL_WEIGHTS.fluency + lib.EVAL_WEIGHTS.tone - 1) < 1e-9 && lib.EVAL_WEIGHTS.pitch === 0.5 && lib.EVAL_WEIGHTS.fluency === 0.3 && lib.EVAL_WEIGHTS.tone === 0.2, 'weights are 50 / 30 / 20');

// ---- a perfect run and a poor one
let r = lib.evaluateRun(mkSlots(15), { beatMs: BEAT, mode: 'tempo', wobbleCap: 40 });
ok(r.total === 100 && r.band === 'Distinction' && r.pitch === 100 && r.fluency === 100 && r.tone === 100, 'perfect run scores 100 (' + r.total + ')');
ok(lib.evaluateRun([], {}) === null, 'an empty run has no evaluation');
r = lib.evaluateRun(mkSlots(15, () => ({ k: 's', c: null, m: null, a: 0, s: null, e: null })), { beatMs: BEAT });
ok(r.total === 0 && r.band === 'Below Pass' && r.skipped === 15, 'a run with nothing played scores 0');

// ---- pitch (50%)
const pitchOf = dev => lib.evaluateRun(mkSlots(10, () => ({ m: dev, c: dev, a: Math.abs(dev) <= 10 ? 1 : 0 })), { beatMs: BEAT, wobbleCap: 40 }).pitch;
ok(pitchOf(0) === 100 && pitchOf(5) === 100, 'pitch: within 6 cents is full marks');
ok(pitchOf(15) < pitchOf(5) && pitchOf(30) < pitchOf(15) && pitchOf(50) <= 1, 'pitch falls steadily with the deviation (' + [5, 15, 30, 50].map(pitchOf).map(x => x.toFixed(0)).join(', ') + ')');
ok(pitchOf(-20) === pitchOf(20), 'sharp and flat count the same');
// the attack: a scooped start (c is the mean including it) must not cost pitch when the median after the attack is in tune
const scoop = lib.evaluateRun(mkSlots(10, () => ({ c: 14, m: 1, sp: 0, a: 0.8 })), { beatMs: BEAT, wobbleCap: 40 }).pitch;
const noScoop = lib.evaluateRun(mkSlots(10, () => ({ c: 14, m: 14, sp: 0, a: 0.8 })), { beatMs: BEAT, wobbleCap: 40 }).pitch;
ok(scoop > noScoop + 5, 'pitch uses the median after the attack, not the mean that includes it (' + scoop.toFixed(0) + ' vs ' + noScoop.toFixed(0) + ')');
const w0 = lib.evaluateRun(mkSlots(10), { beatMs: BEAT }).pitch, w3 = lib.evaluateRun(mkSlots(10, i => ({ wrong: i < 3 ? 1 : 0 })), { beatMs: BEAT }).pitch, w20 = lib.evaluateRun(mkSlots(10, () => ({ wrong: 5 })), { beatMs: BEAT }).pitch;
ok(w0 - w3 === 9 && w20 === 70, 'each wrong note costs 3 points, at most 30 (' + (w0 - w3) + ', ' + w20 + ')');
ok(lib.evaluateRun(mkSlots(10, i => i === 0 ? { k: 's', c: null, m: null, a: 0, e: null } : {}), { beatMs: BEAT }).pitch === 90, 'a skipped note scores 0 for pitch (1 in 10 = -10)');

// ---- fluency & pulse (30%)
const fl = (f, mode = 'tempo') => lib.evaluateRun(mkSlots(15, f), { beatMs: BEAT, mode, wobbleCap: 40 });
ok(fl(() => ({ e: 0 })).pulse === 100, 'pulse: on the beat is 100');
ok(fl(() => ({ e: 200 })).pulse === 100 && Math.abs(fl(() => ({ e: 200 })).lagMs - 200) < 1e-9, 'pulse: a steady lag is reported, not punished');
const uneven = fl(i => ({ e: (i % 2 ? 1 : -1) * 220 }));
ok(uneven.pulse < 60 && uneven.fluency < fl(() => ({ e: 0 })).fluency, 'pulse: uneven onsets score lower (' + uneven.pulse.toFixed(0) + ')');
ok(fl(() => ({ e: null }), 'wait').pulse === null && fl(() => ({ e: null }), 'wait').fluency === 100, 'Wait-for-note: no pulse score, fluency is continuity');
const stop = fl(i => ({ e: i < 8 ? 0 : 900 }));
ok(stop.stalls === 1 && stop.continuity < 100, 'a long stop mid-scale counts as a stall (continuity ' + stop.continuity.toFixed(0) + ')');
ok(fl(i => i < 3 ? { rt: 1 } : {}).continuity < 100 && fl(i => i === 5 ? { k: 's', c: null, m: null, a: 0, s: null, e: null } : {}).continuity < 100, 'retries and skipped notes lower continuity');

// ---- tone & steadiness (20%)
const tn = (f, cap = 40) => lib.evaluateRun(mkSlots(10, f), { beatMs: BEAT, wobbleCap: cap }).tone;
ok(tn(() => ({ s: 2 })) === 100 && tn(() => ({ s: 2, sp: 0 })) === 100, 'tone: a steady note entered cleanly is 100');
ok(tn(() => ({ s: 25 }), 20) < tn(() => ({ s: 25 }), 40), 'tone: the same wobble costs more on a guitar than on a violin (vibrato allowance)');
ok(tn(() => ({ s: 2, sp: 30 })) < tn(() => ({ s: 2, sp: 0 })), 'tone: scooping into notes costs');
ok(tn(() => ({ s: null })) > 0 && tn(() => ({ s: null })) < 100, 'tone: an unmeasured wobble is neutral, not full marks');

// ---- the three parts make the total
r = lib.evaluateRun(mkSlots(15, i => ({ m: 12, c: 12, a: 0.5, e: i % 2 ? 90 : -90, s: 14 })), { beatMs: BEAT, mode: 'tempo', wobbleCap: 40 });
ok(r.total === Math.round(0.5 * r.pitch + 0.3 * r.fluency + 0.2 * r.tone), 'total = 50% pitch + 30% fluency + 20% tone (' + r.total + ')');

// ---- directions
r = lib.evaluateRun(mkSlots(10, i => ({ m: i < 5 ? -12 : 20, c: i < 5 ? -12 : 20 })), { beatMs: BEAT });
ok(r.up.n === 5 && r.down.n === 5 && Math.abs(r.up.bias + 12) < 1e-9 && Math.abs(r.down.bias - 20) < 1e-9 && r.up.pitch > r.down.pitch, 'up and down are kept apart (up -12, down +20)');
ok(r.notes.length === 10 && r.notes[0].dev === -12, 'per-note figures are kept');

// ---- history records
const info = { t: Date.UTC(2026, 10, 20, 10), player: 'P', inst: 'violin', type: 'major', root: 7, span: 1, pos: '1', bow: 'separate', bpm: 80, mode: 'tempo', label: 'G major' };
const rec = lib.histRecord(lib.evaluateRun(mkSlots(15), { beatMs: BEAT, wobbleCap: 40 }), info);
ok(rec.v === 1 && rec.total === 100 && rec.band === 'Distinction' && rec.notes.length === 15 && rec.up.n === 8 && JSON.stringify(rec).length < 3000, 'a record is compact (' + JSON.stringify(rec).length + ' bytes for 15 notes)');
ok(JSON.parse(JSON.stringify(rec)).notes[0].d === 'u', 'a record survives JSON');
let runs = []; for (let i = 0; i < 450; i++) runs = lib.histAdd(runs, { ...rec, t: i, total: i % 100 });
ok(runs.length === 400 && runs[0].t === 50, 'history keeps the newest 400');
const at = (day, total, extra = {}) => ({ ...rec, t: new Date(2026, 10, day, 12).getTime(), total, ...extra });
const set = [at(1, 60), at(2, 70, { inst: 'guitar' }), at(3, 75, { type: 'minor' }), at(4, 82), at(5, 78)];
ok(lib.histFilter(set, { inst: 'violin' }).length === 4 && lib.histFilter(set, { inst: 'all' }).length === 5 && lib.histFilter(set, { inst: 'violin', type: 'minor' }).length === 1, 'filter by instrument and scale type');
ok(lib.histFilter(set, { scale: '7:major:1' }).length === 4 && lib.histFilter(set, { player: 'Q' }).length === 0, 'filter by scale key and player');
ok(lib.histBest(set).total === 82 && lib.histBest([]) === null, 'personal best');
ok(lib.histIsBest(set.slice(0, 3), at(4, 82)) && !lib.histIsBest(set.slice(0, 4), at(5, 82)) && !lib.histIsBest([], at(1, 99)), 'a new best must beat every earlier run, and needs an earlier run');
ok(lib.histTrend(set).map(p => p.y).join() === '60,70,75,82,78', 'trend values in time order');
const noon = d => new Date(2026, 10, d, 12).getTime();
ok(lib.histDayStreak(set, noon(5)) === 5 && lib.histDayStreak(set, noon(6)) === 5 && lib.histDayStreak(set, noon(7)) === 0, 'streak: counts back from today or yesterday, breaks after a missed day');
ok(lib.histDayStreak([at(1, 1), at(2, 1), at(4, 1)], noon(4)) === 1 && lib.histDayStreak([at(5, 1), at(5, 2)], noon(5)) === 1 && lib.histDayStreak([], noon(5)) === 0, 'streak: a gap resets it, two runs on one day count once');

// ---- coach
const runRec = (total, o = {}) => {
  const slots = mkSlots(15, o.f || (() => ({})));
  const r = lib.histRecord(lib.evaluateRun(slots, { beatMs: BEAT, wobbleCap: 40, mode: o.mode || 'tempo' }), { ...info, t: o.t || 1, bpm: o.bpm || 80, mode: o.mode || 'tempo', bow: o.bow || 'separate' });
  if (total != null) r.total = total; return r;
};
let cr = lib.coachReview(runRec(), []);
ok(/baseline/.test(cr.focus.join(' ')) && cr.strengths.length >= 1 && /Distinction/.test(cr.headline), 'first run: says it is the baseline');
// improvement against history
const hist = [runRec(60), runRec(62), runRec(64)]; hist.forEach((h, i) => { h.pitch = 60; h.fluency = 60; h.tone = 60; h.t = i + 1; });
const better = runRec(80); better.pitch = 80; better.fluency = 75; better.tone = 70;
cr = lib.coachReview(better, hist, { best: true });
ok(/personal best/i.test(cr.strengths[0]) && cr.strengths.some(s => /intonation improved by 20/.test(s)), 'strengths: personal best and the sub-score that improved');
// a recurring problem note: midi 64 sharp in four runs
const sharpNote = o => (i => i === 4 ? { m: 18, c: 18 } : {});
const hs = [1, 2, 3].map(t => runRec(null, { f: sharpNote(), t }));
cr = lib.coachReview(runRec(null, { f: sharpNote(), t: 9 }), hs);
ok(cr.focus.some(f => /N4 was sharp in 4 of your last 4 runs/.test(f) && /lower/.test(f)), 'focus: a note sharp in 4 runs is named with advice: ' + cr.focus[0]);
cr = lib.coachReview(runRec(null, { f: sharpNote(), t: 9 }), hs.slice(0, 1));
ok(!cr.focus.some(f => /N4 was/.test(f)), 'focus: two runs are not yet a pattern');
// ascending vs descending
const drift = t => runRec(null, { f: i => ({ m: i < 7.5 ? 0 : 14, c: i < 7.5 ? 0 : 14 }), t });
cr = lib.coachReview(drift(9), [drift(1), drift(2), drift(3)]);
ok(cr.focus.some(f => /Coming down you are 14¢ sharper than going up, as in 3 of your last 3 runs/.test(f)), 'focus: descending drift across sessions: ' + cr.focus.join(' | '));
// timing
cr = lib.coachReview(runRec(null, { f: () => ({ e: 150 }) }), []);
ok(cr.focus.some(f => /150 ms behind the click/.test(f)), 'focus: behind the click');
cr = lib.coachReview(runRec(null, { f: () => ({ e: 150 }), mode: 'wait' }), []);
ok(!cr.focus.some(f => /click/.test(f)), 'no click advice in Wait-for-note');
// readiness to move on
const good = t => runRec(90, { t }), cur90 = runRec(90, { t: 9, bow: 'separate' });
cr = lib.coachReview(cur90, [good(1), good(2), good(3)]);
ok(cr.focus.some(f => /raise the tempo to 88/.test(f) && /two notes to a bow/.test(f)), 'focus: three good runs suggest a faster tempo and slurs: ' + cr.focus.join(' | '));
cr = lib.coachReview(runRec(40), [runRec(50)]);
ok(cr.focus.some(f => /Slow down to about 68 BPM/.test(f)), 'focus: a weak run suggests slowing down');
ok(lib.coachReview(runRec(null, { f: () => ({ s: 38 }) }), []).focus.some(f => /bow/.test(f)), 'focus: a wobbly violin run mentions the bow');
cr = lib.coachReview(runRec(), [runRec(50, { t: 1 })]);
ok(cr.strengths.length <= 4 && cr.focus.length >= 1 && cr.focus.length <= 4, 'at most four lines in each list, never an empty "improve" list');
// other instruments are not mixed in
const guitarHist = [1, 2, 3].map(t => ({ ...runRec(null, { f: sharpNote(), t }), inst: 'guitar' }));
ok(!lib.coachReview(runRec(null, { f: sharpNote(), t: 9 }), guitarHist).focus.some(f => /N4 was/.test(f)), "a guitar's history is not used for a violin run");

// ---- notation geometry
const tlOf = (start, type, span, root, flats) => lib.buildTimeline({ start, type, span, bpm: 60, rootPc: root, flats });
ok(lib.visParseNote('F#4').step === 4 * 7 + 3 && lib.visParseNote('F#4').alter === 1 && lib.visParseNote('Bb3').alter === -1 && lib.visParseNote('E4').step === lib.VIS_BOTTOM, 'note names to staff steps (E4 is the bottom line)');
const key = (pc, type) => lib.visKeySig(pc, type, lib.prefersFlats(pc, type, null));
ok(key(0, 'major').kind === 'none' && key(7, 'major').n === 1 && key(7, 'major').kind === 'sharp' && key(2, 'major').n === 2 && key(10, 'major').kind === 'flat' && key(10, 'major').n === 2, 'key signatures: C none, G 1 sharp, D 2 sharps, Bb 2 flats');
ok(key(9, 'naturalMinor').n === 0 && key(4, 'naturalMinor').n === 1 && key(7, 'naturalMinor').kind === 'flat' && key(7, 'naturalMinor').n === 2, 'minor keys use the relative major (A none, E 1 sharp, G 2 flats)');
ok(key(2, 'dorian').n === 0 && key(0, 'chromatic').n === 0 && key(3, 'wholeTone').n === 0 && key(1, 'major').kind === 'flat' && key(1, 'major').n === 5 && key(6, 'major').n === 6, 'modes share the relative major; chromatic and whole tone have none; Db 5 flats, F# 6 sharps');
ok(key(7, 'major').marks[0].step === 38 && key(10, 'major').marks.map(m => m.step).join() === '34,37', 'the F# sits on the top line, the B flat on the middle line');
ok(lib.visLedgers(30).length === 0 && lib.visLedgers(28).join() === '28' && lib.visLedgers(24).join() === '28,26,24' && lib.visLedgers(40).join() === '40' && lib.visLedgers(39).length === 0 && lib.visLedgers(43).join() === '40,42', 'ledger lines: C4 has one, A3 has two, A5 has one');
const g = tlOf(55, 'major', 1, 7), sigG = key(7, 'major'), L = lib.visLayout(g.slice(0, 8), { perRow: 8, beatsPerBar: 4, sig: sigG, left: 50, spacing: 30 });
ok(L.length === 1 && L[0].notes.length === 8 && L[0].notes[0].step === 3 * 7 + 4 && L[0].notes[6].acc === '' && L[0].notes[6].step === 4 * 7 + 3, 'G major: F# carries no accidental (the key signature has it); first note G3');
ok(L[0].bars.length === 1 && L[0].bars[0] === 50 + 4 * 30, 'one barline after four notes');
const C = tlOf(60, 'harmonicMinor', 1, 9), La = lib.visLayout(tlOf(57, 'harmonicMinor', 1, 9).slice(0, 8), { perRow: 8, beatsPerBar: 8, sig: key(9, 'harmonicMinor') });
ok(La[0].notes[6].acc === '#' && La[0].notes[7].acc === '', 'A harmonic minor: the G# gets a sharp sign, the A after it does not');
const chrom = lib.visLayout(tlOf(60, 'chromatic', 1, 0), { perRow: 25, beatsPerBar: 4, sig: key(0, 'chromatic') });
ok(chrom[0].notes.filter(n => n.acc).length > 5, 'chromatic: accidentals are written (' + chrom[0].notes.filter(n => n.acc).map(n => n.acc).join('') + ')');
// carry inside a bar: C# then C# again in the same bar shows the sign once, a new bar shows it again
const dup = lib.visLayout([{ noteName: 'C#5', direction: 'up' }, { noteName: 'C#5', direction: 'up' }, { noteName: 'D5', direction: 'up' }, { noteName: 'C#5', direction: 'up' }, { noteName: 'C#5', direction: 'up' }], { perRow: 8, beatsPerBar: 4, sig: { alter: {} } });
ok(dup[0].notes.map(n => n.acc).join('|') === '#||||#', 'an accidental carries to the end of the bar and is repeated in the next');
// octave marks
const hiRow = lib.visLayout(tlOf(91, 'major', 1, 7), { perRow: 15, beatsPerBar: 4, sig: sigG });
ok(hiRow[0].label === '8va' && hiRow[0].notes.every(n => n.step <= lib.VIS_HI), 'a row above G6 is written 8va');
const loRow = lib.visLayout(tlOf(40, 'major', 1, 4), { perRow: 15, beatsPerBar: 4, sig: key(4, 'major'), octaveShift: 0 });
ok(loRow[0].label === '8vb' && loRow[0].notes.every(n => n.step >= lib.VIS_LO), 'a row below D3 is written 8vb');
const gtr = lib.visLayout(tlOf(40, 'major', 1, 4), { perRow: 15, beatsPerBar: 4, sig: key(4, 'major'), octaveShift: 1 });
ok(gtr[0].label === '' && gtr[0].notes[0].step === 2 * 7 + 2 + 7, 'guitar is written an octave above where it sounds (E2 is written E3: step ' + gtr[0].notes[0].step + ')');
const big = lib.visLayout(tlOf(55, 'major', 3, 7), { perRow: 10, beatsPerBar: 4, sig: sigG });
ok(big.length === 5 && big.reduce((s, r) => s + r.notes.length, 0) === 43 && big.every(r => r.notes.every(n => n.step <= lib.VIS_HI && n.step >= lib.VIS_LO)), 'three octaves: 43 notes in 5 rows, every note drawable');
// slurs
const sl = lib.visSlurs(lib.buildTimeline({ start: 55, type: 'major', span: 1, bpm: 60, rootPc: 7, slur: 4 }));
ok(sl.length >= 3 && sl[0].from === 0 && sl[0].to === 3 && sl.every(s => s.to > s.from), 'slur groups of four notes (' + sl.map(s => s.from + '-' + s.to).join(' ') + ')');
ok(lib.visSlurs(lib.buildTimeline({ start: 55, type: 'major', span: 1, bpm: 60, rootPc: 7, slur: 1 })).length === 0, 'separate bows: no slurs');
// neck and keys
ok(lib.visFretX(0, 12) === 0 && lib.visFretX(12, 12) === 1 && Math.abs(lib.visFretX(12, 24) - 0.6667) < 1e-3 && lib.visFretX(5, 12) > 0.5, 'fret spacing: the octave sits at the middle of the string');
const vstr = [55, 62, 69, 76];   // G D A E
const pl = lib.visPlace({ string: 2, finger: '2', position: 1 }, vstr, 71);   // B4 on the A string (the second from the top) = 2 above A4
ok(pl.row === 1 && pl.offset === 2 && pl.finger === '2' && !pl.open, 'violin B on the A string: second row from the top, finger 2');
ok(lib.visPlace({ string: 1, finger: 'open' }, vstr, 76).open && lib.visPlace({ string: 1, finger: 'open' }, vstr, 76).finger === '0', 'open E string');
ok(lib.visPlace({ string: 6, fret: 3 }, [40, 45, 50, 55, 59, 64], 43).offset === 3 && lib.visPlace(null, vstr, 60) === null, 'guitar string 6 fret 3');
const kb = lib.visKeys(60, 72);
ok(kb.units === 8 && kb.keys.filter(k => !k.black).length === 8 && kb.keys.filter(k => k.black).length === 5 && kb.keys.find(k => k.midi === 61).black, 'keyboard C4 to C5: 8 white keys, 5 black');

// ---- the examiner rules (audit of the grader): a fault is not averaged away, no pillar carries the others, a flat scale is out of tune, uneven notes are heard
{
  const strict = lib.findEngine('scorer', 'strict'), prac = lib.findEngine('scorer', 'practical'), P = { tolerance: 12, expressive: 1, drift: 70 };
  const run = (e, slots, o = {}) => e.evaluate(slots, Object.assign({ beatMs: BEAT, mode: 'tempo', wobbleCap: 40, params: P }, o));
  const bad = (n, at, off) => mkSlots(n, i => at.includes(i) ? { c: off, m: off, a: 0 } : {});
  const one = run(strict, bad(15, [5], 40)), three = run(strict, bad(15, [3, 7, 11], 35)), long3 = run(strict, bad(43, [5, 20, 33], 35));
  ok(one.band === 'Distinction' && one.faults === 1, `one note 40 cents out in 15 still earns Distinction (${one.total})`);
  ok(three.band === 'Merit' && three.capped === 'pitch' && three.faults === 3, `three notes 35 cents out in 15 cannot be Distinction: pitch ${three.pitch.toFixed(0)} caps the run at Merit (${three.total})`);
  ok(long3.total < run(strict, mkSlots(43)).total - 3, `a fault costs points in a long scale too (3 faults in 43 notes: ${long3.total} against ${run(strict, mkSlots(43)).total})`);
  const weakPitch = run(strict, mkSlots(15, () => ({ c: 27, m: 27, a: 0 })));
  ok(weakPitch.pitch < 50 && weakPitch.total <= 74, `perfect rhythm and tone cannot carry poor intonation: pitch ${weakPitch.pitch.toFixed(0)} gives ${weakPitch.total}, at most a Pass`);
  const slow = run(strict, mkSlots(15, (i) => ({ e: i * 400 })));
  ok(slow.fluency < 100, 'a tempo that drifts away from the click costs fluency');
  // practical: a flat scale
  const flat = d => run(prac, mkSlots(15, () => ({ c: d, m: d, a: Math.abs(d) <= 10 ? 1 : 0 })));
  ok(flat(-10).band === 'Distinction' && flat(-10).offset === -10, 'practical: a scale 10 cents flat is forgiven and the offset is reported');
  ok(flat(-30).band !== 'Distinction' && flat(-30).offset === -30 && flat(-30).total < flat(-10).total - 8, `practical: a scale 30 cents flat is out of tune all the way through (${flat(-30).total} against ${flat(-10).total}) and the offset is still reported`);
  ok(prac.shift(Array(8).fill(-30), { params: P }) === -12 && prac.shift(Array(8).fill(-8), { params: P }) === -5.6, 'practical: the live meter forgives the same bounded share (12 cents at most)');
  // practical: the bowed-string zone and the free margin do not stack in full
  const ld = prac.dev(-24, { midi: 71, root: 0, fretless: true, params: P }), lead = run(prac, mkSlots(8, i => i === 3 ? { midi: 71, c: ld, m: ld, a: 1 } : {}));   // one leading note 24 cents flat (the zone takes 12 of it), the rest exact
  ok(lead.pitch < 100, `practical: a leading note 24 cents flat no longer gets full marks (${lead.pitch.toFixed(1)})`);
  // evenness: a constant lag is forgiven, uneven notes are not
  const lagged = run(strict, mkSlots(15, () => ({ e: 200 }))), uneven = run(strict, mkSlots(15, (i) => ({ e: i % 2 ? 130 : -130 }))), even0 = run(strict, mkSlots(15));
  ok(lagged.fluency === 100 && uneven.fluency < 85 && uneven.even < 50 && even0.even === 100, `evenness: a constant 200 ms lag costs nothing; notes alternately 130 ms early and late do (fluency ${uneven.fluency.toFixed(0)})`);
  // tone: cleanliness and the missing-measurement rule
  const clean = run(strict, mkSlots(15, () => ({ cl: 0.98 }))), noisyRoom = run(strict, mkSlots(15, () => ({ cl: 0.90 }))), scratchy = run(strict, mkSlots(15, i => ({ cl: i % 3 === 0 ? 0.86 : 0.98 })));
  ok(clean.tone === 100 && noisyRoom.tone === 100, 'tone: a poor room or microphone (every note clarity 0.90) is not held against the player');
  ok(scratchy.tone < 95 && scratchy.tone > 70, `tone: notes that are much less clearly pitched than the player's usual (scratch, bow noise) cost tone (${scratchy.tone.toFixed(0)})`);
  const unm = run(strict, mkSlots(15, () => ({ s: null })));
  ok(unm.tone === 75 && unm.toneMeasured === false, 'tone: when no note was long enough to measure, the mark is a neutral 75 and says so');
  // short notes
  const shorts = run(strict, mkSlots(15, (i) => ({ r: i % 2 ? 0.4 : 1 })));
  ok(shorts.shorts === 7 && shorts.continuity < 90, `notes held under 60% of their length are counted and cost continuity (${shorts.shorts} short, continuity ${shorts.continuity.toFixed(0)})`);
}

console.log(fail ? `${fail} FAILED` : 'all evaluation tests passed'); process.exit(fail ? 1 : 0);
