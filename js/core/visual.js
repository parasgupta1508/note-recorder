// Geometry for the scale practice screen: where each note sits on a treble staff, the key signature, accidentals, ledger lines, slurs,
// and where a note falls on a neck or a keyboard. Pure logic (no DOM): the drawing is in js/app/scale-visual.js, and the numbers here are tested in Node.
// A "step" counts the lines and spaces of the staff: step = octave * 7 + letter (C = 0 ... B = 6). The treble staff's bottom line is E4 = step 30.

const VIS_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const VIS_BOTTOM = 30, VIS_TOP = 38;           // bottom line E4, top line F5
const VIS_HI = 46, VIS_LO = 22;                // furthest note drawn with ledger lines (G6 and D3, four ledger lines); beyond that the row is written 8va / 8vb

function visParseNote(name) {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(name); if (!m) return null;
  const letter = VIS_LETTERS.indexOf(m[1]), oct = +m[3];
  return { letter, alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, oct, step: oct * 7 + letter };
}

// Key signature. A mode shares the signature of its relative major (D dorian = C major). Scales without a key (chromatic, whole tone, blues, diminished 7th) write every accidental.
const VIS_SHARP_KEYS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: 7 }, VIS_FLAT_KEYS = { 0: 0, 5: 1, 10: 2, 3: 3, 8: 4, 1: 5, 6: 6, 11: 7 };
const VIS_NO_SIG = ['chromatic', 'wholeTone', 'dim7', 'blues'];
const VIS_SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6], VIS_FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];   // F C G D A E B and B E A D G C F as letters
const VIS_SHARP_STEPS = [38, 35, 39, 36, 33, 37, 34], VIS_FLAT_STEPS = [34, 37, 33, 36, 32, 35, 31];   // where each sign sits on the treble staff
function visKeySig(rootPc, type, flats) {
  const none = { kind: 'none', n: 0, alter: {}, marks: [] }, d = SCALE_DEFS[type];
  if (!d || VIS_NO_SIG.includes(type)) return none;
  const tonic = ((rootPc + d.rel) % 12 + 12) % 12;
  let kind = flats ? 'flat' : 'sharp', n = (kind === 'flat' ? VIS_FLAT_KEYS : VIS_SHARP_KEYS)[tonic];
  if (n == null) { kind = kind === 'flat' ? 'sharp' : 'flat'; n = (kind === 'flat' ? VIS_FLAT_KEYS : VIS_SHARP_KEYS)[tonic]; }
  if (!n) return none;
  const order = kind === 'flat' ? VIS_FLAT_ORDER : VIS_SHARP_ORDER, steps = kind === 'flat' ? VIS_FLAT_STEPS : VIS_SHARP_STEPS, alter = {};
  for (let i = 0; i < n; i++) alter[order[i]] = kind === 'flat' ? -1 : 1;
  return { kind, n, alter, marks: steps.slice(0, n).map(step => ({ step })) };
}

// Ledger-line steps a note needs (even steps beyond the staff).
function visLedgers(step) {
  const out = [];
  for (let e = VIS_BOTTOM - 2; e >= step; e -= 2) out.push(e);
  for (let e = VIS_TOP + 2; e <= step; e += 2) out.push(e);
  return out;
}

// Slur groups of a timeline: [{ from, to }] for every run of two or more notes under one bow (the notes that follow a slurStart until the next one or the turn).
function visSlurs(tl) {
  const out = []; let from = 0;
  for (let i = 1; i <= tl.length; i++) {
    if (i === tl.length || tl[i].slurStart || tl[i].direction !== tl[i - 1].direction) { if (i - 1 > from) out.push({ from, to: i - 1 }); from = i; }
  }
  return out;
}

