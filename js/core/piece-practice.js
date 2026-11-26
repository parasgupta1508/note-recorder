// Piece practice: a MusicXML part turned into the same reference timeline the Scale drills use, so the same displays, the same two practice
// modes and the same graders work on a piece. Pure logic: no DOM, so it also runs in Node (tests load this same file).
//
//   parseMusicXml (musicxml.js)  ->  detectPartInstrument / summariseParts   which instrument is each part?
//                                ->  timelineFromPart                        the part (one melodic line, a range of bars) as scale-style notes
//                                ->  backingEvents                           the other parts, as sound for a live accompaniment
//
// A timeline note is the scale drills' note: { index, noteName, midi, direction, startMs, durationMs, slurStart }
// plus what only a piece has: beat (position in quarter notes from the start of the first bar), bar, dq (length in quarter notes).

const PP_MAX_NOTES = 400;          // the most notes one practice run holds (a longer part is cut at a bar line; the player picks the bars)
const PP_MAX_BACKING = 6000;       // the most accompaniment notes scheduled for one run

// ---- which instrument is this part? -------------------------------------------------------------------------------------------------------------
// key: the instrument the Scale drills know (its pitch tolerances, bowing and fingering hints). Parts for other instruments are practised with the
// chromatic (piano) rule: no vibrato allowance, no fingering hints, but the same grading.
const PP_NAME_RULES = [
  { key: 'violin',    label: 'Violin',   re: /\b(violins?|violino|violon|geige|fiddle)\b/i },
  { key: 'ukulele',   label: 'Ukulele',  re: /\b(ukulele|ukelele|uke)\b/i },
  { key: 'guitar',    label: 'Guitar',   re: /\b(guitars?|guitarra|gitarre|chitarra|gtr)\b/i, not: /\bbass\b/i },
  { key: 'chromatic', label: 'Piano',    re: /\b(pianos?|pianoforte|klavier|keyboards?|harpsichord|organ|celesta|clavichord|cembalo|synth\w*)\b/i },
];
// General MIDI programs (1-based, as MusicXML writes them)
const PP_PROGRAM_RULES = [
  { key: 'chromatic', label: 'Piano',  from: 1, to: 8 }, { key: 'chromatic', label: 'Piano', from: 17, to: 20 },
  { key: 'guitar',    label: 'Guitar', from: 25, to: 31 },
  { key: 'violin',    label: 'Violin', from: 41, to: 41 },
];
// Instruments that are not offered as a practice instrument: named so the badge says what the file has, scored with the nearest rule.
const PP_OTHER = /\b(viola|cello|violoncello|contrabass|double bass|flute|oboe|clarinet|bassoon|horn|trumpet|trombone|tuba|sax\w*|voice|vocals?|soprano|alto|tenor|bass|choir|mandolin|banjo|harp|recorder|accordion|marimba|vibraphone|xylophone|percussion|drums?)\b/i;

// part: { name, inst, program }  ->  { key, label, exact, text } (exact: false when the part is a different instrument scored with the piano rule)
function detectPartInstrument(part) {
  const text = `${part.inst || ''} ${part.name || ''}`;
  for (const r of PP_NAME_RULES) if (r.re.test(text) && !(r.not && r.not.test(text))) return { key: r.key, label: r.label, exact: true, text };
  if (part.program) for (const r of PP_PROGRAM_RULES) if (part.program >= r.from && part.program <= r.to) return { key: r.key, label: r.label, exact: true, text };
  const other = PP_OTHER.exec(text);
  const label = other ? other[1].replace(/^\w/, c => c.toUpperCase()) : (part.name || 'Unknown instrument');
  return { key: 'chromatic', label, exact: false, text };
}

// What the part picker needs for every <score-part>: [{ i, id, name, label, key, exact, notes, lo, hi, polyphonic }]
function summariseParts(parsed) {
  return parsed.parts.map((p, i) => {
    const d = detectPartInstrument(p), mids = p.notes.map(n => n.midi);
    const onsets = new Map(); for (const n of p.notes) onsets.set(Math.round(n.q * 1000), (onsets.get(Math.round(n.q * 1000)) || 0) + 1);
    return { i, id: p.id, name: p.name, label: d.label, key: d.key, exact: d.exact, notes: p.notes.length, lo: Math.min(...mids), hi: Math.max(...mids), polyphonic: [...onsets.values()].some(c => c > 1) || p.staves > 1 };
  });
}

