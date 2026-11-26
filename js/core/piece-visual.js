// Geometry for the Piece practice displays (the Staff, Tab, Fingerboard and Piano roll). Pure logic: no DOM, so Node tests load this same file.
// It reuses the Scale drills' geometry (visParseNote, visLedgers, visKeySig, visPlace, visKeys ... in visual.js) without changing it, and adds what a piece needs
// and a scale does not: notes that are not one per beat, and bar lines that come from the score.

// Time. A timeline note has `beat` (quarter notes from the first bar line of the range). "Position" counts notes: 3.5 is half way from the 4th note to the 5th.
// The Tab and the Piano roll scroll by beat, the staff cursor moves by position, and these three functions turn one into the other.
const pwBeatAt = (tl, i) => tl[i].beat != null ? tl[i].beat : i;
// beat -> position. Before the start (the count-in) the position is the beat itself; a rest before the first note holds the position at 0.
function pwPosOf(tl, b) {
  const n = tl.length; if (!n) return b;
  if (b < 0) return b; if (b <= pwBeatAt(tl, 0)) return 0;
  if (n === 1) return b - pwBeatAt(tl, 0);
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pwBeatAt(tl, m) <= b) lo = m; else hi = m; }
  const a = pwBeatAt(tl, lo), z = pwBeatAt(tl, hi);
  return b >= z ? hi + (b - z) : lo + (z > a ? (b - a) / (z - a) : 0);
}
// position -> beat (the inverse of pwPosOf)
function pwBeatOf(tl, f) {
  const n = tl.length; if (!n) return f;
  if (f <= 0) return f < 0 ? f : pwBeatAt(tl, 0);
  const i = Math.floor(f); if (i >= n - 1) return pwBeatAt(tl, n - 1) + (f - (n - 1));
  return pwBeatAt(tl, i) + (pwBeatAt(tl, i + 1) - pwBeatAt(tl, i)) * (f - i);
}

// The notes on one long row of a treble staff. opts: { sig (visKeySig), left, spacing, octaveShift (1 for guitar: written an octave above where it sounds) }
// Returns [{ notes: [{ i, step, x, acc, ledgers }], bars: [x] }]. An accidental is shown when a note differs from the key signature or from what the bar has already said.
function pwLayout(tl, opts) {
  const sp = opts.spacing || 54, left = opts.left || 50, sh0 = opts.octaveShift || 0, sig = opts.sig || { alter: {} };
  const row = { from: 0, to: tl.length - 1, shift: 0, label: '', bars: [], notes: [] }; let shown = {};
  for (let i = 0; i < tl.length; i++) {
    const p0 = visParseNote(tl[i].noteName), x = left + (i + 0.5) * sp;
    if (i > 0 && tl[i].bar !== tl[i - 1].bar) { shown = {}; row.bars.push(x - sp / 2); }
    if (!p0) continue;
    const p = { ...p0, step: p0.step + 7 * sh0 }, cur = shown[p.step] != null ? shown[p.step] : (sig.alter[p.letter] || 0);
    let acc = ''; if (p.alter !== cur) { acc = p.alter > 0 ? '#' : p.alter < 0 ? 'b' : 'n'; shown[p.step] = p.alter; }
    row.notes.push({ i, step: p.step, x, acc, ledgers: visLedgers(p.step) });
  }
  return [row];
}
