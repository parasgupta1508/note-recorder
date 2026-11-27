// The Piece practice engine: Tempo-locked and Wait-for-note practice of a piece, scored by the same graders and the same Trinity-style evaluation as the Scale drills.
// It is a copy-and-adapt of the Scale drills' engine (js/app/practice-engine.js and practice.js), not a change to it: the Scale drills keep their own state (sc), their own elements
// (sc...) and their own history, and this screen keeps its own (PE, pz...), so the two can never disturb each other. What is shared is the pure code in js/core (the pitch
// attempt detector, the scoring maths, the grader engines, the evaluation, the coach, the history record) and the microphone loop, which hands each frame to pieceFrame().
// The piece itself (its notes as a timeline, the plan) comes from piece-practice.js: ppPlan().
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

const PE = { plan: null, tl: [], seq: [], pos: 0, grades: [], attempts: [], slots: [], slotAt: {}, running: false, wrong: 0, pass: 1, passes: [], mode: 'tempo', clock: null, bpm: 80,
  waitFrames: [], waitOk: 0, needGap: false, devHist: [], demo: -1, runPass: 0, lastRun: null, hold: null, liveC: [], silent: 99, calibAt: 0, runTimer: 0, click: false };
const peDet = new AttemptDetector(a => peOnAttempt(a));
const peMedian = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
function peMsg(text, cls = 'mut') { const m = $('pzMsg'); m.textContent = text; m.className = 'sc-msg ' + (cls === 'mut' ? 'mut' : cls + '-t'); }
const peCents = c => `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(0)}¢`;
const peCls = g => g === 'In tune' ? 'ok' : g === 'Close' ? 'warn' : 'bad';
const peEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ----- the grader: the same Practical / Strict engines the Scale drills use (one choice for both screens, Settings > Engines) -----
const peScorer = () => findEngine('scorer', typeof gradeMode === 'function' ? gradeMode() : 'practical');
function peCtx(midi) { const e = peScorer(), inst = PE.plan ? PE.plan.inst : $('pzInst').value; return { e, ctx: { midi, root: PE.plan ? PE.plan.tonic : 0, fretless: !!ruleFor(inst).bowing, inst, params: e.id === 'practical' && typeof gradeSettings === 'function' ? gradeSettings(inst) : {} } }; }
function peDev(cents, midi) { const { e, ctx } = peCtx(midi); return e.dev ? e.dev(cents, ctx) : cents; }
function peShift() { const { e, ctx } = peCtx(0); return e.shift ? e.shift(PE.devHist, ctx) : 0; }
function peTol() { const { e, ctx } = peCtx(0); return e.tol ? e.tol(tol(), ctx) : tol(); }
function peScoreRun(slots, opts) { const { e, ctx } = peCtx(0); return e.evaluate(slots, Object.assign({}, opts, { params: ctx.params })); }

// ----- starting over -----
function peReset() {
  peFinalize(); clearTimeout(PE.runTimer); PE.runPass = 0; PE.pass = 1; PE.passes = []; PE.lastRun = null; peRenderResult();
  const p = ppPlan(); PE.plan = p; PE.tl = p.tl; PE.seq = p.tl.map(n => n.midi); PE.bpm = p.bpm;
  PE.pos = 0; PE.grades = []; PE.attempts = []; PE.wrong = 0; PE.running = false; PE.slots = []; PE.slotAt = {}; PE.clock = null; PE.waitFrames = []; PE.waitOk = 0; PE.needGap = false; PE.devHist = []; PE.hold = null;
  PE.liveC = []; PE.silent = 99; peDet.cur = null; peDet.lastMidi = null; peClickStop(); if (typeof ppBackingStop === 'function') ppBackingStop();
  $('pzStart').textContent = 'Start practice'; peMsg('');
}
function peUi() {
  $('pzStop').disabled = !(PE.running || PE.demo >= 0);
  $('pzDemo').textContent = PE.demo >= 0 ? '■ Stop demo' : '▶ Hear piece';
  $('pzResBtn').disabled = !PE.lastRun; $('pzResult').hidden = !PE.lastRun || !PE.resOpen; $('pzResBtn').setAttribute('aria-expanded', String(!!PE.lastRun && !!PE.resOpen));
  pwRender();
}

