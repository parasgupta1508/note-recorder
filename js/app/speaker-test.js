// Speaker test (Settings > Accuracy check): the app plays a realistic performance through the device speaker, listens to it with its own microphone, runs the real Scale drill on what
// it hears, and compares the result with what was really played (js/core/perf-synth.js knows the truth of every note). No person has to play. The microphone recording and the truth
// are kept so they can be saved as a test clip (WAV + truth), the same format tests/gold.js reads.
// What is measured: pitch error per note, how many played notes were found, wrong and skipped notes, onset timing against the click, and the score the drill gave next to the score
// the same performance deserves (so a fault in listening is not mistaken for the grader's opinion).
// The run uses a scratch player: nothing is added to anyone's scorecard, history or Progress.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope. Called from Settings, and by tests/mic-loopback.js --mode speaker.

const ST = { running: false, stop: false, takes: [] };
const stSleep = ms => new Promise(r => setTimeout(r, ms));
const stRms = x => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / (x.length || 1)); };
const stCat = chunks => { const n = chunks.reduce((s, c) => s + c.length, 0), o = new Float32Array(n); let p = 0; for (const c of chunks) { o.set(c, p); p += c.length; } return o; };
function stSet(id, v) { const el = $(id); if (!el) return; if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); }
function stWav(x, sr) {            // 32-bit float mono WAV
  const b = new ArrayBuffer(44 + x.length * 4), v = new DataView(b), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + x.length * 4, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 32, true); w(36, 'data'); v.setUint32(40, x.length * 4, true); new Float32Array(b, 44).set(x); return b;
}
// The raw microphone signal (before the app's filters), kept while a test runs.
function stTapStart(from) {
  const c = getCtx(), sp = c.createScriptProcessor(4096, 1, 1), sink = c.createGain(), chunks = []; sink.gain.value = 0; from = from || srcNode;
  sp.onaudioprocess = e => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  from.connect(sp); sp.connect(sink); sink.connect(c.destination);
  return { chunks, t: c.currentTime, stop() { try { from.disconnect(sp); } catch {} try { sp.disconnect(); sink.disconnect(); } catch {} sp.onaudioprocess = null; return stCat(chunks); } };
}
// What a run changes is put back afterwards: the controls, the grader, and the (empty, scratch) player.
function stSave() {
  const ids = ['scInst', 'scRoot', 'scType', 'scSpan', 'scBow', 'scPos', 'scBpm'], o = { vals: {}, chk: { scStrict: $('scStrict').checked, scRepeat: $('scRepeat').checked }, mode: sc.mode, grade: gradeMode(), profile, cardAll, cardSess, passAll, tab };
  ids.forEach(id => { o.vals[id] = $(id).value; }); return o;
}
function stRestore(o) {
  profile = o.profile; cardAll = o.cardAll; cardSess = o.cardSess; passAll = o.passAll; window.stActive = false;
  try { stSet('scInst', o.vals.scInst); for (const id of ['scRoot', 'scType', 'scSpan', 'scBow', 'scPos', 'scBpm']) stSet(id, o.vals[id]); $('scStrict').checked = o.chk.scStrict; $('scRepeat').checked = o.chk.scRepeat; setMode(o.mode, true); setGradeMode(o.grade, true); } catch {}
  if (typeof settingsChanged === 'function') settingsChanged(); if (o.tab !== 'scale') showTab(o.tab);
}
const stPlay = (c, x, sr, at, dest) => { const b = c.createBuffer(1, x.length, sr); b.copyToChannel(x, 0); const s = c.createBufferSource(); s.buffer = b; s.connect(dest || c.destination); s.start(Math.max(at, c.currentTime)); return s; };

