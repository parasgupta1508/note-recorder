// Piece practice screen: where the music comes from (the Pieces screen: its Practise button, or its "Practise a file from this device" button), which instrument and part, which bars, and the accompaniment.
// The file is parsed by js/core/musicxml.js, the chosen part becomes a timeline (js/core/piece-practice.js), and the engine (piece-engine.js) and the displays (piece-visual.js)
// play and draw it. This screen is separate from the Scale drills and does not change them.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.
//
// A file opened from the device lives in memory until the page is closed or another piece is opened, unless the player saves it (Save to my pieces).

const PP = { parsed: null, sum: [], idx: -1, title: '', from: 1, to: 1, last: 1, line: 'top', oct: 'auto', backing: false, backOff: new Set(), bpm0: 80, src: '', id: 0 };
const PP_MAX_FILE = 25 * 1024 * 1024, PP_MAX_XML = 80 * 1024 * 1024;   // bytes in a file / bytes of MusicXML text after un-zipping (a zip bomb stops here)
const ppActive = () => !!PP.parsed && PP.idx >= 0;
const ppEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ppKb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
PRACTICE_INSTRUMENTS.forEach(([k, label]) => $('pzInst').add(new Option(label, k)));

// ================= the instrument's own controls (bowing and position where the instrument has them) =================
function ppFillControls() {
  const inst = $('pzInst').value;
  for (const [k, id] of [['bowing', 'pzBow'], ['position', 'pzPos']]) {
    const o = controls(inst)[k], cur = $(id).value, sel = $(id); $(id + 'Wrap').hidden = !o; sel.innerHTML = '';
    if (o) o.options.forEach(x => sel.add(new Option(x.label, x.value)));
    sel.value = o && o.options.some(x => x.value === cur) ? cur : o ? o.def : '';
  }
}

// ================= the plan =================
// What the engine and the displays play: the chosen part as a timeline, with the instrument's rules. For a violin the hand moves: the position of each note is the lowest that
// can reach it, staying where it is while it can (posList, used by the finger hints).
function ppPositions(tl, inst) {
  if (ruleFor(inst).fingering !== 'bowed') return null;
  const strings = pwStrings(inst); let cur = 1;
  const reach = (n, p) => { const h = fingerHint(inst, n.midi, strings, String(p)); return !!h && h.finger !== ''; };
  return tl.map(n => {
    if (reach(n, cur)) return String(cur);
    for (let d = 1; d <= 4; d++) for (const p of [cur + d, cur - d]) if (p >= 1 && p <= 5 && reach(n, p)) { cur = p; return String(p); }
    return String(cur);
  });
}
let ppMemo = { k: '', plan: null };
function ppPlan() {
  const x = PP.parsed, part = x.parts[PP.idx], inst = $('pzInst').value, rule = ruleFor(inst), bpm = Math.max(30, Math.min(240, +$('pzBpm').value || PP.bpm0));
  const bow = $('pzBow').value, pos = $('pzPos').value, sig = +$('pzSig').value || ppSigBeats(x.timeSig), notes = part.notes.filter(n => n.bar >= PP.from && n.bar <= PP.to);
  const shift = PP.oct === 'auto' ? fitOctaveShift(monoLine(notes, PP.line).map(n => n.midi), rule.range) : +PP.oct || 0;
  const k = [PP.id, PP.idx, PP.from, PP.to, PP.line, shift, bpm, inst, bow, pos, sig].join('|');
  if (ppMemo.k === k) return ppMemo.plan;
  const key = keyInfo(x.key), ask = { bpm, line: PP.line, shift, flats: key.flats, timeSig: x.timeSig, range: rule.range };
  let T = timelineFromPart(part, { ...ask, fromBar: PP.from, toBar: PP.to });
  if (!T.tl.length) T = timelineFromPart(part, ask);   // a range with no notes: the whole part instead
  const mids = T.tl.map(n => n.midi), posList = ppPositions(T.tl, inst);
  const partial = T.fromBar > 1 || T.toBar < ppLastBar(part), sid = ppSourceId(PP.title, part.name, T.fromBar, T.toBar);
  const plan = { start: lowestAtOrAbove(key.tonic, Math.min(...mids)), top: Math.max(...mids), fits: !T.outside, warnings: T.warnings.slice(), tl: T.tl, inst, pc: key.pc, tonic: key.tonic, flats: key.flats, bow, pos: posList ? '1' : pos, posList, bpm, beats: T.beats,
    timeSig: x.timeSig, sig, title: PP.title, part: part.name, from: T.fromBar, to: T.toBar, startQ: T.startQ, endQ: T.endQ, shift, sid, label: `${PP.title} · ${part.name}` + (partial ? ` · bars ${T.fromBar}–${T.toBar}` : ''), key: k + '|' + sid };
  ppMemo = { k, plan }; return plan;
}
// Something that changes the notes or how they are played: start again from a fresh plan.
function ppChanged() { ppMemo = { k: '', plan: null }; if (PE.running || PE.demo >= 0) peStop(); if (ppActive()) peReset(); ppRender(); peUi(); }

