// The piece view: one screen for every piece, imported or generated. Choose the part, transpose it to fit the instrument, pick bars and loop them,
// listen at a chosen speed (with the other parts if you like), or open it in Free record to see it as Sheet or Falling notes and replay it.
// Scoring your playing against the piece comes with the next phase (the reference timeline and evaluator); this screen says so.
// Pure parts (barGrid, notesInBars, transposeNotes, rangeCheck, bestOctaveShift, materialize) are in js/core/library.js. Part of the app: shared scope.

const PV = { piece: null, shift: 0, from: 1, to: 1, loop: false, speed: 1, acc: false, playing: false, nodes: [], timer: null };
const pvGrid = () => barGrid(PV.piece);
const pvMain = () => transposeNotes(PV.piece.parts[PV.piece.part].notes, PV.shift);
const pvOthers = () => PV.piece.parts.filter((p, i) => i !== PV.piece.part).flatMap(p => transposeNotes(p.notes, PV.shift));

function pvOpen(id, listen) {
  const src = pcFind(id); if (!src) return;
  pvStop(); const p = materialize(src);
  PV.src = src; PV.piece = JSON.parse(JSON.stringify(p)); PV.shift = 0; PV.speed = 1; PV.acc = false; PV.loop = false;
  const fit = bestOctaveShift(pvMain(), PV.piece.instrument); if (fit) PV.shift = fit;   // start in range: a low part is lifted an octave, with a note saying so
  PV.from = 1; PV.to = pvGrid().bars;
  pcView('piece'); pvRender(); if (fit) $('pvRange').textContent = `Moved ${fit > 0 ? 'up' : 'down'} ${Math.abs(fit / 12)} octave${Math.abs(fit) > 12 ? 's' : ''} to fit the ${PV.piece.instrument}. ` + $('pvRange').textContent;
  if (listen) pvListen();
}
function pvRender() {
  const p = PV.piece, g = pvGrid(), rc = rangeCheck(pvMain(), p.instrument);
  $('pvTitle').textContent = p.title; $('pvMeta').textContent = `${LIB_INSTRUMENT_NAMES[p.instrument]} · ${p.generator ? 'Generated' : p.verified || p.exact ? 'Verified, exact notes' : 'Draft'} · ${pcInfo(p)}`;
  $('pvPart').innerHTML = p.parts.map((pt, i) => `<option value="${i}"${i === p.part ? ' selected' : ''}>${pcEsc(pt.name)} (${pt.notes.length} notes)</option>`).join(''); $('pvPartWrap').classList.toggle('hide', p.parts.length < 2);
  $('pvAccWrap').classList.toggle('hide', p.parts.length < 2); $('pvAcc').checked = PV.acc;
  $('pvShift').textContent = (PV.shift > 0 ? '+' : '') + PV.shift + ' semitones';
  $('pvRange').textContent = rc.outside ? `${rc.outside} of ${rc.total} notes are outside the ${p.instrument} range (${midiName(rc.low)}–${midiName(rc.high)}).` : `All notes are inside the ${p.instrument} range (${midiName(rc.low)}–${midiName(rc.high)}).`;
  $('pvRange').className = 'hint2' + (rc.outside ? ' bad-t' : ' ok-t');
  $('pvFrom').max = $('pvTo').max = g.bars; $('pvFrom').value = PV.from; $('pvTo').value = PV.to; $('pvLoop').checked = PV.loop; $('pvSpeed').value = String(PV.speed);
  $('pvGrid').textContent = `${g.bars} bar${g.bars === 1 ? '' : 's'}, ${g.timeSig.join('/')} at ${Math.round(g.bpm)} BPM. The bars come from a constant-tempo grid${p.source === 'musicxml' ? '' : ' made from the file\'s tempo and time signature'}.`;
  $('pvListen').textContent = PV.playing ? '■ Stop' : '▶ Listen'; $('pvFav').textContent = PV.src.favourite ? '♥ Favourite' : '♡ Favourite'; $('pvFav').classList.toggle('hide', !!PV.src.generator); $('pvDel').classList.toggle('hide', !!PV.src.generator);
}

