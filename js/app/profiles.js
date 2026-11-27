// Settings storage and instrument profiles.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// Settings: saved on this device, restorable to the recommended values.
const SET_IDS = ['a4', 'tol', 'gate', 'boost', 'conf', 'mindur', 'fmin', 'fmax', 'smooth', 'names', 'awake'], SET_KEY = 'tuner-settings-v1';
const SET_DEFAULTS = { a4: 440, tol: 10, gate: 0.004, boost: 1, conf: 0.85, mindur: 60, fmin: 60, fmax: 1500, smooth: 'normal', names: 'sharp', awake: '1' };
function saveSettings() { const o = {}; SET_IDS.forEach(id => o[id] = $(id).value); try { localStorage.setItem(SET_KEY, JSON.stringify(o)); } catch {} }
function applySettings(o) {
  SET_IDS.forEach(id => { if (o[id] != null) $(id).value = o[id]; });
  $('boostVal').textContent = $('boost').value + '×'; $('confVal').textContent = (+$('conf').value).toFixed(2);
  if (boostNode) boostNode.gain.value = +$('boost').value;
  updateGateMark(); applyTol(); resetTuner(); renderScale(); syncQuick(); syncNames(); renderSet();
}
SET_IDS.forEach(id => $(id).addEventListener('input', saveSettings));
$('conf').addEventListener('input', () => { $('confVal').textContent = (+$('conf').value).toFixed(2); });
function syncNames() { useFlats = $('names').value === 'flat'; buildInstChips(); buildStrChips(shownActive); renderScale(); drawTMeter(); }
$('names').addEventListener('change', () => { syncNames(); saveSettings(); });
const DET = { sens: [0.8, 40, 'Shows notes quickly, even soft or rough ones. Best in a quiet room; an occasional wrong note is possible.'], bal: [0.85, 60, 'Recommended. A good mix of speed and reliability for most instruments and rooms.'], strict: [0.9, 100, 'Shows only clear, steady notes. Best in a noisy room or with a weak microphone; reacts a little later.'] };
let detCustom = false, detSaved = null; try { detSaved = JSON.parse(localStorage.getItem('tuner-detcustom')); } catch {}   // Custom = whatever values are not one of the three presets
function syncQuick() {
  document.querySelectorAll('.qk[data-for]').forEach(q => q.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === +$(q.dataset.for).value)));
  document.querySelectorAll('#rangeQ button').forEach(b => b.classList.toggle('on', b.dataset.r === $('fmin').value + ',' + $('fmax').value));
  let hit = null; for (const k in DET) if (Math.abs(DET[k][0] - +$('conf').value) < 0.005 && DET[k][1] === +$('mindur').value) hit = k;
  if (!hit) { detSaved = { conf: +$('conf').value, mindur: +$('mindur').value }; try { localStorage.setItem('tuner-detcustom', JSON.stringify(detSaved)); } catch {} }
  const on = hit && !detCustom ? hit : 'custom';
  document.querySelectorAll('#detSeg button').forEach(b => b.classList.toggle('on', b.dataset.d === on));
  $('detHint').textContent = on === 'custom' ? 'Your own values, set with the controls below. Changing any preset value brings you here.' : DET[hit][2];
}
document.querySelectorAll('.qk[data-for] button').forEach(b => b.onclick = () => { const i = $(b.parentNode.dataset.for); i.value = b.dataset.v; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); syncQuick(); });
document.querySelectorAll('#rangeQ button').forEach(b => b.onclick = () => { const [a, c] = b.dataset.r.split(','); $('fmin').value = a; $('fmax').value = c; $('fmin').dispatchEvent(new Event('input')); $('fmax').dispatchEvent(new Event('input')); applyLimits(); syncQuick(); });
function setDet(c, m) { $('conf').value = c; $('mindur').value = m; $('conf').dispatchEvent(new Event('input')); $('mindur').dispatchEvent(new Event('input')); }
document.querySelectorAll('#detSeg button').forEach(b => b.onclick = () => {
  if (b.dataset.d === 'custom') { if (detSaved) setDet(detSaved.conf, detSaved.mindur); detCustom = true; }   // back to the values you last set yourself
  else { const d = DET[b.dataset.d]; setDet(d[0], d[1]); detCustom = false; }
  syncQuick();
});
['conf', 'mindur'].forEach(id => $(id).addEventListener('input', () => { detCustom = false; }));
['a4', 'tol', 'conf', 'mindur', 'fmin', 'fmax'].forEach(id => $(id).addEventListener('input', syncQuick));
syncQuick();

