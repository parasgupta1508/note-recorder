// Metronome and remembered scale / tempo choices.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// ----- metronome (Web Audio clock, accent on beat 1) -----
let metroOn = false, metroTimer = null, metroNext = 0, metroBeat = 0, beatTimers = [], beatQ = [], beatRaf = 0;
const sigBeats = () => +$('scSig').value || 4;
function buildBeats() { $('beats').innerHTML = '<i></i>'.repeat(sigBeats()); }
function flashBeat(b) { document.querySelectorAll('#beats i').forEach((e, i) => { e.className = i === b ? (b === 0 ? 'on acc' : 'on') : ''; }); }
function clickAt(time, accent) {
  const c = getCtx(), o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.value = accent ? 1500 : 1000;
  g.gain.setValueAtTime(0.0001, time); g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, time + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
  o.connect(g); g.connect(c.destination); o.start(time); o.stop(time + 0.07);
}
function metroTick() {
  // during a run or a demo the click uses the run's own tempo (a change of the BPM box mid-run must not pull the click away from the cursor)
  const c = getCtx(), spb = 60 / ((sc.running || demoIdx >= 0) && sc.bpm ? sc.bpm : (+$('scBpm').value || 80)), n = sigBeats();
  while (metroNext < c.currentTime + 0.3) {
    const b = metroBeat % n;
    clickAt(metroNext, b === 0); beatQ.push({ at: metroNext, b });
    metroNext += spb; metroBeat++;
  }
  if (beatTimers.length > 12) beatTimers.splice(0, beatTimers.length - 12);
}
// The beat dots are flipped from the audio clock on the animation frame (not by timers, which drift by tens of ms): a dot lights when its click is heard, i.e. at its time plus the output latency.
function beatPump() {
  beatRaf = 0; if (!metroOn) return;
  const c = getCtx(), lat = c.outputLatency > 0 && c.outputLatency < 0.5 ? c.outputLatency : 0; let hit = null;
  while (beatQ.length && beatQ[0].at + lat <= c.currentTime) hit = beatQ.shift();
  if (hit) flashBeat(hit.b);
  beatRaf = requestAnimationFrame(beatPump);
}
function startMetro(at) {   // at: the audio-clock time of beat 1 (the caller's own time, so the click and the cursor share one clock)
  stopMetro(); const c = getCtx(); metroNext = at != null ? at : c.currentTime + 0.08; metroBeat = 0; metroOn = true;
  beatQ = []; metroTick(); metroTimer = setInterval(metroTick, 50); cancelAnimationFrame(beatRaf); beatRaf = requestAnimationFrame(beatPump); $('metro').classList.add('on'); $('metro').textContent = '■ Click';
}
function stopMetro() {
  clearInterval(metroTimer); metroTimer = null; beatTimers.forEach(clearTimeout); beatTimers = []; beatQ = []; cancelAnimationFrame(beatRaf); beatRaf = 0; metroOn = false;
  if ($('beats')) flashBeat(-1); $('metro').classList.remove('on'); $('metro').textContent = '♩ Click';
}
$('metro').onclick = () => metroOn ? stopMetro() : startMetro();
const clampBpm = v => Math.max(30, Math.min(240, Math.round(+v || 80)));
$('bpmDn').onclick = () => { $('scBpm').value = clampBpm(+$('scBpm').value - 2); savePrefs(); };
$('bpmUp').onclick = () => { $('scBpm').value = clampBpm(+$('scBpm').value + 2); savePrefs(); };
$('scBpm').onchange = () => { $('scBpm').value = clampBpm($('scBpm').value); };
$('scSig').onchange = () => { buildBeats(); if (metroOn) startMetro(); };
buildBeats();

// ----- remembered scale / tempo choices -----
const PREF_IDS = ['scInst', 'scRoot', 'scType', 'scSpan', 'scBow', 'scPos', 'scBpm', 'scSig'], PREF_CHK = ['scStrict', 'scRepeat'], PREF_KEY = 'tuner-scaleprefs-v1';
function savePrefs() { const o = {}; PREF_IDS.forEach(id => o[id] = $(id).value); PREF_CHK.forEach(id => o[id] = $(id).checked); o.scMode = sc.mode; try { localStorage.setItem(PREF_KEY, JSON.stringify(o)); } catch {} }
function loadPrefs() { try { const o = JSON.parse(localStorage.getItem(PREF_KEY)); if (!o) return; if (o.scMode) setMode(o.scMode, true); PREF_IDS.forEach(id => { if (id === 'scBow') applyLimits(); if (o[id] != null && [...($(id).options || [{ value: o[id] }])].some(op => op.value === String(o[id]))) $(id).value = o[id]; else if (o[id] != null && !$(id).options) $(id).value = o[id]; }); PREF_CHK.forEach(id => { if (typeof o[id] === 'boolean') $(id).checked = o[id]; }); } catch {} }
$('tab-scale').addEventListener('change', savePrefs);

