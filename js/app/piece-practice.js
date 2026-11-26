// Piece practice: the Scale drills screen with a piece from a MusicXML file instead of a scale.
// The file (a local one, or one read straight from GitHub into memory) is parsed by js/core/musicxml.js, the part the player chooses becomes the same
// reference timeline a scale has (js/core/piece-practice.js), and from there everything is shared: the four displays (scale-visual.js), Tempo-locked and
// Wait modes, the graders, the Trinity-style result and the run history. This file is only the source picker, the part picker, the plan, and the accompaniment.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.
//
// Nothing is stored: not the file, not the GitHub list. They live in memory until the page is closed or another piece is opened.

const PP = { on: false, parsed: null, sum: [], idx: -1, title: '', from: 1, to: 1, last: 1, line: 'top', oct: 'auto', backing: false, backOff: new Set(), bpm0: 80, src: '', id: 0 };
const PP_MAX_FILE = 25 * 1024 * 1024, PP_MAX_XML = 80 * 1024 * 1024;   // bytes in a file / bytes of MusicXML text after un-zipping (a zip bomb stops here)
const ppActive = () => PP.on && !!PP.parsed && PP.idx >= 0;
const ppEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ppKb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// ================= the plan =================
// planNow() (practice.js) returns this while a piece is open. It has the shape of a scale plan, plus what a piece adds.
// For a violin the hand moves: the position of each note is the lowest one that can reach it, staying where it is while it can (posList, used by the finger hints).
function ppPositions(tl, inst) {
  if (ruleFor(inst).fingering !== 'bowed') return null;
  const strings = stringsOf(inst); let cur = 1;
  const reach = (n, p) => { const h = fingerHint(inst, n.midi, strings, String(p)); return !!h && h.finger !== ''; };
  return tl.map(n => {
    if (reach(n, cur)) return String(cur);
    for (let d = 1; d <= 4; d++) for (const p of [cur + d, cur - d]) if (p >= 1 && p <= 5 && reach(n, p)) { cur = p; return String(p); }
    return String(cur);
  });
}
let ppMemo = { k: '', plan: null };
function ppPlan() {
  const x = PP.parsed, part = x.parts[PP.idx], inst = $('scInst').value, rule = ruleFor(inst), bpm = Math.max(30, Math.min(240, +$('scBpm').value || PP.bpm0));
  const bow = $('scBow').value, pos = $('scPos').value, notes = part.notes.filter(n => n.bar >= PP.from && n.bar <= PP.to);
  const shift = PP.oct === 'auto' ? fitOctaveShift(monoLine(notes, PP.line).map(n => n.midi), rule.range) : +PP.oct || 0;
  const k = [PP.id, PP.idx, PP.from, PP.to, PP.line, shift, bpm, inst, bow, pos, sigBeats(), useFlats].join('|');
  if (ppMemo.k === k) return ppMemo.plan;
  const key = keyInfo(x.key), ask = { bpm, line: PP.line, shift, flats: useFlats ? true : key.flats, timeSig: x.timeSig, range: rule.range };
  let T = timelineFromPart(part, { ...ask, fromBar: PP.from, toBar: PP.to });
  if (!T.tl.length) T = timelineFromPart(part, ask);   // a range with no notes: the whole part instead
  const mids = T.tl.map(n => n.midi), tonicPc = key.minor ? (key.pc + 9) % 12 : key.pc, posList = ppPositions(T.tl, inst);
  const partial = T.fromBar > 1 || T.toBar < ppLastBar(part), sid = ppSourceId(PP.title, part.name, T.fromBar, T.toBar);
  const plan = { start: lowestAtOrAbove(tonicPc, Math.min(...mids)), span: 1, requestedSpan: 1, top: Math.max(...mids), clamped: false, fits: !T.outside, warnings: T.warnings.slice(),
    tl: T.tl, inst, pc: key.pc, type: 'piece', bow, pos: posList ? '1' : pos, posList, bpm, beats: T.beats, timeSig: x.timeSig, title: PP.title, part: part.name, from: T.fromBar, to: T.toBar,
    startQ: T.startQ, endQ: T.endQ, shift, sid, label: `${PP.title} · ${part.name}` + (partial ? ` · bars ${T.fromBar}–${T.toBar}` : ''), key: k + '|' + sid };
  ppMemo = { k, plan }; return plan;
}

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
// bytes of a .musicxml / .xml / .mxl -> opened. name: the file name (for its type and as a title when the score has none).
async function ppOpenBytes(bytes, name, src) {
  ppBusy(`Reading ${name}…`);
  try {
    if (bytes.length > PP_MAX_FILE) throw new Error('This file is larger than 25 MB.');
    const det = detectInput({ name, type: '' }, bytes.subarray(0, 8));
    if (det.kind === 'midi') throw new Error('That is a MIDI file. Piece practice reads MusicXML (.musicxml, .xml or .mxl).');
    if (det.kind !== 'musicxml' && det.kind !== 'mxl') throw new Error(`Piece practice reads MusicXML (.musicxml, .xml or .mxl), not ${det.label === 'unknown file' ? 'this kind of file' : det.label}.`);
    const text = det.kind === 'mxl' || (bytes[0] === 0x50 && bytes[1] === 0x4b) ? await mxlToXml(bytes, ppInflate) : ppDecode(bytes);
    ppLoadParsed(parseMusicXml(text), name, src); ppBusy(''); return true;
  } catch (e) { ppBusy(e && e.message ? e.message : String(e), true); return false; }
}
async function ppOpenFile(file) { if (!file) return; if (file.size > PP_MAX_FILE) { ppBusy('This file is larger than 25 MB.', true); return; } return ppOpenBytes(new Uint8Array(await file.arrayBuffer()), file.name, 'file'); }