// ================= opening a score =================
function ppBusy(text, bad) { const m = $('ppMsg'); m.textContent = text; m.className = 'hint2' + (bad ? ' bad-t' : ''); }
const ppDecode = b => (b[0] === 0xff && b[1] === 0xfe) ? new TextDecoder('utf-16le').decode(b.subarray(2)) : (b[0] === 0xfe && b[1] === 0xff) ? new TextDecoder('utf-16be').decode(b.subarray(2)) : new TextDecoder('utf-8').decode(b);
// Raw deflate, with a limit on the size of the result.
async function ppInflate(u8) {
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open compressed (.mxl) files. Use an uncompressed .musicxml file.');
  const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(); w.write(u8).catch(() => {}); w.close().catch(() => {});
  const rd = ds.readable.getReader(), parts = []; let total = 0;
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    total += value.length; if (total > PP_MAX_XML) { try { rd.cancel(); } catch {} throw new Error('This score is too large to open.'); }
    parts.push(value);
  }
  const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
// bytes of a .musicxml / .xml / .mxl -> opened. name: the file name (for its type, and as the title when the score has none).
async function ppOpenBytes(bytes, name, src, cats) {
  ppBusy(`Reading ${name}…`);
  try {
    if (bytes.length > PP_MAX_FILE) throw new Error('This file is larger than 25 MB.');
    const det = detectInput({ name, type: '' }, bytes.subarray(0, 8));
    if (det.kind === 'midi') throw new Error('That is a MIDI file. Piece practice reads MusicXML (.musicxml, .xml or .mxl).');
    if (det.kind !== 'musicxml' && det.kind !== 'mxl') throw new Error(`Piece practice reads MusicXML (.musicxml, .xml or .mxl), not ${det.label === 'unknown file' ? 'this kind of file' : det.label}.`);
    const text = det.kind === 'mxl' || (bytes[0] === 0x50 && bytes[1] === 0x4b) ? await mxlToXml(bytes, ppInflate) : ppDecode(bytes);
    ppLoadParsed(parseMusicXml(text), name, src, text, cats); ppBusy(''); return true;
  } catch (e) { ppBusy(e && e.message ? e.message : String(e), true); return false; }
}
async function ppOpenFile(file) { if (!file) return; if (file.size > PP_MAX_FILE) { ppBusy('This file is larger than 25 MB.', true); return; } return ppOpenBytes(new Uint8Array(await file.arrayBuffer()), file.name, 'file'); }