// ----- the click: the count-in bar, and the whole piece when Click is on. Scheduled just ahead on the audio clock (clickAt is the shared click sound). -----
const PM = { timer: 0, q: [] };
function peClickPass(startAt, countIn, beats) {   // clicks at startAt, then every beat: countIn clicks (accented on the bar's first), then `beats` more
  const per = PE.plan ? PE.plan.sig : 4; PM.q.push({ t: startAt, i: 0, n: countIn + beats, per, spb: 60 / PE.bpm });
  if (!PM.timer) PM.timer = setInterval(peClickPump, 50); peClickPump();
}
function peClickPump() {
  const c = getCtx(), now = c.currentTime;
  for (const p of PM.q) while (p.i < p.n && p.t + p.i * p.spb < now + 0.3) { const at = p.t + p.i * p.spb; if (at >= now - 0.01) clickAt(at, p.i % p.per === 0); p.i++; }
  PM.q = PM.q.filter(p => p.i < p.n); if (!PM.q.length) { clearInterval(PM.timer); PM.timer = 0; }
}
function peClickStop() { clearInterval(PM.timer); PM.timer = 0; PM.q = []; }

// ----- Tempo-locked: one bar of clicks, then each note is due on its time. The clock is in the microphone loop's time (ctx.currentTime - t0). -----
function peCountIn() {
  const c = getCtx(), spb = 60 / PE.bpm, n = PE.plan.sig, base = c.currentTime + 0.08;
  PE.clock = base + n * spb - t0;
  peClickPass(base, n, PE.click ? PE.plan.beats : 0);
  if (typeof ppBackingBegin === 'function') ppBackingBegin(base + n * spb);   // the other parts start on the first beat
  peMsg('Count-in: start on the downbeat after the clicks');
}
// Before a run the app listens to the room for 1.5 s and sets the noise gate just above it (the Tuner's own quiet step), when the microphone has just been turned on or the last check is old.
function peQuietCalib(fresh) {
  const stale = performance.now() - (PE.calibAt || -1e9) > 600000;
  if ((!fresh && !stale) || calib || recording || !listening || typeof startAutoCalib !== 'function') return null;
  PE.calibAt = performance.now(); startAutoCalib(true); peMsg('Checking the room noise… stay quiet for a moment');
  return new Promise(res => {
    const t = performance.now(), iv = setInterval(() => {
      if (!PE.running || !calib || calib.phase !== 1 || performance.now() - t > 4000) { clearInterval(iv); if (calib && calib.phase === 2 && calib.auto) { calib = null; $('status').textContent = ''; } peMsg(''); res(); }
    }, 40);
  });
}
function peStart() {
  peStopDemo(); peReset(); PE.running = true;
  const begin = () => { if (!PE.running) return; if (PE.mode === 'tempo') peCountIn(); else peMsg('Play the first note and hold it in tune; the music waits for you'); };
  const fresh = !listening; peMsg(listening ? '' : 'Starting microphone…'); $('pzStart').textContent = 'Restart'; peUi();
  const go = w => w ? w.then(begin) : begin();
  if (listening) go(peQuietCalib(false));
  else startListening().then(() => go(peQuietCalib(fresh))).catch(e => { PE.running = false; $('pzStart').textContent = 'Start practice'; $('status').textContent = 'Mic error: ' + e.message; peMsg('Mic error: ' + e.message, 'bad'); peUi(); });
}
function peStop() {
  const was = PE.running || PE.demo >= 0;
  peStopDemo(); peClickStop(); peFinalize(); if (typeof ppBackingStop === 'function') ppBackingStop();
  PE.running = false; peDet.cur = null; peDet.lastMidi = null; PE.liveC = []; PE.clock = null;
  $('pzStart').textContent = 'Start practice'; peMsg(was ? 'Stopped — press Start practice to begin again' : ''); peUi();
}
function peLeave() { if (PE.running || PE.demo >= 0) peStop(); }   // called when another screen is opened