// direct: true sends the sound straight into the app's input instead of through the speaker and the microphone (silent; checks the software, not the room).
// One scenario: { inst: violin|guitar|ukulele, level, vibrato, root (pitch class), type, span, bpm, bow ('separate'|'slur2'|'slur4'|'slur8'), seed, grader: 'strict'|'practical' }
// hooks: { log(text) }. Returns a report { ok, error?, checks[], stats..., wav (ArrayBuffer), truth, ... }.
async function stRunScenario(sce, hooks = {}) {
  const log = hooks.log || (() => {}), S = Object.assign({ inst: 'violin', level: 'good', vibrato: true, root: 2, type: 'major', span: 1, bpm: 70, bow: 'separate', pos: '', seed: 1, grader: 'strict', minHz: 0 }, sce), saved = stSave();
  window.stActive = true; profile = ''; cardAll = {}; cardSess = {}; passAll = [];
  let tap = null, bus = null;
  try {
    if (document.hidden) return { ok: false, hidden: true, error: 'HIDDEN: the browser window is hidden, minimised or the screen is asleep, so the page cannot listen. Keep this window visible and the screen awake, then run again.', scenario: S };
    showTab('scale'); if (sc.running) stopScale();
    stSet('scInst', S.inst); settingsChanged();
    stSet('scRoot', S.root); stSet('scType', S.type); stSet('scSpan', S.span); if (!$('scBowWrap').hidden) stSet('scBow', S.bow); if (S.pos && !$('scPosWrap').hidden) stSet('scPos', S.pos); stSet('scBpm', S.bpm); $('scStrict').checked = true; $('scRepeat').checked = false;
    setMode('tempo', true); setGradeMode(S.grader, true); settingsChanged();
    const tl = sc.tl, c = getCtx(); await c.resume(); const sr = c.sampleRate;
    log(`Rendering ${S.inst} (${S.level}${S.vibrato ? ', vibrato' : ''}) …`); await stSleep(30);
    const perf = psRender({ inst: S.inst, sr, tl, level: S.level, player: { vibrato: !!S.vibrato }, seed: S.seed, tonic: sc.plan.pc });
    if (!listening) await startListening(); await c.resume();
    if (S.direct) { bus = c.createGain(); try { srcNode.disconnect(hpNode); } catch {} bus.connect(hpNode); }   // the recording goes into the app's filters instead of the microphone
    tap = stTapStart(bus);
    // preflight: a realistic note through the speaker must be clearly louder than the room, else the speaker-to-microphone path is not working
    log(S.direct ? 'Direct input (no speaker) …' : 'Checking the speaker and microphone …'); await stSleep(700);
    const room = stRms(stCat(tap.chunks.slice(-3)));
    const pre = psRender({ inst: 'violin', sr, tl: [{ index: 0, midi: 69, startMs: 0, durationMs: 800 }], level: 'expert', player: { vibrato: false, scoop: 0 }, seed: 2 });   // a steady bowed A4 whatever the instrument: it is a level check
    const n0 = tap.chunks.length; stPlay(c, pre.samples, sr, c.currentTime + 0.1, bus); await stSleep(1500);
    const lvl = stRms(stCat(tap.chunks.slice(n0 + 1, n0 + 7)));
    if (!S.direct && (lvl < room * 3 || lvl < 0.002)) return { ok: false, tooQuiet: true, error: `TOO QUIET: the microphone barely heard the speaker (room ${room.toExponential(2)}, note ${lvl.toExponential(2)}). Raise the speaker volume, move the microphone closer, and use the speaker, not headphones.`, scenario: S };
    log('Starting the Scale drill …');
    const t1 = Date.now(); startScale();
    for (let i = 0; i < 750 && sc.clock == null && sc.running; i++) await stSleep(20);
    if (sc.clock == null) { stopScale(); return { ok: false, hidden: document.hidden, error: document.hidden ? 'HIDDEN: the browser window was hidden while the test ran (minimised, covered or the screen slept). Keep it visible and the screen awake, then run again.' : 'The drill did not start (no count-in).', scenario: S }; }
    const playAt = sc.clock + t0 - perf.padS;                 // the first beat of the drill, on the audio clock, less the lead-in of the recording
    if (playAt < c.currentTime + 0.05) return { ok: false, error: 'The recording was not ready in time for the count-in.', scenario: S };
    const src = stPlay(c, perf.samples, sr, playAt, bus);
    log(`Playing: ${tl.length} notes at ${sc.bpm} BPM …`);
    const limit = Date.now() + (perf.durationS + (playAt - c.currentTime) + 12) * 1000;
    while (Date.now() < limit && !ST.stop && !(sc.lastRun && sc.lastRun.rec && sc.lastRun.rec.t >= t1) ) { await stSleep(100); }
    if (ST.stop) { try { src.stop(); } catch {} stopScale(); return { ok: false, error: 'Stopped.', scenario: S }; }
    const finished = !!(sc.lastRun && sc.lastRun.rec && sc.lastRun.rec.t >= t1);
    await stSleep(600);
    if (!finished && sc.running) stopScale();
    const beatInWavS = playAt + perf.padS - tap.t, audio = tap.stop(); tap = null;   // where the first beat sits in the saved recording (before the acoustic and device delay)
    const minHz = S.direct ? 0 : (S.minHz || 230), slots = sc.slots.filter(s => s.pass === 1), cmp = psCompare(perf.truth, slots, tl, { minHz });   // a laptop speaker does not reproduce much below 230 Hz
    const refSlots = psTruthSlots(perf.truth, tl, { tol: tol(), smooth: ruleFor(S.inst).smooth }).map((x, i) => cmp.rows[i].rig ? (slots.find(q => q.index === x.index) || x) : x), beatMs = 60000 / sc.bpm;   // rig-limited notes are scored as heard in both
    const opts = { beatMs, mode: 'tempo', wobbleCap: ruleFor(S.inst).wobble }, measured = finished ? scoreRun(slots, opts) : null, reference = scoreRun(refSlots, opts);
    const d = cmp.detection, checks = [];
    const chk = (ok, msg) => checks.push({ ok: !!ok, msg });
    chk(finished, finished ? 'the drill ran to the end of the scale' : 'the drill did not finish');
    chk(d.played === 0 || d.found / d.played >= 0.9, `found ${d.found} of ${d.played} played notes (needs 90%)`);
    chk(cmp.pitch.n >= 3 && cmp.pitch.medAbs <= 5, `median pitch error ${cmp.pitch.medAbs == null ? '–' : cmp.pitch.medAbs.toFixed(1)}¢ (needs 5¢ or less)`);
    chk(cmp.pitch.n >= 3 && cmp.pitch.p95Abs <= 15, `95% of notes within ${cmp.pitch.p95Abs == null ? '–' : cmp.pitch.p95Abs.toFixed(1)}¢ (needs 15¢)`);
    if (cmp.rigLimited) checks.push({ ok: true, msg: `${cmp.rigLimited} notes below ${minHz} Hz are left out: a small speaker cannot play them (this is the rig, not the app)` });
    chk(d.falseWrong <= Math.max(1, Math.round(0.1 * d.played)), `${d.falseWrong} good notes wrongly called wrong notes`);
    if (measured) chk(Math.abs(measured.total - reference.total) <= 8, `score ${measured.total} against ${reference.total} for the same performance heard perfectly (needs within 8)`);
    const report = { ok: checks.every(x => x.ok), scenario: S, sr, bpm: sc.bpm, notes: tl.length, finished, checks, pitch: cmp.pitch, detection: d, timing: cmp.timing, rows: cmp.rows, rigLimited: cmp.rigLimited,
      grade: { measured: measured && { total: measured.total, band: measured.band, pitch: measured.pitch, fluency: measured.fluency, tone: measured.tone }, reference: { total: reference.total, band: reference.band, pitch: reference.pitch, fluency: reference.fluency, tone: reference.tone } },
      truth: perf.truth, player: perf.player, wav: stWav(audio, sr), beatInWavS,
      debug: { running: sc.running, pos: sc.pos, attempts: sc.attempts.length, slots: sc.slots.length, listening, tab, clock: sc.clock, now: getCtx().currentTime - t0, hidden: document.hidden, state: getCtx().state, gate: $('gate').value } };
    return report;
  } catch (e) { return { ok: false, error: 'Test error: ' + (e && e.message || e), scenario: S }; }
  finally { if (tap) tap.stop(); if (bus) { try { bus.disconnect(); } catch {} try { srcNode.connect(hpNode); } catch {} } stRestore(saved); }
}