// Lays the timeline out in rows (systems) on a treble staff.
// opts: { perRow, beatsPerBar, octaveShift (written an octave higher: 1 for guitar), sig (visKeySig), left, spacing }
// Returns rows [{ from, to, shift, label, bars:[x], notes:[{ i, step, x, acc, ledgers, d }] }]. A row that goes too high or too low is drawn an octave (or two) away and labelled 8va / 15ma / 8vb.
function visLayout(tl, opts) {
  const per = Math.max(4, opts.perRow | 0), bpb = Math.max(1, opts.beatsPerBar | 0 || 4), sp = opts.spacing || 28, left = opts.left || 50, sh0 = opts.octaveShift || 0, sig = opts.sig || { alter: {} };
  const rows = []; let shown = {};
  for (let from = 0; from < tl.length; from += per) {
    const to = Math.min(tl.length, from + per), parsed = [];
    for (let i = from; i < to; i++) { const p = visParseNote(tl[i].noteName); parsed.push(p ? { ...p, step: p.step + 7 * sh0 } : null); }
    const steps = parsed.filter(Boolean).map(p => p.step), hi = Math.max(...steps), lo = Math.min(...steps);
    let sh = 0; while (hi - 7 * sh > VIS_HI && sh < 3) sh++; if (sh === 0) while (lo - 7 * sh < VIS_LO && sh > -2) sh--;
    const row = { from, to: to - 1, shift: sh, label: { 1: '8va', 2: '15ma', 3: '22ma', '-1': '8vb', '-2': '15mb' }[sh] || '', bars: [], notes: [] };
    for (let i = from; i < to; i++) {
      const p = parsed[i - from], x = left + (i - from + 0.5) * sp;
      if (i > 0 && i % bpb === 0) { shown = {}; if (i > from) row.bars.push(x - sp / 2); }
      if (!p) continue;
      const cur = shown[p.step] != null ? shown[p.step] : (sig.alter[p.letter] || 0);
      let acc = ''; if (p.alter !== cur) { acc = p.alter > 0 ? '#' : p.alter < 0 ? 'b' : 'n'; shown[p.step] = p.alter; }
      const step = p.step - 7 * sh;
      row.notes.push({ i, step, x, acc, ledgers: visLedgers(step), d: tl[i].direction });
    }
    rows.push(row);
  }
  return rows;
}
// Highest and lowest step drawn in a row, with the staff included: how tall the row has to be.
const visRowExtent = row => ({ hi: Math.max(VIS_TOP, ...row.notes.map(n => n.step)), lo: Math.min(VIS_BOTTOM, ...row.notes.map(n => n.step)) });

// ---- the neck and the keyboard
// How far along a string a finger or fret sits, 0 at the nut and 1 at `total` semitones above it: places get closer together up the neck.
const visFretX = (n, total) => (1 - Math.pow(2, -n / 12)) / (1 - Math.pow(2, -total / 12));
// Where a note is played, from fingerHint() and the MIDI note: { row (0 = the highest string, drawn at the top), offset (semitones above the open string), finger ('0'-'4' or '' for frets), open } or null.
function visPlace(hint, strings, midi) {
  if (!hint || hint.string == null || !strings || !strings.length) return null;
  const si = strings.length - hint.string; if (si < 0 || si >= strings.length) return null;
  const fretted = typeof hint.fret === 'number', offset = fretted ? hint.fret : Math.max(0, midi - strings[si]);
  const digit = /^\d/.test(String(hint.finger || '')) ? String(hint.finger)[0] : '';
  return { row: hint.string - 1, offset, finger: fretted ? (offset === 0 ? '0' : '') : hint.finger === 'open' ? '0' : digit, open: offset === 0 || hint.finger === 'open' };
}
// A keyboard window lo..hi (MIDI): the white keys in order and the black keys over them. Units: one white key is 1 wide.
const VIS_BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0], VIS_WHITE_IX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const visIsBlack = m => !!VIS_BLACK[((m % 12) + 12) % 12];
const visWhiteIx = m => Math.floor(m / 12) * 7 + VIS_WHITE_IX[((m % 12) + 12) % 12];
function visKeys(lo, hi) {
  while (visIsBlack(lo)) lo--; while (visIsBlack(hi)) hi++;
  const x0 = visWhiteIx(lo), keys = [];
  for (let m = lo; m <= hi; m++) keys.push(visIsBlack(m) ? { midi: m, black: true, x: visWhiteIx(m) - x0 + 1 - 0.3, w: 0.6 } : { midi: m, black: false, x: visWhiteIx(m) - x0, w: 1 });
  return { lo, hi, units: visWhiteIx(hi) - x0 + 1, keys };
}