// ----- listening: the app's own synth, scheduled ahead on the audio clock; a loop schedules the next pass just before the last one ends -----
function pvNotesInRange() {
  const g = pvGrid(), p = PV.piece, main = notesInBars(pvMain(), g, PV.from, PV.to), acc = PV.acc ? notesInBars(pvOthers(), g, PV.from, PV.to) : [];
  return { notes: main.concat(acc), len: (PV.to - PV.from + 1) * g.barSec };
}
function pvPass(t0) {
  const c = getCtx(), { notes, len } = pvNotesInRange(), sp = PV.speed, a = a4();
  for (const n of notes) {
    const o = c.createOscillator(), g = c.createGain(), at = t0 + n.start / sp, d = Math.max(0.1, n.dur / 1000 / sp);
    o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (n.midi - 69) / 12) * (a / 440);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.18, at + 0.015); g.gain.setValueAtTime(0.18, at + Math.max(0.02, d - 0.06)); g.gain.linearRampToValueAtTime(0, at + d);
    o.connect(g); g.connect(c.destination); o.start(at); o.stop(at + d + 0.02); PV.nodes.push(o);
  }
  const end = t0 + len / sp;
  PV.timer = setTimeout(() => { if (!PV.playing) return; if (PV.loop) pvPass(end); else pvStop(); }, Math.max(0, (end - c.currentTime) * 1000 - (PV.loop ? 400 : 0)));
}
function pvListen() { if (PV.playing) { pvStop(); return; } PV.playing = true; pvPass(getCtx().currentTime + 0.1); pvRender(); }
function pvStop() {
  PV.playing = false; clearTimeout(PV.timer); for (const o of PV.nodes) { try { o.stop(); } catch {} } PV.nodes = [];
  if (PV.piece && !$('pcPiece').classList.contains('hide')) $('pvListen').textContent = '▶ Listen';
}
const pvRestart = () => { if (PV.playing) { pvStop(); pvListen(); } };

// ----- the controls -----
$('pvBack').onclick = () => { pvStop(); pcView('home'); };
$('pvListen').onclick = pvListen;
$('pvPart').onchange = () => { PV.piece.part = +$('pvPart').value; PV.shift = 0; const f = bestOctaveShift(pvMain(), PV.piece.instrument); PV.shift = f; PV.from = 1; PV.to = pvGrid().bars; pvRender(); pvRestart(); };
$('pvAcc').onchange = () => { PV.acc = $('pvAcc').checked; pvRestart(); };
$('pvDown').onclick = () => { PV.shift -= 1; pvRender(); pvRestart(); }; $('pvUp').onclick = () => { PV.shift += 1; pvRender(); pvRestart(); };
$('pvFit').onclick = () => { PV.shift += bestOctaveShift(pvMain(), PV.piece.instrument); pvRender(); pvRestart(); };
const pvBars = () => { const mx = pvGrid().bars; PV.from = Math.max(1, Math.min(mx, +$('pvFrom').value || 1)); PV.to = Math.max(PV.from, Math.min(mx, +$('pvTo').value || mx)); $('pvFrom').value = PV.from; $('pvTo').value = PV.to; pvRestart(); };
$('pvFrom').onchange = $('pvTo').onchange = pvBars;
$('pvLoop').onchange = () => { PV.loop = $('pvLoop').checked; };
$('pvSpeed').onchange = () => { PV.speed = +$('pvSpeed').value; pvRestart(); };
$('pvFav').onclick = async () => { const s = PV.src; if (s.generator) return; s.favourite = !s.favourite; await LIBDB.put([s]); pvRender(); };
$('pvDel').onclick = async () => { const s = PV.src; if (s.generator || !confirm(`Delete “${s.title}” from this device?`)) return; pvStop(); await LIBDB.del(s.id); PC.lib = await LIBDB.all(); pcView('home'); };

// Free record already draws notes as Sheet or Falling and replays them (with speed and the synth), so a piece can be put there to look at and replay.
$('pvRec').onclick = () => {
  pvStop(); const notes = notesInBars(pvMain(), pvGrid(), PV.from, PV.to); if (!notes.length) return;
  showTab('rec'); pbStop(); newRecording(); recT0 = 0;
  for (const n of notes) addEvent({ midi: n.midi, note: midiName(n.midi), hz: noteToFreq(n.midi, a4()), cents: 0, start: n.start, dur: n.dur, lvl: 40, pts: [], vib: 0 });
  recEnd = Math.max(...notes.map(n => n.start + n.dur / 1000));
  $('pbMode').value = 'notes'; $('pbMode').dispatchEvent(new Event('change'));
  const Wc = cv.clientWidth || 360; view.follow = false; view.vs = 0; view.pps = Math.min(Math.max(8, (Wc - GUT) / 8), Math.max(20, (Wc - GUT - 24) / Math.max(2, recEnd)));
  $('recInfo').textContent = `${PV.piece.title}: ${notes.length} notes, bars ${PV.from}–${PV.to}. Press Replay to hear it.`; recUi(); requestDraw();
};