// Reads a URL into memory (GitHub's two hosts only; the caller built the URL from checked parts).
async function ppFetch(url) {
  let r; try { r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }); } catch { throw new Error(ghExplain(0)); }
  if (!r.ok) throw new Error(ghExplain(r.status, r.headers.get('x-ratelimit-remaining'), r.headers.get('x-ratelimit-reset')));
  if (+r.headers.get('content-length') > GH_MAX_BYTES) throw new Error('This file is larger than 25 MB.');
  const b = new Uint8Array(await r.arrayBuffer()); if (b.length > GH_MAX_BYTES) throw new Error('This file is larger than 25 MB.'); return b;
}

// ================= a score is open: which instrument, which part =================
function ppLoadParsed(x, name, src) {
  PP.parsed = x; PP.id++; PP.src = src; PP.title = cleanTitle(x.title || name, 'MusicXML piece'); PP.sum = summariseParts(x); PP.line = 'top'; PP.oct = 'auto'; PP.backing = false; PP.backOff = new Set();
  PP.bpm0 = Math.max(30, Math.min(240, Math.round(x.bpm) || 80)); $('scBpm').value = PP.bpm0; $('scSig').value = String(ppSigBeats(x.timeSig));
  PP.idx = -1; ppMemo = { k: '', plan: null };
  if (sc.running || demoIdx >= 0) stopScale();
  $('ppSource').hidden = true;
  if (PP.sum.length === 1) ppChoosePart(0); else { $('scInst').disabled = false; settingsChanged(); ppRender(); }
}
function ppChoosePart(i) {
  PP.idx = i; const s = PP.sum[i], part = PP.parsed.parts[i], r = ppDefaultRange(part, PP.line);
  PP.from = r.from; PP.to = r.to; PP.last = r.last; ppMemo = { k: '', plan: null };
  // the instrument configures the scoring (vibrato allowance, hold time) and the fingering hints; a lone, recognised instrument is locked
  $('scInst').value = s.key; $('scInst').disabled = PP.sum.length === 1 && s.exact;
  applyLimits(); if (ruleFor(s.key).positions === 'fretted' && [...$('scPos').options].some(o => o.value === 'auto')) $('scPos').value = 'auto';
  SV.view = 'staff'; SV.showNeck = true;   // Staff and the instrument under it (not saved: the player's own choice of display comes back with the scales)
  settingsChanged(); ppRender();
}
$('ppParts').onclick = e => { const b = e.target.closest('button[data-i]'); if (b) ppChoosePart(+b.dataset.i); };