// ----- Hear piece: plays the same timeline the scoring uses, with the other parts if Accompaniment is on -----
function peStopDemo() {
  refStop(); peClickStop(); if (typeof ppBackingStop === 'function') ppBackingStop();
  const was = PE.demo >= 0; PE.demo = -1; PW.demoT0 = null; if (was) { peDet.cur = null; peDet.lastMidi = null; peUi(); }
}
function peDemo() {
  if (!ppActive()) return; peFinalize(); const p = ppPlan(); PE.plan = p; PE.tl = p.tl; PE.seq = p.tl.map(n => n.midi); PE.bpm = p.bpm;
  const at = getCtx().currentTime + 0.08;   // one time for the first note, the click and the cursor
  if (PE.click) peClickPass(at, 0, p.beats);
  if (typeof ppBackingBegin === 'function') ppBackingBegin(at, true);
  PE.demo = 0; PW.demoT0 = at;
  refPlay(p.tl, { at, onNote: i => { PE.demo = i; }, onEnd: peStopDemo });
  peUi();
}

// ----- the results of one play of the piece: one slot per note per pass -----
function peSlot(i, pass = PE.pass) {
  const key = pass + ':' + i; let s = PE.slotAt[key];
  if (!s) { const n = PE.tl[i]; s = PE.slotAt[key] = { pass, index: i, name: n.noteName, midi: n.midi, d: 'up', k: 's', c: null, m: null, a: 0, s: null, e: null, sp: null, cl: null, r: null, cov: null, wrong: 0, rt: 0 }; PE.slots.push(s); }
  return s;
}
const peNewHold = (a, T, ix, e) => ({ midi: a.midi, c0: a.cents, T, frames: [], cl: [], t0: a.t, last: a.t, gap: 0, inst: PE.plan.inst, ix, pass: PE.pass, e: e == null ? null : e });
// While a note is held, frames keep coming in (after the attack) so its accuracy and steadiness can be scored. An octave glitch frame counts as a gap.
function peCollect(f) {
  const h = PE.hold; if (!h) return;
  if (f) {
    const c = centsBetween(f, noteToFreq(h.midi, a4()));
    if (Math.abs(c) <= 65) { h.frames.push(peDev(c, h.midi)); h.cl.push(frameCl); h.last = frameT; h.gap = 0; } else if (isOctaveGlitch(c)) { if (++h.gap >= 4) peFinalize(); } else peFinalize();
  } else if (++h.gap >= 4) peFinalize();
}
function peFinalize() {
  const h = PE.hold; PE.hold = null; if (!h) return;
  let c = h.c0, a = Math.abs(h.c0) <= h.T ? 1 : 0, s = null, m = null, sp = null, cl = null;   // s stays null when the note was too short to measure wobble
  if (h.frames.length >= 4) {
    const sm = ruleFor(h.inst).smooth, st = holdStats(h.frames, h.T, sm); c = st.c; s = st.s; a = st.a;
    m = evalMedian(smoothCents(h.frames.slice(Math.min(3, h.frames.length >> 2)), sm)); sp = Math.abs(h.c0 - m);   // the evaluation judges the pitch after the attack
    cl = holdClarity(h.cl, Math.min(3, h.frames.length >> 2));
  }
  const bowed = !!ruleFor(h.inst).bowing && PE.mode === 'tempo' && PE.tl[h.ix], r = bowed ? heldRatio(h.t0, h.last, PE.tl[h.ix].durationMs) : null, cov = bowed ? heardShare(h.frames.length, PE.tl[h.ix].durationMs) : null;   // length is judged only where a note can be held (bowed), against the click
  Object.assign(peSlot(h.ix, h.pass), { k: 'h', c, a, s, e: h.e, m, sp, cl, r, cov });
  PE.devHist.push(m != null ? m : c);   // the grader's view of the player's overall offset
  if (PE.runPass && h.pass === PE.runPass) peFlushRun();   // the last note of a finished pass has just been scored
}
function peMarkSkip(i, t) {
  const n = PE.tl[i]; PE.grades[i] = 'Skipped';
  PE.attempts.push({ index: i + 1, expected: n.noteName, played: '–', grade: 'Skipped', hz: null, cents: null, time_s: t == null ? 0 : t, pass: PE.pass, direction: 'up', timing_ms: null }); peSlot(i);
}
// Tempo-locked: a note the clock has left behind (half a beat after its end) counts as skipped, so the target keeps pace with the click.
function peClockTick(t) {
  if (PE.mode !== 'tempo' || PE.clock == null || t == null) return;
  const el = (t - PE.clock) * 1000, beat = 60000 / PE.bpm; let moved = false;
  while (PE.pos < PE.seq.length) { const n = PE.tl[PE.pos]; if (el > n.startMs + n.durationMs + 0.5 * beat) { peMarkSkip(PE.pos, t); PE.pos++; moved = true; } else break; }
  if (!moved) return;
  PE.liveC = []; PE.silent = 99;
  if (PE.pos >= PE.seq.length) peEndPass('Skipped the rest'); else { peMsg(`Too late for ${PE.tl[PE.pos - 1].noteName} — keep with the click`, 'warn'); peUi(); }
}
// A pass is done: queue its evaluation, then loop (Loop on) or finish.
function peEndPass(note) {
  const tl = PE.tl, done = PE.attempts.filter(x => x.pass === PE.pass && x.played === x.expected), n = done.filter(x => x.grade === 'In tune').length;
  const wr = PE.attempts.filter(x => x.pass === PE.pass && /^Wrong/.test(x.grade)).length, pct = 100 * n / (tl.length + wr);   // wrong notes count against the pass
  PE.passes.push({ pct }); peQueueRun();
  if ($('pzRepeat').checked) {   // loop: the next pass starts one bar after the end of this piece
    const spb = 60 / PE.bpm, nxt = (PE.plan.beats + PE.plan.sig) * spb;
    if (PE.mode === 'tempo' && PE.clock != null) { PE.clock += nxt; peClickPass(PE.clock + t0 - PE.plan.sig * spb, PE.plan.sig, PE.click ? PE.plan.beats : 0); if (typeof ppBackingBegin === 'function') ppBackingBegin(PE.clock + t0); }
    peMsg(`Pass ${PE.pass} done — ${pct.toFixed(0)}% in tune. ${PE.mode === 'tempo' ? 'Next pass starts after one bar of clicks' : 'Play the first note to start pass ' + (PE.pass + 1)}`, 'ok');
    PE.pass++; PE.pos = 0; PE.grades = []; PE.waitFrames = []; PE.waitOk = 0; PE.needGap = false; peUi(); return;
  }
  PE.running = false; $('pzStart').textContent = 'Start practice';
  peMsg(note ? `${note} — ${pct.toFixed(0)}% in tune` : `Piece complete — ${pct.toFixed(0)}% in tune`, 'ok'); peUi();
}