// ---- one melodic line -------------------------------------------------------------------------------------------------------------------------------
// The drills listen for one note at a time, so a part with chords or several voices is played as its top line (or its bottom line):
// the highest (lowest) note that starts at each moment, kept only when no higher (lower) note is still sounding. Lengths are cut at the next note.
function monoLine(notes, mode = 'top') {
  const top = mode !== 'bottom', byQ = new Map();
  for (const n of notes) { const k = Math.round(n.q * 1000); if (!byQ.has(k)) byQ.set(k, []); byQ.get(k).push(n); }
  const out = []; let sounding = [];
  for (const k of [...byQ.keys()].sort((a, b) => a - b)) {
    const group = byQ.get(k), q = k / 1000, pick = group.reduce((a, b) => (top ? b.midi > a.midi : b.midi < a.midi) ? b : a);
    sounding = sounding.filter(s => s.q + s.dq > q + 1e-6);
    if (sounding.some(s => top ? s.midi > pick.midi : s.midi < pick.midi)) continue;   // an outer voice is still sounding: this is an inner voice
    const prev = out[out.length - 1]; if (prev && prev.q + prev.dq > q) prev.dq = q - prev.q;   // the new note ends the old one
    const n = { ...pick, dq: pick.dq }; out.push(n); sounding.push(n);
  }
  return out;
}

// The octave shift (a multiple of 12) that puts the most notes inside the instrument's range; the smallest shift wins a tie.
function fitOctaveShift(midis, range) {
  let best = 0, bs = -1;
  for (const k of [0, 1, -1, 2, -2, 3, -3]) { const s = midis.filter(m => m + 12 * k >= range[0] && m + 12 * k <= range[1]).length; if (s > bs) { bs = s; best = 12 * k; } }
  return best;
}

// ---- key and bars ---------------------------------------------------------------------------------------------------------------------------------------
// key: { fifths, minor } from the score. pc is the tonic of the MAJOR key with the same signature (what the notation code wants), flats: written with flats.
function keyInfo(key) {
  const f = key && Number.isFinite(+key.fifths) ? Math.max(-7, Math.min(7, Math.round(+key.fifths))) : 0, minor = !!(key && key.minor);
  const pc = (((7 * f) % 12) + 12) % 12, tonic = minor ? (pc + 9) % 12 : pc;
  return { fifths: f, minor, pc, tonic, flats: f < 0, label: `${(f < 0 ? PC_FLAT : PC_SHARP)[tonic]} ${minor ? 'minor' : 'major'}` };
}
const ppBeatsPerBar = ts => (ts && ts[0] > 0 && ts[1] > 0) ? ts[0] * 4 / ts[1] : 4;              // quarter notes in a bar
const ppSigBeats = ts => Math.max(2, Math.min(4, Math.round(ppBeatsPerBar(ts))));               // the count-in length the practice screen offers: 2, 3 or 4 beats
const ppLastBar = part => part.notes.reduce((m, n) => Math.max(m, n.bar), 1);

// Where bar b starts, in quarter notes. The score gives every measure's start; without it (an older saved piece) the bars are taken as even.
function ppBarQ(part, bar, timeSig) {
  if (part.bars && part.bars[bar - 1] != null) return part.bars[bar - 1];
  const first = part.notes.find(n => n.bar === bar); return first ? Math.floor(first.q) : (bar - 1) * ppBeatsPerBar(timeSig);
}
// A first range of bars that holds at most maxNotes notes of this part's line (for a long piece: the player then moves the range on).
function ppDefaultRange(part, line, maxNotes = PP_MAX_NOTES) {
  const last = ppLastBar(part), per = new Map(); for (const n of monoLine(part.notes, line)) per.set(n.bar, (per.get(n.bar) || 0) + 1);
  let count = 0, to = 1; for (let b = 1; b <= last; b++) { count += per.get(b) || 0; if (count > maxNotes && b > 1) break; to = b; }
  return { from: 1, to, last };
}

