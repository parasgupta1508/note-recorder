// Turns a stream of pitch readings into notes (Segmenter), vibrato detection, and the practice attempt detector.
// Pure logic: no DOM, so it also runs in Node (tests load these same files).

// Vibrato: a steady 3.5 to 9 Hz wobble of the pitch (at least about 12 cents wide). pts = [[ms, cents], ...]. Returns { rate (Hz), width (cents peak to peak) } or null.
function vibratoOf(pts) {
  if (!pts || pts.length < 8) return null;
  const t = pts.map(q => q[0]), c = pts.map(q => q[1]), dur = t[t.length - 1] - t[0]; if (dur < 250) return null;
  const d = c.map((v, i) => { let sum = 0, k = 0; for (let j = 0; j < c.length; j++) if (Math.abs(t[j] - t[i]) <= 140) { sum += c[j]; k++; } return v - sum / k; });   // remove the slow drift
  let sgn = 0; const cross = [];
  for (let i = 0; i < d.length; i++) { if (Math.abs(d[i]) < 2) continue; const sg = d[i] > 0 ? 1 : -1; if (sgn && sg !== sgn) cross.push(t[i]); sgn = sg; }
  if (cross.length < 3) return null;
  const half = []; for (let i = 1; i < cross.length; i++) half.push(cross[i] - cross[i - 1]);
  const mean = half.reduce((a, b) => a + b, 0) / half.length, sd = Math.sqrt(half.reduce((a, b) => a + (b - mean) * (b - mean), 0) / half.length);
  const rate = 500 / mean, width = 2.83 * Math.sqrt(d.reduce((a, b) => a + b * b, 0) / d.length);
  return rate >= 3.5 && rate <= 9 && width >= 12 && sd / mean < 0.45 ? { rate: +rate.toFixed(1), width: Math.round(width) } : null;
}