// ================= the panel =================
function ppRender() {
  const on = PP.on, loaded = !!PP.parsed, chosen = ppActive(), P = $('scPlayer');
  P.classList.toggle('piece', on); P.classList.toggle('pp-pick', on && !chosen);
  $('ppPanel').hidden = !on; document.querySelectorAll('#ppMode button').forEach(b => { const a = (b.dataset.m === 'piece') === on; b.classList.toggle('on', a); b.setAttribute('aria-pressed', a); });
  const lab = document.querySelector('#scPlayer .pl-id b'); if (lab) lab.textContent = on ? 'PIECE NOTATION' : 'SCALE NOTATION';
  if (demoIdx < 0) $('scDemo').textContent = '▶ Hear ' + (chosen ? 'piece' : 'scale');
  $('scRandom').hidden = on;
  $('ppLoaded').hidden = !loaded;
  if (!on || !loaded) return;
  const x = PP.parsed, solo = PP.sum.length === 1;
  $('ppTitle').textContent = PP.title;
  if (chosen) {
    const s = PP.sum[PP.idx], ts = x.timeSig.join('/'), kn = keyInfo(x.key).label;
    $('ppBadge').textContent = solo ? `${solo && s.exact ? 'Detected instrument: ' : 'Detected: '}${s.label}${solo ? ' Solo' : ''}${s.exact ? '' : ' (scored like a piano)'}` : `Playing: ${s.label}`;
    $('ppBadge').className = 'pl-chip' + (solo && s.exact ? ' lock' : '');
    $('ppBadge').title = solo && s.exact ? 'The score has one instrument, so the app set the scoring for it' : s.exact ? 'Chosen from the score\'s part list' : 'This instrument is not one the drills know, so the piano scoring (no vibrato allowance) is used. You can change the instrument above.';
    const p = ppPlan();
    $('ppFrom').value = p.from; $('ppTo').value = p.to; $('ppFrom').max = $('ppTo').max = PP.last; $('ppOf').textContent = `of ${PP.last}`;
    $('ppLine').value = PP.line; $('ppOct').value = PP.oct; $('ppLineW').hidden = !s.polyphonic;
    $('ppInfo').innerHTML = `${ppEsc(kn)} · ${ts} · ♩ = ${Math.round(x.bpm)} in the score · ${p.tl.length} notes in bars ${p.from}–${p.to}` + (p.warnings.length ? '<br>' + p.warnings.map(w => `<span class="warn-t">${ppEsc(w)}</span>`).join(' ') : '');
  } else { $('ppBadge').textContent = ''; $('ppInfo').textContent = ''; }
  // Case B: the list of parts in the file
  $('ppParts').hidden = solo; $('ppParts').classList.toggle('chosen', chosen);
  if (!solo) $('ppParts').innerHTML = `<div class="pp-parts-h">${chosen ? 'Parts in this file' : 'Which part will you play?'}</div>` + PP.sum.map(s => `<button type="button" role="radio" aria-checked="${s.i === PP.idx}" class="pp-part${s.i === PP.idx ? ' on' : ''}" data-i="${s.i}"><b>P${s.i + 1}: ${ppEsc(s.name)}</b><span>${ppEsc(s.label)}${s.exact ? '' : ' · piano scoring'} · ${s.notes} notes · ${midiName(s.lo)}–${midiName(s.hi)}${s.polyphonic ? ' · chords' : ''}</span></button>`).join('');
  // accompaniment: the parts that are not being played
  const others = PP.sum.filter(s => s.i !== PP.idx);
  $('ppBackW').hidden = !chosen || !others.length;
  if (chosen && others.length) {
    $('ppBack').checked = PP.backing;
    $('ppBackList').innerHTML = others.map(s => `<label class="check"><input type="checkbox" data-b="${s.i}" ${PP.backOff.has(s.i) ? '' : 'checked'}> <span>P${s.i + 1}: ${ppEsc(s.name)}</span></label>`).join('');
    $('ppBackNote').textContent = sc.mode === 'wait' ? 'The accompaniment plays in Tempo mode and in "Hear piece"; in Wait mode the music waits for you.' : 'Use headphones: the microphone would hear the speakers.';
  }
}
function ppChanged() { ppMemo = { k: '', plan: null }; settingsChanged(); ppRender(); }
function ppRange() {
  const f = Math.max(1, Math.min(PP.last, +$('ppFrom').value | 0 || 1)), t = Math.max(f, Math.min(PP.last, +$('ppTo').value | 0 || PP.last));
  const part = PP.parsed.parts[PP.idx];
  if (!part.notes.some(n => n.bar >= f && n.bar <= t)) { ppBusy('There are no notes in those bars.', true); ppRender(); return; }
  ppBusy(''); PP.from = f; PP.to = t; ppChanged();
}
$('ppFrom').onchange = $('ppTo').onchange = ppRange;
$('ppLine').onchange = () => { PP.line = $('ppLine').value; const r = ppDefaultRange(PP.parsed.parts[PP.idx], PP.line); if (PP.to > r.to && PP.from === 1) PP.to = r.to; ppChanged(); };
$('ppOct').onchange = () => { PP.oct = $('ppOct').value; ppChanged(); };
['scBpm', 'scBow', 'scPos', 'scInst', 'scSig'].forEach(id => $(id).addEventListener('change', () => { if (ppActive()) { ppMemo = { k: '', plan: null }; ppRender(); } }));
$('ppBack').onchange = () => { PP.backing = $('ppBack').checked; if (!PP.backing) ppBackingStop(); else setMsg('Accompaniment is on: use headphones so the microphone does not hear it'); };
$('ppBackList').onchange = e => { const b = e.target.closest('input[data-b]'); if (!b) return; if (b.checked) PP.backOff.delete(+b.dataset.b); else PP.backOff.add(+b.dataset.b); };
$('scMode').addEventListener('click', () => { if (ppActive()) setTimeout(ppRender, 0); });

