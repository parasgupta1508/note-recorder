// Scale generation and the reference timeline. One timeline feeds "Hear scale" and the live microphone scoring.
// Pure logic: no DOM, so it also runs in Node (tests load this same file).

// up = intervals going up, down = intervals going down when they differ (melodic minor), rel = semitones to the relative major (for spelling)
const SCALE_DEFS = {
  major:         { label: 'Major',          up: [0, 2, 4, 5, 7, 9, 11], rel: 0 },
  naturalMinor:  { label: 'Natural minor',  up: [0, 2, 3, 5, 7, 8, 10], rel: 3 },
  harmonicMinor: { label: 'Harmonic minor', up: [0, 2, 3, 5, 7, 8, 11], rel: 3 },
  melodicMinor:  { label: 'Melodic minor',  up: [0, 2, 3, 5, 7, 9, 11], down: [0, 2, 3, 5, 7, 8, 10], rel: 3 },
  majorPent:     { label: 'Major pentatonic', up: [0, 2, 4, 7, 9], rel: 0 },
  minorPent:     { label: 'Minor pentatonic', up: [0, 3, 5, 7, 10], rel: 3 },
  blues:         { label: 'Blues',          up: [0, 3, 5, 6, 7, 10], rel: 3 },
  dorian:        { label: 'Dorian',         up: [0, 2, 3, 5, 7, 9, 10], rel: 10 },
  mixolydian:    { label: 'Mixolydian',     up: [0, 2, 4, 5, 7, 9, 10], rel: 5 },
  chromatic:     { label: 'Chromatic',      up: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], rel: 0 },
};
// What a "Randomize" press may pick: the scales an exam asks for (an exam preset is just another list like this one).
const EXAM_SCALES = { basic: ['major', 'naturalMinor', 'harmonicMinor', 'melodicMinor', 'chromatic', 'majorPent', 'minorPent'] };

const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_KEY_PCS = [5, 10, 3, 8, 1];   // major keys written with flats: F, Bb, Eb, Ab, Db (F#/Gb is written with sharps)

// Flats or sharps? Follows the key signature (Bb major, G minor -> flats). force true/false overrides, null = by key.
function prefersFlats(rootPc, type, force) {
  if (force === true || force === false) return force;
  const d = SCALE_DEFS[type]; if (!d) return false;
  return FLAT_KEY_PCS.includes(((rootPc + d.rel) % 12 + 12) % 12);
}
const spellNote = (midi, flats) => (flats ? PC_FLAT : PC_SHARP)[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

// Semitone offsets from the start: up leg (the top note included once) and down leg (top not repeated, ends on the start note).
// Melodic minor goes up with raised 6th and 7th and comes down as natural minor.
function scaleLegs(type, span) {
  const d = SCALE_DEFS[type]; if (!d) throw new Error('unknown scale ' + type);
  const upI = d.up, downI = d.down || d.up, up = [], down = [];
  for (let o = 0; o < span; o++) for (const i of upI) up.push(12 * o + i);
  up.push(12 * span);
  for (let o = span - 1; o >= 0; o--) for (let k = downI.length - 1; k >= 0; k--) down.push(12 * o + downI[k]);
  return { up, down };
}

// The reference timeline: [{ index, noteName, midi, direction:'up'|'down', startMs, durationMs, slurStart }].
// opts: { start (MIDI), type, span, bpm, slur (notes per bow, 1 = separate), rootPc, flats (true/false/null) }
// One note per beat. Notes inside a slur run into each other (full duration); separate notes leave a small gap.
// Slur groups restart at the turn, so the top note ends the up bow and the first note down starts a new one.
function buildTimeline(o) {
  const { start, type, span, bpm } = o, slur = Math.max(1, o.slur | 0 || 1);
  if (!(bpm > 0)) throw new Error('bpm must be positive');
  const legs = scaleLegs(type, span), beat = 60000 / bpm, flats = prefersFlats(o.rootPc != null ? o.rootPc : start % 12, type, o.flats);
  const items = legs.up.map(x => ({ midi: start + x, direction: 'up' })).concat(legs.down.map(x => ({ midi: start + x, direction: 'down' })));
  const nUp = legs.up.length;
  return items.map((it, i) => {
    const pos = i < nUp ? i : i - nUp, slurStart = pos % slur === 0;
    const next = items[i + 1], continues = next && (i + 1 === nUp ? false : (pos + 1) % slur !== 0);
    return { index: i, noteName: spellNote(it.midi, flats), midi: it.midi, direction: it.direction, startMs: Math.round(i * beat * 1000) / 1000,
      durationMs: Math.round((continues ? beat : beat * 0.9) * 1000) / 1000, slurStart };
  });
}
const timelineEndMs = tl => tl.length ? tl[tl.length - 1].startMs + tl[tl.length - 1].durationMs : 0;
// Index of the note the clock is on at ms (null before the start, tl.length after the end).
function timelineIndexAt(tl, ms) {
  if (ms < 0) return null;
  if (tl.length < 2) return ms < 0 ? null : tl.length;
  return Math.min(tl.length, Math.floor(ms / (tl[1].startMs - tl[0].startMs)));
}
// A random exam-style prompt: { rootPc, type, span }. rnd is Math.random-like so tests can be deterministic.
function randomPrompt(rnd, list, maxSpan) {
  const types = list || EXAM_SCALES.basic;
  return { rootPc: Math.floor(rnd() * 12), type: types[Math.floor(rnd() * types.length)], span: 1 + Math.floor(rnd() * (maxSpan || 3)) };
}
