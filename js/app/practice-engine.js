// Practice engine: instrument controls, the practice state machine (Tempo-locked and Wait-for-note), summary, Hear scale.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

function fillSel(sel, pairs, val) { sel.innerHTML = ''; pairs.forEach(([v, t]) => sel.add(new Option(t, v))); sel.value = val; }
// The selectors depend on the instrument: its bowing or position control, and a note about its range and where the scale starts.
function applyLimits() {
  const inst = $('scInst').value, rule = ruleFor(inst), c = controls(inst);
  for (const [k, id] of [['bowing', 'scBow'], ['position', 'scPos']]) {       // bowing and position, only where the instrument has them
    const o = c[k], cur = $(id).value; $(id + 'Wrap').hidden = !o;
    fillSel($(id), o ? o.options.map(x => [x.value, x.label]) : [], o && o.options.some(x => x.value === cur) ? cur : o ? o.def : '');
  }
  const p = planNow(), nm = n => spellNote(n, false);
  $('instRange').innerHTML = p.warnings.map(w => `<span class="warn-t">${w}</span>`).join(' ');
}
function droneRetune() { if (typeof DRONE !== 'undefined' && DRONE.on) droneSet(droneMidiFor(planNow().start)); }

function resetPractice() {
  finalizeHold(); clearTimeout(sc.countTimer); clearTimeout(sc.runTimer); sc.runPass = 0; sc.pass = 1; sc.passes = []; clearResult();
  const p = planNow(); sc.plan = p; sc.tl = p.tl; sc.seq = p.tl.map(n => n.midi); sc.bpm = p.bpm; sc.label = null;
  sc.pos = 0; sc.grades = []; sc.attempts = []; sc.wrong = 0; sc.running = false; sc.slots = []; sc.slotAt = {}; sc.clock = null; sc.waitFrames = []; sc.waitOk = 0; sc.devHist = [];
  liveBuf = []; liveC = []; silentFrames = 99; det.cur = null; det.lastMidi = null;
  $('scStart').textContent = 'Start practice'; $('scSum').innerHTML = ''; setMsg('');
}
// Tempo-locked: one bar of clicks, then each note is due on its beat. The clock is in the microphone loop's time (ctx.currentTime - t0).
function startCountIn() {
  const c = getCtx(), spb = 60 / sc.bpm, n = sigBeats(), base = c.currentTime + 0.08, wasOn = metroOn;
  sc.clickAfter = wasOn; startMetro(base);
  sc.clock = base + n * spb - t0;
  if (!wasOn) sc.countTimer = setTimeout(() => { if (!sc.clickAfter && metroOn) stopMetro(); }, (0.08 + n * spb) * 1000 + 30);
  setMsg('Count-in: start on the downbeat after the clicks');
}
$('metro').addEventListener('click', () => { sc.clickAfter = metroOn; });
// Before a run the app listens to the room for 1.5 s and sets the noise gate just above it (the same quiet step the Tuner runs when it opens), so a fan or a hum is not heard as a
// note and a quiet room does not need a high gate. It runs when the microphone has just been turned on, or when the last check was more than 10 minutes ago. Only the quiet
// step runs here; the Tuner's second step (play a note to set the boost) is left to the Tuner, so the input level never changes in the middle of a run.
function quietCalib(fresh) {
  const stale = performance.now() - (sc.calibAt || -1e9) > 600000;
  if ((!fresh && !stale) || calib || recording || !listening || typeof startAutoCalib !== 'function') return null;   // null: nothing to wait for
  sc.calibAt = performance.now(); startAutoCalib(true); setMsg('Checking the room noise… stay quiet for a moment');
  return new Promise(res => {
    const t = performance.now(), iv = setInterval(() => {
      if (!sc.running || !calib || calib.phase !== 1 || performance.now() - t > 4000) { clearInterval(iv); if (calib && calib.phase === 2 && calib.auto) { calib = null; $('status').textContent = ''; } setMsg(''); res(); }
    }, 40);
  });
}
function startScale() {
  stopDemo(); resetPractice(); sc.running = true;
  const begin = () => {
    if (!sc.running) return;
    if (sc.mode === 'tempo') startCountIn(); else setMsg('Play the first note and hold it in tune; the target waits for you');
  };
  const fresh = !listening;
  setMsg(listening ? '' : 'Starting microphone…');
  $('scStart').textContent = 'Restart'; renderScale();
  const go = w => w ? w.then(begin) : begin();   // begin at once when no room check is needed
  if (listening) go(quietCalib(false));
  else startListening().then(() => go(quietCalib(fresh)))
    .catch(e => { sc.running = false; $('scStart').textContent = 'Start practice'; $('status').textContent = 'Mic error: ' + e.message; setMsg('Mic error: ' + e.message, 'bad'); renderScale(); });
}
function stopScale() {                       // stops the demo and/or the practice run and returns to "Start practice"
  const was = sc.running || demoIdx >= 0;
  stopDemo(); clearTimeout(sc.countTimer); stopMetro(); finalizeHold();
  sc.running = false; det.cur = null; det.lastMidi = null; liveBuf = []; sc.clock = null;
  $('scStart').textContent = 'Start practice';
  setMsg(was ? 'Stopped — press Start practice to begin again' : '');
  renderScale(); renderSummary(); renderCard(); renderAnalysis();
}
const newHold = (a, T, ix, e) => ({ midi: a.midi, c0: a.cents, T, frames: [], gap: 0, sl: scaleLabel(), i: $('scInst').value, ix, pass: sc.pass, d: sc.tl[ix].direction, e: e == null ? null : e });
const scCents = c => `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(0)}¢`;
const cls3 = g => g === 'In tune' ? 'ok' : g === 'Close' ? 'warn' : 'bad';
function markSkip(i, t) {
  const n = sc.tl[i]; sc.grades[i] = 'Skipped';
  sc.attempts.push({ index: i + 1, expected: n.noteName, played: '–', grade: 'Skipped', hz: null, cents: null, time_s: t == null ? 0 : t, pass: sc.pass, direction: n.direction, timing_ms: null });
  addEv(n.midi, { k: 's', d: n.direction }, true); slotFor(i);
}
// Tempo-locked: a note the clock has left behind (a beat and a half after its start) counts as skipped, so the target keeps pace with the click.
function clockTick(t) {
  if (sc.mode !== 'tempo' || sc.clock == null || t == null) return;
  const el = (t - sc.clock) * 1000, beat = 60000 / sc.bpm; let moved = false;
  while (sc.pos < sc.seq.length) {
    const n = sc.tl[sc.pos];
    if (el > n.startMs + n.durationMs + 0.5 * beat) { markSkip(sc.pos, t); sc.pos++; moved = true; } else break;
  }
  if (!moved) return;
  liveBuf = []; liveC = []; silentFrames = 99;
  if (sc.pos >= sc.seq.length) endPass('Skipped the rest'); else { setMsg(`Too late for ${sc.tl[sc.pos - 1].noteName} — keep with the click`, 'warn'); renderScale(); renderCard(); }
}
// A pass is done: save its percentage, then loop (Repeat) or finish.
function endPass(note) {
  const tl = sc.tl, done = sc.attempts.filter(x => x.pass === sc.pass && x.played === x.expected), n = done.filter(x => x.grade === 'In tune').length;
  const wr = sc.attempts.filter(x => x.pass === sc.pass && /^Wrong/.test(x.grade)).length, pct = 100 * n / (tl.length + wr);   // wrong notes count against the pass
  sc.passes.push({ pct }); savePass(pct); queueRun();
  if ($('scRepeat').checked) {                       // loop: the next pass starts one bar after the end of this grid; the scorecard keeps growing
    if (sc.mode === 'tempo' && sc.clock != null) sc.clock += (tl.length + sigBeats()) * 60 / sc.bpm;
    setMsg(`Pass ${sc.pass} done — ${pct.toFixed(0)}% in tune. ${sc.mode === 'tempo' ? 'Next pass starts after one bar of clicks' : 'Play the first note to start pass ' + (sc.pass + 1)}`, 'ok');
    sc.pass++; sc.pos = 0; sc.grades = []; sc.waitFrames = []; sc.waitOk = 0; renderScale(); renderSummary(); renderCard(); return;
  }
  sc.running = false; $('scStart').textContent = 'Start practice';
  if (sc.mode === 'tempo' && !sc.clickAfter) stopMetro();
  setMsg(note ? `${note} — ${pct.toFixed(0)}% in tune` : `Scale complete — ${pct.toFixed(0)}% in tune`, 'ok'); renderScale(); renderSummary(); renderCard();
}
function onAttempt(a) {
  if (!sc.running || demoIdx >= 0 || sc.pos >= sc.seq.length) return;
  a = Object.assign({}, a, { cents: scaleDev(a.cents, a.midi) }); const sh = scaleShift();   // the grader's deviation; sh = the player's overall offset to forgive
  if (sc.mode === 'wait') return waitAttempt(a);
  const seq = sc.seq, tl = sc.tl, exp = seq[sc.pos], T = scaleTol();
  const terr = ix => sc.clock == null ? null : Math.round((a.t - sc.clock) * 1000 - tl[ix].startMs);
  const rec = { index: sc.pos + 1, expected: tl[sc.pos].noteName, played: midiName(a.midi), hz: a.hz, cents: a.cents, time_s: a.t, pass: sc.pass, direction: tl[sc.pos].direction, timing_ms: null };
  // Re-playing the note just played is a retry: scored as another play of that note, never a skip or a wrong note.
  // If the clock had already skipped it, this is a late play: it replaces the skip.
  if (sc.pos > 0 && a.midi === seq[sc.pos - 1] && a.midi !== exp) {
    const p = sc.pos - 1, g = gradeCents(a.cents - sh, T), late = sc.grades[p] === 'Skipped'; if (!late) slotFor(p).rt++;   // a retry is a restart: the evaluation counts it against continuity
    finalizeHold(); hold = newHold(a, T, p, late ? terr(p) : null); sc.grades[p] = g; liveBuf = []; liveC = []; silentFrames = 99; neutralLive();
    setMsg(`${late ? 'Late: ' : 'Retry '}${midiName(a.midi)} ${scCents(a.cents - sh)} — ${g}`, cls3(g)); renderScale(); return;
  }
  // Only look ahead (never backwards). With no clock you may start anywhere; after that at most 2 notes can be skipped at once.
  let k = seq.indexOf(a.midi, sc.pos);
  if (k > sc.pos + ((sc.pos === 0 && sc.clock == null) ? seq.length : 2)) k = -1;
  if (k >= 0) {
    const skipped = [];
    for (let i = sc.pos; i < k; i++) { markSkip(i, a.t); skipped.push(tl[i].noteName); }
    const g = gradeCents(a.cents - sh, T), e = terr(k);
    sc.attempts.push({ ...rec, index: k + 1, expected: tl[k].noteName, direction: tl[k].direction, grade: g, timing_ms: e }); sc.grades[k] = g;
    finalizeHold(); hold = newHold(a, T, k, e);   // scored when the note ends
    sc.pos = k + 1; liveBuf = []; liveC = []; silentFrames = 99; neutralLive();
    const fb = `${tl[k].noteName} ${scCents(a.cents - sh)} — ${g}` + (e != null && Math.abs(e) > 120 ? ` · ${e > 0 ? 'late' : 'early'} ${Math.abs(e)} ms` : '') + (skipped.length ? ` · skipped ${skipped.join(', ')}` : '');
    if (sc.pos >= seq.length) { endPass(); setMsg(`${fb} · ${$('scMsg').textContent}`, cls3(g)); return; }
    setMsg(fb, cls3(g)); renderScale();
  } else if ($('scStrict').checked) {
    const g = (a.midi - exp) % 12 === 0 ? 'Wrong octave' : 'Wrong note';
    sc.wrong++; sc.attempts.push({ ...rec, grade: g }); addEv(exp, { k: 'w', d: tl[sc.pos].direction }); slotFor(sc.pos).wrong++;
    setMsg(`Heard ${midiName(a.midi)} — expected ${tl[sc.pos].noteName} (${g.toLowerCase()})`, 'bad');
  } else {
    sc.attempts.push({ ...rec, grade: 'Ignored (lenient)' });
  }
}
// Wait for note: the target never moves on its own. It advances once the note has been held in tune for the instrument's hold time.
function waitAttempt(a) {
  const exp = sc.seq[sc.pos];
  if (a.midi === exp || (sc.pos > 0 && a.midi === sc.seq[sc.pos - 1])) return;      // the right note (liveScaleFrame advances it) or the previous one still ringing
  if (!$('scStrict').checked) return;
  const n = sc.tl[sc.pos], g = (a.midi - exp) % 12 === 0 ? 'Wrong octave' : 'Wrong note';
  sc.wrong++; sc.attempts.push({ index: sc.pos + 1, expected: n.noteName, played: midiName(a.midi), hz: a.hz, cents: a.cents, time_s: a.t, pass: sc.pass, direction: n.direction, timing_ms: null, grade: g });
  addEv(exp, { k: 'w', d: n.direction }); slotFor(sc.pos).wrong++;
  setMsg(`Heard ${midiName(a.midi)} — waiting for ${n.noteName} (${g.toLowerCase()})`, 'bad');
}
function waitFrame(raw, inTol, rule) {
  if (Math.abs(raw) <= 65) { sc.waitFrames.push(raw); if (sc.waitFrames.length > 600) sc.waitFrames.shift(); }
  sc.waitOk = inTol ? sc.waitOk + 1 : 0;
  if (sc.waitOk >= rule.holdFrames) advanceWait(rule);
}
function advanceWait(rule) {
  const T = scaleTol(), i = sc.pos, n = sc.tl[i], st = holdStats(sc.waitFrames, T, rule.smooth); if (!st) return;
  const g = gradeCents(st.c - scaleShift(), T), hz = noteToFreq(n.midi, a4()) * Math.pow(2, st.c / 1200);
  addEv(n.midi, { k: 'h', c: st.c, a: st.a, s: st.n >= 4 ? st.s : null, d: n.direction, sl: scaleLabel(), i: $('scInst').value }, true);
  const body = smoothCents(sc.waitFrames.slice(Math.min(3, sc.waitFrames.length >> 2)), rule.smooth), med = evalMedian(body);   // the evaluation judges the pitch after the attack
  Object.assign(slotFor(i), { k: 'h', c: st.c, a: st.a, s: st.n >= 4 ? st.s : null, e: null, m: med, sp: Math.abs(sc.waitFrames[0] - med) });
  sc.attempts.push({ index: i + 1, expected: n.noteName, played: n.noteName, hz, cents: st.c, time_s: 0, pass: sc.pass, direction: n.direction, timing_ms: null, grade: g });
  sc.grades[i] = g; sc.pos++; sc.waitFrames = []; sc.waitOk = 0; liveBuf = []; liveC = []; silentFrames = 99; neutralLive();
  setMsg(`${n.noteName} ${scCents(st.c - scaleShift())} — ${g}`, cls3(g));
  if (sc.pos >= sc.seq.length) endPass(); else { renderScale(); renderCard(); }
}