class Segmenter {
  constructor(onNote) { this.onNote = onNote; this.cur = null; this.cand = null; this.miss = 0; this.minDur = 60; this.a4 = 440; this.confirm = 4; this.maxMiss = 5; this.gap = 0; this.candGap = 0; this.rearticulate = true; this.hist = []; }
  reset() { this.hist = []; this.cur = null; this.cand = null; this.miss = 0; this.candGap = 0; }
  // t = seconds, f = Hz (or null when nothing reliable was heard), lv = signal level (RMS) for the volume lane
  frame(t, f, lv = 0) {
    const MISS = this.maxMiss;
    if (f) {
      this.candGap = 0;
      this.hist.push([t, f]); if (this.hist.length > 60) this.hist.shift();
      const m = freqToNote(f, this.a4).midi, c = this.cur;
      // Stay on the current note while the pitch is within 65¢ of where the note has actually been sounding (its running median,
      // not the first frame): no flicker at semitone borders, vibrato is fine, and a note played 45¢ sharp stays one note.
      if (c && (m === c.midi || Math.abs(centsBetween(f, this.refHz(c))) < 65)) {
        // Re-articulation (détaché / martelé / spiccato / staccato): the same pitch is played again after a dip in volume
        // or a brief silence. Close the old note and begin a new one, so repeated notes are not merged into one long note.
        if (this.rearticulate && this.rearm(c, t, lv)) { this.end(); this.cur = { midi: m, start: t, last: t, f: [f], t: [t], l: [lv], pk: lv, dip: lv, dipT: t, up: 0, re: true }; this.miss = 0; this.cand = null; return; }
        c.f.push(f); c.t.push(t); c.l.push(lv); c.last = t; c.ref = median(c.f.slice(-12)); this.miss = 0; this.cand = null; return;
      }
      if (this.cand && Math.abs(centsBetween(f, noteToFreq(this.cand.midi, this.a4))) < 65) { const k = this.cand; k.f.push(f); k.t.push(t); k.l.push(lv); k.last = t; }
      else this.cand = { midi: m, start: t, last: t, f: [f], t: [t], l: [lv] };
      // A jump of exactly an octave / twelfth is the classic wrong-harmonic mistake, so ask for more proof.
      const prevM = c ? c.midi : (this.lastEnd && t - this.lastEnd.t < 0.3 ? this.lastEnd.midi : null);   // also right after a note ended: room tails and attack noise give the same wrong-harmonic frames
      const jump = prevM != null ? Math.abs(this.cand.midi - prevM) : 0;
      // The same pitch coming straight back after a note ended is usually the old note's tail around a new pluck or bow attack
      // (the attack noise breaks the pitch for a few frames, then the old pitch "returns"): ask for twice the proof.
      const echo = !c && this.lastEnd && t - this.lastEnd.t < 0.15 && Math.abs(centsBetween(f, this.lastEnd.hz)) < 65;
      const need = this.confirm + (jump === 12 || jump === 19 || jump === 24 ? 4 : 0) + (echo ? this.confirm : 0);
      if (c) this.miss++;
      if (this.cand.f.length >= need) { if (c) this.end(); this.cur = this.cand; this.cand = null; this.miss = 0; }
      else if (c && this.miss >= MISS) this.end();   // lost the old note; the candidate keeps building
    } else {
      if (this.cand && this.candGap < this.gap) this.candGap++; else this.cand = null;   // fast mode forgives one unclear frame inside a building note
      if (this.cur && this.cur.pk != null && lv < this.cur.dip) { this.cur.dip = lv; this.cur.dipT = t; }   // the silence itself counts as the dip
      if (this.cur && ++this.miss >= MISS) this.end();
    }
  }
  // True when a new bow/tongue attack of the same pitch begins: the level fell to under ~60% of the note's recent
  // peak (or the sound broke off for a few frames) and has now climbed back clearly above that dip.
  rearm(c, t, lv) {
    if (c.pk == null) { c.pk = lv; c.dip = lv; c.dipT = t; c.up = 0; }
    const age = t - c.start, brokeOff = this.miss >= 1;      // frames with no clear pitch just before this one = a gap
    if (lv > c.pk) c.pk = lv; else c.pk = c.pk * 0.985 + lv * 0.015;   // peak decays slowly so a long fade is not mistaken
    if (lv < c.dip || t - c.dipT > 0.25) { c.dip = lv; c.dipT = t; c.up = 0; }
    const dipped = c.dip < c.pk * 0.6 && t - c.start > 0.06;
    const rose = lv > Math.max(c.dip * 1.5, c.pk * 0.7);
    // A real attack climbs back from its dip in well under 0.1 s. A string "beating" (two vibration planes) or a room tail swells back over
    // 0.15 s or more, so a slow recovery is never a new note.
    const quick = t - c.dipT <= 0.1;
    if (age > 0.08 && quick && ((dipped && rose) || (brokeOff && c.dip < c.pk * 0.8 && lv > c.dip * 1.3))) {
      // A deep dip (under 30% of the peak) is a bow change or a new tongue / pluck: always a new note.
      if (c.dip < c.pk * 0.3) return true;
      // A moderate dip may just be vibrato (the volume wobbles with the pitch). Look at the last ~0.8 s of pitch:
      // if it is a steady wobble it is vibrato (one note); if there is not yet enough history to tell, wait.
      const h = this.hist, ref = noteToFreq(c.midi, this.a4), w = [];
      if (h.length < 12 || h[h.length - 1][0] - h[0][0] < 0.3) return false;
      for (const q of h) w.push([Math.round((q[0] - h[0][0]) * 1000), centsBetween(q[1], ref)]);
      return !vibratoOf(w);
    }
    return false;
  }
  end() {
    const c = this.cur; this.cur = null; this.miss = 0;
    if (!c) return;
    this.lastEnd = { t: c.last, hz: this.refHz(c), midi: this.summary(c).midi };
    const dur = (c.last - c.start) * 1000;
    if (dur < this.minDur) return;
    if (c.re && dur < 90) return;   // a "re-attack" that dies at once is the level jump of the NEXT note arriving before its pitch is clear
    const sm = this.summary(c), hz = sm.hz, ref = noteToFreq(sm.midi, this.a4);
    const step = Math.max(1, Math.ceil(c.f.length / 120)), pts = [];   // pitch contour: [ms from start, cents from the note centre]
    for (let i = 0; i < c.f.length; i += step) pts.push([Math.round((c.t[i] - c.start) * 1000), +centsBetween(c.f[i], ref).toFixed(1)]);
    const lvl = 20 * Math.log10(Math.max(1e-6, median(c.l)));
    this.onNote({ midi: sm.midi, note: midiName(sm.midi), hz, cents: sm.cents, start: c.start, dur, lvl: +lvl.toFixed(1), pts, vib: vibratoOf(pts) });
  }
  // Where the note really sat: the median of its frames (the first 15% are skipped once there are enough, because a scoop or the
  // attack of a pluck starts off-pitch). The name and the cents both come from this, so they always agree.
  summary(c) {
    const f = c.f.length >= 10 ? c.f.slice(Math.floor(c.f.length * 0.15)) : c.f, hz = median(f), n = freqToNote(hz, this.a4);
    return { hz, midi: n.midi, cents: n.cents };
  }
  refHz(c) { return c.ref || noteToFreq(c.midi, this.a4); }
}

