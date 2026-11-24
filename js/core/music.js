// Music theory: note names and maths, instrument tunings, scales, tuner target picking.
// Pure logic: no DOM, so it also runs in Node (tests load these same files).

const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLATS = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B']; let useFlats = false;
const midiName = m => (useFlats ? FLATS : NOTES)[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
function nameToMidi(n) { const m = n.match(/^([A-G]#?)(-?\d+)$/); return NOTES.indexOf(m[1]) + 12 * (+m[2] + 1); }
const noteToFreq = (midi, a4 = 440) => a4 * Math.pow(2, (midi - 69) / 12);
function freqToNote(f, a4) {
  const midiF = 69 + 12 * Math.log2(f / a4), midi = Math.round(midiF);
  return { midi, cents: (midiF - midi) * 100, name: midiName(midi) };
}
const centsBetween = (f, target) => 1200 * Math.log2(f / target);
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const PRESETS = {
  chromatic:  { label: 'Chromatic', strings: [] },
  guitar:     { label: 'Guitar – Standard',   strings: ['E2','A2','D3','G3','B3','E4'] },
  guitarDropD:{ label: 'Guitar – Drop D',     strings: ['D2','A2','D3','G3','B3','E4'] },
  guitarHalf: { label: 'Guitar – Half step down', strings: ['D#2','G#2','C#3','F#3','A#3','D#4'] },
  guitarFull: { label: 'Guitar – Full step down', strings: ['D2','G2','C3','F3','A3','D4'] },
  guitarDadgad:{ label: 'Guitar – DADGAD',    strings: ['D2','A2','D3','G3','A3','D4'] },
  guitarOpenG:{ label: 'Guitar – Open G',     strings: ['D2','G2','D3','G3','B3','D4'] },
  guitarOpenD:{ label: 'Guitar – Open D',     strings: ['D2','A2','D3','F#3','A3','D4'] },
  bass:       { label: 'Bass – 4 string',     strings: ['E1','A1','D2','G2'] },
  bass5:      { label: 'Bass – 5 string',     strings: ['B0','E1','A1','D2','G2'] },
  violin:     { label: 'Violin',    strings: ['G3','D4','A4','E5'] },
  viola:      { label: 'Viola',     strings: ['C3','G3','D4','A4'] },
  cello:      { label: 'Cello',     strings: ['C2','G2','D3','A3'] },
  mandolin:   { label: 'Mandolin',  strings: ['G3','D4','A4','E5'] },
  ukulele:    { label: 'Ukulele (GCEA)',  strings: ['G4','C4','E4','A4'] },
  ukuleleLow: { label: 'Ukulele (Low-G)', strings: ['G3','C4','E4','A4'] },
  ukuleleBar: { label: 'Ukulele (Baritone)', strings: ['D3','G3','B3','E4'] },
};
// the tuner shows one chip per instrument; tunings of the same instrument are chosen in a menu
const FAMILIES = [['chromatic', 'Chromatic', ['chromatic']], ['guitar', 'Guitar', ['guitar', 'guitarDropD', 'guitarHalf', 'guitarFull', 'guitarDadgad', 'guitarOpenG', 'guitarOpenD']],
  ['bass', 'Bass', ['bass', 'bass5']], ['violin', 'Violin', ['violin']], ['viola', 'Viola', ['viola']], ['cello', 'Cello', ['cello']],
  ['ukulele', 'Ukulele', ['ukulele', 'ukuleleLow', 'ukuleleBar']], ['mandolin', 'Mandolin', ['mandolin']]];
const SCALES = {
  major:['Major',[0,2,4,5,7,9,11]], naturalMinor:['Natural minor',[0,2,3,5,7,8,10]],
  harmonicMinor:['Harmonic minor',[0,2,3,5,7,8,11]], majorPent:['Major pentatonic',[0,2,4,7,9]],
  minorPent:['Minor pentatonic',[0,3,5,7,10]], blues:['Blues',[0,3,5,6,7,10]],
  dorian:['Dorian',[0,2,3,5,7,9,10]], mixolydian:['Mixolydian',[0,2,4,5,7,9,10]],
  chromatic:['Chromatic',[0,1,2,3,4,5,6,7,8,9,10,11]],
};
function buildScale(rootPc, octave, type, span, dir) {
  const root = 12 * (octave + 1) + rootPc, iv = SCALES[type][1], up = [];
  for (let o = 0; o < span; o++) for (const i of iv) up.push(root + 12 * o + i);
  up.push(root + 12 * span);
  const down = [...up].reverse();
  return dir === 'asc' ? up : dir === 'desc' ? down : up.concat(down.slice(1));
}
function gradeCents(cents, tol) { const a = Math.abs(cents); return a <= tol ? 'In tune' : a <= 25 ? 'Close' : 'Out of tune'; }

function pickTarget(f, a4, strings, lockIdx) {
  if (!strings.length) { const n = freqToNote(f, a4); return { idx: -1, midi: n.midi, hz: noteToFreq(n.midi, a4), cents: n.cents }; }
  let idx = lockIdx;
  if (idx != null && (idx < 0 || idx >= strings.length)) idx = null;
  if (idx == null) {
    let best = Infinity;
    strings.forEach((m, i) => { const c = Math.abs(centsBetween(f, noteToFreq(m, a4))); if (c < best) { best = c; idx = i; } });
  }
  const hz = noteToFreq(strings[idx], a4);
  return { idx, midi: strings[idx], hz, cents: centsBetween(f, hz) };
}