// ================= a score is open: which instrument, which part =================
function ppLoadParsed(x, name, src, text, cats) {
  if (PE.running || PE.demo >= 0) peStop();
  PP.parsed = x; PP.xml = text || ''; PP.cats = cats && cats.length ? cats : ['My imports']; PP.saved = src === 'mine'; PP.id++; PP.src = src; PP.title = cleanTitle(x.title || name, 'MusicXML piece'); PP.sum = summariseParts(x); PP.line = 'top'; PP.oct = 'auto'; PP.backing = false; PP.backOff = new Set();
  PP.bpm0 = Math.max(30, Math.min(240, Math.round(x.bpm) || 80)); $('pzBpm').value = PP.bpm0; $('pzSig').value = String(ppSigBeats(x.timeSig));
  PP.idx = -1; ppMemo = { k: '', plan: null }; PE.plan = null; PE.tl = []; PE.seq = [];
  ppShowLib(false); ppSaveUi();
  if (PP.sum.length === 1) ppChoosePart(0); else { $('pzInst').disabled = false; ppRender(); }
}
function ppChoosePart(i) {
  PP.idx = i; const s = PP.sum[i], part = PP.parsed.parts[i], r = ppDefaultRange(part, PP.line);
  PP.from = r.from; PP.to = r.to; PP.last = r.last; ppMemo = { k: '', plan: null };
  // the instrument configures the scoring (vibrato allowance, hold time) and the fingering hints; a lone, recognised instrument is locked
  $('pzInst').value = s.key; $('pzInst').disabled = PP.sum.length === 1 && s.exact;
  ppFillControls(); if (ruleFor(s.key).positions === 'fretted' && [...$('pzPos').options].some(o => o.value === 'auto')) $('pzPos').value = 'auto';
  PW.view = 'staff'; PW.showNeck = true;   // Staff with the instrument under it (not saved: the player's own choice of display is kept for next time)
  peReset(); ppRender(); peUi();
}
$('ppParts').onclick = e => { const b = e.target.closest('button[data-i]'); if (b && PP.idx !== +b.dataset.i) { if (PE.running || PE.demo >= 0) peStop(); ppChoosePart(+b.dataset.i); } };