// ----- summary: intonation, timing, and the weakest spots -----
function renderSummary() {
  const sm = summariseRun(sc.slots, { tol: tol(), beatMs: 60000 / (sc.bpm || 80) });
  if (!sm) { $('scSum').innerHTML = ''; return; }
  const big = (v, l) => `<div><b>${v}</b>${l}</div>`, dr = sm.timingDriftMs;
  const timing = sm.timing == null ? big('–', sc.mode === 'wait' ? 'Timing (Tempo-locked only)' : 'Timing') : big(sm.timing.toFixed(0) + '%', 'Timing');
  const facts = [`${sm.played}/${sm.slots} notes played`, sm.avgErr == null ? null : `average error ${sm.avgErr.toFixed(1)}¢`, `${sm.wrongNotes} wrong`, sc.passes.length ? `${sc.passes.length} pass${sc.passes.length > 1 ? 'es' : ''}` : null,
    dr != null && Math.abs(dr) >= 30 ? `you are ${Math.abs(dr).toFixed(0)} ms ${dr > 0 ? 'behind' : 'ahead of'} the click on average` : null].filter(Boolean).join(' · ');
  const spots = sm.spots.length ? `<ol class="spots">${sm.spots.map(s => `<li><b>${s.name.replace('b', '♭').replace('#', '♯')} ${s.d === 'up' ? '↑' : '↓'}</b> — ${s.text}</li>`).join('')}</ol>` : '<div class="ok-t" style="margin-top:4px">No weak spots in this run.</div>';
  $('scSum').innerHTML = `<div class="sum-big">${big(sm.intonation.toFixed(0) + '%', 'Intonation')}${timing}${big(sm.inTune + '/' + sm.slots, 'Notes in tune')}</div><div class="mut" style="font-size:13px">${facts}</div><div style="margin-top:8px"><b>Spots to fix</b>${spots}</div>`;
}

