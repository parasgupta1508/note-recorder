// Injected by tests/mic-loopback.js into index.html (--mode app). Drives the REAL tuner with the REAL microphone:
// plays each note through the speaker on a separate audio context, reads what the tuner shows, and counts the in-tune beeps.
(async () => {
  const Q = new URLSearchParams(location.search), notes = (Q.get('notes') || '69').split(',').map(Number), post = (p, b) => fetch(p, { method: 'POST', body: b }).catch(() => {});
  const sleep = ms => new Promise(r => setTimeout(r, ms)), hzOf = m => 440 * Math.pow(2, (m - 69) / 12);
  try {
    await new Promise(r => (document.readyState === 'complete' ? r() : addEventListener('load', r))); await sleep(500);
    let beeps = 0; const realPlay = window.playTone; window.playTone = function (...a) { beeps++; return realPlay.apply(this, a); };
    showTab('tuner'); await startListening(); await sleep(2200);   // the Tuner calibrates itself on opening (1.5 s of quiet)
    const cal0 = { gate: $('gate').value, boost: $('boost').value };
    const pc = new AudioContext(), rows = []; await pc.resume();
    for (const midi of notes) {
      const re = new Float32Array(9), im = new Float32Array(9); for (let n = 1; n < 9; n++) im[n] = 1 / n;
      const o = pc.createOscillator(), g = pc.createGain(), t0 = pc.currentTime + 0.1; o.setPeriodicWave(pc.createPeriodicWave(re, im)); o.frequency.value = hzOf(midi);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.5, t0 + 0.03); g.gain.setValueAtTime(0.5, t0 + 1.55); g.gain.linearRampToValueAtTime(0, t0 + 1.6); o.connect(g); g.connect(pc.destination); o.start(t0); o.stop(t0 + 1.62);
      const b0 = beeps, seen = []; await sleep(100);
      for (let k = 0; k < 14; k++) { await sleep(100); if (!tm.idle) seen.push({ midi: tm.midi, disp: tm.disp, T: tm.T }); }
      const good = seen.filter(s => s.midi === midi), last = good.slice(-4);
      rows.push({ sample: seen.slice(0, 3).concat(seen.slice(-2)), midi, shown: seen.length, rightNote: good.length, finalDisp: last.length ? +(last.reduce((s, v) => s + v.disp, 0) / last.length).toFixed(1) : null, beeped: beeps - b0 > 0, T: seen.length ? seen[0].T : null });
      await sleep(1600);   // >1 s of silence so the tuner goes idle and re-arms its beep before the next note
    }
    await post('/api/result', JSON.stringify({ mode: 'app', rows, cal0, cal1: { gate: $('gate').value, boost: $('boost').value } }));
  } catch (e) { await post('/api/result', JSON.stringify({ error: String(e && e.stack || e) })); }
})();
