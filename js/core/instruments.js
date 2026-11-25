// Instrument rules for scale practice, as data. Adding an instrument or an exam preset is a new entry here, no code.
// Pure logic: no DOM, so it also runs in Node (tests load this same file).
//
// range      playable sounding range [low, high] in MIDI (violin G3-G7: three octaves from F#4 reach F#7)
// startLow   the lowest comfortable first note: a scale starts on the lowest note at or above it with the chosen root
//            (violin 55 = G3, so G..B start in octave 3 and C..F# in octave 4)
// bowing     true for bowed strings: Separate / Slur 2 / 4 / 8
// positions  which position set the instrument offers: 'violin' (1st to 5th) or 'fretted' (Open/1st, Mid neck, Auto), null for none
// wobble     pitch wobble (std-dev in cents) that earns zero steadiness credit; bowed strings forgive vibrato
// smooth     median window (frames) used to smooth the live meter and a held note: wide for vibrato, narrow for frets
// holdFrames frames of steady in-tune sound that Wait-for-note mode needs before it moves on
// fingering  how a hint is derived: 'bowed' (string + finger) or 'fretted' (string + fret) or null

const BOWINGS = { separate: ['Separate', 1], slur2: ['Slur 2', 2], slur4: ['Slur 4', 4], slur8: ['Slur 8', 8] };
// Violin positions. f1 = semitones from the open string to the first finger in that position (the first finger sits on the
// 2nd, 3rd, 4th ... degree of the major ladder above the open string: G string 1st position A, 2nd B, 3rd C, 4th D, 5th E).
// low = the lowest note of the position on the G string (first finger, low placement), the lowest comfortable scale start.
const VIOLIN_POSITIONS = { 1: ['1st position', { f1: 2, low: 55 }], 2: ['2nd position', { f1: 4, low: 58 }], 3: ['3rd position', { f1: 5, low: 59 }],
  4: ['4th position', { f1: 7, low: 61 }], 5: ['5th position', { f1: 9, low: 63 }] };
// Fretted positions change where the scale starts and which string/fret the hint names.
const POSITIONS = { open: ['Open / 1st', { fretMax: 4 }], mid: ['Mid neck', { fretMin: 5, fretMax: 9 }], auto: ['Auto', {}] };
const POSITION_SETS = { violin: { table: VIOLIN_POSITIONS, def: '1' }, fretted: { table: POSITIONS, def: 'open' } };

// The instruments the app offers (Scale drills lists these four; Piano uses the chromatic rule). Other entries are kept so old saved scores still read.
const PRACTICE_INSTRUMENTS = [['violin', 'Violin'], ['guitar', 'Guitar'], ['chromatic', 'Piano'], ['ukulele', 'Ukulele']];
const INSTRUMENT_RULES = {
  chromatic: { label: 'Piano', range: [21, 108], startLow: 60, bowing: false, positions: null, wobble: 25, smooth: 5, holdFrames: 10, fingering: null },
  violin:    { label: 'Violin', range: [55, 103], startLow: 55, bowing: true, positions: 'violin', wobble: 40, smooth: 7, holdFrames: 12, fingering: 'bowed' },
  viola:     { label: 'Viola', range: [48, 96], startLow: 48, bowing: true, positions: null, wobble: 40, smooth: 7, holdFrames: 12, fingering: 'bowed' },
  cello:     { label: 'Cello', range: [36, 88], startLow: 36, bowing: true, positions: null, wobble: 40, smooth: 7, holdFrames: 12, fingering: null },
  mandolin:  { label: 'Mandolin', range: [55, 100], startLow: 55, bowing: false, positions: 'fretted', wobble: 25, smooth: 5, holdFrames: 10, fingering: 'fretted', maxFret: 17 },
  guitar:    { label: 'Guitar', range: [40, 88], startLow: 40, bowing: false, positions: 'fretted', wobble: 20, smooth: 3, holdFrames: 10, fingering: 'fretted', maxFret: 22,
               positionLow: { open: 40, mid: 45, auto: 40 } },
  bass:      { label: 'Bass', range: [28, 67], startLow: 28, bowing: false, positions: 'fretted', wobble: 20, smooth: 3, holdFrames: 10, fingering: 'fretted', maxFret: 20 },
  ukulele:   { label: 'Ukulele', range: [60, 84], startLow: 60, bowing: false, positions: 'fretted', wobble: 20, smooth: 3, holdFrames: 10, fingering: 'fretted', maxFret: 15,
               positionLow: { open: 60, mid: 65, auto: 60 } },
  ukuleleLow:{ label: 'Ukulele (low G)', range: [55, 84], startLow: 55, bowing: false, positions: 'fretted', wobble: 20, smooth: 3, holdFrames: 10, fingering: 'fretted', maxFret: 15,
               positionLow: { open: 55, mid: 65, auto: 55 } },
  ukuleleBar:{ label: 'Ukulele (baritone)', range: [50, 79], startLow: 50, bowing: false, positions: 'fretted', wobble: 20, smooth: 3, holdFrames: 10, fingering: 'fretted', maxFret: 15,
               positionLow: { open: 50, mid: 60, auto: 50 } },
};
const MAX_SPAN = 3;