// ----- a note was played (the attempt detector heard a new note start) -----
function peOnAttempt(a) {
  if (!PE.running || PE.demo >= 0 || PE.pos >= PE.seq.length) return;
  a = Object.assign({}, a, { cents: peDev(a.cents, a.midi) }); const sh = peShift();   // the grader's deviation; sh = the player's overall offset to forgive
  if (PE.mode === 'wait') return peWaitAttempt(a);
  const seq = PE.seq, tl = PE.tl, exp = seq[PE.pos], T = peTol();
  const terr = ix => PE.clock == null ? null : Math.round((a.t - PE.clock) * 1000 - tl[ix].startMs);
  const rec = { index: PE.pos + 1, expected: tl[PE.pos].noteName, played: midiName(a.midi), hz: a.hz, cents: a.cents, time_s: a.t, pass: PE.pass, direction: 'up', timing_ms: null };
  // Re-playing the note just played is a retry: scored as another play of that note, never a skip or a wrong note. If the clock had already skipped it, it is a late play that replaces the skip.
  // (In a piece the note after the next one can be the one just played, as in A B A: if the clock says the sound is nearer in time to that later note, it is that note, not a retry.)
  const kAhead = seq.indexOf(a.midi, PE.pos), laterNote = PE.clock != null && kAhead > PE.pos && kAhead <= PE.pos + 2 && PE.pos > 0 && Math.abs(terr(kAhead)) < Math.abs(terr(PE.pos - 1));
  if (PE.pos > 0 && a.midi === seq[PE.pos - 1] && a.midi !== exp && !laterNote) {
    const p = PE.pos - 1, g = gradeCents(a.cents - sh, T), late = PE.grades[p] === 'Skipped'; if (!late) peSlot(p).rt++;   // a retry is a restart: the evaluation counts it against continuity
    peFinalize(); PE.hold = peNewHold(a, T, p, late ? terr(p) : null); PE.grades[p] = g; PE.liveC = []; PE.silent = 99;
    peMsg(`${late ? 'Late: ' : 'Retry '}${midiName(a.midi)} ${peCents(a.cents - sh)} — ${g}`, peCls(g)); peUi(); return;
  }
  // Only look ahead (never backwards). With no clock you may start anywhere; after that at most 2 notes can be skipped at once.
  let k = seq.indexOf(a.midi, PE.pos);
  if (k > PE.pos + ((PE.pos === 0 && PE.clock == null) ? seq.length : 2)) k = -1;
  if (k >= 0) {
    const skipped = [];
    for (let i = PE.pos; i < k; i++) { peMarkSkip(i, a.t); skipped.push(tl[i].noteName); }
    const g = gradeCents(a.cents - sh, T), e = terr(k);
    PE.attempts.push({ ...rec, index: k + 1, expected: tl[k].noteName, grade: g, timing_ms: e }); PE.grades[k] = g;
    peFinalize(); PE.hold = peNewHold(a, T, k, e);   // scored when the note ends
    PE.pos = k + 1; PE.liveC = []; PE.silent = 99;
    const fb = `${tl[k].noteName} ${peCents(a.cents - sh)} — ${g}` + (e != null && Math.abs(e) > 120 ? ` · ${e > 0 ? 'late' : 'early'} ${Math.abs(e)} ms` : '') + (skipped.length ? ` · skipped ${skipped.join(', ')}` : '');
    if (PE.pos >= seq.length) { peEndPass(); peMsg(`${fb} · ${$('pzMsg').textContent}`, peCls(g)); return; }
    peMsg(fb, peCls(g)); peUi();
  } else {   // strict: a wrong note is flagged
    const g = (a.midi - exp) % 12 === 0 ? 'Wrong octave' : 'Wrong note';
    PE.wrong++; PE.attempts.push({ ...rec, grade: g }); peSlot(PE.pos).wrong++;
    peMsg(`Heard ${midiName(a.midi)} — expected ${tl[PE.pos].noteName} (${g.toLowerCase()})`, 'bad');
  }
}
// Wait for note: the music never moves on its own. It advances once the note has been held in tune for the instrument's hold time.
function peWaitAttempt(a) {
  const exp = PE.seq[PE.pos];
  if (a.midi === exp || (PE.pos > 0 && a.midi === PE.seq[PE.pos - 1])) return;   // the right note (peLive advances it) or the previous one still ringing
  const n = PE.tl[PE.pos], g = (a.midi - exp) % 12 === 0 ? 'Wrong octave' : 'Wrong note';
  PE.wrong++; PE.attempts.push({ index: PE.pos + 1, expected: n.noteName, played: midiName(a.midi), hz: a.hz, cents: a.cents, time_s: a.t, pass: PE.pass, direction: 'up', timing_ms: null, grade: g }); peSlot(PE.pos).wrong++;
  peMsg(`Heard ${midiName(a.midi)} — waiting for ${n.noteName} (${g.toLowerCase()})`, 'bad');
}
function peWaitFrame(raw, inTol, rule) {
  if (PE.needGap) return;   // the next note is the same pitch as the one just passed (pieces repeat notes): a pause, then a new note, is needed before it counts
  if (Math.abs(raw) <= 65) { PE.waitFrames.push(raw); if (PE.waitFrames.length > 600) PE.waitFrames.shift(); }
  PE.waitOk = inTol ? PE.waitOk + 1 : 0;
  if (PE.waitOk >= rule.holdFrames) peAdvanceWait(rule);
}
function peAdvanceWait(rule) {
  const T = peTol(), i = PE.pos, n = PE.tl[i], st = holdStats(PE.waitFrames, T, rule.smooth); if (!st) return;
  const g = gradeCents(st.c - peShift(), T), hz = noteToFreq(n.midi, a4()) * Math.pow(2, st.c / 1200);
  const med = evalMedian(smoothCents(PE.waitFrames.slice(Math.min(3, PE.waitFrames.length >> 2)), rule.smooth));   // the evaluation judges the pitch after the attack
  Object.assign(peSlot(i), { k: 'h', c: st.c, a: st.a, s: st.n >= 4 ? st.s : null, e: null, m: med, sp: Math.abs(PE.waitFrames[0] - med) }); PE.devHist.push(med);
  PE.attempts.push({ index: i + 1, expected: n.noteName, played: n.noteName, hz, cents: st.c, time_s: 0, pass: PE.pass, direction: 'up', timing_ms: null, grade: g });
  PE.grades[i] = g; PE.pos++; PE.waitFrames = []; PE.waitOk = 0; PE.liveC = []; PE.silent = 99;
  PE.needGap = PE.pos < PE.seq.length && PE.seq[PE.pos] === n.midi;
  peMsg(`${n.noteName} ${peCents(st.c - peShift())} — ${g}`, peCls(g));
  if (PE.pos >= PE.seq.length) peEndPass(); else peUi();
}
// One microphone frame (f: Hz, or 0 when nothing is heard). Called by the microphone loop (profiles.js) while this screen is open.
function pieceFrame(f, t) {
  peCollect(f);
  if (!PE.running || PE.demo >= 0) return;
  peDet.frame(t, f, a4(), frameRms, PE.pos > 0 && PE.seq[PE.pos] === PE.seq[PE.pos - 1]);   // a repeated note can start without a pause: a deep dip in level then counts as the new note
  if (peDet.rearmed) { peDet.rearmed = false; PE.needGap = false; }
  peClockTick(t);
  if (PE.pos >= PE.seq.length) return;
  if (!f) { if (++PE.silent > 8) { PE.liveC = []; PE.waitFrames = []; PE.waitOk = 0; PE.needGap = false; } return; }   // a bow change or a breath is a short gap, not an error
  const T = peTol(), target = PE.seq[PE.pos], rawET = centsOffset(f, target, a4());
  if (isOctaveGlitch(rawET)) return;   // a pitch-detector octave glitch: not a pitch the player made
  PE.silent = 0;
  const rule = ruleFor(PE.plan.inst), raw0 = peDev(rawET, target), raw = raw0 - peShift();   // raw0 is stored; raw is what is graded (overall offset forgiven)
  PE.liveC.push(raw); if (PE.liveC.length > 15) PE.liveC.shift();
  const c = peMedian(PE.liveC.slice(-rule.smooth));
  if (PE.mode === 'wait') peWaitFrame(raw0, Math.abs(c) <= T, rule);
}
// The pitch range the microphone loop searches while a run is on: around the piece (plus room for wrong notes).
function peFreqRange() { return PE.running && PE.seq.length ? [Math.max(25, noteToFreq(Math.min(...PE.seq) - 5, a4())), noteToFreq(Math.max(...PE.seq) + 5, a4())] : null; }