// ================= the panel =================
function ppRender() {
  const loaded = !!PP.parsed, chosen = ppActive();
  $('pzPlayer').classList.toggle('pp-pick', !chosen);
  $('pzDemo').disabled = $('pzStart').disabled = !chosen;
  $('ppLoaded').hidden = !loaded;
  if (!loaded) return;
  const x = PP.parsed, solo = PP.sum.length === 1;
  $('ppTitle').textContent = PP.title;
  if (chosen) {
    const s = PP.sum[PP.idx], ts = x.timeSig.join('/'), kn = keyInfo(x.key).label, p = ppPlan();
    $('ppBadge').textContent = solo ? `${s.label} solo${s.exact ? '' : ' (piano scoring)'}` : s.label;
    $('ppBadge').className = 'pl-chip' + (solo && s.exact ? ' lock' : '');
    $('ppBadge').title = solo && s.exact ? 'Detected instrument: the score has one instrument, so the app set the scoring for it' : s.exact ? 'Chosen from the score\'s part list' : 'This instrument is not one the drills know, so the piano scoring (no vibrato allowance) is used. You can change the instrument above.';
    $('ppFrom').value = p.from; $('ppTo').value = p.to; $('ppFrom').max = $('ppTo').max = PP.last; $('ppOf').textContent = `of ${PP.last}`;
    $('ppLine').value = PP.line; $('ppOct').value = PP.oct; $('ppLineW').hidden = !s.polyphonic;
    $('ppInfo').innerHTML = `${ppEsc(kn)} · ${ts} · ♩ = ${Math.round(x.bpm)} in the score · ${p.tl.length} notes in bars ${p.from}–${p.to}` + (p.warnings.length ? '<br>' + p.warnings.map(w => `<span class="warn-t">${ppEsc(w)}</span>`).join(' ') : '');
    $('ppOptSum').textContent = `Options · ${kn} · ${ts} · bars ${p.from}–${p.to} · ${p.tl.length} notes` + (p.warnings.length ? ' · ⚠' : '');
  } else { $('ppBadge').textContent = ''; $('ppInfo').textContent = ''; $('ppOptSum').textContent = 'Options'; }
  // Case B: the list of parts in the file
  $('ppParts').hidden = solo; $('ppParts').classList.toggle('chosen', chosen);
  if (!solo) $('ppParts').innerHTML = `<div class="pp-parts-h">${chosen ? 'Parts in this file' : 'Which part will you play?'}</div>` + PP.sum.map(s => `<button type="button" role="radio" aria-checked="${s.i === PP.idx}" class="pp-part${s.i === PP.idx ? ' on' : ''}" data-i="${s.i}"><b>P${s.i + 1}: ${ppEsc(s.name)}</b><span>${ppEsc(s.label)}${s.exact ? '' : ' · piano scoring'} · ${s.notes} notes · ${midiName(s.lo)}–${midiName(s.hi)}${s.polyphonic ? ' · chords' : ''}</span></button>`).join('');
  // accompaniment: the parts that are not being played
  const others = PP.sum.filter(s => s.i !== PP.idx);
  $('ppBackW').hidden = !chosen || !others.length;
  if (chosen && others.length) {
    $('ppBack').checked = PP.backing;
    $('ppBackList').innerHTML = others.map(s => `<label class="check"><input type="checkbox" data-b="${s.i}" ${PP.backOff.has(s.i) ? '' : 'checked'}> <span>P${s.i + 1}: ${ppEsc(s.name)}</span></label>`).join('');
    $('ppBackNote').textContent = PE.mode === 'wait' ? 'The accompaniment plays in Tempo mode and in "Hear piece"; in Wait mode the music waits for you.' : 'Use headphones: the microphone would hear the speakers.';
  }
}
function ppRange() {
  const f = Math.max(1, Math.min(PP.last, +$('ppFrom').value | 0 || 1)), t = Math.max(f, Math.min(PP.last, +$('ppTo').value | 0 || PP.last));
  if (!PP.parsed.parts[PP.idx].notes.some(n => n.bar >= f && n.bar <= t)) { ppBusy('There are no notes in those bars.', true); ppRender(); return; }
  ppBusy(''); PP.from = f; PP.to = t; ppChanged();
}
$('ppFrom').onchange = $('ppTo').onchange = ppRange;
$('ppLine').onchange = () => { PP.line = $('ppLine').value; const r = ppDefaultRange(PP.parsed.parts[PP.idx], PP.line); if (PP.to > r.to && PP.from === 1) PP.to = r.to; ppChanged(); };
$('ppOct').onchange = () => { PP.oct = $('ppOct').value; ppChanged(); };
$('pzInst').onchange = () => { ppFillControls(); ppChanged(); };
['pzBow', 'pzPos', 'pzSig'].forEach(id => $(id).onchange = ppChanged);
$('pzBpm').onchange = () => { $('pzBpm').value = Math.max(30, Math.min(240, +$('pzBpm').value || PP.bpm0)); ppChanged(); };
$('pzBpmDn').onclick = () => { $('pzBpm').value = Math.max(30, (+$('pzBpm').value || PP.bpm0) - 5); ppChanged(); };
$('pzBpmUp').onclick = () => { $('pzBpm').value = Math.min(240, (+$('pzBpm').value || PP.bpm0) + 5); ppChanged(); };
$('ppBack').onchange = () => { PP.backing = $('ppBack').checked; if (!PP.backing) ppBackingStop(); else peMsg('Accompaniment is on: use headphones so the microphone does not hear it'); };
$('ppBackList').onchange = e => { const b = e.target.closest('input[data-b]'); if (!b) return; if (b.checked) PP.backOff.delete(+b.dataset.b); else PP.backOff.add(+b.dataset.b); };

// ================= Open a piece =================
// The pieces to choose from are the Pieces screen's (instrument, search, Built-in / Mine / Favourites; add .mxl or .musicxml files there with + Add a piece): its Practise button
// opens a MusicXML piece here, with scoring. This screen also opens one file straight from this device.
const plUsable = p => !p.generator && p.source === 'musicxml' && Array.isArray(p.parts) && p.parts.some(x => x.notes && x.notes[0] && x.notes[0].q != null);   // MIDI pieces and generated scales have no bars or note lengths to score
// A Pieces-library piece -> opened here. Returns false when it cannot be practised with scoring (the Pieces screen then opens it as before).
function ppOpenLibPiece(id) {
  const p = (typeof PC !== 'undefined' ? PC.lib : []).find(x => x.id === id); if (!p || !plUsable(p)) return false;
  showTab('piece');
  ppLoadParsed({ title: p.title, parts: p.parts, bpm: p.bpm || 80, timeSig: p.timeSig || [4, 4], key: p.key || { fifths: 0, minor: false } }, p.title, 'mine', p.xml || '');
  ppBusy(''); return true;
}
// The open screen and the player are two views of this tab.
function ppShowLib(show) { $('pzLib').hidden = !show; $('pzPlayer').hidden = show; if (show) $('pzLibBack').hidden = !PP.parsed; else ppBusy(''); }
function ppEnter() { ppInstallBuiltins(); peUi(); }   // the screen was opened
$('pzLibBack').onclick = () => ppShowLib(false);
$('ppChange').onclick = () => { if (PE.running || PE.demo >= 0) peStop(); showTab('pieces'); };   // back to the Pieces screen, where pieces are chosen
$('pzLibPieces').onclick = () => showTab('pieces');