// The rule for any tuner preset key (guitarDropD, bass5 ...). Unknown keys fall back to chromatic.
function ruleKey(preset) {
  if (INSTRUMENT_RULES[preset]) return preset;
  if (/^guitar/.test(preset)) return 'guitar';
  if (/^bass/.test(preset)) return 'bass';
  if (/^ukulele/.test(preset)) return 'ukulele';
  return 'chromatic';
}
const ruleFor = preset => INSTRUMENT_RULES[ruleKey(preset)];
// The instrument the Scale screen offers for any tuner preset (a guitar tuning is the Guitar, a bass is the chromatic keyboard ...).
function practiceInstrument(preset) {
  const k = ruleKey(preset);
  return k === 'violin' || k === 'guitar' || k === 'ukulele' ? k : /^ukulele/.test(k) ? 'ukulele' : 'chromatic';
}

// The instrument-specific controls: { bowing: {name, def, options}|null, position: {name, def, options}|null }, options as [{value,label}].
function controls(preset) {
  const r = ruleFor(preset), set = r.positions && POSITION_SETS[r.positions];
  return {
    bowing: r.bowing ? { name: 'Bowing', def: 'separate', options: Object.keys(BOWINGS).map(k => ({ value: k, label: BOWINGS[k][0] })) } : null,
    position: set ? { name: 'Position', def: set.def, options: Object.keys(set.table).map(k => ({ value: k, label: set.table[k][0] })) } : null,
  };
}
const slurSize = (preset, bowing) => (ruleFor(preset).bowing && BOWINGS[bowing]) ? BOWINGS[bowing][1] : 1;

// Lowest MIDI note >= low whose pitch class is pc.
const lowestAtOrAbove = (pc, low) => low + (((pc - low) % 12) + 12) % 12;

// Where does the scale start, and does the span fit? Never throws: it clamps and says so.
// position: the key of the instrument's position set (violin '1'..'5', guitar 'open'/'mid'/'auto'); omitted = the default.
// Returns { start, span, requestedSpan, top, clamped, fits, warnings[] }.
function planScale(preset, rootPc, span, position) {
  const r = ruleFor(preset), [lo, hi] = r.range, want = Math.max(1, Math.min(MAX_SPAN, Math.round(span) || 1));
  const set = r.positions && POSITION_SETS[r.positions], pdef = set && set.table[position];
  const startLow = pdef && pdef[1].low != null ? pdef[1].low : r.positionLow && r.positionLow[position] != null ? r.positionLow[position] : r.startLow;
  const bound = set ? Math.max(lo, startLow) : lo;      // a chosen position keeps the scale at or above its own lowest note
  const warnings = [];
  let start = lowestAtOrAbove(rootPc, startLow), s = want;
  // 1. a lower start (still inside the range and the position) is better than a shorter scale
  while (start + 12 * s > hi && start - 12 >= bound) start -= 12;
  // 2. otherwise use as many octaves as fit
  while (s > 1 && start + 12 * s > hi) s--;
  const fits = start + 12 * s <= hi && start >= lo;
  const name = r.label;
  if (s < want) warnings.push(`${want} octaves do not fit the ${name} from this root (range ends at ${hi}); playing ${s}.`);
  if (!fits) warnings.push(`This scale goes above the ${name} range even at one octave.`);
  if (start < startLow && start >= lo) warnings.push('Started one octave lower than usual so that more octaves fit.');
  return { start, span: s, requestedSpan: want, top: start + 12 * s, clamped: s < want, fits, warnings };
}

