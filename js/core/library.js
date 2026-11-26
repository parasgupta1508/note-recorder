// The library model: where a piece lives (instrument + category path), the category tree, search, generated scales and arpeggios,
// transposition and range checks, and the bar grid. Pure logic: no DOM, so Node tests load this same file.
//   Piece (library fields) = { id, title, instrument, categoryPath: ['Mozart', 'Volume 1'], builtin, favourite, verified, pack?, generator?, ... }  (see piece.js for the rest)

const LIB_INSTRUMENTS = ['violin', 'guitar', 'piano', 'ukulele'];
const LIB_INSTRUMENT_NAMES = { violin: 'Violin', guitar: 'Guitar', piano: 'Piano', ukulele: 'Ukulele' };
const LIB_FILE = /\.(mid|midi|musicxml|xml|mxl)$/i;
const LIB_SCALES_CAT = 'Scales and arpeggios';

// ---- packs: a folder listing or the names inside a .zip -> where each file belongs.
// "Violin/Mozart/Volume 1/a.mid" -> instrument violin, categories [Mozart, Volume 1]. A folder named after an instrument, anywhere in the path, sets the instrument
// (anything above it is just the pack's own name). Without one, the chosen default instrument is used and every folder is a category.
function parsePackPaths(paths, defaultInstrument) {
  const out = [], skipped = [];
  for (const raw of paths) {
    const segs = String(raw).replace(/\\/g, '/').split('/').filter(s => s && s !== '.'), file = segs[segs.length - 1] || '';
    if (!LIB_FILE.test(file) || segs.some(s => s.startsWith('.') || s === '__MACOSX')) { if (file && !segs.some(s => s.startsWith('.') || s === '__MACOSX') && !/\.(json|txt|md)$/i.test(file)) skipped.push(raw); continue; }
    const dirs = segs.slice(0, -1), at = dirs.findIndex(d => LIB_INSTRUMENTS.includes(d.toLowerCase()));
    const instrument = at >= 0 ? dirs[at].toLowerCase() : (defaultInstrument || 'violin');
    const cats = (at >= 0 ? dirs.slice(at + 1) : dirs).map(d => d.replace(/[<>&"]/g, '').trim().slice(0, 60)).filter(Boolean);
    out.push({ path: raw, instrument, categoryPath: cats.length ? cats : ['My imports'], title: file.replace(LIB_FILE, '').replace(/_+/g, ' ').replace(/[<>&"]/g, '').trim().slice(0, 80) || 'Untitled' });
  }
  return { items: out, skipped };
}

// ---- the category tree for one instrument. node = { name, path: [..], folders: Map(name -> node), pieces: [], count }
function buildTree(pieces, instrument) {
  const root = { name: '', path: [], folders: new Map(), pieces: [], count: 0 };
  for (const p of pieces) {
    if (instrument && p.instrument !== instrument) continue;
    let node = root; root.count++;
    for (const c of (p.categoryPath && p.categoryPath.length ? p.categoryPath : ['My imports'])) {
      if (!node.folders.has(c)) node.folders.set(c, { name: c, path: node.path.concat(c), folders: new Map(), pieces: [], count: 0 });
      node = node.folders.get(c); node.count++;
    }
    node.pieces.push(p);
  }
  return root;
}
const treeAt = (root, path) => path.reduce((n, c) => n && n.folders.get(c), root) || null;
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
// What to show at one level: folders (with counts) and the pieces directly in it, both in natural order ("Volume 2" before "Volume 10").
function listNode(node) { return { folders: [...node.folders.values()].sort((a, b) => natural(a.name, b.name)), pieces: node.pieces.slice().sort((a, b) => natural(a.title, b.title)) }; }

// A scale or arpeggio is anything filed under the "Scales and arpeggios" folder (the generated ones); every other piece is a piece.
const libIsScale = p => (p.categoryPath || [])[0] === LIB_SCALES_CAT;
// ---- search and filters. Every word typed must start a word in the title, the category path or the instrument (so "c maj" finds "C major", and "c" does not match "Scales").
function searchPieces(list, q, f = {}) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(p => (!f.builtin || p.builtin) && (!f.scales || libIsScale(p)) && (!f.pieces || !libIsScale(p)) && (!f.favourite || p.favourite) && (!f.tag || (p.tags || []).includes(f.tag)) && (!f.verified || p.verified) &&
    (hay => words.every(w => hay.some(h => h.startsWith(w))))((p.title + ' ' + (p.categoryPath || []).join(' ') + ' ' + p.instrument).toLowerCase().split(/[\s/,.›-]+/)));
}

// ---- generated scales and arpeggios: ordinary pieces with a "generator", no files. Notes are made when a piece is opened.
const GEN_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const GEN_TYPES = {                                  // id -> [label, intervals of one octave, kind]
  major: ['Major', [0, 2, 4, 5, 7, 9, 11], 'scale'], naturalMinor: ['Natural minor', [0, 2, 3, 5, 7, 8, 10], 'scale'], harmonicMinor: ['Harmonic minor', [0, 2, 3, 5, 7, 8, 11], 'scale'],
  melodicMinor: ['Melodic minor', [0, 2, 3, 5, 7, 9, 11], 'scale'], majorPent: ['Major pentatonic', [0, 2, 4, 7, 9], 'scale'], minorPent: ['Minor pentatonic', [0, 3, 5, 7, 10], 'scale'],
  chromatic: ['Chromatic', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'scale'], arpMajor: ['Major arpeggio', [0, 4, 7], 'arp'], arpMinor: ['Minor arpeggio', [0, 3, 7], 'arp'],
};
const GEN_PLAN = {                                   // per instrument: which types, how many octaves, lowest note a scale may start on, highest it may reach
  violin: { types: ['major', 'naturalMinor', 'harmonicMinor', 'melodicMinor', 'arpMajor', 'arpMinor', 'chromatic'], octaves: [1, 2, 3], low: 55, high: 100, label: 'Violin' },
  guitar: { types: ['major', 'naturalMinor', 'majorPent', 'minorPent', 'arpMajor', 'arpMinor', 'chromatic'], octaves: [1, 2], low: 40, high: 88, label: 'Guitar' },
  piano: { types: ['major', 'naturalMinor', 'harmonicMinor', 'melodicMinor', 'arpMajor', 'arpMinor', 'chromatic'], octaves: [1, 2, 3, 4], low: 60, high: 108, label: 'Piano', hands: true },
  ukulele: { types: ['major', 'naturalMinor', 'majorPent', 'arpMajor', 'arpMinor'], octaves: [1, 2], low: 60, high: 84, label: 'Ukulele' },
};
// Lowest MIDI note >= low with this pitch class (octave shift for the left hand is applied by the caller).
const genStart = (pc, low) => { let m = 12 * Math.floor(low / 12) + pc; if (m < low) m += 12; return m; };
function genNotes(g, instrument, hand) {
  const plan = GEN_PLAN[instrument] || GEN_PLAN.violin, t = GEN_TYPES[g.type], root0 = genStart(g.root, hand === 'left' ? plan.low - 12 : plan.low), up = [];
  for (let o = 0; o < g.octaves; o++) for (const i of t[1]) up.push(root0 + 12 * o + i);
  up.push(root0 + 12 * g.octaves);
  const seq = up.concat(up.slice(0, -1).reverse());                                // up, then back down (the top note once)
  return seq.map((m, i) => ({ midi: m, start: i * 0.75, dur: 700 }));                // quarter notes at 80 BPM
}
// Metadata for every generated piece of an instrument (cheap); materialize() makes the notes.
function generatorPieces(instrument) {
  const plan = GEN_PLAN[instrument]; if (!plan) return [];
  const out = [];
  for (const type of plan.types) for (const oct of plan.octaves) for (let r = 0; r < 12; r++) {
    const top = genStart(r, plan.low) + 12 * oct + (type === 'chromatic' ? 0 : 0); if (top > plan.high) continue;
    out.push({ id: `gen:${instrument}:${type}:${r}:${oct}`, title: `${GEN_ROOTS[r]} ${GEN_TYPES[type][0].toLowerCase()}, ${oct} octave${oct > 1 ? 's' : ''}`, instrument, categoryPath: [LIB_SCALES_CAT, GEN_TYPES[type][0]], builtin: true, favourite: false, verified: true, exact: true, source: 'generated', generator: { type, root: r, octaves: oct } });
  }
  return out;
}
function materialize(p) {
  if (!p.generator) return p;
  const parts = [{ id: 'main', name: p.instrument === 'piano' ? 'Right hand' : 'Scale', notes: genNotes(p.generator, p.instrument, 'right') }];
  if ((GEN_PLAN[p.instrument] || {}).hands) parts.push({ id: 'left', name: 'Left hand', notes: genNotes(p.generator, p.instrument, 'left') });
  return Object.assign({}, p, { parts, part: 0, bpm: 80, timeSig: [4, 4] });
}

// ---- transposition and range
const transposeNotes = (notes, semis) => notes.map(n => Object.assign({}, n, { midi: n.midi + semis }));
function rangeCheck(notes, instrument) {
  const r = (typeof PIECE_INSTRUMENTS !== 'undefined' && PIECE_INSTRUMENTS[instrument]) || [0, 127];
  const outside = notes.filter(n => n.midi < r[0] || n.midi > r[1]);
  return { low: r[0], high: r[1], total: notes.length, outside: outside.length, below: outside.filter(n => n.midi < r[0]).length, above: outside.filter(n => n.midi > r[1]).length };
}
// The octave shift (multiple of 12, -36..+36) that puts the most notes in range; 0 when it is already best.
function bestOctaveShift(notes, instrument) {
  let best = 0, bo = rangeCheck(notes, instrument).outside;
  for (const s of [12, -12, 24, -24, 36, -36]) { const o = rangeCheck(transposeNotes(notes, s), instrument).outside; if (o < bo) { bo = o; best = s; } }
  return best;
}

// ---- bar grid: a constant-tempo grid from the piece's tempo and time signature (tempo changes inside a piece are not followed).
function barGrid(p) {
  const [n, d] = p.timeSig || [4, 4], bpm = p.bpm > 0 ? p.bpm : 120, barSec = n * (4 / d) * 60 / bpm, notes = p.parts[p.part || 0].notes;
  const end = notes.length ? Math.max(...notes.map(x => x.start + x.dur / 1000)) : 0;
  return { barSec, bars: Math.max(1, Math.ceil(end / barSec - 1e-6)), bpm, timeSig: [n, d] };
}
// The notes of bars from..to (1-based, inclusive), moved so bar `from` starts at 0.
function notesInBars(notes, grid, from, to) {
  const a = (from - 1) * grid.barSec, b = to * grid.barSec;
  return notes.filter(n => n.start >= a - 1e-6 && n.start < b - 1e-6).map(n => Object.assign({}, n, { start: n.start - a }));
}
