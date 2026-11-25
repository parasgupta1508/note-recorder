// Pieces tab: the library list and the single "Add a piece" screen.
// Whatever arrives (dropped or picked file, pasted link) is detected, never chosen. MIDI and MusicXML become exact pieces here; audio, video, PDF and YouTube are
// recognised and explained, and wait for the importers of the next phase. Pieces live only on this device (localStorage), and are never part of the code.
// The pure logic (detectInput, pieceFromMidi, pieceFromMusicXml) is in js/core/piece.js and musicxml.js. Part of the app: shared scope.

const PIECES_KEY = 'tuner-pieces-v1';
let pcQueue = [], pcInst = ['violin', 'guitar', 'ukulele'].includes(prof.k) ? prof.k : 'violin';
const pcEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pcLoad = () => { const l = lsGet(PIECES_KEY, []); return Array.isArray(l) ? l : []; };
const pcStore = l => { try { localStorage.setItem(PIECES_KEY, JSON.stringify(l)); return true; } catch { return false; } };
const pcMin = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const pcNoteName = m => midiName(m);
const pcInfo = p => { const n = pieceNotes(p); return `${n.length} notes · ${pcMin(pieceSeconds(p))}${p.bpm ? ' · ' + Math.round(p.bpm) + ' BPM' : ''}${p.timeSig ? ' · ' + p.timeSig.join('/') : ''}`; };
async function pcInflate(b) { const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(); w.write(b); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }

function pcView(v) {
  $('pcHome').classList.toggle('hide', v !== 'home'); $('pcAddView').classList.toggle('hide', v !== 'add');
  if (v === 'home') pcRenderList(); else pcSteps(1);
  scrollTo(0, 0);
}
function pcSteps(n) { [1, 2, 3].forEach(i => { const li = $('pcS' + i); li.classList.toggle('on', i <= n); if (i === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); }); }

function pcRenderList() {
  const l = pcLoad();
  $('pcList').innerHTML = l.length ? l.map((p, i) => `<div class="pc-item"><div><b>${pcEsc(p.title)}</b><small>${pcEsc(p.instrument)} · ${pcEsc((p.parts[p.part] || p.parts[0]).name)} · ${pcEsc(pcInfo(p))}</small></div><button type="button" class="sec" data-del="${i}" aria-label="Delete ${pcEsc(p.title)}">Delete</button></div>`).join('')
    : '<div class="home-card"><b>Nothing here yet</b><p class="mut">Add a piece (MIDI or MusicXML for exact notes) and it will be kept on this device.</p></div>';
}
$('pcList').addEventListener('click', e => {
  const b = e.target.closest('[data-del]'); if (!b) return; const l = pcLoad(), p = l[+b.dataset.del]; if (!p) return;
  if (!confirm(`Delete “${p.title}” from this device?`)) return; l.splice(+b.dataset.del, 1); pcStore(l); pcRenderList();
});