// The full set: realistic players on the three instruments. Each entry is one performance.
const ST_SET = [
  { name: 'Violin, expert, no vibrato, separate bows', inst: 'violin', level: 'expert', vibrato: false, bow: 'separate' },
  { name: 'Violin, good, vibrato, separate bows', inst: 'violin', level: 'good', vibrato: true, bow: 'separate' },
  { name: 'Violin, good, vibrato, four notes to a bow, two octaves', inst: 'violin', level: 'good', vibrato: true, bow: 'slur4', span: 2 },
  { name: 'Violin, average, vibrato', inst: 'violin', level: 'average', vibrato: true, bow: 'separate' },
  { name: 'Violin, weak, vibrato', inst: 'violin', level: 'weak', vibrato: true, bow: 'separate' },
  { name: 'Guitar, good, mid neck, two octaves', inst: 'guitar', level: 'good', vibrato: false, root: 7, pos: 'mid', span: 2 },
  { name: 'Ukulele, good', inst: 'ukulele', level: 'good', vibrato: false, root: 0 },
];
async function stRunSet(list, hooks = {}) {
  ST.running = true; ST.stop = false; const out = [];
  try { for (let i = 0; i < list.length && !ST.stop; i++) { const sce = list[i]; if (hooks.log) hooks.log(`${i + 1}/${list.length}: ${sce.name || sce.inst}`); let r = await stRunScenario(Object.assign({ seed: 100 + i }, sce), hooks); if (!r.ok && !r.error && !r.hidden && r.finished === false && !ST.stop) { if (hooks.log) hooks.log('The drill did not finish; trying once more'); r = await stRunScenario(Object.assign({ seed: 100 + i }, sce), hooks); r.retried = true; } r.name = sce.name || `${sce.inst} ${sce.level}`; out.push(r); if (hooks.onTake) await hooks.onTake(r, i); if (r.tooQuiet || r.hidden) break; } }
  finally { ST.running = false; }
  return out;
}