// ----- Save to my pieces: the opened score goes into the Pieces library on this device (IndexedDB), filed under its composer or folder, and then works offline -----
const ppFolders = path => path.split('/').slice(0, -1).filter(x => x !== '_' && x.toLowerCase() !== 'scores').map(x => x.replace(/_/g, ' ')).slice(0, 2);   // "scores/Haydn,_Joseph/Quartet/x.mxl" -> [Haydn, Joseph; Quartet]
const PP_MAX_KEEP = 3 * 1024 * 1024;   // a score text larger than this is kept without its source text (the engraved staff then is not offered for it)
// The library piece for the open score (pure: no storage). Null for a piece that is already from the library.
function ppBuildPiece() {
  if (!PP.parsed || !PP.xml || PP.saved) return null;
  const inst = PP.idx >= 0 ? ({ chromatic: 'piano', violin: 'violin', guitar: 'guitar', ukulele: 'ukulele' })[PP.sum[PP.idx].key] || 'piano' : 'piano';
  const piece = pieceFromMusicXml(PP.xml, { title: PP.title, instrument: inst });
  Object.assign(piece, { title: PP.title, instrument: inst, categoryPath: PP.cats.slice(), builtin: false, favourite: false, verified: true, pack: null, part: Math.max(0, PP.idx) });
  if (PP.xml.length <= PP_MAX_KEEP) piece.xml = PP.xml;
  return piece;
}
function ppSaveUi() {
  const b = $('ppSave'); if (!b) return;
  b.hidden = !PP.parsed || PP.src === 'mine'; b.disabled = !!PP.saved; b.textContent = PP.saved ? 'Saved ✓' : 'Save';
  b.title = PP.saved ? 'This piece is in your Pieces library on this device' : 'Keep this piece on this device, in the Pieces library, so it opens without the internet';
}
$('ppSave').onclick = async () => {
  const piece = ppBuildPiece(); if (!piece) return;
  try {
    const all = await LIBDB.all(); if (all.some(p => p.title === piece.title && p.source === 'musicxml' && p.parts.length === piece.parts.length && p.parts[0].notes.length === piece.parts[0].notes.length)) { PP.saved = true; ppSaveUi(); peMsg('This piece is already in your Pieces library.'); return; }
    await LIBDB.put([piece]); if (typeof PC !== 'undefined') PC.lib = await LIBDB.all(); PP.saved = true; ppSaveUi();
    peMsg(`Saved. Find it in Pieces, under ${piece.categoryPath.join(' › ')}.`, 'ok');
  } catch (e) { peMsg('Could not save on this device: ' + (e.message || e), 'bad'); }
};

// ----- built-in pieces: data/builtin/index.json lists scores that ship with the app. Each is put into the Pieces library (marked builtin) the first time, so it appears under the Built-in filter
// there and in "My pieces & built-in" here, and works offline. A piece the player deletes is not put back (the ids already installed are remembered). -----
const PL_BI_KEY = 'tuner-builtin-installed';
async function ppInstallBuiltins() {
  try {
    const done = new Set(JSON.parse(localStorage.getItem(PL_BI_KEY) || '[]')), res = await fetch('data/builtin/index.json'); if (!res.ok) return;
    const todo = (await res.json()).filter(b => !done.has(b.id)); if (!todo.length) return;
    for (const b of todo) {
      const r = await fetch('data/builtin/' + encodeURIComponent(b.file)); if (!r.ok) continue;
      const bytes = new Uint8Array(await r.arrayBuffer()), text = /\.mxl$/i.test(b.file) ? await mxlToXml(bytes, ppInflate) : ppDecode(bytes), piece = pieceFromMusicXml(text, { title: b.title, instrument: b.instrument });
      Object.assign(piece, { id: b.id, title: b.title, instrument: b.instrument, categoryPath: b.categoryPath || ['Built-in'], builtin: true, favourite: false, verified: true, pack: null, xml: text });
      await LIBDB.put([piece]); done.add(b.id);
    }
    localStorage.setItem(PL_BI_KEY, JSON.stringify([...done])); if (typeof PC !== 'undefined') { PC.lib = await LIBDB.all(); if (typeof pcRenderHome === 'function') pcRenderHome(); }
  } catch {}
}

