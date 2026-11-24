// Instrument ranges, practice engine, demo playback.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// Playable range of each instrument (sounding pitch, MIDI): guitar E2–C6, violin G3–E6 (kept under the 1500 Hz detection limit),
// ukulele GCEA C4–C6, low-G ukulele G3–C6. Octave and span choices that would leave the range are hidden. Chromatic is unrestricted.
const INST_RANGE = { guitar: [40, 84], violin: [55, 88], ukulele: [60, 84], ukuleleLow: [55, 84] };
function fillSel(sel, pairs, val) { sel.innerHTML = ''; pairs.forEach(([v, t]) => sel.add(new Option(t, v))); sel.value = val; }
const nearestOf = (list, v) => list.reduce((b, x) => Math.abs(x - v) < Math.abs(b - v) ? x : b, list[0]);
function applyLimits() {
  const inst = $('scInst').value, rng = INST_RANGE[inst], root = +$('scRoot').value, type = $('scType').value, dir = $('scDir').value;
  const fits = (o, n) => { if (!rng) return true; const q = buildScale(root, o, type, n, dir); return Math.min(...q) >= rng[0] && Math.max(...q) <= rng[1]; };
  let octs = (rng ? [1, 2, 3, 4, 5, 6] : [2, 3, 4, 5, 6]).filter(o => [1, 2, 3, 4].some(n => fits(o, n)));
  if (!octs.length) octs = [+$('scOct').value];
  const oct = nearestOf(octs, +$('scOct').value);
  fillSel($('scOct'), octs.map(o => [o, String(o)]), oct);
  let spans = [1, 2, 3, 4].filter(n => fits(oct, n)); if (!spans.length) spans = [1];
  const span = nearestOf(spans, +$('scSpan').value || 1);
  fillSel($('scSpan'), spans.map(n => [n, n + (n > 1 ? ' octaves' : ' octave')]), span);
  $('instRange').textContent = rng ? `${PRESETS[inst].label}: ${midiName(rng[0])}–${midiName(rng[1])}. Octave and span choices that go outside this range are hidden.` : 'Chromatic: no limits.';
}
function resetPractice() {
  finalizeHold(); sc.pass = 1; sc.passes = [];
  sc.seq = scaleSeq(); sc.pos = 0; sc.grades = []; sc.attempts = []; sc.wrong = 0; sc.running = false;
  liveBuf = []; silentFrames = 99; det.cur = null; det.lastMidi = null;
  $('scStart').textContent = 'Start practice'; $('scSum').innerHTML = ''; setMsg('');
}
function startScale() {
  stopDemo(); resetPractice(); sc.running = true;
  setMsg(listening ? 'Play the first note (or any note — earlier ones are marked skipped)' : 'Starting microphone…');
  $('scStart').textContent = 'Restart'; $('scOpts').open = false; renderScale();   // fold the options so the live rows fit on a phone
  if (!listening) {
    startListening()
      .then(() => setMsg('Play the first note (or any note — earlier ones are marked skipped)'))
      .catch(e => { sc.running = false; $('scStart').textContent = 'Start practice'; $('status').textContent = 'Mic error: ' + e.message; setMsg('Mic error: ' + e.message, 'bad'); renderScale(); });
  }
}
function stopScale() {                       // stops the demo and/or the practice run and returns to "Start practice"
  const was = sc.running || demoIdx >= 0;
  stopDemo(); stopMetro(); finalizeHold();
  sc.running = false; det.cur = null; det.lastMidi = null; liveBuf = [];
  $('scStart').textContent = 'Start practice';
  setMsg(was ? 'Stopped — press Start practice to begin again' : '');
  renderScale(); renderSummary(); renderCard(); renderAnalysis();
}
const newHold = (a, T) => ({ midi: a.midi, c0: a.cents, T, frames: [], gap: 0, sl: scaleLabel(), i: $('scInst').value });
function onAttempt(a) {
  if (!sc.running || demoIdx >= 0 || sc.pos >= sc.seq.length) return;
  const seq = sc.seq, exp = seq[sc.pos], T = tol();
  const rec = { index: sc.pos + 1, expected: midiName(exp), played: midiName(a.midi), hz: a.hz, cents: a.cents, time_s: a.t, pass: sc.pass };
  // Re-playing the note just played is a retry: scored as another play of that note, never a skip or a wrong note.
  if (sc.pos > 0 && a.midi === seq[sc.pos - 1] && a.midi !== exp) {
    const g = gradeCents(a.cents, T);
    finalizeHold(); hold = newHold(a, T); sc.grades[sc.pos - 1] = g; liveBuf = []; silentFrames = 99; neutralLive();
    setMsg(`Retry ${midiName(a.midi)} ${a.cents >= 0 ? '+' : '−'}${Math.abs(a.cents).toFixed(0)}¢ — ${g}`, g === 'In tune' ? 'ok' : g === 'Close' ? 'warn' : 'bad'); renderScale(); return;
  }
  // Only look ahead (never backwards). You may start anywhere, but after that at most 2 notes can be skipped at once.
  let k = seq.indexOf(a.midi, sc.pos);
  if (k > sc.pos + (sc.pos === 0 ? seq.length : 2)) k = -1;
  
  if (k >= 0) {
    const skipped = [];
    for (let i = sc.pos; i < k; i++) {
      sc.grades[i] = 'Skipped'; skipped.push(midiName(seq[i]));
      sc.attempts.push({ index: i + 1, expected: midiName(seq[i]), played: '–', grade: 'Skipped', hz: null, cents: null, time_s: a.t, pass: sc.pass });
      addEv(seq[i], { k: 's' }, true);
    }
    const g = gradeCents(a.cents, T);
    sc.attempts.push({ ...rec, index: k + 1, expected: midiName(seq[k]), grade: g }); sc.grades[k] = g;
    finalizeHold(); hold = newHold(a, T);   // scored when the note ends
    sc.pos = k + 1; liveBuf = []; silentFrames = 99; neutralLive();
    const fb = `${midiName(a.midi)} ${a.cents >= 0 ? '+' : '−'}${Math.abs(a.cents).toFixed(0)}¢ — ${g}` + (skipped.length ? ` · skipped ${skipped.join(', ')}` : '');
    
    if (sc.pos >= seq.length) {
      const done = sc.attempts.filter(x => x.pass === sc.pass && x.played === x.expected), n = done.filter(x => x.grade === 'In tune').length;
      const wr = sc.attempts.filter(x => x.pass === sc.pass && /^Wrong/.test(x.grade)).length, pct = 100 * n / (seq.length + wr);   // wrong notes count against the pass
      sc.passes.push({ pct }); savePass(pct);
      if ($('scRepeat').checked) {                       // loop: next pass starts from the root, scorecard keeps growing
        setMsg(`Pass ${sc.pass} done — ${pct.toFixed(0)}% in tune. Play the root to start pass ${sc.pass + 1}`, 'ok');
        sc.pass++; sc.pos = 0; sc.grades = []; renderScale(); renderSummary(); renderCard(); return;
      }
      sc.running = false; $('scStart').textContent = 'Start practice'; setMsg(fb); renderScale(); renderSummary(); renderCard(); return;
    }
    setMsg(fb, g === 'In tune' ? 'ok' : g === 'Close' ? 'warn' : 'bad'); renderScale();
  } else if ($('scStrict').checked) {
    const g = (a.midi - exp) % 12 === 0 ? 'Wrong octave' : 'Wrong note';
    sc.wrong++; sc.attempts.push({ ...rec, grade: g }); addEv(exp, { k: 'w' });
    setMsg(`Heard ${midiName(a.midi)} — expected ${midiName(exp)} (${g.toLowerCase()})`, 'bad');
  } else {
    sc.attempts.push({ ...rec, grade: 'Ignored (lenient)' });
  }
}
function renderSummary() {
  const ok = sc.attempts.filter(a => a.played === a.expected);
  if (!ok.length) { $('scSum').innerHTML = ''; return; }
  const inTune = ok.filter(a => a.grade === 'In tune').length;
  const avg = ok.reduce((s, a) => s + Math.abs(a.cents), 0) / ok.length;
  const worst = ok.reduce((w, a) => Math.abs(a.cents) > Math.abs(w.cents) ? a : w);
  const resolved = ok.length + sc.attempts.filter(a => a.grade === 'Skipped').length;   // note slots played or skipped, across all passes
  $('scSum').innerHTML = `<div class="scroll"><table><tr><th>Passes</th><th>Notes</th><th>In tune</th><th>Avg error</th><th>Worst</th><th>Wrong</th><th>In-tune %</th></tr>
    <tr><td>${sc.passes.length}</td><td>${ok.length}/${resolved}</td><td>${inTune}</td><td>${avg.toFixed(1)}¢</td><td>${worst.expected} (${Math.abs(worst.cents).toFixed(0)}¢)</td><td>${sc.wrong}</td><td><b>${(100 * inTune / (resolved + sc.wrong)).toFixed(0)}%</b></td></tr></table></div>`;
}