// ----- the screen -----
const stFmt = (x, d = 1) => x == null ? '–' : x.toFixed(d);
function stRow(r) {
  const g = r.grade || {}, m = g.measured, p = r.pitch || {}, d = r.detection || {}, t = r.timing || {};
  if (r.error) return `<tr><td>${r.name || ''}</td><td colspan="6" class="${r.tooQuiet ? 'warn-t' : 'bad-t'}">${r.error}</td></tr>`;
  return `<tr><td>${r.name}</td><td class="${r.ok ? 'ok-t' : 'bad-t'}">${r.ok ? 'pass' : 'FAIL'}</td><td>${d.found}/${d.played}</td><td>${stFmt(p.medAbs)}¢ · p95 ${stFmt(p.p95Abs)}¢</td><td>${stFmt(t.latencyMs, 0)} ms ± ${stFmt(t.spreadMs, 0)}</td><td>${m ? m.total : '–'} (${g.reference.total})</td><td>${r.checks.filter(x => !x.ok).map(x => x.msg).join('; ')}</td></tr>`;
}
function stShow(list) {
  $('stRes').innerHTML = `<div class="scroll tbl"><table><tr><th>Test</th><th></th><th>Notes found</th><th>Pitch error</th><th>Onset lag ± spread</th><th>Score (deserved)</th><th>Problems</th></tr>${list.map(stRow).join('')}</table></div>`;
  $('stFiles').innerHTML = ''; ST.takes = list.filter(r => r.wav);
  ST.takes.forEach((r, i) => { const a = document.createElement('a'), nm = `speaker-${r.scenario.inst}-${r.scenario.level}${r.scenario.vibrato ? '-vib' : ''}-${i + 1}`; a.className = 'btn sec'; a.textContent = 'Save ' + nm + '.wav'; a.href = URL.createObjectURL(new Blob([r.wav], { type: 'audio/wav' })); a.download = nm + '.wav'; $('stFiles').append(a); });
}
async function stGo(list) {
  if (ST.running) return; $('stRun').disabled = $('stAll').disabled = true; $('stStop').classList.remove('hide'); $('stMsg').className = 'hint2'; $('stRes').innerHTML = ''; $('stFiles').innerHTML = '';
  try { const res = await stRunSet(list, { log: t => { $('stMsg').textContent = t; } }); stShow(res); const bad = res.filter(r => !r.ok).length; $('stMsg').className = 'hint2 ' + (res.some(r => r.tooQuiet || r.hidden) ? 'warn-t' : bad ? 'bad-t' : 'ok-t');
    $('stMsg').textContent = res.some(r => r.hidden) ? 'The window was hidden: keep it visible and the screen awake, then run again.' : res.some(r => r.tooQuiet) ? 'Too quiet: raise the speaker volume and try again.' : bad ? `${bad} of ${res.length} tests failed.` : `All ${res.length} tests passed.`; }
  finally { $('stRun').disabled = $('stAll').disabled = false; $('stStop').classList.add('hide'); }
}
$('stRun').onclick = () => stGo([{ name: `${$('stInst').selectedOptions[0].textContent}, ${$('stLevel').value}${$('stVib').checked ? ', vibrato' : ''}`, inst: $('stInst').value, level: $('stLevel').value, vibrato: $('stVib').checked && $('stInst').value === 'violin', bow: $('stBow').value }]);
$('stAll').onclick = () => stGo(ST_SET);
$('stStop').onclick = () => { ST.stop = true; };