class AttemptDetector {
  constructor(onAttempt) { this.onAttempt = onAttempt; this.cur = null; this.gap = 99; this.lastMidi = null; this.need = 6; this.rearmed = false; }
  // The sound level of the note being followed: its recent peak and its deepest dip since (kept on every frame, voiced or not, because a bow change is often a silent frame).
  levelTrack(c, t, lv) {
    if (c.pk == null) { c.pk = lv; c.dip = lv; c.dipT = t; }
    if (lv > c.pk) c.pk = lv; else c.pk = c.pk * 0.985 + lv * 0.015;   // the peak decays slowly so a long fade is not mistaken for a dip
    if (lv < c.dip || t - c.dipT > 0.25) { c.dip = lv; c.dipT = t; }
  }
  // A bow change or a fresh pluck on the SAME pitch: the level fell under 30% of the note's recent peak and climbed back within 0.1 s. Only asked when the next written note repeats
  // the pitch (a shallower dip may just be vibrato moving the loudness, so it is never taken as a new note here).
  levelDip(c, t, lv) { return t - c.t > 0.08 && t - c.dipT <= 0.1 && c.dip < c.pk * 0.3 && lv > Math.max(c.dip * 2, c.pk * 0.6); }
  // t: time of the frame, f: Hz or null, a4, lv: the frame's level (rms) or undefined, repeat: true when the next written note has the same pitch as the one just played.
  frame(t, f, a4, lv, repeat) {
    if (!f) { if (this.cur && lv != null) this.levelTrack(this.cur, t, lv); if (++this.gap >= 3) { this.cur = null; this.lastMidi = null; } return; }
    this.gap = 0;
    let n = freqToNote(f, a4);
    if (this.cur && n.midi !== this.cur.midi) {
      const c = centsBetween(f, noteToFreq(this.cur.midi, a4));
      if (Math.abs(c) < 65) n = { midi: this.cur.midi, cents: c };
    }
    if (lv != null && this.cur && this.cur.midi === n.midi) {
      this.levelTrack(this.cur, t, lv);
      if (repeat && this.cur.reg && this.levelDip(this.cur, t, lv)) { this.cur = null; this.lastMidi = null; this.rearmed = true; }   // the same pitch again: a new attempt
    }
    if (!this.cur || this.cur.midi !== n.midi) this.cur = { midi: n.midi, cents: [], hz: [], reg: false, t };
    this.cur.cents.push(n.cents); this.cur.hz.push(f);
    if (!this.cur.reg && this.cur.cents.length >= this.need) {
      this.cur.reg = true;
      if (n.midi === this.lastMidi) return;
      this.lastMidi = n.midi;
      this.onAttempt({ t: this.cur.t, midi: n.midi, cents: median(this.cur.cents.slice(2)), hz: median(this.cur.hz.slice(2)) });
    }
  }
}

