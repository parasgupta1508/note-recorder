// Speaker test for PIECES: the same idea as the scale test (js/app/speaker-test.js), but the music is a real score opened in Piece practice. The app plays a performance of that
// score's notes (the real violin, guitar, ukulele or piano recordings, with a player's intonation, timing and mistakes), listens to it, runs the real Piece practice on what it hears,
// and compares what it found with what was really played. Long pieces, real rhythms, real tempo changes of register: the things a short scale does not have.
// Uses the helpers and the scratch-player rules of speaker-test.js (nothing is added to anyone's scores). Called from tests/mic-loopback.js --mode speaker --pieces.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// S: { name, xml (the score text), part (index), inst, from, to (bars), maxSec (longest run, default 75), bpm (optional), level, vibrato, seed, grader, direct, minHz, synth }
async function stRunPiece(sce, hooks = {}) {
  const log = hooks.log || (() => {}), S = Object.assign({ inst: 'violin', part: 0, level: 'good', vibrato: true, seed: 1, grader: 'strict', minHz: 0, maxSec: 75 }, sce), saved = stSave();
  window.stActive = true; profile = ''; cardAll = {}; cardSess = {}; passAll = [];
  let tap = null, bus = null; const prevRepeat = $('pzRepeat').checked, prevMode = PE.mode;
  try {
    if (document.hidden) return { ok: false, hidden: true, error: 'HIDDEN: the browser window is hidden, minimised or the screen is asleep, so the page cannot listen. Keep this window visible and the screen awake, then run again.', scenario: S };
    if (PE.running) peStop(); if (sc.running) stopScale();
    showTab('piece'); setGradeMode(S.grader, true); peSetMode('tempo'); $('pzRepeat').checked = false;
    const text = S.xml; ppLoadParsed(parseMusicXml(text), S.name || 'Test piece', 'file', text);
    if (PP.sum.length > 1) ppChoosePart(Math.min(S.part, PP.sum.length - 1));
    stSet('pzInst', S.inst);
    const last = PP.last || ppLastBar(PP.parsed.parts[PP.idx]); PP.from = Math.max(1, S.from || PP.from); PP.to = Math.min(last, S.to || PP.to);
    if (S.bpm) { $('pzBpm').value = S.bpm; }
    ppChanged();
    // keep a run to about a minute: shorten the bar range until the written music fits
    for (let guard = 0; guard < 12; guard++) { const p = ppPlan(), end = p.tl.length ? timelineEndMs(p.tl) / 1000 : 0; if (end <= S.maxSec || PP.to <= PP.from) break; PP.to = Math.max(PP.from, PP.from + Math.floor((PP.to - PP.from + 1) * S.maxSec / end) - 1); ppChanged(); }
    const plan = ppPlan(), tl = plan.tl, c = getCtx(); await c.resume(); const sr = c.sampleRate;
    if (!tl.length) return { ok: false, error: 'The piece has no notes in these bars.', scenario: S };
    log(`Rendering ${S.name || 'piece'}: ${tl.length} notes, bars ${plan.from}-${plan.to}, ${plan.bpm} BPM, ${S.inst} …`); await stSleep(30);
    const bank = S.synth ? null : await smpLoad(smpKey(S.inst)), spec = { inst: smpKey(S.inst) || S.inst, sr, tl, level: S.level, player: { vibrato: !!S.vibrato }, seed: S.seed, tonic: plan.tonic };
    if (bank) { spec.voice = smVoice(bank); spec.vibOf = smVibOf(bank); }
    const perf = psRender(spec);
    if (!listening) await startListening(); await c.resume();
    if (S.direct) { bus = c.createGain(); try { srcNode.disconnect(hpNode); } catch {} bus.connect(hpNode); }
    tap = stTapStart(bus);
    log(S.direct ? 'Direct input (no speaker) …' : 'Checking the speaker and microphone …'); await stSleep(700);
    const room = stRms(stCat(tap.chunks.slice(-3)));
    const pre = psRender({ inst: 'violin', sr, tl: [{ index: 0, midi: 69, startMs: 0, durationMs: 800 }], level: 'expert', player: { vibrato: false, scoop: 0 }, seed: 2, voice: smpBank('violin') ? smVoice(smpBank('violin')) : undefined });
    const n0 = tap.chunks.length; stPlay(c, pre.samples, sr, c.currentTime + 0.1, bus); await stSleep(1500);
    const lvl = tap.chunks.slice(n0).reduce((m, k) => Math.max(m, stRms(k)), 0);
    if (!S.direct && (lvl < room * 3 || lvl < 0.002)) return { ok: false, tooQuiet: true, error: `TOO QUIET: the microphone barely heard the speaker (room ${room.toExponential(2)}, note ${lvl.toExponential(2)}). Raise the speaker volume, move the microphone closer, and use the speaker, not headphones.`, scenario: S };
    log('Starting Piece practice …'); window.stTrace = [];
    const t1 = Date.now(); peStart();
    for (let i = 0; i < 750 && PE.clock == null && PE.running; i++) await stSleep(20);
    if (PE.clock == null) { peStop(); return { ok: false, hidden: document.hidden, error: document.hidden ? 'HIDDEN: the browser window was hidden while the test ran. Keep it visible and the screen awake, then run again.' : 'Piece practice did not start (no count-in).', scenario: S }; }
    const clock0 = PE.clock, playAt = PE.clock + t0 - perf.padS;
    if (playAt < c.currentTime + 0.05) return { ok: false, error: 'The recording was not ready in time for the count-in.', scenario: S };
    const src = stPlay(c, perf.samples, sr, playAt, bus);
    log(`Playing ${Math.round(perf.durationS)} s of music …`);
    const limit = Date.now() + (perf.durationS + (playAt - c.currentTime) + 15) * 1000, done = () => PE.lastRun && PE.lastRun.rec && PE.lastRun.rec.t >= t1;
    while (Date.now() < limit && !ST.stop && !done()) await stSleep(100);
    if (ST.stop) { try { src.stop(); } catch {} peStop(); return { ok: false, error: 'Stopped.', scenario: S }; }
    const finished = !!done(); await stSleep(600); if (!finished && PE.running) peStop();
    const beatInWavS = playAt + perf.padS - tap.t, audio = tap.stop(); tap = null;
    const minHz = S.direct ? 0 : (S.minHz || 230), slots = PE.slots.filter(s => s.pass === 1), cmp = psCompare(perf.truth, slots, tl, { minHz });
    const dropped = new Set(slots.filter(s => tooShortSkipped(s, tl[s.index] && tl[s.index].durationMs)).map(s => s.index));   // the drill leaves these out; so does the reference
    const refSlots = psTruthSlots(perf.truth, tl, { tol: peTol(), smooth: ruleFor(S.inst).smooth }).filter(x => !dropped.has(x.index)).map((x, i) => cmp.rows[i].rig ? (slots.find(q => q.index === x.index) || x) : x), beatMs = 60000 / PE.bpm;
    const opts = { beatMs, mode: 'tempo', wobbleCap: ruleFor(S.inst).wobble }, measured = finished ? peScoreRun(slots.filter(s => !dropped.has(s.index)), opts) : null, reference = peScoreRun(refSlots, opts);
    const d = cmp.detection, checks = [], chk = (ok, msg) => checks.push({ ok: !!ok, msg });
    chk(finished, finished ? 'the piece ran to the end' : 'the piece did not finish');
    // notes under 100 ms (ornaments, 64ths) cannot be told apart by a pitch tracker: the bar is on the notes of at least 100 ms, and the others are reported
    chk(d.playedLong === 0 || d.foundLong / d.playedLong >= 0.85, `found ${d.foundLong} of ${d.playedLong} notes of 100 ms or more (needs 85%); ${d.found} of ${d.played} counting the ${d.played - d.playedLong} shorter ones`);
    chk(cmp.pitch.n >= 3 && cmp.pitch.medAbs <= 6, `median pitch error ${cmp.pitch.medAbs == null ? '–' : cmp.pitch.medAbs.toFixed(1)}¢ (needs 6¢ or less)`);
    chk(d.falseWrong <= Math.max(2, Math.round(0.1 * d.played)), `${d.falseWrong} good notes wrongly called wrong notes`);
    if (measured) chk(Math.abs(measured.total - reference.total) <= 12, `score ${measured.total} against ${reference.total} for the same performance heard perfectly (needs within 12)`);
    if (cmp.rigLimited) checks.push({ ok: true, msg: `${cmp.rigLimited} notes below ${minHz} Hz are left out: a small speaker cannot play them` });
    return { ok: checks.every(x => x.ok), scenario: Object.assign({}, S, { xml: undefined }), kind: 'piece', sound: bank ? 'recordings: ' + bank.credit : 'synthetic', sr, bpm: PE.bpm, notes: tl.length, bars: [plan.from, plan.to], finished, checks, pitch: cmp.pitch, detection: d, timing: cmp.timing, rows: cmp.rows, rigLimited: cmp.rigLimited,
      grade: { measured: measured && { total: measured.total, band: measured.band, pitch: measured.pitch, fluency: measured.fluency, tone: measured.tone }, reference: { total: reference.total, band: reference.band, pitch: reference.pitch, fluency: reference.fluency, tone: reference.tone } },
      truth: perf.truth, player: perf.player, wav: stWav(audio, sr), beatInWavS, clock0, trace: (window.stTrace || []).slice(0, 7000), attempts: PE.attempts.slice(0, 400).map(a => ({ i: a.index, e: a.expected, p: a.played, g: a.grade, t: +(a.time_s || 0).toFixed(3), ms: a.timing_ms })), debug: { need: peDet.need, scNeed: det.need, listen: dlMemo.v, running: PE.running, pos: PE.pos, attempts: PE.attempts.length, slots: PE.slots.length, listening, hidden: document.hidden } };
  } catch (e) { return { ok: false, error: 'Test error: ' + (e && e.message || e), scenario: S }; }
  finally {
    if (tap) tap.stop(); if (bus) { try { bus.disconnect(); } catch {} try { srcNode.connect(hpNode); } catch {} }
    try { if (PE.running) peStop(); $('pzRepeat').checked = prevRepeat; peSetMode(prevMode); } catch {}
    stRestore(saved);
  }
}
