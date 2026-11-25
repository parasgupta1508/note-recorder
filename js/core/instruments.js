// Instrument rules for scale practice, as data. Adding an instrument or an exam preset is a new entry here, no code.
// Pure logic: no DOM, so it also runs in Node (tests load this same file).
//
// range      playable sounding range [low, high] in MIDI (violin G3-G7: three octaves from F#4 reach F#7)
// startLow   the lowest comfortable first note: a scale starts on the lowest note at or above it with the chosen root
//            (violin 55 = G3, so G..B start in octave 3 and C..F# in octave 4)
// tech       the instrument-specific control: bowing (bowed strings) or position (fretted strings), null for none
// wobble     pitch wobble (std-dev in cents) that earns zero steadiness credit; bowed strings forgive vibrato
// smooth     median window (frames) used to smooth the live meter and a held note: wide for vibrato, narrow for frets
// holdFrames frames of steady in-tune sound that Wait-for-note mode needs before it moves on
// fingering  how a hint is derived: 'bowed' (string + finger) or 'fretted' (string + fret) or null

const BOWINGS = { separate: ['Separate', 1], slur2: ['Slur 2', 2], slur4: ['Slur 4', 4], slur8: ['Slur 8', 8] };
// Fretted positions change where the scale starts and which string/fret the hint names.
const POSITIONS = { open: ['Open / 1st', { fretMax: 4 }], mid: ['Mid neck', { fretMin: 5, fretMax: 9 }], auto: ['Auto', {}] };

const INSTRUMENT_RULES = {
  chromatic: { label: 'Chromatic', range: [21, 108], startLow: 60, tech: null, wobble: 25, smooth: 5, holdFrames: 10, fingering: null },
  violin:    { label: 'Violin', range: [55, 103], startLow: 55, tech: 'bowing', wobble: 40, smooth: 7, holdFrames: 12, fingering: 'bowed', fingers: 4 },
  viola:     { label: 'Viola', range: [48, 96], startLow: 48, tech: 'bowing', wobble: 40, smooth: 7, holdFrames: 12, fingering: 'bowed', fingers: 4 },
  cello:     { label: 'Cello', range: [36, 88], startLow: 36, tech: 'bowing', wobble: 40, smooth: 7, holdFrames: 12, fingering: null },
  mandolin:  { label: 'Mandolin', range: [55, 100], startLow: 55, tech: 'position', wobble: 25, smooth: 5, holdFrames: 10, fingering: 'fretted', maxFret: 17 },
  guitar:    { label: 'Guitar', range: [40, 88], startLow: 40, tech: 'position', wobble: 20, smooth: 3, holdFrames: 10, fingering: 'fretted', maxFret: 22,
               positionLow: { open: 40, mid: 45, auto: 40 } },
  bass:      { label: 'Bass', range: [28, 67], startLow: 28, tech: 'position', wobble: 20, smooth: 3, holdFrames: 10, fingering: 'fretted', maxFret: 20 },
  ukulele:   { label: 'Ukulele', range: [60, 84], startLow: 60, tech: 'position', wobble: 20, smooth: 3, holdFrames: 10, fingering: 'fretted', maxFret: 15,
               positionLow: { open: 60, mid: 65, auto: 60 } },
  ukuleleLow:{ label: 'Ukulele (low G)', range: [55, 84], startLow: 55, tech: 'position', wobble: 20, smooth: 3, holdFrames: 10, fingering: 'fretted', maxFret: 15,
               positionLow: { open: 55, mid: 65, auto: 55 } },
  ukuleleBar:{ label: 'Ukulele (baritone)', range: [50, 79], startLow: 50, tech: 'position', wobble: 20, smooth: 3, holdFrames: 10, fingering: 'fretted', maxFret: 15,
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

// The options of the instrument-specific control: [{value,label}], and its default.
function techOptions(preset) {
  const r = ruleFor(preset);
  if (r.tech === 'bowing') return { name: 'Bowing', def: 'separate', options: Object.keys(BOWINGS).map(k => ({ value: k, label: BOWINGS[k][0] })) };
  if (r.tech === 'position') return { name: 'Position', def: 'open', options: Object.keys(POSITIONS).map(k => ({ value: k, label: POSITIONS[k][0] })) };
  return { name: 'Style', def: '', options: [] };
}
const slurSize = (preset, tech) => (ruleFor(preset).tech === 'bowing' && BOWINGS[tech]) ? BOWINGS[tech][1] : 1;

// Lowest MIDI note >= low whose pitch class is pc.
const lowestAtOrAbove = (pc, low) => low + (((pc - low) % 12) + 12) % 12;

// Where does the scale start, and does the span fit? Never throws: it clamps and says so.
// Returns { start, span, requestedSpan, top, clamped, fits, warnings[] }.
function planScale(preset, rootPc, span, tech) {
  const r = ruleFor(preset), [lo, hi] = r.range, want = Math.max(1, Math.min(MAX_SPAN, Math.round(span) || 1));
  const startLow = r.positionLow && r.positionLow[tech] != null ? r.positionLow[tech] : r.startLow;
  const warnings = [];
  let start = lowestAtOrAbove(rootPc, startLow), s = want;
  // 1. a lower start (still inside the range) is better than a shorter scale
  while (start + 12 * s > hi && start - 12 >= lo) start -= 12;
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
const FIRST_POS_FINGER = ['open', '1 low', '1', '2 low', '2', '3', '3 high', '4'];
// strings: open-string MIDI notes, lowest to highest (as in PRESETS). Returns { text, string, fret|finger } or null.
function fingerHint(preset, midi, strings, tech) {
  const r = ruleFor(preset);
  if (!r.fingering || !strings || !strings.length) return null;
  if (r.fingering === 'bowed') {
    let si = -1; strings.forEach((m, i) => { if (m <= midi) si = i; });
    if (si < 0) return null;
    const off = midi - strings[si], n = strings.length - si;
    const sName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][strings[si] % 12];
    if (off <= 7) return { text: off === 0 ? `open ${sName} string` : `${sName} string · finger ${FIRST_POS_FINGER[off]}`, string: n, finger: FIRST_POS_FINGER[off] };
    const pos = 1 + Math.ceil((off - 7) / 2);   // each position moves the hand a tone; roughly the position whose 4th finger reaches this note
    return { text: `${sName} string · high position (~${pos + 1}th)`, string: n, finger: '4', position: pos + 1 };
  }
  // fretted: string index 0 is the lowest string; string numbers count from the highest (1)
  const pos = POSITIONS[tech] || POSITIONS.auto, win = pos[1], cand = [];
  strings.forEach((m, i) => { const fret = midi - m; if (fret >= 0 && fret <= r.maxFret) cand.push({ i, fret }); });
  if (!cand.length) return null;
  const inWin = cand.filter(c => c.fret >= (win.fretMin || 0) && c.fret <= (win.fretMax == null ? 99 : win.fretMax));
  const pool = inWin.length ? inWin : cand;
  const mid = win.fretMin != null ? (win.fretMin + win.fretMax) / 2 : null;
  pool.sort((a, b) => mid != null ? Math.abs(a.fret - mid) - Math.abs(b.fret - mid) || a.fret - b.fret : a.fret - b.fret || b.i - a.i);
  const best = pool[0], str = strings.length - best.i;
  return { text: best.fret === 0 ? `open string ${str}` : `string ${str} · fret ${best.fret}`, string: str, fret: best.fret };
}