// the switch between scales and pieces
function ppSetMode(piece) {
  if (piece === PP.on) return;
  if (sc.running || demoIdx >= 0) stopScale();
  PP.on = piece; ppMemo = { k: '', plan: null };
  if (!piece) {
    $('scInst').disabled = false; $('ppSource').hidden = true;
    try { const v = localStorage.getItem('tuner-scview'); if (SV_VIEWS.includes(v)) SV.view = v; SV.showNeck = localStorage.getItem('tuner-scneck') === '1'; } catch {}   // back to the player's own display
  } else $('ppSource').hidden = !!PP.parsed;
  if (piece && PP.parsed && PP.idx >= 0) { $('scInst').value = PP.sum[PP.idx].key; $('scInst').disabled = PP.sum.length === 1 && PP.sum[PP.idx].exact; SV.view = 'staff'; SV.showNeck = true; }
  applyLimits(); settingsChanged(); ppRender();
}
document.querySelectorAll('#ppMode button').forEach(b => b.onclick = () => ppSetMode(b.dataset.m === 'piece'));
$('ppChange').onclick = () => { $('ppSource').hidden = !$('ppSource').hidden; };

// ================= sources: a local file =================
$('ppPick').onclick = () => $('ppFile').click();
$('ppFile').onchange = async () => { const f = $('ppFile').files[0]; $('ppFile').value = ''; await ppOpenFile(f); };
{ const d = $('ppDrop');
  d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('over'); }); d.addEventListener('dragleave', () => d.classList.remove('over'));
  d.addEventListener('drop', async e => { e.preventDefault(); d.classList.remove('over'); await ppOpenFile(e.dataTransfer.files[0]); });
  d.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === d) { e.preventDefault(); $('ppFile').click(); } }); }

