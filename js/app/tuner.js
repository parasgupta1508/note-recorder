// Tuner tab: needle, smoothing, string targets.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// ----- TUNER -----
let inst = 'chromatic'; const tuned = new Set(); var profReady = false;
const HN = () => ({ fast: 3, normal: 7, calm: 11 }[$('smooth').value] || 7), hist = []; let pend = null, lastVoiced = -9, inTuneSince = null, confirmed = false, shownActive = -2;
const strMidis = () => PRESETS[inst].strings.map(nameToMidi);

function resetTuner() {
  tuned.clear(); hist.length = 0; pend = null; lastVoiced = -9; inTuneSince = null; confirmed = false; shownActive = -2; offSince = null; lock = null; updateAuto();
  trail.length = 0; tTgMidi = null; tm = { idle: true };
  $('tHint').textContent = ''; $('tAdvice').textContent = ''; buildStrChips(-1);
}
// The Tuner offers the instruments this app is for. Piano has no strings, so its chip is the chromatic tuner; the Chromatic switch lets a string player see every note too.
const TUNER_CHIPS = ['violin', 'guitar', 'ukulele', 'chromatic'];
let preChrom = null;   // the instrument to go back to when Chromatic is switched off
$('chromBtn').onclick = () => { if (inst === 'chromatic') { inst = preChrom || 'violin'; preChrom = null; } else { preChrom = inst; inst = 'chromatic'; } resetTuner(); buildInstChips(); };
function buildInstChips() {
  const fam = FAMILIES.find(f => f[2].includes(inst)) || FAMILIES[0];
  $('instChips').innerHTML = '';
  for (const f of TUNER_CHIPS.map(k => FAMILIES.find(x => x[0] === k))) {
    const b = document.createElement('button'); b.className = 'chip' + (f === fam ? ' on' : ''); b.textContent = f[0] === 'chromatic' ? 'Piano' : f[1]; b.setAttribute('aria-pressed', f === fam ? 'true' : 'false');
    b.onclick = () => { if (f === fam) return; preChrom = null; inst = f[2][0]; resetTuner(); buildInstChips(); };
    $('instChips').appendChild(b);
  }
  const chrom = inst === 'chromatic'; $('chromBtn').textContent = 'Chromatic: ' + (chrom ? 'on' : 'off'); $('chromBtn').setAttribute('aria-pressed', chrom ? 'true' : 'false'); $('chromBtn').classList.toggle('on', chrom);
  const sel = $('tuningSel'); sel.classList.toggle('hide', fam[2].length < 2);
  sel.innerHTML = fam[2].map(k => '<option value="' + k + '">' + PRESETS[k].label.replace(/^[^–(]*[–(]\s*/, '').replace(/\)$/, '') + '  ·  ' + PRESETS[k].strings.map(n => nm(n.replace(/\d+/, ''))).join(' ') + '</option>').join('');
  sel.value = inst;
  if (profReady) syncProf();
}
$('tuningSel').onchange = () => { inst = $('tuningSel').value; resetTuner(); buildInstChips(); };
let lock = null;                                       // null = Auto (detect the string), number = locked to that string
function updateAuto() { $('autoBtn').classList.toggle('on', lock == null); }
function buildStrChips(activeIdx = -1) {
  const box = $('strChips'), S = PRESETS[inst].strings; box.innerHTML = '';
  $('strRow').classList.toggle('hide', !S.length);
  S.forEach((n, i) => {
    const b = document.createElement('button');
    b.className = 'sp' + (i === activeIdx ? ' on' : '') + (tuned.has(i) ? ' done' : '') + (lock === i ? ' lock' : '');
    b.innerHTML = `<b>${nm(n.replace(/\d+/, ''))}</b><small>${n.match(/\d+/)[0]}</small>`;
    b.title = 'Hear ' + n + ' and tune to this string';
    b.onclick = () => { lock = i; updateAuto(); shownActive = -2; pend = null; buildStrChips(i); playTone(noteToFreq(nameToMidi(n), a4()), 1.4); };
    box.appendChild(b);
  });
}
$('autoBtn').onclick = () => { lock = null; pend = null; updateAuto(); shownActive = -2; buildStrChips(-1); };
// Pitch history + smoothing: the raw reading jumps around too fast to follow, so the needle is smoothed,
// a band shows how far it is wobbling, and a 3-second trail shows which way it is drifting.
const trail = [], TRAIL_S = 3, SC = { ok: '#34d399', warn: '#fbbf24', bad: '#fb7185' };
let nPos = 0, nVel = 0, tDisp = 0, tLastT = 0, tTgMidi = null, tShown = 0, offSince = null, tm = { idle: true };
const tState = c => { const a = Math.abs(c); return a <= tol() ? 'ok' : a <= 25 ? 'warn' : 'bad'; };
const tcv = $('tMeter'), tg2 = tcv.getContext('2d');

function tunerIdle() {
  const was = tm.idle;
  $('tNote').innerHTML = '–'; $('tTarget').textContent = ''; $('tHeard').textContent = ''; $('tHint').textContent = '';
  $('tVerdict').textContent = ''; $('tAdvice').textContent = ''; $('tAdvice').className = 'advice';
  trail.length = 0; tTgMidi = null; tm = { idle: true };
  if (shownActive !== -1) { shownActive = -1; buildStrChips(-1); }
  if (!was) drawTMeter();
}
function tunerFrame(t, f) {
  // Outlier guard: a single reading far from the recent median (octave jump, pluck click) is held back
  // until the next frame agrees with it, so the needle never lurches on one bad frame.
  if (f) {
    if (t - lastVoiced > 0.25) { hist.length = 0; pend = null; }
    if (hist.length >= 3 && Math.abs(centsBetween(f, median(hist))) > 120) {
      if (pend && Math.abs(centsBetween(f, pend)) < 40) { hist.length = 0; hist.push(pend, f); pend = null; lastVoiced = t; }
      else { pend = f; f = null; }
    } else { pend = null; hist.push(f); while (hist.length > HN()) hist.shift(); lastVoiced = t; }
  }
  if (!hist.length || t - lastVoiced > 1.0) { tunerIdle(); inTuneSince = null; confirmed = false; offSince = null; return; }
  const fm = median(hist), A = a4(), T = tol();   // median of the last 7 good readings
  const tg = pickTarget(fm, A, strMidis(), lock);
  const c = tg.cents, tn = midiName(tg.midi), m = tn.match(/^([A-G][#♭]?)(-?\d+)$/);
  if (tg.midi !== tTgMidi) { tTgMidi = tg.midi; trail.length = 0; tDisp = c; tLastT = t; tShown = 0; nPos = c; nVel = 0; }
  const dt = Math.max(0, Math.min(0.2, t - tLastT)); tLastT = t;
  tDisp += (c - tDisp) * (1 - Math.exp(-dt / (Math.abs(c - tDisp) > 25 ? 0.03 : 0.09)));   // quick on big moves, calm when close
  { const s = Math.min(dt, 0.05); nVel += (120 * (c - nPos) - 18.6 * nVel) * s; nPos += nVel * s; }   // analog-style needle: heavy, springy, calm
  if (f) trail.push({ t, c }); while (trail.length && t - trail[0].t > TRAIL_S) trail.shift();
  const a = Math.abs(tDisp), st = tState(tDisp);
  tm = { idle: false, t, hz: fm, midi: tg.midi, disp: tDisp, needle: nPos, state: st, lo: nm(midiName(tg.midi - 1)), hi: nm(midiName(tg.midi + 1)), letter: nm(m[1]), oct: m[2], T, confirmed: confirmed && a <= T };
  if (t - tShown > 0.12) {                               // numbers update ~8×/s so they are readable
    tShown = t;
    const stringy = inst !== 'chromatic';
    $('tHint').textContent = tg.idx >= 0 ? `String ${tg.idx + 1} · ${nm(tn)}` : '';
    $('tNote').innerHTML = `${m[1]}<small>${m[2]}</small>`;
    $('tTarget').textContent = `${fm.toFixed(1)} Hz  ·  target ${tg.hz.toFixed(1)} Hz`;
    $('tHeard').textContent = '';
    $('tVerdict').textContent = (a <= T ? 'In tune' : tDisp > 0 ? 'Sharp ♯' : 'Flat ♭') + `  ${tDisp >= 0 ? '+' : '−'}${a.toFixed(0)}¢`;
    $('tVerdict').className = 'verdict ' + st + '-t';
    $('tAdvice').textContent = a <= T ? '' : a > 60 ? 'Not close to this note' : tDisp < 0 ? 'Tune up' : 'Tune down';
    $('tAdvice').className = 'advice';
  }
  drawTMeter();
  if (tg.idx !== shownActive) { shownActive = tg.idx; buildStrChips(tg.idx); }

  if (a <= T) {
    offSince = null;
    if (inTuneSince == null) inTuneSince = t;
    if (!confirmed && t - inTuneSince >= 0.5) {   // held in tune for half a second
      confirmed = true;
      if (tg.idx >= 0 && !tuned.has(tg.idx)) { tuned.add(tg.idx); buildStrChips(tg.idx); }
      $('tNote').classList.remove('pulse'); void $('tNote').offsetWidth; $('tNote').classList.add('pulse');
      playTone(1318, 0.12, 'sine', 0.12);
    }
  } else {
    inTuneSince = null; confirmed = false;
    // a ticked string that has clearly drifted out again loses its tick
    if (tg.idx >= 0 && tuned.has(tg.idx) && a > 25) { if (offSince == null) offSince = t; else if (t - offSince > 0.8) { tuned.delete(tg.idx); buildStrChips(tg.idx); offSince = null; } } else offSince = null;
  }
}
function drawTMeter() {
  if (tab !== 'tuner') return;
  const W = tcv.clientWidth, H = tcv.clientHeight; if (!W || !H) return;
  const dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
  if (tcv.width !== Math.round(W * dpr) || tcv.height !== Math.round(H * dpr)) { tcv.width = Math.round(W * dpr); tcv.height = Math.round(H * dpr); }
  const g = tg2; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.lineCap = 'round'; g.textBaseline = 'alphabetic';
  const INK = '#f4f6fb', MUT = '#c9d2e6', T = tol(), idle = tm.idle, FONT = 'system-ui,-apple-system,"Segoe UI",sans-serif';
  const a = idle ? 0 : Math.abs(tm.disp), inTune = !idle && a <= T, tunedNow = !idle && tm.confirmed;
  const col = idle ? MUT : inTune ? SC.ok : INK, cx = W / 2;
  // note name
  const y0 = H * 0.38;
  g.textAlign = 'center';
  if (idle) { g.fillStyle = '#7a86a3'; g.font = '400 88px ' + FONT; g.fillText('–', cx, y0); }
  else {
    const L = tm.letter[0], acc = tm.letter.slice(1);
    g.font = '500 96px ' + FONT; const wl = g.measureText(L).width;
    g.font = '400 30px ' + FONT; const wa = acc ? g.measureText(acc).width + 2 : 0, wo = g.measureText(tm.oct).width + 4;
    const x = cx - (wl + wa + wo) / 2; g.textAlign = 'left';
    g.fillStyle = tunedNow ? SC.ok : INK; g.font = '500 96px ' + FONT; g.fillText(L, x, y0);
    g.font = '400 30px ' + FONT; g.fillStyle = tunedNow ? SC.ok : INK; if (acc) g.fillText(acc, x + wl + 2, y0 - 50);
    g.fillStyle = MUT; g.fillText(tm.oct, x + wl + wa + 4, y0);
  }
  // cents readout
  g.textAlign = 'center'; g.font = '500 22px ' + FONT; g.fillStyle = col;
  g.fillText(idle ? 'Play a note' : tunedNow ? 'In tune' : inTune ? '0¢' : `${tm.disp > 0 ? '+' : '−'}${a.toFixed(0)}¢`, cx, y0 + 40);
  // linear meter
  const my = H * 0.76, x0 = 30, x1 = W - 30, pos = c => cx + Math.max(-50, Math.min(50, c)) / 50 * (x1 - cx);
  g.fillStyle = idle ? 'rgba(52,211,153,.07)' : 'rgba(52,211,153,.22)'; rr(g, pos(-T), my - 22, pos(T) - pos(-T), 44, 6); g.fill();
  for (let c = -50; c <= 50; c += 5) {
    const h = c === 0 ? 22 : c % 10 === 0 ? 12 : 7;
    g.strokeStyle = c === 0 ? '#c9d1e4' : '#7a86a3'; g.lineWidth = c === 0 ? 2 : 1.2; g.beginPath(); g.moveTo(pos(c), my - h); g.lineTo(pos(c), my + h); g.stroke();
  }
  g.font = '600 14px ' + FONT; g.fillStyle = MUT; g.textAlign = 'center';
  g.fillText('−50', pos(-50), my + 42); g.fillText('0', pos(0), my + 42); g.fillText('+50', pos(50), my + 42);
  g.font = '400 18px ' + FONT; g.fillText('♭', x0 - 8, my - 30); g.fillText('♯', x1 + 8, my - 30);
  if (!idle) {
    const rec = trail.filter(q => tm.t - q.t < 0.5);                    // where the pitch wandered in the last half second
    if (rec.length > 1) { let lo = 1e9, hi = -1e9; for (const q of rec) { lo = Math.min(lo, q.c); hi = Math.max(hi, q.c); } g.fillStyle = 'rgba(255,255,255,.14)'; rr(g, pos(lo), my - 5, Math.max(4, pos(hi) - pos(lo)), 10, 5); g.fill(); }
    const nx = pos(tm.needle);
    g.save(); if (tunedNow) { g.shadowColor = SC.ok; g.shadowBlur = 14; }
    g.strokeStyle = col; g.lineWidth = 4; g.beginPath(); g.moveTo(nx, my - 28); g.lineTo(nx, my + 28); g.stroke(); g.restore();
  }
}
function rr(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
$('retune').onclick = () => { resetTuner(); drawTMeter(); };
updateAuto();
window.addEventListener('resize', drawTMeter);

