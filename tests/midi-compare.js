// Unit tests for js/core/midi.js (writer + reader) and js/core/compare.js (note matching). node tests/midi-compare.js
const lib = require('./lib/load.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const near = (a, b, e) => Math.abs(a - b) <= e;

// --- MIDI round trip
const notes = [{ midi: 60, start: 0, dur: 500, vel: 90 }, { midi: 64, start: 0.25, dur: 750, vel: 70 }, { midi: 60, start: 1.2, dur: 300 }, { midi: 127, start: 2, dur: 100 }];
const bytes = lib.writeMidi(notes, { name: 'test' }), back = lib.parseMidi(bytes);
ok(bytes[0] === 0x4d && bytes[1] === 0x54, 'writer: MThd header');
ok(back.notes.length === 4, 'round trip keeps every note');
ok(back.notes.every((n, i) => n.midi === notes[i].midi && near(n.start, notes[i].start, 0.002) && near(n.dur, notes[i].dur, 2)), 'round trip keeps pitch, start and length');
ok(back.notes[0].vel === 90 && back.notes[1].vel === 70, 'round trip keeps velocity');
ok(lib.parseMidi(lib.writeMidi([{ midi: 60, start: 0, dur: 100 }, { midi: 60, start: 0.1, dur: 100 }])).notes.length === 2, 'two touching notes of the same pitch stay two notes');
let threw = false; try { lib.parseMidi(new Uint8Array([1, 2, 3])); } catch { threw = true; } ok(threw, 'reader rejects non-MIDI data');
// tempo change: 480 tpq, tempo 1,000,000 us/beat (60 bpm) from tick 480: note at tick 960 = 0.5 s + 1.0 s = 1.5 s
const tm = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 0, 0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0x83, 0x60, 0xff, 0x51, 3, 0x0f, 0x42, 0x40, 0x83, 0x60, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0]);
const len = tm.length - 22; tm[18] = 0; tm[19] = 0; tm[20] = (len >> 8) & 255; tm[21] = len & 255;
const tr = lib.parseMidi(tm); ok(tr.notes.length === 1 && near(tr.notes[0].start, 1.5, 0.002) && near(tr.notes[0].dur, 1000, 3), `tempo map is followed (start ${tr.notes[0] && tr.notes[0].start.toFixed(3)} s)`);

// --- matching
const ref = [{ midi: 60, start: 0, dur: 400 }, { midi: 62, start: 0.5, dur: 400 }, { midi: 64, start: 1, dur: 400 }, { midi: 65, start: 1.5, dur: 400 }, { midi: 67, start: 2, dur: 400 }];
let r = lib.compareNotes(ref, ref.map(n => ({ ...n })));
ok(r.f1 === 1 && r.tp === 5 && r.overlapF1 > 0.999, 'identical lists score 1.0');
r = lib.compareNotes(ref, [{ midi: 60, start: 0.02, dur: 400 }, { midi: 74, start: 0.5, dur: 400 }, { midi: 65, start: 1, dur: 400 }, { midi: 65, start: 1.52, dur: 300 }, { midi: 90, start: 5, dur: 100 }]);
ok(r.tp === 2 && r.fp === 3 && r.fn === 3, `counts hits, extra and missed notes (tp ${r.tp}, fp ${r.fp}, fn ${r.fn})`);
ok(r.why.octave === 1 && r.why.semitone === 1 && r.why.none === 1, `explains misses (octave ${r.why.octave}, semitone ${r.why.semitone}, none ${r.why.none})`);
ok(near(r.onsetMedianMs, 20, 1) && near(r.durRatioMedian, 0.875, 0.01), 'timing and length ratio of matched notes');
const late = ref.map(n => ({ ...n, start: n.start + 0.12 }));
ok(lib.compareNotes(ref, late).tp === 0 && lib.compareNotes(ref, late, { autoShift: true }).f1 === 1 && near(lib.compareNotes(ref, late, { autoShift: true }).shift, -0.12, 0.001), 'autoShift finds a constant delay');
ok(lib.compareNotes([], []).f1 === 0 && lib.compareNotes(ref, []).recall === 0, 'empty lists do not crash');
// one-to-one: two found notes must not both claim one reference note
r = lib.compareNotes([{ midi: 60, start: 0, dur: 400 }], [{ midi: 60, start: 0, dur: 200 }, { midi: 60, start: 0.03, dur: 200 }]); ok(r.tp === 1 && r.fp === 1, 'one reference note is matched once');
// consensus
const c = lib.consensusNotes([ref, ref.slice(0, 3), ref.slice(1, 4)], 2); ok(c.length === 4 && c.every(n => n.votes >= 2), `consensus keeps notes two lists agree on (${c.length})`);
process.exit(fail ? 1 : 0);
