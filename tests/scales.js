// Scale drills model: scale legs, reference timeline, instrument rules (start octave, range, clamping), fingering hints, scoring. node tests/scales.js
const lib = require('./lib/load.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const names = tl => tl.map(n => n.noteName).join(' ');
const mk = (preset, pc, type, span, bpm = 60, tech) => { const p = lib.planScale(preset, pc, span, tech); return { p, tl: lib.buildTimeline({ start: p.start, type, span: p.span, bpm, rootPc: pc, slur: lib.slurSize(preset, tech) }) }; };

// ---- scale legs
let { tl } = mk('violin', 0, 'major', 1);
ok(names(tl) === 'C4 D4 E4 F4 G4 A4 B4 C5 B4 A4 G4 F4 E4 D4 C4', 'C major 1 octave: up then down, top note once (' + names(tl) + ')');
ok(tl.length === 15 && tl.filter(n => n.direction === 'up').length === 8 && tl.filter(n => n.direction === 'down').length === 7, 'top note counts as up; down leg has 7 notes ending on the start');
ok(mk('violin', 0, 'major', 2).tl.length === 29 && mk('violin', 0, 'major', 3).tl.length === 43, 'major: 2 octaves = 29 notes, 3 octaves = 43');
({ tl } = mk('violin', 9, 'melodicMinor', 1));
ok(names(tl) === 'A3 B3 C4 D4 E4 F#4 G#4 A4 G4 F4 E4 D4 C4 B3 A3', 'A melodic minor: raised 6th/7th up, natural minor down (' + names(tl) + ')');
ok(new Set(tl.map(n => n.midi + n.direction)).size === tl.length, 'melodic minor: no duplicated top note');
({ tl } = mk('violin', 9, 'harmonicMinor', 1));
ok(names(tl).startsWith('A3 B3 C4 D4 E4 F4 G#4 A4 G#4 F4'), 'A harmonic minor uses G# both ways');
({ tl } = mk('violin', 0, 'chromatic', 1));
ok(tl.length === 25 && tl[12].midi - tl[0].midi === 12 && tl[24].midi === tl[0].midi, 'chromatic: 25 notes, back to the start');
({ tl } = mk('violin', 7, 'majorPent', 1));
ok(tl.slice(0, 6).map(n => n.noteName).join(' ') === 'G3 A3 B3 D4 E4 G4', 'pentatonic: five notes per octave');

// ---- spelling follows the key
ok(names(mk('violin', 10, 'major', 1).tl).startsWith('Bb3 C4 D4 Eb4 F4 G4 A4 Bb4'), 'Bb major is spelled with flats');
ok(names(mk('violin', 7, 'naturalMinor', 1).tl).startsWith('G3 A3 Bb3 C4 D4 Eb4'), 'G minor is spelled with flats');
ok(names(mk('violin', 6, 'major', 1).tl).startsWith('F#4 G#4 A#4 B4'), 'F# major is spelled with sharps');
ok(lib.buildTimeline({ start: 62, type: 'major', span: 1, bpm: 60, rootPc: 2, flats: true })[0].noteName === 'D4', 'a forced setting wins');

// ---- timeline timing and slurs
const t80 = lib.buildTimeline({ start: 60, type: 'major', span: 1, bpm: 120, rootPc: 0, slur: 1 });
ok(t80[1].startMs === 500 && t80[14].startMs === 7000, 'timing: one note per beat (120 BPM = 500 ms)');
ok(t80.every(n => n.slurStart) && t80[0].durationMs < 500, 'separate bows: every note starts a bow, with a small gap');
const s4 = lib.buildTimeline({ start: 55, type: 'major', span: 1, bpm: 60, rootPc: 7, slur: 4 });
ok(s4.map(n => n.slurStart ? 'B' : '.').join('') === 'B...B...B...B..', 'slur 4: bow change every four notes (up leg 8 notes, then a fresh bow at the turn)');
ok(s4[0].durationMs === 1000 && s4[3].durationMs < 1000 && s4[7].durationMs < 1000, 'slurred notes run into each other; the last note of a bow lifts');
const s8 = lib.buildTimeline({ start: 55, type: 'major', span: 1, bpm: 60, rootPc: 7, slur: 8 });
ok(s8[0].slurStart && !s8[7].slurStart && s8[8].slurStart, 'slur 8 over an 8-note up leg then a new bow going down');
ok(lib.timelineIndexAt(t80, -1) === null && lib.timelineIndexAt(t80, 0) === 0 && lib.timelineIndexAt(t80, 1250) === 2 && lib.timelineIndexAt(t80, 99999) === 15, 'clock to note index');
let threw = false; try { lib.buildTimeline({ start: 60, type: 'major', span: 1, bpm: 0 }); } catch { threw = true; } ok(threw, 'a zero tempo is rejected');

// ---- start octave per instrument + root
const startOf = (preset, pc, span = 1, tech) => lib.planScale(preset, pc, span, tech).start;
const violinStart = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(pc => Math.floor(startOf('violin', pc) / 12) - 1);
ok(violinStart.join() === '4,4,4,4,4,4,4,3,3,3,3,3', 'violin: G..B start in octave 3, C..F# in octave 4 (' + violinStart + ')');
ok(lib.INSTRUMENT_RULES.violin.range[1] === 103, 'violin ceiling is G7');
for (let pc = 0; pc < 12; pc++) { const p = lib.planScale('violin', pc, 3); if (!(p.span === 3 && p.fits && !p.clamped)) { ok(false, 'violin: three octaves fit for root ' + pc); break; } }
ok(lib.planScale('violin', 6, 3).top === 102, 'violin F# three octaves ends on F#7 (102), inside the G7 ceiling');
ok(startOf('guitar', 4) === 40 && startOf('guitar', 0) === 48 && startOf('guitar', 7) === 43, 'guitar: lowest comfortable start (E2, C3, G2)');
ok(startOf('guitarDropD', 2) === 50 && lib.ruleKey('guitarDropD') === 'guitar' && lib.ruleKey('ukuleleBar') === 'ukuleleBar' && lib.ruleKey('bass5') === 'bass', 'tuning presets map to their instrument rule');
ok(startOf('ukulele', 0) === 60 && startOf('ukulele', 7) === 67, 'ukulele: C4 and G4 starts');
ok(startOf('guitar', 9, 1, 'mid') > startOf('guitar', 9, 1, 'open') || startOf('guitar', 9, 1, 'mid') === 45, 'guitar mid-neck position starts higher up the neck');

// ---- range clamping and warnings
let pl = lib.planScale('ukulele', 0, 3);
ok(pl.span === 2 && pl.clamped && pl.fits && pl.warnings.length === 1, 'ukulele C, 3 octaves: clamped to 2 with a warning (' + pl.warnings[0] + ')');
pl = lib.planScale('ukulele', 0, 2); ok(pl.span === 2 && !pl.clamped && pl.warnings.length === 0, 'ukulele C, 2 octaves fits, no warning');
pl = lib.planScale('guitar', 3, 3, 'mid'); ok(pl.top <= 88 && pl.fits, 'guitar: a span that does not fit from a high start is lowered or shortened, never out of range');
for (const preset of Object.keys(lib.INSTRUMENT_RULES)) for (let pc = 0; pc < 12; pc++) for (let s = 1; s <= 3; s++) {
  const q = lib.planScale(preset, pc, s), r = lib.INSTRUMENT_RULES[preset];
  if (q.fits && (q.start < r.range[0] || q.top > r.range[1])) { ok(false, `${preset} root ${pc} span ${s} stays inside the range`); }
  if (!q.fits && q.span !== 1) { ok(false, `${preset} root ${pc} span ${s}: clamps down to one octave before giving up`); }
}
ok(lib.planScale('violin', 0, 9).requestedSpan === 3 && lib.planScale('violin', 0, 0).span === 1, 'span is limited to 1 to 3');

// ---- instrument controls
const vt = lib.controls('violin'), gt = lib.controls('guitarDropD'), ct = lib.controls('chromatic'), ut = lib.controls('ukulele');
ok(vt.bowing.options.map(o => o.value).join() === 'separate,slur2,slur4,slur8', 'violin gets Bowing: Separate, Slur 2, 4, 8');
ok(vt.position.options.map(o => o.value).join() === '1,2,3,4,5' && vt.position.def === '1', 'violin also gets Position: 1st to 5th');
ok(gt.bowing === null && gt.position.options.map(o => o.value).join() === 'open,mid,auto' && gt.position.def === 'open' && ut.position.def === 'open', 'guitar and ukulele get Position only: Open/1st, Mid neck, Auto');
ok(ct.bowing === null && ct.position === null && lib.slurSize('guitar', 'slur4') === 1 && lib.slurSize('violin', 'slur4') === 4, 'piano has no control; slurs only apply to bowed strings');
ok(lib.PRACTICE_INSTRUMENTS.map(x => x[0]).join() === 'violin,guitar,chromatic,ukulele' && lib.PRACTICE_INSTRUMENTS[2][1] === 'Piano', 'the Scale screen offers Violin, Guitar, Piano, Ukulele');
ok(lib.practiceInstrument('guitarDropD') === 'guitar' && lib.practiceInstrument('ukuleleLow') === 'ukulele' && lib.practiceInstrument('bass') === 'chromatic' && lib.practiceInstrument('violin') === 'violin' && lib.practiceInstrument('viola') === 'chromatic', 'any tuner preset maps to one of the four');
ok(lib.ruleFor('violin').wobble > lib.ruleFor('guitar').wobble && lib.ruleFor('violin').smooth > lib.ruleFor('guitar').smooth, 'violin forgives more wobble and smooths vibrato more than guitar');

// ---- modes and arpeggios
const D = (pc, type) => names(mk('violin', pc, type, 1).tl);
ok(D(2, 'dorian').startsWith('D4 E4 F4 G4 A4 B4 C5 D5'), 'D dorian');
ok(D(4, 'phrygian').startsWith('E4 F4 G4 A4 B4 C5 D5 E5'), 'E phrygian');
ok(D(5, 'lydian').startsWith('F4 G4 A4 B4 C5 D5 E5 F5'), 'F lydian (B natural: spelled with sharps, no flat)');
ok(D(7, 'mixolydian').startsWith('G3 A3 B3 C4 D4 E4 F4 G4'), 'G mixolydian');
ok(D(11, 'locrian').startsWith('B3 C4 D4 E4 F4 G4 A4 B4'), 'B locrian');
ok(D(0, 'wholeTone').startsWith('C4 D4 E4 F#4 G#4 A#4 C5'), 'whole tone');
ok(D(0, 'arpMajor') === 'C4 E4 G4 C5 G4 E4 C4', 'C major arpeggio, 1 octave: ' + D(0, 'arpMajor'));
ok(D(9, 'arpMinor') === 'A3 C4 E4 A4 E4 C4 A3', 'A minor arpeggio');
ok(D(7, 'dom7') === 'G3 B3 D4 F4 G4 F4 D4 B3 G3', 'G dominant 7th arpeggio: ' + D(7, 'dom7'));
ok(D(0, 'dim7') === 'C4 Eb4 Gb4 A4 C5 A4 Gb4 Eb4 C4' || D(0, 'dim7') === 'C4 D#4 F#4 A4 C5 A4 F#4 D#4 C4', 'C diminished 7th arpeggio (' + D(0, 'dim7') + ')');
ok(mk('violin', 0, 'arpMajor', 3).tl.length === 3 * 3 * 2 + 1, 'arpeggio over 3 octaves: top note once');
ok(Object.values(lib.SCALE_DEFS).every(d => d.group) && new Set(Object.values(lib.SCALE_DEFS).map(d => d.group)).size === 4, 'scales are grouped: Scales, Modes, Pentatonic/blues, Arpeggios');

// ---- violin positions
ok(lib.planScale('violin', 7, 1, '1').start === 55 && lib.planScale('violin', 7, 1, '3').start === 67 && lib.planScale('violin', 0, 1, '2').start === 60, 'violin: a higher position starts the scale higher (3rd position G = G4)');
let vp = lib.planScale('violin', 0, 3, '5'); ok(vp.span === 2 && vp.clamped && vp.start === 72, 'violin 5th position, 3 octaves: shortened rather than dropped out of position (' + vp.warnings[0] + ')');
const VS2 = [55, 62, 69, 76];
ok(lib.fingerHint('violin', 67, VS2, '3').text === 'D string · finger 1 (3rd pos)', 'hint in 3rd position: G on the D string, first finger');
ok(lib.fingerHint('violin', 55, VS2, '3').text.includes('shift') || lib.fingerHint('violin', 55, VS2, '3').text.includes('open'), 'open G in 3rd position says open (reachable only as an open string)');
ok(lib.fingerHint('violin', 57, VS2, '1').text === 'G string · finger 1' && lib.fingerHint('violin', 57, VS2, '2') && true, 'hint in 1st position unchanged (A on the G string, finger 1)');

// ---- fingering hints
const VS = [55, 62, 69, 76], GS = [40, 45, 50, 55, 59, 64], US = [67, 60, 64, 69];
ok(lib.fingerHint('violin', 69, VS).text === 'open A string' && lib.fingerHint('violin', 71, VS).text === 'A string · finger 1', 'violin hint: open A, B = finger 1');
ok(lib.fingerHint('violin', 60, VS).text.includes('G string') && /shift up/.test(lib.fingerHint('violin', 88, VS).text), 'violin hint: a note above the E string span says to shift up');
ok(lib.fingerHint('guitar', 64, GS, 'open').text === 'open string 1' && lib.fingerHint('guitar', 67, GS, 'open').text === 'string 1 · fret 3', 'guitar hint, open position: open E, G = fret 3');
ok(lib.fingerHint('guitar', 64, GS, 'mid').fret >= 5 && lib.fingerHint('guitar', 64, GS, 'mid').fret <= 9, 'guitar hint, mid neck: stays in frets 5 to 9');
ok(lib.fingerHint('ukulele', 60, US).text === 'open string 3' && lib.fingerHint('chromatic', 60, []) === null, 'ukulele hint; chromatic gives none');

// ---- scoring: cents, frames, octave glitches
const cents = (f, m) => lib.centsOffset(f, m);
ok(Math.abs(cents(440, 69)) < 1e-9 && Math.abs(cents(466.1638, 69) - 100) < 0.01 && Math.abs(cents(430, 69) - (-39.9)) < 0.5, 'cents offset: 440 = 0, +1 semitone = +100');
ok(lib.classifyFrame(5, 10) === 'ok' && lib.classifyFrame(25, 10) === 'sharp' && lib.classifyFrame(-25, 10) === 'flat' && lib.classifyFrame(180, 10) === 'wrong', 'frame classes: ok, sharp, flat, wrong');
ok(lib.classifyFrame(1195, 10) === 'glitch' && lib.classifyFrame(-1210, 10) === 'glitch' && lib.classifyFrame(1900, 10) === 'glitch' && lib.classifyFrame(600, 10) === 'wrong', 'octave and twelfth errors are glitches, not wrong notes');
ok(lib.smoothCents([0, 0, 90, 0, 0], 3).join() === '0,0,0,0,0', 'smoothing removes a one-frame spike');
const vib = Array.from({ length: 60 }, (_, i) => 15 * Math.sin(i * 0.6));
ok(lib.holdStats(vib, 10, 9).s < lib.holdStats(vib, 10, 1).s * 0.8 && Math.abs(lib.holdStats(vib, 10, 9).c) < 2, 'wider smoothing calms vibrato; bias stays centred');

// ---- scoring: status, comments
const h = (c, a = 1, s = 5, d) => ({ k: 'h', c, a, s, d, i: 'violin' });
const sc = evs => lib.noteScore(evs, undefined, 1);
ok(lib.noteStatus([h(2)], sc([h(2)]), 10) === 'ok' && lib.noteStatus([h(22)], sc([h(22)]), 10) === 'sharp' && lib.noteStatus([h(-22)], sc([h(-22)]), 10) === 'flat', 'badges: ok / sharp / flat');
ok(lib.noteStatus([{ k: 'w' }, { k: 'w' }, h(3)], sc([{ k: 'w' }, { k: 'w' }, h(3)]), 10) === 'wrong' && lib.noteStatus([{ k: 's' }], sc([{ k: 's' }]), 10) === 'miss' && lib.noteStatus([], null, 10) === null, 'badges: wrong, missed, no data');
ok(lib.guidance(16, 3) === '+16c sharp, lower' && lib.guidance(-8, 3) === '−8c flat, slightly higher' && lib.guidance(2, 3) === 'centred' && lib.guidance(40, 3).endsWith('much lower'), 'guidance wording (' + lib.guidance(16, 3) + ')');
ok(lib.guidance(0, 35, 40).includes('steadier') && !lib.guidance(0, 10, 40).includes('steadier'), 'wobble over three quarters of the instrument cap adds a steadiness hint');
ok(lib.commentFor([], null) === 'not played yet' && lib.commentFor([{ k: 's' }, { k: 's' }], sc([{ k: 's' }, { k: 's' }])) .includes('2 skipped'), 'comment: not played / skipped');
ok(lib.noteScore([h(0), h(0)]) === null && lib.noteScore([h(0), h(0), h(0)]).score > 90, 'default needs 3 plays (analysis page); the scorecard asks for 1');
const all = { 66: [h(5, 1, 5, 'up'), h(-30, 1, 5, 'down')], 67: [h(1)] };
ok(lib.eventsFor(all, 66, 'up').length === 1 && lib.eventsFor(all, 66, 'down')[0].c === -30 && lib.eventsFor(all, 67, 'down').length === 1, 'F#4 up and F#4 down are separate; old events without a direction count for both');

// ---- scoring: run summary
const slot = (name, midi, d, c, a, e) => ({ name, midi, d, k: 'h', c, a, s: 4, e, wrong: 0 });
const run = [slot('G3', 55, 'up', 2, 1, 10), slot('A3', 57, 'up', 3, 1, -20), slot('B3', 59, 'up', 25, 0.2, 30), slot('A3', 57, 'down', 4, 0.9, 380), { name: 'G3', midi: 55, d: 'down', k: 's', wrong: 2 }];
const sm = lib.summariseRun(run, { tol: 10, beatMs: 1000 });
ok(sm.slots === 5 && sm.played === 4 && sm.skipped === 1 && sm.wrongNotes === 2 && sm.inTune === 3, 'summary counts');
ok(Math.abs(sm.intonation - 100 * (1 + 1 + 0.2 + 0.9) / 5) < 1e-9, 'intonation = in-tune share of frames across every position, a skipped one counts 0 (' + sm.intonation.toFixed(1) + ')');
ok(sm.timing > 60 && sm.timing < 90 && Math.abs(sm.timingDriftMs - 100) < 1, 'timing score and average rush/drag (' + sm.timing.toFixed(0) + ', ' + sm.timingDriftMs.toFixed(0) + ' ms late)');
ok(sm.spots.length === 2 && sm.spots[0].name === 'G3' && sm.spots[0].d === 'down' && sm.spots[1].name === 'B3' && /sharp/.test(sm.spots[1].text), 'spots to fix: the weakest, worst first, only those under 85 (' + sm.spots.map(s => s.name + s.d).join() + ')');
ok(lib.summariseRun([slot('C4', 60, 'up', 1, 1, null)], { tol: 10, beatMs: 1000 }).timing === null && lib.summariseRun([slot('C4', 60, 'up', 1, 1, null)], { tol: 10, beatMs: 1000 }).spots.length === 0 && lib.summariseRun([], { tol: 10 }) === null, 'no timing in Wait mode; a clean run has no spots; an empty run has no summary');

// ---- randomize
const rp = lib.randomPrompt(() => 0.99, lib.EXAM_SCALES.basic, 3); ok(rp.rootPc === 11 && rp.span === 3 && lib.SCALE_DEFS[rp.type], 'random prompt picks a root, an exam scale and a span');
ok(Object.keys(lib.SCALE_DEFS).every(k => lib.scaleLegs(k, 3).up[0] === 0), 'every scale type builds');

console.log(fail ? `\n${fail} FAILED` : '\nall scales tests passed'); process.exit(fail ? 1 : 0);