// ----- fingering hints (data-driven; open strings come from the tuning) -----
// Finger by distance from the first finger's note: low and high placements are the two common ones.
const FINGER_BY_DELTA = { '-1': '1 low', 0: '1', 1: '2 low', 2: '2', 3: '3', 4: '3 high', 5: '4', 6: '4 high' };
const PC_LETTER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// strings: open-string MIDI notes (for violin lowest to highest). position: see planScale. Returns { text, string, ... } or null.
function fingerHint(preset, midi, strings, position) {
  const r = ruleFor(preset);
  if (!r.fingering || !strings || !strings.length) return null;
  if (r.fingering === 'bowed') {
    const p = (VIOLIN_POSITIONS[position] || VIOLIN_POSITIONS[1])[1], pn = VIOLIN_POSITIONS[position] ? +position : 1;
    // the highest string that can reach the note with the hand where this position puts it (open string only in 1st position)
    for (let si = strings.length - 1; si >= 0; si--) {
      const off = midi - strings[si], n = strings.length - si, sName = PC_LETTER[strings[si] % 12];
      if (off === 0 && pn === 1) return { text: `open ${sName} string`, string: n, finger: 'open', position: 1 };
      const f = FINGER_BY_DELTA[off - p.f1];
      if (off > 0 && f) return { text: `${sName} string · finger ${f}` + (pn > 1 ? ` (${pn}${['', '', 'nd', 'rd', 'th', 'th'][pn]} pos)` : ''), string: n, finger: f, position: pn };
    }
    // out of reach in this position: say which string and roughly which position the note lives in
    let si = -1; strings.forEach((m, i) => { if (m <= midi) si = i; });
    if (si < 0) return null;
    const off = midi - strings[si], n = strings.length - si, sName = PC_LETTER[strings[si] % 12];
    if (off === 0) return { text: `open ${sName} string`, string: n, finger: 'open', position: pn };
    const need = 1 + Math.ceil(Math.max(0, off - 7) / 2);   // each position moves the hand about a tone
    return { text: off <= 7 ? `${sName} string · shift to 1st position` : `${sName} string · shift up (~${need + 1}th position)`, string: n, finger: '', position: need };
  }
  // fretted: string index 0 is the lowest string; string numbers count from the highest (1)
  const pos = POSITIONS[position] || POSITIONS.auto, win = pos[1], cand = [];
  strings.forEach((m, i) => { const fret = midi - m; if (fret >= 0 && fret <= r.maxFret) cand.push({ i, fret }); });
  if (!cand.length) return null;
  const inWin = cand.filter(c => c.fret >= (win.fretMin || 0) && c.fret <= (win.fretMax == null ? 99 : win.fretMax));
  const pool = inWin.length ? inWin : cand;
  const mid = win.fretMin != null ? (win.fretMin + win.fretMax) / 2 : null;
  pool.sort((a, b) => mid != null ? Math.abs(a.fret - mid) - Math.abs(b.fret - mid) || a.fret - b.fret : a.fret - b.fret || b.i - a.i);
  const best = pool[0], str = strings.length - best.i;
  return { text: best.fret === 0 ? `open string ${str}` : `string ${str} · fret ${best.fret}`, string: str, fret: best.fret };
}