// ----- adding -----
async function pcAddFiles(files) {
  $('pcMsg').textContent = '';
  for (const f of files) {
    let head = null; try { head = new Uint8Array(await f.slice(0, 8).arrayBuffer()); } catch {}
    const det = detectInput({ name: f.name, type: f.type }, head), item = { name: f.name, det, piece: null, error: '' };
    if (det.exact) {
      try {
        if (det.kind === 'midi') item.piece = pieceFromMidi(new Uint8Array(await f.arrayBuffer()), { name: f.name, instrument: pcInst });
        else item.piece = pieceFromMusicXml(det.kind === 'mxl' ? await mxlToXml(new Uint8Array(await f.arrayBuffer()), pcInflate) : await f.text(), { name: f.name, instrument: pcInst });
      } catch (err) { item.error = err.message || String(err); }
    }
    pcQueue.push(item);
  }
  pcRenderQueue();
}
function pcAddLink(url) {
  url = url.trim(); if (!url) return;
  pcQueue.push({ name: url, det: detectInput({ link: url }), piece: null, error: '' }); $('pcLink').value = ''; pcRenderQueue();
}
function pcRenderQueue() {
  const ready = pcQueue.filter(q => q.piece).length;
  $('pcDetect').innerHTML = pcQueue.map(q => `<div class="pc-det">Detected: <b>${pcEsc(q.det.label)}</b>${q.det.unsupported ? '' : ', ' + pcEsc(q.det.note)}.${q.det.unsupported ? ' ' + pcEsc(q.det.note.charAt(0).toUpperCase() + q.det.note.slice(1)) + '.' : ''}</div>`).join('');
  $('pcQueue').innerHTML = pcQueue.map((q, i) => {
    if (q.error) return `<div class="pc-card pc-bad" role="alert"><b>${pcEsc(q.name)}</b><p>Could not read this file: ${pcEsc(q.error)}</p><button type="button" class="sec" data-rm="${i}">Remove</button></div>`;
    if (!q.piece) return `<div class="pc-card"><b>${pcEsc(q.name)}</b><p class="mut">${q.det.unsupported ? pcEsc(q.det.note.charAt(0).toUpperCase() + q.det.note.slice(1)) + '.' : 'This needs the audio importer, which arrives in the next update. Nothing is saved yet.' + (q.det.needs === 'helper' ? ' It will also need the helper running on your computer.' : '')}</p><button type="button" class="sec" data-rm="${i}">Remove</button></div>`;
    const p = q.piece;
    return `<div class="pc-card"><label class="field"><span>Title</span><input data-title="${i}" maxlength="80" value="${pcEsc(p.title)}"></label>
      <fieldset class="pc-parts"><legend>Which part is the ${pcEsc(pcInst)}?</legend>${p.parts.map((pt, k) => { const ms = pt.notes.map(n => n.midi); return `<label class="pc-part"><input type="radio" name="part${i}" data-part="${i}|${k}"${k === p.part ? ' checked' : ''}><span><b>${pcEsc(pt.name)}</b><small>${pt.notes.length} notes, ${pcNoteName(Math.min(...ms))}–${pcNoteName(Math.max(...ms))}</small></span></label>`; }).join('')}</fieldset>
      <p class="hint2">${pcEsc(pcInfo(p))}. Exact notes: no Draft step needed.</p><button type="button" class="sec" data-rm="${i}">Remove</button></div>`;
  }).join('');
  $('pcSaveRow').classList.toggle('hide', !ready); $('pcSaveAll').textContent = ready > 1 ? `Save ${ready} pieces` : 'Save to my pieces';
  pcSteps(ready || pcQueue.length ? 2 : 1);
}
$('pcQueue').addEventListener('input', e => { const t = e.target.closest('[data-title]'); if (t) pcQueue[+t.dataset.title].piece.title = cleanTitle(t.value, 'Untitled'); });
$('pcQueue').addEventListener('change', e => { const r = e.target.closest('[data-part]'); if (r) { const [i, k] = r.dataset.part.split('|'); pcQueue[+i].piece.part = +k; } });
$('pcQueue').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { pcQueue.splice(+b.dataset.rm, 1); pcRenderQueue(); } });
$('pcSaveAll').onclick = () => {
  const ok = pcQueue.filter(q => q.piece), l = pcLoad();
  if (!ok.length) return;
  for (const q of ok) l.push(q.piece);
  if (!pcStore(l)) { $('pcMsg').textContent = 'There is not enough space on this device to keep this piece. Delete one you no longer need and try again.'; $('pcMsg').className = 'hint2 bad-t'; return; }
  pcQueue = pcQueue.filter(q => !q.piece); pcRenderQueue(); pcSteps(3);
  $('pcMsg').className = 'hint2 ok-t'; $('pcMsg').textContent = `Saved ${ok.length === 1 ? '“' + ok[0].piece.title + '”' : ok.length + ' pieces'}. Find ${ok.length === 1 ? 'it' : 'them'} on the Pieces screen.`;
};

// ----- the input card -----
$('pcAdd').onclick = () => { pcView('add'); $('pcMsg').textContent = ''; };
$('pcBack').onclick = () => pcView('home');
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
$('pcRec').onclick = () => { $('pcMsg').className = 'hint2'; $('pcMsg').textContent = 'Recording a demo performance arrives with the audio importer. To try the microphone now, use Free record on the Practice tab.'; };
$('pcInst').addEventListener('click', e => {
  const b = e.target.closest('button[data-i]'); if (!b) return; pcInst = b.dataset.i;
  for (const x of $('pcInst').children) { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  for (const q of pcQueue) if (q.piece) { q.piece.instrument = pcInst; q.piece.part = suggestPart(pcInst, q.piece.parts); }
  pcRenderQueue();
});
for (const x of $('pcInst').children) { const on = x.dataset.i === pcInst; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); }
pcRenderList();
