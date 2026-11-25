// Microphone engine, calibration, steadiness check.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// ----- audio engine -----
// Keep the screen on while listening (phones otherwise dim/lock, which suspends the mic). Silently skipped if unsupported.
let wakeLock = null;
async function keepAwake() { try { if ($('awake').value === '1' && navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.onrelease = () => { wakeLock = null; }; } } catch {} }
function releaseAwake() { try { if (wakeLock) wakeLock.release(); } catch {} wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && listening) keepAwake(); else if (document.visibilityState === 'hidden' && listening && !recording) stopListening(); });   // a backgrounded app lets go of the microphone (not while recording)
let starting = false;
async function startListening() {
  if (listening || starting) return;
  starting = true;
  try { await openMic(); } finally { starting = false; }
}
async function openMic() {
  const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, dev = $('micDev').value;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: dev ? { ...base, deviceId: { exact: dev } } : base }); }
  catch (e) { if (!dev) throw e; stream = await navigator.mediaDevices.getUserMedia({ audio: base }); }   // saved device unplugged: fall back to default
  const c = getCtx(); if (c.state === 'suspended') await c.resume();
  srcNode = c.createMediaStreamSource(stream);
  hpNode = c.createBiquadFilter(); hpNode.type = 'highpass'; hpNode.frequency.value = 70;
  analyser = c.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0;
  boostNode = c.createGain(); boostNode.gain.value = +$('boost').value;   // input boost for quiet mics (AGC is off)
  lpA = c.createBiquadFilter(); lpB = c.createBiquadFilter(); lpA.type = lpB.type = 'lowpass'; lpA.Q.value = 0.5412; lpB.Q.value = 1.3066;   // 4th-order Butterworth: removes high harmonics and hiss that cause octave errors
  lpA.frequency.value = lpB.frequency.value = 6000; lpCut = 6000;
  srcNode.connect(hpNode); hpNode.connect(boostNode); boostNode.connect(lpA); lpA.connect(lpB); lpB.connect(analyser);
  // tap the (boosted) mic signal so a recording can be replayed as real sound
  cap.k = 1; cap.rate = c.sampleRate;
  capNode = c.createScriptProcessor(4096, 1, 1); capSink = c.createGain(); capSink.gain.value = 0;
  capNode.onaudioprocess = ev => { if (recording) capPush(ev.inputBuffer.getChannelData(0)); };
  boostNode.connect(capNode); capNode.connect(capSink); capSink.connect(c.destination);
  buf = new Float32Array(analyser.fftSize); t0 = c.currentTime; listening = true; keepAwake();
  showMicProc(); listMics(); audioInfo(); micChipUi(); $('rec').disabled = detBusy; $('status').textContent = '';
  loop();
}
// The mic chip in the header: shows whether the microphone is on, and is the one place to switch it on or off by hand.
function micChipUi() {
  const b = $('micChip'); b.classList.toggle('on', listening); b.setAttribute('aria-pressed', listening ? 'true' : 'false');
  b.setAttribute('aria-label', listening ? 'Microphone is on. Tap to turn it off.' : 'Microphone is off. Tap to turn it on.'); $('micTxt').textContent = listening ? 'Mic on' : 'Mic off';
}
// Every screen's own start button calls this; it never throws.
function ensureMic() { return listening ? Promise.resolve() : startListening().catch(e => { $('status').textContent = 'Mic error: ' + e.message; }); }
function stopListening() {
  listening = false; calib = null; $('calib').disabled = false; releaseAwake(); cancelAnimationFrame(rafId); finalizeHold(); seg.end(); setRecording(false);
  stream.getTracks().forEach(t => t.stop()); srcNode.disconnect(); hpNode.disconnect(); boostNode.disconnect(); analyser = null;
  if (capNode) { capNode.onaudioprocess = null; capNode.disconnect(); capSink.disconnect(); capNode = capSink = null; }
  recUi();
  $('lvlBar').style.width = '0'; $('lvlDb').textContent = '–';
  sc.running = false; $('scStart').textContent = 'Start practice'; liveBuf = [];
  micChipUi(); $('rec').disabled = detBusy; $('status').textContent = '';
  hist.length = 0; lastVoiced = -9; tunerIdle(); renderScale();
}
let boostNode = null, lpA = null, lpB = null, lpCut = 6000;
const dbPos = r => Math.max(0, Math.min(100, (20 * Math.log10(Math.max(r, 1e-6)) + 60) / 60 * 100));   // −60…0 dBFS → 0…100 %
function updateGateMark() { $('lvlGate').style.left = dbPos(+$('gate').value) + '%'; }
function updateLevel(rms, pk = 0) {
  const open = rms > +$('gate').value, clip = pk >= 0.98;
  $('lvlBar').style.width = dbPos(rms) + '%'; $('lvlBar').style.background = clip ? 'var(--bad)' : open ? 'var(--ok)' : 'var(--mut)';
  $('lvlDb').textContent = clip ? 'CLIPPING' : (20 * Math.log10(Math.max(rms, 1e-6))).toFixed(0) + ' dB'; $('lvlDb').style.color = clip ? 'var(--bad)' : '';
}
$('gate').oninput = updateGateMark;
$('boost').oninput = () => { $('boostVal').textContent = $('boost').value + '×'; if (boostNode) boostNode.gain.value = +$('boost').value; };
updateGateMark();
// What the browser really applied (some browsers ignore the "off" request): shown in Settings.
function showMicProc() {
  try {
    const st = stream.getAudioTracks()[0].getSettings(), on = ['echoCancellation', 'noiseSuppression', 'autoGainControl'].filter(k => st[k] === true);
    $('micProc').innerHTML = on.length ? `<span class="warn-t">Browser left ${on.join(', ')} switched on — it can disturb pitch readings. Try Chrome, or play a little louder/closer.</span>` : '<span class="ok-t">Mic processing is off (echo cancellation, noise suppression, auto-gain) — good for tuning.</span>';
  } catch { $('micProc').textContent = 'Mic processing: could not be read on this browser.'; }
}
const MIC_KEY = 'tuner-mic-dev';
async function listMics() {
  try {
    const sel = $('micDev'), want = sel.value || localStorage.getItem(MIC_KEY) || '', d = (await navigator.mediaDevices.enumerateDevices()).filter(x => x.kind === 'audioinput' && x.deviceId);
    sel.innerHTML = '<option value="">Default microphone</option>' + d.map((x, i) => `<option value="${x.deviceId}">${(x.label || 'Microphone ' + (i + 1)).replace(/[<&]/g, '')}</option>`).join('');
    if ([...sel.options].some(o => o.value === want)) sel.value = want;
  } catch {}
}
$('micDev').onchange = () => { try { localStorage.setItem(MIC_KEY, $('micDev').value); } catch {} if (listening) { stopListening(); startListening(); } };
try { navigator.mediaDevices.addEventListener('devicechange', listMics); } catch {}
function audioInfo() { const sr = ctx.sampleRate; $('audioInfo').textContent = `Audio: ${sr} Hz · ${(4096 / sr * 1000).toFixed(0)} ms analysis window · lowest note ≈ ${Math.ceil(sr / 2047)} Hz`; }
// Noise-floor calibration: listen ~2 s of silence, put the gate just above the ambient level.
let calib = null, calRes = {};
const calMsg = t => { $('calibMsg').textContent = t; };
function startCalib(phase) {
  calib = { phase, vals: [], pk: 0, end: performance.now() + (phase === 1 ? 3000 : 4000) }; $('calib').disabled = true;
  calMsg(phase === 1 ? 'Step 1 of 2: stay quiet for 3 seconds…' : 'Step 2 of 2: play one steady note at normal volume for 4 seconds…');
}
// Runs by itself whenever the Tuner is opened: 1.5 s of room noise sets the gate, then the first note you play sets the input boost.
function startAutoCalib() {
  if (calib || !listening || recording) return;
  calib = { phase: 1, auto: true, vals: [], pk: 0, end: performance.now() + 1500 }; $('status').textContent = 'Calibrating… stay quiet for a moment';
}
$('calib').onclick = () => { if (!listening) { calMsg('Tap the Mic button at the top to turn the microphone on first.'); return; } $('calibOut').classList.add('hide'); startCalib(1); };
function calibFrame(rms, pk = 0) {
  if (!calib) return;
  calib.vals.push(rms); calib.pk = Math.max(calib.pk, pk);
  if (calib.auto && calib.phase === 2) {   // automatic run: finish as soon as about half a second of clear playing has been heard
    const n = calib.vals.reduce((s, x) => s + (x > calRes.noise * 2 ? 1 : 0), 0); if (n < 30 && performance.now() < calib.end) return;
  } else if (performance.now() < calib.end) return;
  const v = calib.vals.sort((x, y) => x - y), q = p => v[Math.min(v.length - 1, Math.floor(v.length * p))] || 0, db = x => 20 * Math.log10(Math.max(x, 1e-6));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  if (calib.phase === 1) {
    // Auto run: the player may already be playing, so the noise level is taken from the median (a note over part of the window cannot raise it much).
    const auto = calib.auto, p95 = auto ? Math.min(q(0.95), q(0.5) * 3) : q(0.95); calRes = { noise: p95, boost: +$('boost').value };
    const g = clamp(Math.round(Math.max(p95 * 2.5, q(0.5) * 4) * 1000) / 1000, 0.002, 0.1); $('gate').value = g; updateGateMark(); saveSettings();
    if (auto) { calib = { phase: 2, auto: true, vals: [], pk: 0, end: performance.now() + 15000 }; $('status').textContent = `Room noise ${db(p95).toFixed(0)} dB · play a note to finish calibrating`; return; }
    calib = null; calMsg(`Room noise ${db(p95).toFixed(0)} dB. Get ready…`); setTimeout(() => { if (listening) startCalib(2); else $('calib').disabled = false; }, 1200); return;
  }
  const noise = calRes.noise, sig = v.filter(x => x > noise * 2), clip = calib.pk >= 0.98, wasAuto = calib.auto; calib = null; $('calib').disabled = false;
  if (wasAuto) $('status').textContent = '';
  if (wasAuto && sig.length < 10) return;   // nobody played within 15 s: keep the gate from the quiet step, say nothing
  if (sig.length < 10) { calMsg('No clear sound heard. Check the microphone, play louder or closer, then try again.'); return; }
  const p90 = sig[Math.min(sig.length - 1, Math.floor(sig.length * 0.9))], b = calRes.boost;
  const nb = clip ? Math.max(1, Math.round(b * 0.6 * 2) / 2) : clamp(Math.round(b * 0.08 / p90 * 2) / 2, 1, 8);   // aim for a played level of about −22 dB
  const ratio = nb / b; $('boost').value = nb; $('boostVal').textContent = nb + '×'; if (boostNode) boostNode.gain.value = nb;
  $('gate').value = clamp(Math.round(+$('gate').value * ratio * 1000) / 1000, 0.002, 0.1); updateGateMark(); saveSettings();
  const snr = db(p90) - db(noise), rate = snr >= 30 ? ['Excellent', 'ok'] : snr >= 20 ? ['Good', 'ok'] : snr >= 12 ? ['Fair', 'warn'] : ['Poor', 'bad'];
  const nDb = db(noise * ratio), noisy = nDb > -40;
  $('calibOut').innerHTML = `<div class="${noisy ? 'warn' : ''}">Room noise<b>${nDb.toFixed(0)} dB</b></div><div>Your playing<b>${db(p90 * ratio).toFixed(0)} dB</b></div><div class="${rate[1]}">Signal-to-noise<b>${snr.toFixed(0)} dB · ${rate[0]}</b></div><div>Boost / gate<b>${nb}× / ${(+$('gate').value).toFixed(3)}</b></div>`;
  $('calibOut').classList.remove('hide');
  calMsg(clip ? 'Your sound was clipping: input lowered. Move the microphone a little further away and run it again.' : noisy ? 'The room is noisy. Move somewhere quieter or closer to the instrument for best accuracy.' : snr < 20 ? 'Move the microphone closer to the instrument, or play a little louder.' : 'Calibrated. You are ready to tune.');
}
// Live check: how steady is the pitch your microphone really hears?
let lc = null;
$('livetest').onclick = () => {
  if (!listening) { $('lcMsg').textContent = 'Tap the Mic button at the top to turn the microphone on first.'; return; }
  lc = { end: performance.now() + 4000, fs: [], n: 0 }; $('livetest').disabled = true; $('lcOut').classList.add('hide'); $('lcMsg').textContent = 'Listening… play one steady note.';
};
function liveFrame(f, open) {
  if (!lc) return;
  if (open) { lc.n++; if (f) lc.fs.push(f); }
  if (performance.now() < lc.end) return;
  const L = lc; lc = null; $('livetest').disabled = false;
  if (L.n < 20 || L.fs.length < 12) { $('lcMsg').textContent = 'Not enough sound heard. Play louder or closer (or lower the noise gate) and try again.'; return; }
  const med = median(L.fs), n0 = freqToNote(med, a4()), ref = noteToFreq(n0.midi, a4());
  const cs = L.fs.map(f => centsBetween(f, ref)), mean0 = cs.reduce((a, b) => a + b, 0) / cs.length;
  const good = cs.filter(c => Math.abs(c - mean0) < 100), jumps = cs.length - good.length;
  const mean = good.reduce((a, b) => a + b, 0) / good.length, sd = Math.sqrt(good.reduce((a, b) => a + (b - mean) ** 2, 0) / good.length), det = L.fs.length / L.n * 100;
  const st = sd <= 2 ? ['Very steady', 'ok'] : sd <= 4 ? ['Steady', 'ok'] : sd <= 8 ? ['Slightly unsteady', 'warn'] : ['Unsteady', 'bad'];
  $('lcOut').innerHTML = `<div>Note<b>${nm(n0.name)}</b></div><div>Tuning<b>${mean >= 0 ? '+' : '−'}${Math.abs(mean).toFixed(1)}¢</b></div><div class="${st[1]}">Steadiness<b>±${sd.toFixed(1)}¢ · ${st[0]}</b></div><div class="${det >= 90 ? 'ok' : det >= 70 ? 'warn' : 'bad'}">Detected<b>${det.toFixed(0)}%</b></div><div class="${jumps ? 'warn' : 'ok'}">Glitches<b>${jumps}</b></div>`;
  $('lcOut').classList.remove('hide');
  $('lcMsg').textContent = sd > 8 ? 'Unsteady readings: try Strict detection, a quieter room, or a steadier note (vibrato counts as movement).' : jumps > 2 ? 'A few octave glitches: set the pitch range to your instrument.' : det < 70 ? 'The note was often missed: raise the boost or move closer.' : 'Tuning is your instrument against the reference pitch; steadiness is the measurement noise. Under ±3¢ is excellent.';
};