// ================= sources: GitHub (read straight into memory; nothing is saved) =================
const GHB = { spec: null, tree: null, all: [], dir: '', query: '', prefix: '', includeXml: false, seq: 0, preset: null };
const ghbMsg = (t, bad) => { $('ppGhMsg').textContent = t; $('ppGhMsg').className = 'hint2' + (bad ? ' bad-t' : ''); };
function ghbPresets() {
  $('ppGhPresets').innerHTML = GH_PRESETS.map(p => `<button type="button" class="pp-preset" data-id="${p.id}"><b>${ppEsc(p.title)}</b><span>${ppEsc(p.owner)}/${ppEsc(p.repo)}</span><small>${ppEsc(p.note)}</small></button>`).join('');
}
async function ghbLoad(spec, o = {}) {
  const my = ++GHB.seq; GHB.spec = spec; GHB.prefix = o.prefix || ''; GHB.includeXml = !!o.includeXml; GHB.query = ''; GHB.dir = ''; GHB.tree = null; GHB.all = [];
  $('ppGhPresets').hidden = true; $('ppGhOther').hidden = false;   // the catalogue list makes room for the scores (it comes back with "Other libraries")
  $('ppGhBar').hidden = true; $('ppGhSearch').value = ''; $('ppGhXml').checked = GHB.includeXml; $('ppGhList').innerHTML = ''; $('ppGhCrumb').textContent = ''; ghbMsg(`Reading the list of ${spec.owner}/${spec.repo}…`);
  try {
    const tree = JSON.parse(new TextDecoder().decode(await ppFetch(ghTreeUrl(spec)))); if (my !== GHB.seq) return;
    GHB.tree = tree; ghbBuild();
  } catch (e) { if (my === GHB.seq) ghbMsg(e.message, true); }
}
function ghbBuild() {
  const r = ghMusicFiles(GHB.tree, { prefix: GHB.prefix, includeXml: GHB.includeXml }); GHB.all = r.files;
  $('ppGhBar').hidden = false;
  if (!r.files.length) { ghbMsg(`No MusicXML files (.mxl, .musicxml${GHB.includeXml ? ', .xml' : ''}) found${GHB.prefix ? ' in ' + GHB.prefix : ''}.` + (r.truncated ? ' GitHub cut this list short because the repository is very large: paste a link to a folder instead.' : ''), true); $('ppGhList').innerHTML = ''; return; }
  ghbMsg(`${r.files.length} score${r.files.length === 1 ? '' : 's'}` + (r.skipped ? ` · ${r.skipped} over 25 MB left out` : '') + (r.truncated ? ' · the list is incomplete (very large repository): paste a link to a folder to see the rest' : '') + ' · tap one to practise it');
  ghbRender();
}
function ghbRender() {
  const q = GHB.query.trim(), box = $('ppGhList'); let html = '';
  const row = f => `<button type="button" class="pp-file" role="listitem" data-p="${ppEsc(f.path)}"><b>${ppEsc(f.label)}</b><span>${ppEsc(f.ext)} · ${ppKb(f.size)}${q && f.dir ? ' · ' + ppEsc(f.dir) : ''}</span></button>`;
  if (q) { const hits = ghSearch(GHB.all, q); $('ppGhCrumb').textContent = `${hits.length} match${hits.length === 1 ? '' : 'es'}`; html = hits.slice(0, 200).map(row).join('') + (hits.length > 200 ? '<div class="hint2">Showing the first 200: type more to narrow it down.</div>' : ''); }
  else {
    const l = ghCollapse(GHB.all, GHB.dir); GHB.dir = l.dir;
    const parts = l.dir ? l.dir.split('/') : [];
    $('ppGhCrumb').innerHTML = `<button type="button" class="lnk" data-d="">${ppEsc(GHB.spec.repo)}</button>` + parts.map((p, i) => ` / <button type="button" class="lnk" data-d="${ppEsc(parts.slice(0, i + 1).join('/'))}">${ppEsc(p)}</button>`).join('');
    // a folder that holds a single score is shown as that score (a dataset with one folder per piece would otherwise need a click to open each)
    html = l.dirs.map(d => d.count === 1 ? row(GHB.all.find(f => f.path.startsWith(d.path + '/'))) : `<button type="button" class="pp-file dir" role="listitem" data-d="${ppEsc(d.path)}"><b>📁 ${ppEsc(d.name.replace(/_/g, ' '))}</b><span>${d.count} scores</span></button>`).join('') + l.files.map(row).join('');
  }
  box.innerHTML = html || '<div class="hint2">Nothing here.</div>';
}
async function ghbPick(path) {
  const f = GHB.all.find(x => x.path === path); if (!f) return;
  ghbMsg(`Reading ${f.name} (${ppKb(f.size)})…`);
  try {
    const bytes = await ppFetch(ghRawUrl(GHB.spec, f.path));
    $('ppGhMsg').textContent = '';
    if (await ppOpenBytes(bytes, f.name, `github:${GHB.spec.owner}/${GHB.spec.repo}`)) $('ppGh').close(); else ghbMsg($('ppMsg').textContent, true);
  } catch (e) { ghbMsg(e.message, true); }
}
// what was pasted: a file opens at once; a repository or a folder opens the browser on it
async function ppLink(text, fromDialog) {
  const s = ghParseUrl(text);
  if (!s) { (fromDialog ? ghbMsg : ppBusy)('Paste a link to a GitHub repository, a folder in one, or a .mxl / .musicxml file (for example github.com/owner/repo).', true); return; }
  if (s.kind === 'file') {
    if (!GH_MUSIC_EXT.concat('xml').includes(ghExt(s.path))) { (fromDialog ? ghbMsg : ppBusy)('That link is not a MusicXML file (.mxl, .musicxml or .xml).', true); return; }
    const name = s.path.split('/').pop(); (fromDialog ? ghbMsg : ppBusy)(`Reading ${name}…`);
    try { const ok = await ppOpenBytes(await ppFetch(ghRawUrl(s, s.path)), name, `github:${s.owner}/${s.repo}`); if (ok && $('ppGh').open) $('ppGh').close(); } catch (e) { (fromDialog ? ghbMsg : ppBusy)(e.message, true); }
    return;
  }
  if (!$('ppGh').open) $('ppGh').showModal();
  $('ppGhUrl').value = `${s.owner}/${s.repo}`; await ghbLoad(s, { prefix: s.kind === 'dir' ? s.path : '', includeXml: s.kind === 'dir' });
}
$('ppUrlForm').onsubmit = e => { e.preventDefault(); const v = $('ppUrl').value; if (v.trim()) ppLink(v, false); };
$('ppGhForm').onsubmit = e => { e.preventDefault(); ppLink($('ppGhUrl').value, true); };
$('ppBrowse').onclick = () => { ghbPresets(); $('ppGhPresets').hidden = false; $('ppGhOther').hidden = true; $('ppGh').showModal(); };
$('ppGhOther').onclick = () => { GHB.seq++; $('ppGhPresets').hidden = false; $('ppGhOther').hidden = true; $('ppGhBar').hidden = true; $('ppGhList').innerHTML = ''; $('ppGhCrumb').textContent = ''; ghbMsg(''); };
$('ppGhClose').onclick = () => $('ppGh').close();
$('ppGh').addEventListener('click', e => { if (e.target === $('ppGh')) $('ppGh').close(); });   // a click on the dimmed area outside the box
$('ppGhPresets').onclick = e => { const b = e.target.closest('button[data-id]'); if (!b) return; const p = GH_PRESETS.find(x => x.id === b.dataset.id); $('ppGhUrl').value = `${p.owner}/${p.repo}`; ghbLoad({ owner: p.owner, repo: p.repo, ref: '', path: '', kind: 'repo' }, { prefix: p.prefix, includeXml: p.includeXml }); };
$('ppGhSearch').oninput = () => { GHB.query = $('ppGhSearch').value; ghbRender(); };
$('ppGhXml').onchange = () => { GHB.includeXml = $('ppGhXml').checked; if (GHB.tree) ghbBuild(); };
$('ppGhCrumb').onclick = e => { const b = e.target.closest('button[data-d]'); if (b) { GHB.dir = b.dataset.d; ghbRender(); } };
$('ppGhList').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.p) ghbPick(b.dataset.p); else if (b.dataset.d != null) { GHB.dir = b.dataset.d; ghbRender(); } };

