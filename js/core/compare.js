// Compares two note lists (a reference, for example a MIDI file made by another tool, and what the app found).
// Pure logic: no DOM. Notes are { midi, start (seconds), dur (milliseconds) }.
// The reference is only "another opinion", not the truth: a high score means the two agree.

// Greedy one-to-one matching: same pitch and onset within `onsetTol` seconds. Closest onsets are paired first.
// Returns { pairs: [[refIdx, gotIdx]], refLeft: [idx], gotLeft: [idx] }.
function matchNotes(ref, got, onsetTol = 0.07, shift = 0) {
  const cand = [], byMidi = new Map();
  got.forEach((g, j) => { const k = Math.round(g.midi); if (!byMidi.has(k)) byMidi.set(k, []); byMidi.get(k).push(j); });
  ref.forEach((r, i) => { for (const j of byMidi.get(Math.round(r.midi)) || []) { const e = Math.abs(got[j].start + shift - r.start); if (e <= onsetTol) cand.push([e, i, j]); } });
  cand.sort((a, b) => a[0] - b[0]);
  const ru = new Set(), gu = new Set(), pairs = [];
  for (const [, i, j] of cand) if (!ru.has(i) && !gu.has(j)) { ru.add(i); gu.add(j); pairs.push([i, j]); }
  return { pairs, refLeft: ref.map((_, i) => i).filter(i => !ru.has(i)), gotLeft: got.map((_, j) => j).filter(j => !gu.has(j)) };
}

const medianOf = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

// Time-weighted agreement: how much of the reference's sounding time the other list also has at the same pitch (frame-style F1).
function overlapScore(ref, got, shift = 0) {
  const by = new Map(), add = (L, k, off) => L.forEach(n => { const m = Math.round(n.midi); if (!by.has(m)) by.set(m, { r: [], g: [] }); by.get(m)[k].push([n.start + off, n.start + off + n.dur / 1000]); });
  add(ref, 'r', 0); add(got, 'g', shift);
  let rt = 0, gt = 0, tp = 0;
  const merge = L => { L.sort((a, b) => a[0] - b[0]); const o = []; for (const x of L) { const l = o[o.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else o.push([x[0], x[1]]); } return o; };
  for (const { r, g } of by.values()) {
    const R = merge(r), G = merge(g); R.forEach(x => rt += x[1] - x[0]); G.forEach(x => gt += x[1] - x[0]);
    let a = 0, b = 0; while (a < R.length && b < G.length) { tp += Math.max(0, Math.min(R[a][1], G[b][1]) - Math.max(R[a][0], G[b][0])); R[a][1] < G[b][1] ? a++ : b++; }
  }
  const p = gt ? tp / gt : 0, r = rt ? tp / rt : 0;
  return { p, r, f1: p + r ? 2 * p * r / (p + r) : 0 };
}

// o: { onsetTol (s, default 0.07), shift (seconds added to the app's times), autoShift (search -0.2..0.2 s for the best constant offset) }
// Result: precision / recall / f1 on notes, timing error, duration ratio, why notes were missed or extra, and the lists to draw.
function compareNotes(ref, got, o = {}) {
  const tol = o.onsetTol == null ? 0.07 : o.onsetTol; let shift = o.shift || 0;
  const score = s => { const m = matchNotes(ref, got, tol, s), tp = m.pairs.length, p = got.length ? tp / got.length : 0, r = ref.length ? tp / ref.length : 0; const err = tp ? m.pairs.reduce((a, [i, j]) => a + Math.abs(got[j].start + s - ref[i].start), 0) / tp : 1e9; return { m, err, f1: p + r ? 2 * p * r / (p + r) : 0 }; };
  let best = score(shift);
  if (o.autoShift && ref.length && got.length) for (let s = -0.2; s <= 0.2001; s += 0.01) { const c = score(s); if (c.f1 > best.f1 + 1e-9 || (Math.abs(c.f1 - best.f1) <= 1e-9 && c.err < best.err - 1e-9)) { best = c; shift = Math.round(s * 100) / 100; } }
  const { pairs, refLeft, gotLeft } = best.m, tp = pairs.length, P = got.length ? tp / got.length : 0, R = ref.length ? tp / ref.length : 0;
  const onsetErr = pairs.map(([i, j]) => (got[j].start + shift - ref[i].start) * 1000), durRatio = pairs.filter(([i]) => ref[i].dur > 0).map(([i, j]) => got[j].dur / ref[i].dur);
  // Why was a reference note missed? Another note near the same time with a different pitch tells us the kind of mistake.
  const why = { octave: 0, semitone: 0, otherPitch: 0, none: 0 }, missed = [], extra = [];
  for (const i of refLeft) {
    const r = ref[i], c = gotLeft.map(j => got[j]).filter(g => Math.abs(g.start + shift - r.start) <= tol * 2); let kind = 'none';
    if (c.length) { const dm = c.map(g => Math.round(g.midi) - Math.round(r.midi)); kind = dm.some(d => d && d % 12 === 0) ? 'octave' : dm.some(d => Math.abs(d) === 1) ? 'semitone' : 'otherPitch'; }
    why[kind]++; missed.push({ i, kind });
  }
  for (const j of gotLeft) extra.push({ j });
  const ov = overlapScore(ref, got, shift);
  return { nRef: ref.length, nGot: got.length, tp, fp: gotLeft.length, fn: refLeft.length, precision: P, recall: R, f1: P + R ? 2 * P * R / (P + R) : 0,
    onsetMedianMs: medianOf(onsetErr), onsetAbsMedianMs: medianOf(onsetErr.map(Math.abs)), durRatioMedian: medianOf(durRatio), overlapF1: ov.f1, shift, why, pairs, missed, extra };
}

// Notes that at least `minVotes` of the lists agree on (same pitch, onset within onsetTol). Lists are given in priority order; the first list's version of a note is kept.
function consensusNotes(lists, minVotes = 2, onsetTol = 0.07) {
  const out = [];
  lists.forEach((L, li) => L.forEach(n => {
    if (out.some(o => Math.round(o.midi) === Math.round(n.midi) && Math.abs(o.start - n.start) <= onsetTol)) return;
    let votes = 1;
    lists.forEach((M, mi) => { if (mi !== li && M.some(x => Math.round(x.midi) === Math.round(n.midi) && Math.abs(x.start - n.start) <= onsetTol)) votes++; });
    if (votes >= minVotes) out.push({ ...n, votes });
  }));
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi);
}
