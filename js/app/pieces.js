// Pieces tab: the library (instrument tabs, search, categories, packs) and the single "Add a piece" screen.
// Whatever arrives (dropped or picked file, pasted link) is detected, never chosen. MIDI and MusicXML become exact pieces; audio, video, PDF and YouTube are
// recognised and explained, and wait for the importers of the next phase. Pieces live only on this device (IndexedDB, see library-db.js), never in the code.
// The pure logic is in js/core/piece.js, musicxml.js and library.js. The piece view (listen, loop, transpose) is in piece-view.js. Part of the app: shared scope.

const PC = { lib: [], packs: [], inst: 'violin', path: [], q: '', f: {}, adding: [] };
const pcEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pcMin = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const pcInfo = p => { const n = pieceNotes(p); return `${n.length} notes · ${pcMin(pieceSeconds(p))}${p.bpm ? ' · ' + Math.round(p.bpm) + ' BPM' : ''}${p.timeSig ? ' · ' + p.timeSig.join('/') : ''}`; };
async function pcInflate(b) { const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(); w.write(b); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
const pcInstKey = () => 'tuner-libinst-' + (profile || '');
const pcMsg = (t, cls) => { $('pcMsg').textContent = t; $('pcMsg').className = 'hint2 ' + (cls || ''); };

// ----- views: home (library), add, piece -----
function pcView(v) {
  for (const [k, id] of [['home', 'pcHome'], ['add', 'pcAddView'], ['piece', 'pcPiece']]) $(id).classList.toggle('hide', v !== k);
  if (v === 'home') pcRenderHome(); else if (v === 'add') { pcSteps(1); pcSyncInst(); }
  scrollTo(0, 0);
}
function pcSteps(n) { [1, 2, 3].forEach(i => { const li = $('pcS' + i); li.classList.toggle('on', i <= n); if (i === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); }); }

// ----- the library -----
const pcAllFor = inst => PC.lib.filter(p => p.instrument === inst).concat(generatorPieces(inst));
const pcFind = id => PC.lib.find(p => p.id === id) || [].concat(...LIB_INSTRUMENTS.map(generatorPieces)).find(p => p.id === id) || null;
async function pcLoad() {
  try {
    try { const old = JSON.parse(localStorage.getItem('tuner-pieces-v1')); if (Array.isArray(old) && old.length) { await LIBDB.put(old.map(p => Object.assign({ categoryPath: ['My imports'], builtin: false, favourite: false, verified: true }, p))); } localStorage.removeItem('tuner-pieces-v1'); } catch {}   // pieces saved by the first Add-a-piece version
    PC.lib = await LIBDB.all(); PC.packs = await LIBDB.packs();
  } catch (e) { PC.lib = []; PC.packs = []; pcMsg('The library could not be opened on this device: ' + (e.message || e), 'bad-t'); }
  pcRenderHome();
}
function pcSetInst(k, fromUi) {
  if (!LIB_INSTRUMENTS.includes(k)) k = 'violin';
  PC.inst = k; PC.path = []; try { localStorage.setItem(pcInstKey(), k); } catch {}
  if (fromUi && prof.k !== k) applyProfile(k);                  // the Tuner, Scale drills, pitch range and Recorder follow the instrument
  pcRenderHome(); pcSyncInst();
}
function pcSyncInst() { for (const x of $('pcInst').children) { const on = x.dataset.i === PC.inst; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); } }
function pcRenderHome() {
  for (const x of $('pcLibInst').children) { const on = x.dataset.i === PC.inst; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  for (const x of $('pcFilters').children) { const on = !!PC.f[x.dataset.f]; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  const all = pcAllFor(PC.inst), searching = PC.q.trim() || Object.values(PC.f).some(Boolean), tree = buildTree(all, PC.inst);
  let node = treeAt(tree, PC.path); if (!node) { PC.path = []; node = tree; }
  const crumbs = [`<button type="button" data-crumb="-1">${LIB_INSTRUMENT_NAMES[PC.inst]}</button>`].concat(PC.path.map((c, i) => `<button type="button" data-crumb="${i}">${pcEsc(c)}</button>`));
  $('pcCrumb').innerHTML = searching ? '' : (PC.path.length ? crumbs.join('<span aria-hidden="true">›</span>') : '');
  let html = '';
  if (searching) {
    const found = searchPieces(all, PC.q, PC.f); html = found.length ? found.slice(0, 80).map(pcRow).join('') + (found.length > 80 ? `<p class="mut">${found.length - 80} more. Type more of the name to narrow it down.</p>` : '') : '<p class="mut">Nothing matches.</p>';
  } else {
    const l = listNode(node);
    html = l.folders.map(f => `<button type="button" class="pc-folder" data-folder="${pcEsc(f.name)}"><span><b>${pcEsc(f.name)}</b><small>${f.count} piece${f.count === 1 ? '' : 's'}</small></span><i aria-hidden="true">›</i></button>`).join('') + l.pieces.map(pcRow).join('');
    if (!html) html = '<div class="home-card"><b>Nothing here yet</b><p class="mut">Add a piece, or import a folder of MIDI or MusicXML files, and it will be kept on this device.</p></div>';
  }
  $('pcList').innerHTML = html;
  $('pcPacks').innerHTML = PC.packs.length ? PC.packs.map(p => `<div class="pc-item"><div><b>${pcEsc(p.name)}</b><small>${p.itemCount} pieces</small></div><button type="button" class="sec" data-rmpack="${pcEsc(p.id)}">Remove pack</button></div>`).join('') : '';
}
const pcRow = p => `<div class="pc-item"><div><b>${pcEsc(p.title)}</b><small>${pcEsc((p.categoryPath || []).join(' › '))}${p.generator ? '' : ' · ' + pcEsc(p.verified || p.exact ? 'Verified' : 'Draft')}${p.favourite ? ' · ♥' : ''}</small></div><div class="pc-acts">${p.builtin || (typeof plUsable === 'function' && plUsable(p)) ? '' : `<button type="button" data-listen="${pcEsc(p.id)}">Listen</button>`}<button type="button" class="sec" data-practise="${pcEsc(p.id)}">Practise</button></div></div>`;   // no Listen on built-in pieces and MusicXML pieces: Piece practice has Hear piece (and Scale drills Hear scale)
$('pcList').addEventListener('click', e => {
  const f = e.target.closest('[data-folder]'); if (f) { PC.path.push(f.dataset.folder); pcRenderHome(); return; }
  const l = e.target.closest('[data-listen]'), pr = e.target.closest('[data-practise]');
  if (l) pvOpen(l.dataset.listen, true); else if (pr) { if (typeof ppOpenLibPiece === 'function' && ppOpenLibPiece(pr.dataset.practise)) return; pvOpen(pr.dataset.practise, false); }   // a MusicXML piece is practised with scoring in Piece practice
});
$('pcCrumb').addEventListener('click', e => { const b = e.target.closest('[data-crumb]'); if (b) { PC.path = PC.path.slice(0, +b.dataset.crumb + 1); pcRenderHome(); } });
$('pcLibInst').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) pcSetInst(b.dataset.i, true); });
$('pcFilters').addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (!b) return; PC.f[b.dataset.f] = !PC.f[b.dataset.f]; if (b.dataset.f === 'builtin' && PC.f.builtin) PC.f.mine = false; if (b.dataset.f === 'mine' && PC.f.mine) PC.f.builtin = false; pcRenderHome(); });
$('pcSearch').addEventListener('input', () => { PC.q = $('pcSearch').value; pcRenderHome(); });
$('pcAdd').onclick = () => { pcView('add'); pcMsg(''); };
$('pcBack').onclick = () => pcView('home');