// ================= the other parts, as sound =================
// While a piece runs in Tempo mode (or "Hear piece"), the parts the player is not playing are played by the app's own synth, scheduled just ahead on the audio clock.
// startAt: the audio time of the first note. Called again for every loop, which restarts the accompaniment on the new first note.
const PPB = { events: [], key: '', i: 0, t0: 0, timer: 0, nodes: [] };
function ppBackingEvents() {
  const p = sc.plan && sc.plan.type === 'piece' ? sc.plan : ppPlan(), only = PP.sum.map(s => s.i).filter(i => i !== PP.idx && !PP.backOff.has(i));
  const k = [p.key, only.join()].join('/'); if (PPB.key !== k) { PPB.key = k; PPB.events = backingEvents(PP.parsed.parts, PP.idx, { bpm: p.bpm, shift: p.shift, startQ: p.startQ, endQ: p.endQ, only }); }
  return PPB.events;
}
function ppBackingBegin(startAt, anyMode) {
  if (!ppActive() || !PP.backing || !(anyMode || sc.mode === 'tempo') || !ppBackingEvents().length) return;
  PPB.t0 = startAt; PPB.i = 0; if (!PPB.timer) PPB.timer = setInterval(ppBackingPump, 100); ppBackingPump();
}
function ppBackingPump() {
  const c = getCtx(), A = a4();
  while (PPB.i < PPB.events.length) {
    const e = PPB.events[PPB.i], at = PPB.t0 + e.startMs / 1000; if (at > c.currentTime + 0.8) break; PPB.i++;
    const d = e.durationMs / 1000; if (at + d < c.currentTime) continue;
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter(), a = Math.max(at, c.currentTime);
    o.type = 'triangle'; o.frequency.value = noteToFreq(e.midi, A); lp.type = 'lowpass'; lp.frequency.value = 2600;
    g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(0.09, a + 0.02); g.gain.setValueAtTime(0.09, Math.max(a + 0.02, at + d - 0.06)); g.gain.linearRampToValueAtTime(0.0001, at + d);
    o.connect(lp); lp.connect(g); g.connect(c.destination); o.start(a); o.stop(at + d + 0.03); PPB.nodes.push(o); o.onended = () => { PPB.nodes = PPB.nodes.filter(x => x !== o); };
  }
  if (PPB.i >= PPB.events.length && !PPB.nodes.length) { clearInterval(PPB.timer); PPB.timer = 0; }
}
function ppBackingStop() { clearInterval(PPB.timer); PPB.timer = 0; PPB.i = PPB.events.length; PPB.nodes.forEach(o => { try { o.stop(); } catch {} }); PPB.nodes = []; }

ppRender();
