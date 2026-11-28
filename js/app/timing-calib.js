// Timing check at the start of a practice run: the app plays four short guitar notes through the speaker and times when it hears them through the microphone. That round trip (speaker,
// air, microphone, the audio drivers) is a delay every note the player plays also carries, and the app cannot know it any other way. It is taken out of the player's timing, so "behind
// the click" means the player is behind, not the hardware. The notes are plucked (a sharp start, so the hardware delay is not mixed up with a slow violin attack), alternate between two
// pitches of the piece (a repeated pitch would not register as a new note), and go through the SAME detector and clock the drill uses, so the number is exactly what the drill adds.
// With headphones (or a muted speaker) nothing is heard: the check is skipped and the app keeps its estimate. The result is kept for 10 minutes.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope. Called from startScale (practice-engine.js) and peStart (piece-engine.js).

const CAL = { active: false, hwMs: null, totalMs: null, at: 0, why: '', det: null, heard: [], dest: null, last: null };   // dest: where the notes go (the speaker test sends them into the app's input instead)
const CAL_KEEP_MS = 600000, CAL_BEEPS = 4, CAL_GAP_S = 0.8;
// One frame of the drill's loop while the check runs: the same attempt detector the drills use, so the time it reports is the time the drill would have reported.
function calFrame(t, f) { if (CAL.det) CAL.det.frame(t, f, a4(), frameRms, false, frameFast); }
// A plucked note with no recording to hand (not loaded, offline): a triangle with a sharp start.
function calBeepFallback(c, midi, at, dest) {
  const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = noteToFreq(midi, a4());
  g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.35, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45); o.connect(g); g.connect(dest || c.destination); o.start(at); o.stop(at + 0.5);
}
// True when a check made in the last 10 minutes can be used: the count-in then starts at once.
const calFresh = () => CAL.hwMs != null && Date.now() - CAL.at < CAL_KEEP_MS;
// seq: the MIDI notes of the scale or piece about to be played (the beeps stay inside its range so the detector listens for them). say(text, cls): where to show a message.
// Resolves to { ok, hwMs, totalMs, why, reused }. Never rejects.
async function timingCalib(seq, say, opts = {}) {
  const speak = say || (() => {});
  try {
    if (!opts.force && CAL.hwMs != null && Date.now() - CAL.at < CAL_KEEP_MS) return { ok: true, hwMs: CAL.hwMs, totalMs: CAL.totalMs, reused: true };
    const c = getCtx(); await c.resume();
    const pitches = calPitches(seq);   // two pitches that are in the music, from its higher notes
    speak('Checking the timing of this speaker and microphone: listen for four short notes (use the speaker, not headphones)…');
    await Promise.race([smpLoad('guitar'), new Promise(r => setTimeout(r, 4000))]);
    CAL.heard = []; CAL.det = new AttemptDetector(a => CAL.heard.push(a)); CAL.det.need = 3;
    const t00 = c.currentTime + 0.5, plan = [];
    for (let i = 0; i < CAL_BEEPS; i++) {
      const at = t00 + i * CAL_GAP_S, midi = pitches[i % 2];
      plan.push({ at, midi });
      if (!(smpBank('guitar') && smpPlay(c, 'guitar', midi, at, 0.4, { dest: CAL.dest }))) calBeepFallback(c, midi, at, CAL.dest);
    }
    CAL.active = true;
    await new Promise(r => setTimeout(r, (t00 - c.currentTime + CAL_BEEPS * CAL_GAP_S + 0.6) * 1000));
    CAL.active = false;
    // when the drill noticed each note: the first attempt of the right pitch after it was due
    const lags = plan.map(p => { const due = p.at - t0, a = CAL.heard.find(h => h.midi === p.midi && h.t >= due - 0.05 && h.t < due + 0.7); return a ? (a.t - due) * 1000 : null; });
    const r = latencyFromBeeps(lags, frameWinS * 1000);
    CAL.last = { lags, winMs: frameWinS * 1000, result: r };
    if (r.ok) { CAL.hwMs = r.hwMs; CAL.totalMs = r.totalMs; CAL.at = Date.now(); CAL.why = ''; speak(`Timing check done: this setup adds about ${Math.round(r.hwMs)} ms, which is taken out of your timing.`); return { ok: true, hwMs: r.hwMs, totalMs: r.totalMs }; }
    CAL.hwMs = null; CAL.why = r.why; speak(`Timing check skipped (${r.why}). With headphones the microphone cannot hear the notes; the timing then uses an estimate.`, 'warn');
    return { ok: false, why: r.why };
  } catch (e) { CAL.active = false; CAL.hwMs = null; CAL.why = String(e && e.message || e); return { ok: false, why: CAL.why }; }
}