// ----- packs: a folder or a .zip of MIDI / MusicXML files -----
async function pcImportPack(entries, name) {
  const { items, skipped } = parsePackPaths(entries.map(e => e.path), PC.inst), byPath = new Map(entries.map(e => [e.path, e])), packId = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), out = []; let bad = 0;
  if (!items.length) { pcMsg(`No MIDI or MusicXML files were found${skipped.length ? ' (' + skipped.length + ' other files were skipped)' : ''}.`, 'bad-t'); return; }
  for (let i = 0; i < items.length && i < 3000; i++) {
    const it = items[i]; pcMsg(`Reading ${i + 1} of ${items.length}…`);
    try {
      const data = await byPath.get(it.path).read(), kind = detectInput({ name: it.path }, data instanceof Uint8Array ? data : null).kind;
      const p = kind === 'midi' ? pieceFromMidi(data, { name: it.title, instrument: it.instrument }) : pieceFromMusicXml(kind === 'mxl' ? await mxlToXml(data, pcInflate) : (typeof data === 'string' ? data : new TextDecoder().decode(data)), { name: it.title, instrument: it.instrument });
      p.title = it.title; p.instrument = it.instrument; p.categoryPath = it.categoryPath; p.builtin = false; p.favourite = false; p.verified = true; p.pack = packId; p.part = suggestPart(p.instrument, p.parts); out.push(p);
    } catch { bad++; }
    if (i % 20 === 19) await new Promise(r => setTimeout(r, 0));
  }
  try { await LIBDB.put(out); await LIBDB.putPack({ id: packId, name, itemCount: out.length, importedAt: Date.now() }); }
  catch (e) { pcMsg('There is not enough space on this device to keep this pack: ' + (e.message || e), 'bad-t'); return; }
  PC.lib = await LIBDB.all(); PC.packs = await LIBDB.packs(); if (out.length) PC.inst = out[0].instrument, PC.path = [];
  pcRenderHome(); pcMsg(`Imported ${out.length} piece${out.length === 1 ? '' : 's'} from “${name}”${bad ? `; ${bad} could not be read` : ''}${skipped.length ? `; ${skipped.length} other files skipped` : ''}.`, 'ok-t');
}
$('pcPackDir').onchange = e => { const f = [...e.target.files]; e.target.value = ''; if (!f.length) return; pcImportPack(f.map(x => ({ path: x.webkitRelativePath || x.name, read: async () => new Uint8Array(await x.arrayBuffer()) })), (f[0].webkitRelativePath || '').split('/')[0] || 'Folder'); };
$('pcPackZip').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const files = zipEntries(new Uint8Array(await f.arrayBuffer())).filter(z => !z.name.endsWith('/'));
    await pcImportPack(files.map(z => ({ path: z.name, read: async () => z.method === 0 ? z.data : await pcInflate(z.data) })), f.name.replace(/\.zip$/i, ''));
  } catch (err) { pcMsg('Could not read that .zip: ' + (err.message || err), 'bad-t'); }
};
$('pcDirBtn').onclick = () => $('pcPackDir').click(); $('pcZipBtn').onclick = () => $('pcPackZip').click();
$('pcPacks').addEventListener('click', async e => { const b = e.target.closest('[data-rmpack]'); if (!b || !confirm('Remove this pack and all its pieces from this device? The original files are not touched.')) return; await LIBDB.delPack(b.dataset.rmpack); PC.lib = await LIBDB.all(); PC.packs = await LIBDB.packs(); pcRenderHome(); });