// ----- a file from this device: the button is on the Pieces screen ("Practise a file from this device"); the file opens here, and can then be saved with Save to my pieces -----
$('pcPractiseFile').onclick = () => $('ppFile').click();
$('ppFile').onchange = async () => { const f = $('ppFile').files[0]; $('ppFile').value = ''; const ok = await ppOpenFile(f); showTab('piece'); if (!ok) ppShowLib(true); };   // a refused file: the reason is shown on the open screen

// ================= the other parts, as sound =================
// While a piece runs in Tempo mode (or "Hear piece"), the parts the player is not playing are played by the app's own synth, scheduled just ahead on the audio clock.
// startAt: the audio time of the first note. Called again for every loop, which restarts the accompaniment on the new first note.
const PPB = { events: [], key: '', i: 0, t0: 0, timer: 0, nodes: [] };
function ppBackingEvents() {
  const p = PE.plan || ppPlan(), only = PP.sum.map(s => s.i).filter(i => i !== PP.idx && !PP.backOff.has(i));
  const k = [p.key, only.join()].join('/'); if (PPB.key !== k) { PPB.key = k; PPB.events = backingEvents(PP.parsed.parts, PP.idx, { bpm: p.bpm, shift: p.shift, startQ: p.startQ, endQ: p.endQ, only }); }
  return PPB.events;
}
function ppBackingBegin(startAt, anyMode) {
  if (!ppActive() || !PP.backing || !(anyMode || PE.mode === 'tempo') || !ppBackingEvents().length) return;
  PPB.t0 = startAt; PPB.i = 0; if (!PPB.timer) PPB.timer = setInterval(ppBackingPump, 100); ppBackingPump();
}
function ppBackingPump() {
  const c = getCtx(), A = a4();
  while (PPB.i < PPB.events.length) {
    const e = PPB.events[PPB.i], at = PPB.t0 + e.startMs / 1000; if (at > c.currentTime + 0.8) break; PPB.i++;
    const d = e.durationMs / 1000; if (at + d < c.currentTime) continue;
    if (smpBank('piano')) { const node = smpPlay(c, 'piano', e.midi, Math.max(at, c.currentTime), d, { vol: 0.7 }); if (node) { PPB.nodes.push(node); node.onended = () => { PPB.nodes = PPB.nodes.filter(x => x !== node); }; continue; } }   // the accompaniment is a piano
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter(), a = Math.max(at, c.currentTime);
    o.type = 'triangle'; o.frequency.value = noteToFreq(e.midi, A); lp.type = 'lowpass'; lp.frequency.value = 2600;
    g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(0.09, a + 0.02); g.gain.setValueAtTime(0.09, Math.max(a + 0.02, at + d - 0.06)); g.gain.linearRampToValueAtTime(0.0001, at + d);
    o.connect(lp); lp.connect(g); g.connect(c.destination); o.start(a); o.stop(at + d + 0.03); PPB.nodes.push(o); o.onended = () => { PPB.nodes = PPB.nodes.filter(x => x !== o); };
  }
  if (PPB.i >= PPB.events.length && !PPB.nodes.length) { clearInterval(PPB.timer); PPB.timer = 0; }
}
function ppBackingStop() { clearInterval(PPB.timer); PPB.timer = 0; PPB.i = PPB.events.length; PPB.nodes.forEach(o => { try { o.stop(); } catch {} }); PPB.nodes = []; }

ppFillControls(); $('pzPlayer').hidden = true; ppRender(); peUi();   // the library is the first view; it reads GitHub when the screen is opened (ppEnter)
setTimeout(ppInstallBuiltins, 1500);   // built-in pieces appear in the Pieces screen without having to open this one first