// ----- the result: a Trinity-style report for the run, kept per piece on this device (never the file itself) -----
const PE_RUNS_KEY = 'tuner-piece-runs-v1', PE_BAND = { Distinction: 'dist', Merit: 'merit', Pass: 'pass', 'Below Pass': 'below' };
const peRuns = () => { try { const a = JSON.parse(localStorage.getItem(PE_RUNS_KEY)); return Array.isArray(a) ? a : []; } catch { return []; } };
// A run keeps a compact per-note list (name, pitch, played, cents, bar) for the newest PE_KEEP_NOTES runs, so the coach can see which bars go wrong again and again; older runs keep only the summary.
const PE_KEEP_NOTES = 12;
function peSaveRun(rec) {
  const all = peRuns(); all.push(rec);
  all.slice(0, Math.max(0, all.length - PE_KEEP_NOTES)).forEach(r => { r.notes = []; });
  try { localStorage.setItem(PE_RUNS_KEY, JSON.stringify(all.slice(-120))); } catch { try { all.forEach(r => { r.notes = []; }); localStorage.setItem(PE_RUNS_KEY, JSON.stringify(all.slice(-120))); } catch {} }   // storage full: keep the summaries
}
function peQueueRun() { PE.runPass = PE.pass; clearTimeout(PE.runTimer); if (!PE.hold) peFlushRun(); else PE.runTimer = setTimeout(() => { peFinalize(); peFlushRun(); }, 1500); }   // the last note is still being held
function peFlushRun() {
  clearTimeout(PE.runTimer); const pass = PE.runPass; PE.runPass = 0; if (!pass || !PE.plan) return;
  const slots = PE.slots.filter(s => s.pass === pass); if (!slots.length) return;
  const p = PE.plan, ev = peScoreRun(slots, { beatMs: 60000 / PE.bpm, mode: PE.mode, wobbleCap: ruleFor(p.inst).wobble });
  const rec = histRecord(ev, { t: Date.now(), player: typeof profile !== 'undefined' ? profile : '', inst: p.inst, type: 'piece', root: p.pc, span: 1, pos: p.pos, bow: p.bow, bpm: PE.bpm, mode: PE.mode, label: p.label, pass }); rec.sid = p.sid; rec.notes = rec.notes.map((x, i) => ({ n: x.n, m: x.m, k: x.k ? 1 : 0, c: x.c, b: PE.tl[i] ? PE.tl[i].bar : 0 }));   // compact: only what the coach reads, and the bar
  const prior = peRuns().filter(r => r.sid === p.sid && r.inst === rec.inst && (!rec.p || r.p === rec.p)), best = histIsBest(prior, rec);
  PE.lastRun = { rec, coach: coachReview(rec, prior, { best }), best, earlier: prior.slice(-5).map(r => r.total), weak: peWeakSpots(slots) }; peSaveRun(rec); PE.resOpen = true; peRenderResult(); peUi();
}
// The notes to work on: skipped, wrong or far from the pitch, with their bar (a piece has bars, a scale does not).
function peWeakSpots(slots) {
  const T = peTol(), bad = slots.map(s => {
    const bar = PE.tl[s.index] ? PE.tl[s.index].bar : 0, dev = s.k === 'h' ? (typeof s.m === 'number' ? s.m : s.c) : null;
    if (s.k !== 'h') return { bar, name: s.name, w: 100, text: 'not played' };
    if (s.wrong) return { bar, name: s.name, w: 60 + s.wrong, text: 'a wrong note was played first' };
    return Math.abs(dev) > T ? { bar, name: s.name, w: Math.abs(dev), text: `${Math.abs(dev).toFixed(0)}¢ ${dev > 0 ? 'sharp' : 'flat'}` } : null;
  }).filter(Boolean).sort((a, b) => b.w - a.w).slice(0, 6);
  return bad;
}
const peBar = (label, w, v) => `<div class="rb"><span>${label}<small> ${w}%</small></span><div class="rb-t"><i style="width:${Math.max(2, Math.min(100, v)).toFixed(0)}%"></i></div><b>${v.toFixed(0)}</b></div>`;
function peRenderResult() {
  const el = $('pzResult'), L = PE.lastRun; if (!el) return;
  if (!L) { el.innerHTML = ''; return; }
  const r = L.rec, list = a => `<ul>${a.map(t => `<li>${peEsc(t)}</li>`).join('')}</ul>`;
  const weak = L.weak.length ? `<h4>Notes to work on</h4><ul>${L.weak.map(w => `<li><b>Bar ${w.bar} · ${peEsc(w.name.replace('b', '♭').replace('#', '♯'))}</b> — ${peEsc(w.text)}</li>`).join('')}</ul>` : '';
  el.innerHTML = `<div class="res-head"><div class="res-score"><b>${r.total}</b><small>/100</small></div>
    <div><span class="band ${PE_BAND[r.band]}">${r.band}</span>${L.best ? ' <span class="pbadge">★ Personal best</span>' : ''}
    <div class="mut res-sub">${peEsc(r.label)} · ${r.bpm} BPM · ${r.mode === 'wait' ? 'Wait for note' : 'Tempo-locked'} · pass ${r.pass}${r.eng ? ' · ' + (r.eng === 'strict' ? 'Strict' : 'Practical') + ' grading' : ''}</div>
    ${r.cov != null && r.cov < 0.6 ? `<div class="warn-t res-sub">The microphone heard only ${Math.round(r.cov * 100)}% of each note. Move it closer, quiet the room, or raise the input level: this score may be lower than your playing deserves.</div>` : ''}
    ${r.off != null && Math.abs(r.off) >= 8 ? `<div class="mut res-sub">You played ${Math.abs(r.off).toFixed(0)}¢ ${r.off > 0 ? 'sharp' : 'flat'} overall. Up to 12¢ of that is forgiven in the score${Math.abs(r.off) > 12 ? ' and the rest counts against you' : ''}, so check your tuning or your first note.</div>` : ''}
    ${L.earlier.length ? `<div class="mut res-sub">Earlier runs of this piece: ${L.earlier.join(' · ')}</div>` : ''}</div></div>
    <div class="res-bars">${peBar('Pitch &amp; intonation', 50, r.pitch)}${peBar('Fluency &amp; pulse', 30, r.fluency)}${peBar('Tone &amp; steadiness', 20, r.tone)}</div>
    ${weak}<h4>What you're doing well</h4>${list(L.coach.strengths)}<h4>What to improve</h4>${list(L.coach.focus)}`;
}