// ----- adding one or more files -----
async function pcAddFiles(files) {
  pcMsg('');
  for (const f of files) {
    let head = null; try { head = new Uint8Array(await f.slice(0, 8).arrayBuffer()); } catch {}
    const det = detectInput({ name: f.name, type: f.type }, head), item = { name: f.name, det, piece: null, error: '' };
    if (det.exact) {
      try {
        if (det.kind === 'midi') item.piece = pieceFromMidi(new Uint8Array(await f.arrayBuffer()), { name: f.name, instrument: PC.inst });
        else item.piece = pieceFromMusicXml(det.kind === 'mxl' ? await mxlToXml(new Uint8Array(await f.arrayBuffer()), pcInflate) : await f.text(), { name: f.name, instrument: PC.inst });
      } catch (err) { item.error = err.message || String(err); }
    }
    PC.adding.push(item);
  }
  pcRenderQueue();
}
function pcAddLink(url) {
  url = url.trim(); if (!url) return;
  PC.adding.push({ name: url, det: detectInput({ link: url }), piece: null, error: '' }); $('pcLink').value = ''; pcRenderQueue();
}
const pcCap = s => s.charAt(0).toUpperCase() + s.slice(1);
function pcRenderQueue() {
  const Q = PC.adding, ready = Q.filter(q => q.piece).length;
  $('pcDetect').innerHTML = Q.map(q => `<div class="pc-det">Detected: <b>${pcEsc(q.det.label)}</b>${q.det.unsupported ? '.' : ', ' + pcEsc(q.det.note) + '.'}${q.det.unsupported ? ' ' + pcEsc(pcCap(q.det.note)) + '.' : ''}</div>`).join('');
  $('pcQueue').innerHTML = Q.map((q, i) => {
    if (q.error) return `<div class="pc-card pc-bad" role="alert"><b>${pcEsc(q.name)}</b><p>Could not read this file: ${pcEsc(q.error)}</p><button type="button" class="sec" data-rm="${i}">Remove</button></div>`;
    if (!q.piece) return `<div class="pc-card"><b>${pcEsc(q.name)}</b><p class="mut">${q.det.unsupported ? pcEsc(pcCap(q.det.note)) + '.' : 'This needs the audio importer, which arrives in the next update. Nothing is saved yet.' + (q.det.needs === 'helper' ? ' It will also need the helper running on your computer.' : '')}</p><button type="button" class="sec" data-rm="${i}">Remove</button></div>`;
    const p = q.piece;
    return `<div class="pc-card"><label class="field"><span>Title</span><input data-title="${i}" maxlength="80" value="${pcEsc(p.title)}"></label>
      <fieldset class="pc-parts"><legend>Which part is the ${pcEsc(PC.inst)}?</legend>${p.parts.map((pt, k) => { const ms = pt.notes.map(n => n.midi); return `<label class="pc-part"><input type="radio" name="part${i}" data-part="${i}|${k}"${k === p.part ? ' checked' : ''}><span><b>${pcEsc(pt.name)}</b><small>${pt.notes.length} notes, ${midiName(Math.min(...ms))}–${midiName(Math.max(...ms))}</small></span></label>`; }).join('')}</fieldset>
      <p class="hint2">${pcEsc(pcInfo(p))}. Exact notes: no Draft step needed.</p><button type="button" class="sec" data-rm="${i}">Remove</button></div>`;
  }).join('');
  $('pcSaveRow').classList.toggle('hide', !ready); $('pcSaveAll').textContent = ready > 1 ? `Save ${ready} pieces` : 'Save to my pieces';
  $('pcCatList').innerHTML = [...new Set(pcAllFor(PC.inst).filter(p => !p.builtin).map(p => (p.categoryPath || []).join('/')))].map(c => `<option value="${pcEsc(c)}">`).join('');
  pcSteps(ready || Q.length ? 2 : 1);
}
$('pcQueue').addEventListener('input', e => { const t = e.target.closest('[data-title]'); if (t) PC.adding[+t.dataset.title].piece.title = cleanTitle(t.value, 'Untitled'); });
$('pcQueue').addEventListener('change', e => { const r = e.target.closest('[data-part]'); if (r) { const [i, k] = r.dataset.part.split('|'); PC.adding[+i].piece.part = +k; } });
$('pcQueue').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { PC.adding.splice(+b.dataset.rm, 1); pcRenderQueue(); } });
$('pcSaveAll').onclick = async () => {
  const ok = PC.adding.filter(q => q.piece); if (!ok.length) return;
  const cat = $('pcCat').value.split('/').map(s => s.replace(/[<>&"]/g, '').trim()).filter(Boolean).slice(0, 4), path = cat.length ? cat : ['My imports'];
  for (const q of ok) Object.assign(q.piece, { categoryPath: path, instrument: PC.inst, builtin: false, favourite: false, verified: true, pack: null });
  try { await LIBDB.put(ok.map(q => q.piece)); } catch (e) { pcMsg('There is not enough space on this device to keep this piece. Delete one you no longer need and try again.', 'bad-t'); return; }
  PC.lib = await LIBDB.all(); PC.adding = PC.adding.filter(q => !q.piece); pcRenderQueue(); pcSteps(3);
  pcMsg(`Saved ${ok.length === 1 ? '“' + ok[0].piece.title + '”' : ok.length + ' pieces'} in ${path.join(' › ')}. Find ${ok.length === 1 ? 'it' : 'them'} on the Pieces screen.`, 'ok-t');
};

// ----- the input card -----
const pcPick = () => $('pcFile').click();
$('pcUpload').onclick = e => { e.stopPropagation(); pcPick(); };
$('pcDrop').addEventListener('click', pcPick);
$('pcDrop').addEventListener('keydown', e => { if (e.target === $('pcDrop') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pcPick(); } });
$('pcFile').onchange = e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) pcAddFiles(f); };
for (const ev of ['dragenter', 'dragover']) $('pcDrop').addEventListener(ev, e => { e.preventDefault(); $('pcDrop').classList.add('over'); });
for (const ev of ['dragleave', 'drop']) $('pcDrop').addEventListener(ev, e => { e.preventDefault(); $('pcDrop').classList.remove('over'); });
$('pcDrop').addEventListener('drop', e => { const f = [...(e.dataTransfer ? e.dataTransfer.files : [])]; if (f.length) pcAddFiles(f); });
$('pcLink').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pcAddLink($('pcLink').value); } });
$('pcLink').addEventListener('paste', () => setTimeout(() => pcAddLink($('pcLink').value), 0));
$('pcRec').onclick = () => pcMsg('Recording a demo performance arrives with the audio importer. To try the microphone now, use Free record on the Practice tab.');
$('pcInst').addEventListener('click', e => {
  const b = e.target.closest('button[data-i]'); if (!b) return; PC.inst = b.dataset.i; try { localStorage.setItem(pcInstKey(), PC.inst); } catch {} pcSyncInst();
  for (const q of PC.adding) if (q.piece) { q.piece.instrument = PC.inst; q.piece.part = suggestPart(PC.inst, q.piece.parts); }
  pcRenderQueue();
});

function pcPlayerChanged() { let k = null; try { k = localStorage.getItem(pcInstKey()); } catch {} if (LIB_INSTRUMENTS.includes(k) && k !== PC.inst) pcSetInst(k, true); }

// ----- start-up: the instrument the player used last (or the one in Settings), then the stored library -----
(() => { let k = null; try { k = localStorage.getItem(pcInstKey()); } catch {} PC.inst = LIB_INSTRUMENTS.includes(k) ? k : (LIB_INSTRUMENTS.includes(prof.k) ? prof.k : 'violin'); })();
pcSyncInst(); pcLoad();