function stopDemo() {
  demoTimers.forEach(clearTimeout); demoTimers = [];
  stopTone();
  const was = demoIdx >= 0; demoIdx = -1;
  $('scDemo').textContent = '▶ Hear scale';
  if (was) { det.cur = null; det.lastMidi = null; liveBuf = []; renderScale(); }
}
function startDemo() {
  finalizeHold(); sc.seq = scaleSeq();
  const step = 60 / (+$('scBpm').value || 80) , seq = sc.seq, off = metroOn ? 90 : 0;
  if (metroOn) startMetro();
  demoIdx = 0; $('scDemo').textContent = '■ Stop demo';
  seq.forEach((m, i) => demoTimers.push(setTimeout(() => {
    demoIdx = i; renderScale(); playTone(noteToFreq(m, a4()), step * 0.95, 'triangle', 0.25);
  }, off + i * step * 1000)));
  demoTimers.push(setTimeout(stopDemo, off + seq.length * step * 1000));
  renderScale();
}
$('scDemo').onclick = () => { if (demoIdx >= 0) stopDemo(); else startDemo(); };
$('scStart').onclick = startScale;
$('scStop').onclick = stopScale;
['scInst', 'scRoot', 'scOct', 'scType', 'scSpan', 'scDir'].forEach(id => $(id).onchange = () => { applyLimits(); stopDemo(); resetPractice(); renderScale(); renderCard(); renderAnalysis(); });