// ----- the controls -----
PE.resOpen = true;
$('pzStart').onclick = peStart; $('pzStop').onclick = peStop; $('pzDemo').onclick = () => { if (PE.demo >= 0) peStopDemo(); else peDemo(); };
$('pzResBtn').onclick = () => { PE.resOpen = !PE.resOpen; peUi(); if (PE.resOpen) $('pzResult').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
$('pzClick').onclick = () => { PE.click = !PE.click; $('pzClick').classList.toggle('on', PE.click); $('pzClick').setAttribute('aria-pressed', String(PE.click)); $('pzClick').textContent = PE.click ? '■ Click' : '♩ Click'; };
function peSetMode(m) {
  if (PE.running || PE.demo >= 0) peStop();
  PE.mode = m === 'wait' ? 'wait' : 'tempo';
  document.querySelectorAll('#pzMode button').forEach(b => { const on = b.dataset.mode === PE.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  if (typeof ppRender === 'function') ppRender(); peUi();
}
document.querySelectorAll('#pzMode button').forEach(b => b.onclick = () => peSetMode(b.dataset.mode));
function peShowGrade() { document.querySelectorAll('#pzGrade button').forEach(b => { const on = b.dataset.g === gradeMode(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
document.querySelectorAll('#pzGrade button').forEach(b => b.onclick = () => { if (PE.running) { peMsg('Change the grading before you start a run.', 'warn'); return; } setGradeMode(b.dataset.g, true); peShowGrade(); });   // one grading choice for both screens
peShowGrade();