// ---- the timeline ---------------------------------------------------------------------------------------------------------------------------------------
// part: one entry of parseMusicXml().parts. o: { bpm, fromBar, toBar, line: 'top'|'bottom', shift (semitones), flats, timeSig, range: [lo, hi] (instrument, for warnings) }
// Returns { tl, beats, startQ, endQ, fromBar, toBar, dropped, outside, warnings }. beats: length of the bar range in quarter notes (the loop length).
function timelineFromPart(part, o = {}) {
  const bpm = o.bpm > 0 ? o.bpm : 80, ts = o.timeSig || [4, 4], last = ppLastBar(part);
  const fromBar = Math.max(1, Math.min(last, o.fromBar | 0 || 1)), toBar = Math.max(fromBar, Math.min(last, o.toBar | 0 || last));
  const inBars = part.notes.filter(n => n.bar >= fromBar && n.bar <= toBar), line = monoLine(inBars, o.line || 'top');
  const dropped = inBars.length - line.length, shift = o.shift | 0, beatMs = 60000 / bpm;
  if (!line.length) return { tl: [], beats: 0, startQ: 0, endQ: 0, fromBar, toBar, dropped, outside: 0, warnings: ['There are no notes in these bars.'] };
  const startQ = ppBarQ(part, fromBar, ts), endQ = part.bars && part.bars[toBar] != null ? part.bars[toBar] : Math.max(...line.map(n => n.q + n.dq));
  const flats = o.flats == null ? false : !!o.flats;
  const tl = line.slice(0, PP_MAX_NOTES).map((n, i) => {
    const midi = n.midi + shift, beat = n.q - startQ;
    let name = n.name && shift % 12 === 0 ? n.name.replace(/-?\d+$/, m => String(+m + shift / 12)) : spellNote(midi, flats);
    return { index: i, noteName: name, midi, direction: 'up', startMs: Math.round(beat * beatMs * 1000) / 1000, durationMs: Math.round(Math.max(60, n.dq * beatMs * 0.96) * 1000) / 1000, slurStart: true, beat, bar: n.bar, dq: n.dq };
  });
  const warnings = [];
  if (line.length > PP_MAX_NOTES) warnings.push(`Only the first ${PP_MAX_NOTES} notes are used; pick a shorter range of bars to practise the rest.`);
  const outside = o.range ? tl.filter(n => n.midi < o.range[0] || n.midi > o.range[1]).length : 0;
  if (outside) warnings.push(`${outside} of ${tl.length} notes are outside this instrument's range.`);
  if (dropped > 0) warnings.push(`${dropped} chord or inner-voice notes are left out: the drill listens to one line, the ${o.line === 'bottom' ? 'lowest' : 'highest'} notes.`);
  const used = tl[tl.length - 1].beat + tl[tl.length - 1].dq;
  return { tl, beats: Math.max(1, Math.ceil(Math.max(endQ - startQ, used) - 1e-6)), startQ, endQ, fromBar, toBar: tl[tl.length - 1].bar, dropped, outside, warnings };
}

// The other parts as sound: [{ midi, startMs, durationMs }] over the same bars, tempo and transposition as the practised part. Sorted by start.
function backingEvents(parts, mainIdx, o = {}) {
  const bpm = o.bpm > 0 ? o.bpm : 80, beatMs = 60000 / bpm, shift = o.shift | 0, from = o.startQ, to = o.endQ, out = [];
  parts.forEach((p, i) => {
    if (i === mainIdx || (o.only && !o.only.includes(i))) return;
    for (const n of p.notes) {
      if (n.q < from - 1e-6 || n.q >= to - 1e-6) continue;
      out.push({ midi: n.midi + shift, startMs: (n.q - from) * beatMs, durationMs: Math.max(60, n.dq * beatMs * 0.96) });
    }
  });
  out.sort((a, b) => a.startMs - b.startMs || a.midi - b.midi);
  return out.slice(0, PP_MAX_BACKING);
}

// A short id for "this piece, this part, these bars", so a run's history can be compared with the same piece only.
function ppSourceId(title, partName, fromBar, toBar) {
  let h = 5381; const s = `${title}|${partName}|${fromBar}-${toBar}`; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'pc' + h.toString(36);
}