// ----- instrument profile: one choice sets the tuner, practice, recorder and pitch range together -----
const INST_PROFILES = [
  { k: 'all',      name: 'All',      fam: null,        range: [60, 1500], rec: 'auto' },
  { k: 'guitar',   name: 'Guitar',   fam: 'guitar',    range: [70, 1500], rec: 'auto' },
  { k: 'bass',     name: 'Bass',     fam: 'bass',      range: [30, 400],  rec: 'auto' },
  { k: 'violin',   name: 'Violin',   fam: 'violin',    range: [180, 3300], rec: 'auto' },
  { k: 'viola',    name: 'Viola',    fam: 'viola',     range: [120, 1500], rec: 'auto' },
  { k: 'cello',    name: 'Cello',    fam: 'cello',     range: [55, 1200], rec: 'auto' },
  { k: 'ukulele',  name: 'Ukulele',  fam: 'ukulele',   range: [140, 1400], rec: 'auto' },
  { k: 'mandolin', name: 'Mandolin', fam: 'mandolin',  range: [180, 1800], rec: 'auto' },
  { k: 'piano',    name: 'Piano',    fam: null,        range: [27, 4200], rec: 'auto' },
  { k: 'voice',    name: 'Voice',    fam: null,        range: [80, 1100], rec: 'auto' },
];
const PROF_KEY = 'tuner-instprofile';
let prof = { k: 'all', t: 'chromatic' }; try { const o = JSON.parse(localStorage.getItem(PROF_KEY)); if (o && INST_PROFILES.some(p => p.k === o.k)) prof = o; } catch {}
const profOf = k => INST_PROFILES.find(p => p.k === k) || INST_PROFILES[0];
const profFam = p => FAMILIES.find(f => f[0] === p.fam) || FAMILIES[0];
function applyProfile(k, tuning) {
  const p = profOf(k), fam = p.fam ? profFam(p) : null, key = fam ? (fam[2].includes(tuning) ? tuning : fam[2][0]) : 'chromatic';
  prof = { k: p.k, t: key }; try { localStorage.setItem(PROF_KEY, JSON.stringify(prof)); } catch {}
  inst = key; resetTuner(); buildInstChips();                                   // Tuner: instrument and tuning
  $('scInst').value = practiceInstrument(key); $('scInst').dispatchEvent(new Event('change'));       // Practice: same instrument
  $('fmin').value = p.range[0]; $('fmax').value = p.range[1];                    // pitch range for Recorder and Practice
  $('fmin').dispatchEvent(new Event('input')); $('fmax').dispatchEvent(new Event('input')); applyLimits();
  $('recMode').value = p.rec; $('recMode').dispatchEvent(new Event('change'));   // Recorder listening mode
  syncProf(); renderSet();
}
function syncProf() {
  const p = profOf(prof.k), fam = (profFam(p) || FAMILIES[0])[0], cur = (FAMILIES.find(f => f[2].includes(inst)) || FAMILIES[0])[0];
  const live = fam === cur;                                                      // the Tuner was switched by hand to another instrument → no profile is "on"
  $('profChips').innerHTML = INST_PROFILES.map(x => `<button data-k="${x.k}" class="${live && x.k === p.k ? 'on' : ''}">${x.name === 'All' ? 'All instruments' : x.name}</button>`).join('');
  const f = p.fam ? profFam(p) : null, sel = $('profTuning');
  $('profTuningWrap').classList.toggle('hide', !f || f[2].length < 2);
  if (f) { sel.innerHTML = f[2].map(k => `<option value="${k}">${PRESETS[k].label.replace(/^[^–(]*[–(]\s*/, '').replace(/\)$/, '') + '  ·  ' + PRESETS[k].strings.map(n => nm(n.replace(/\d+/, ''))).join(' ')}</option>`).join(''); sel.value = inst; }
  $('profHint').textContent = live ? `${p.name === 'All' ? 'All instruments' : p.name}: pitch range ${p.range[0]}–${p.range[1]} Hz · Recorder listening “${REC_NAMES[p.rec]}”${p.fam ? ' · Practice and Tuner use this instrument' : ' · chromatic Tuner and Practice'}. You can still change any setting individually.` : 'Tuner instrument was changed by hand. Pick an instrument above to set everything to match.';
}
function profName() { const p = profOf(prof.k), cur = (FAMILIES.find(f => f[2].includes(inst)) || FAMILIES[0])[0]; return (profFam(p)[0] === cur) ? (p.k === 'all' ? 'All instruments' : p.name) : 'Custom'; }
$('profChips').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) applyProfile(b.dataset.k); });
$('profTuning').onchange = () => applyProfile(prof.k, $('profTuning').value);
profReady = true;
if (prof.k !== 'all') { inst = FAMILIES.some(f => f[2].includes(prof.t)) ? prof.t : 'chromatic'; resetTuner(); buildInstChips(); }   // remember the instrument between visits
syncProf(); renderSet();
$('defaults').onclick = () => { applySettings(SET_DEFAULTS); applyProfile('all'); saveSettings(); calMsg('Defaults restored.'); $('calibOut').classList.add('hide'); };
let gateOn = false, trkF = 0, trkT = -9, hpCut = 70, recTickT = -1, pracTickT = -1, frameCl = null, frameT = 0, frameRms = 0;   // frameCl / frameT: clarity and time of the frame just analysed (the drills store them with each note)
function loop() {
  rafId = requestAnimationFrame(loop);
  analyser.getFloatTimeDomainData(buf);
  const t = ctx.currentTime - t0;
  let rms = 0, pk = 0; for (let i = 0; i < buf.length; i++) { rms += buf[i] * buf[i]; const a = Math.abs(buf[i]); if (a > pk) pk = a; } rms = Math.sqrt(rms / buf.length);
  updateLevel(rms, pk); calibFrame(rms, pk);
  let f = null, fR = null, rA = null; frameCl = null; frameT = t; frameRms = rms;
  const G = +$('gate').value;
  gateOn = rms > G || (gateOn && rms > G * 0.6);   // hysteresis: a fading note does not chatter the gate
  // Sustain tracking: once the tuner has a note, a decaying string keeps reading (down to about -14 dB under the gate)
  // as long as it stays within 45 cents of that note. A new note still has to pass the normal gate and confidence.
  const track = (tab === 'tuner' || sc.running) && !recording && trkF > 0 && t - trkT < 0.4;   // same for the tuner and for Practice
  if (gateOn || (track && rms > G * 0.2)) {
    let lo = +$('fmin').value, hi = +$('fmax').value;
    if (tab === 'tuner' && !recording && !sc.running) {          // the tuner only needs the instrument's own range: fewer octave errors, less CPU
      const S = strMidis(); if (S.length) {
        const A = a4(), one = lock != null && S[lock] != null;
        lo = noteToFreq((one ? S[lock] : Math.min(...S)) - (one ? 5 : 4), A); hi = noteToFreq((one ? S[lock] : Math.max(...S)) + (one ? 5 : 4), A);
      }
    }
    if (sc.running && !recording && tab !== 'tuner' && sc.seq.length) {   // Practice knows its scale: search only around it (plus room for wrong notes)
      lo = Math.max(25, noteToFreq(Math.min(...sc.seq) - 5, a4())); hi = noteToFreq(Math.max(...sc.seq) + 5, a4());
    }
    if (tab === 'piece' && typeof peFreqRange === 'function') { const R = peFreqRange(); if (R) { lo = R[0]; hi = R[1]; } }   // Piece practice knows its notes: search only around them
    const hp = lo < 50 ? Math.max(20, lo * 0.7) : 70;   // only low instruments (bass) need a lower cut-off
    if (Math.abs(hp - hpCut) > 3) { hpCut = hp; hpNode.frequency.value = hp; }
    const cut = Math.min(6000, Math.max(1000, hi * 3));
    if (lpA && Math.abs(cut - lpCut) > lpCut * 0.1) { lpCut = cut; lpA.frequency.value = lpB.frequency.value = cut; }
    const rm = recording ? recModeCfg() : null, yb = rm && rm.win && lo >= 80 ? buf.subarray(buf.length - rm.win) : buf;   // fast mode: only the newest 2048 samples, so a quick note change is not smeared
    const r = f0Engine().frame(yb, ctx.sampleRate, lo, hi), conf = +$('conf').value;
    const near = r && track && Math.abs(centsBetween(r.freq, trkF)) < 45;
    if (r && (gateOn ? r.clarity > conf : near && r.clarity > 0.5) || (near && r.clarity > 0.5)) { f = r.freq; frameCl = r.clarity; }
    if (recording && gateOn) { fR = recPitch(r, rms, pk, conf); rA = r; }   // the recorder is stricter than the tuner: fewer wrong notes from noise
  }
  if (f) { trkF = f; trkT = t; }
  // The recorder's timing rules count frames and assume 60 per second, so a 120 Hz screen must not feed it twice as fast.
  // Frames are stamped at the middle of the audio they analysed (not the end), which is where the sound really is on the replay timeline.
  if (recording && t - recTickT >= 0.0155) {
    recTickT = t; if ($('recMode').value === 'auto') { autoM.frame(rms, gateOn ? rA : null); autoUi(); }
    const m = recModeCfg(); seg.a4 = a4(); seg.minDur = m.own ? m.minDur : Math.max(+$('mindur').value, m.minDur); seg.confirm = m.confirm; seg.maxMiss = m.miss || 5; seg.gap = m.gap || 0;
    seg.frame(t - (m.win && +$('fmin').value >= 80 ? m.win : buf.length) / 2 / ctx.sampleRate, fR, rms);
  }
  liveFrame(f, gateOn);
  if (tab === 'tuner') tunerFrame(t, f);
  // The drills count frames (6 for a note, 8 of quiet, the hold and smoothing windows), so they run at one rate, about 60 a second, whatever the screen's refresh rate:
  // on a 120 Hz screen every one of those windows would otherwise be half as long and the same playing would be graded differently.
  if (t - pracTickT >= 0.012) {
    pracTickT = t;
    if (demoIdx < 0) collectHold(f);                   // keep scoring the note that is still sounding
    if (sc.running && demoIdx < 0) { det.frame(t, f, a4(), frameRms, false); liveScaleFrame(f, t); }   // a scale never repeats a note, so a dip in level is never a new note here
    if (tab === 'piece' && typeof pieceFrame === 'function') pieceFrame(f, t);   // Piece practice has its own engine
  }
  if (tab === 'rec' && recording) { drawRoll(); recUi(); }
}