// ----- Hear scale: plays the same timeline the scoring uses (honours tempo and slurs) -----
function stopDemo() {
  refStop();
  const was = demoIdx >= 0; demoIdx = -1; SV.demoT0 = null;
  $('scDemo').textContent = '▶ Hear scale';
  if (was) { det.cur = null; det.lastMidi = null; liveBuf = []; renderScale(); }
}
function startDemo() {
  finalizeHold(); const p = planNow(); sc.plan = p; sc.tl = p.tl; sc.seq = p.tl.map(n => n.midi); sc.bpm = p.bpm; sc.label = null;
  const at = getCtx().currentTime + 0.08;    // one time for the first note, the click and the cursor
  if (metroOn) startMetro(at);
  demoIdx = 0; SV.demoT0 = at; $('scDemo').textContent = '■ Stop demo';   // the audio clock time of the first note: the cursor glides on it
  refPlay(p.tl, { at, onNote: i => { demoIdx = i; renderScale(); }, onEnd: stopDemo });
  renderScale();
}
$('scDemo').onclick = () => { if (demoIdx >= 0) stopDemo(); else startDemo(); };
$('scStart').onclick = startScale;
$('scStop').onclick = stopScale;
function settingsChanged() { applyLimits(); stopDemo(); resetPractice(); renderScale(); renderCard(); renderAnalysis(); droneRetune(); }
['scInst', 'scRoot', 'scType', 'scSpan', 'scBow', 'scPos'].forEach(id => $(id).onchange = settingsChanged);
$('scRandom').onclick = () => {
  const inst = $('scInst').value, pos = $('scPos').value, p = randomPrompt(Math.random, EXAM_SCALES.basic, MAX_SPAN);
  while (p.span > 1 && planScale(inst, p.rootPc, p.span, pos).clamped) p.span--;      // an exam prompt the instrument can actually play
  $('scRoot').value = p.rootPc; $('scType').value = p.type; $('scSpan').value = p.span; savePrefs(); settingsChanged();
};
$('drone').onclick = () => droneToggle();
function setMode(m, quiet) {
  if (sc.running || demoIdx >= 0) stopScale();
  sc.mode = m === 'wait' ? 'wait' : 'tempo';
  document.querySelectorAll('#scMode button').forEach(b => { const on = b.dataset.mode === sc.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  if (!quiet) savePrefs();
}
document.querySelectorAll('#scMode button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
