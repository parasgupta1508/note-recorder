// Lab page: YouTube link or audio file -> reference MIDI from other open-source tools -> compare with the notes this app finds.
// The downloading and the other tools run in the helper on the computer (tools/lab/server.js). The comparing runs here, with the app's own detectors.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

const LAB_KEY = 'tuner-lab';
const LAB_NAMES = { basicpitch: 'Basic Pitch (Spotify)', mpm: 'McLeod pitch (pitchy)', pyin: 'pYIN (librosa)', crepe: 'CREPE (torchcrepe)', custom: 'Your .mid file', consensus: 'Consensus (2+ tools agree)' };
const LAB = { ok: false, tried: false, status: null, lib: [], cur: null, busy: false, last: null, store: { url: 'http://localhost:8787', hist: [] } };
try { const o = JSON.parse(localStorage.getItem(LAB_KEY)); if (o) { LAB.store.url = o.url || LAB.store.url; LAB.store.hist = Array.isArray(o.hist) ? o.hist : []; } } catch {}
const labSave = () => { try { localStorage.setItem(LAB_KEY, JSON.stringify(LAB.store)); } catch {} };
const labBase = () => ($('labUrl').value.trim() || LAB.store.url).replace(/\/+$/, '');
const labSay = (m, warn) => { $('labMsg').textContent = m || ''; $('labMsg').style.color = warn ? 'var(--bad)' : ''; };
const labProg = p => { const b = $('labProg'); b.classList.toggle('hide', p == null); if (p != null) b.firstElementChild.style.width = Math.round(p * 100) + '%'; };
const labPct = v => v == null ? '–' : Math.round(v * 100) + '%';
const labRefName = k => { const [e, st] = k.split('.'); return (LAB_NAMES[e] || e) + (st ? ' · ' + st : ''); };
const labEngKeys = c => Object.keys(c.refs).sort((a, b) => Object.keys(LAB_NAMES).indexOf(a.split('.')[0]) - Object.keys(LAB_NAMES).indexOf(b.split('.')[0]) || a.length - b.length);

// ---------- helper connection ----------
async function labFetchJson(path, body) {
  const r = await fetch(labBase() + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Helper error ' + r.status); return j;
}
async function labWait(jobId, onUpdate) {
  for (;;) {
    const j = await labFetchJson('/api/job/' + jobId); onUpdate && onUpdate(j);
    if (j.status === 'done') return j.result; if (j.status === 'error') throw new Error(j.error || 'The helper failed.');
    await new Promise(r => setTimeout(r, 700));
  }
}
async function labConnect() {
  LAB.tried = true; $('labState').textContent = 'checking…'; $('labState').classList.remove('ok');
  try {
    LAB.status = await labFetchJson('/api/status?fresh=1'); LAB.ok = true; LAB.store.url = labBase(); labSave();
    $('labState').textContent = 'connected'; $('labState').classList.add('ok'); $('labHelp').classList.add('hide');
    const t = LAB.status.tools; $('labEngines').textContent = (t.ytdlp ? '' : 'YouTube downloads need setup (node tools/lab/setup.js). ') + (t.ffmpeg ? '' : 'ffmpeg is missing. ') + (t.separate ? '' : 'Listening to one instrument needs: node tools/lab/setup.js --separate. ');
    for (const o of $('labStem').options) if (o.value) o.disabled = !t.separate;
    await labLoadLib();
  } catch {
    LAB.ok = false; LAB.status = null; $('labState').textContent = 'not running'; $('labHelp').classList.remove('hide');
    $('labHelp').innerHTML = 'The helper is not running. Open a terminal in the project folder and run <b>node tools/lab/server.js</b> (the first time, run <b>node tools/lab/setup.js</b> before it), then press Connect. You can still use an audio file and a .mid file here without it.';
  }
  labEngUi(); labUi();
}
async function labLoadLib() {
  try { LAB.lib = (await labFetchJson('/api/library')).items; } catch { LAB.lib = []; }
  const sel = $('labLib'), keep = LAB.cur && LAB.cur.id;
  sel.innerHTML = '<option value="">' + (LAB.lib.length ? '— pick a saved clip —' : '— none yet —') + '</option>' + LAB.lib.map(i => `<option value="${esc(i.id)}"${i.id === keep ? ' selected' : ''}>${esc(i.title)} (${i.start}s, ${i.len}s${i.engines.length ? ', ' + i.engines.length + ' MIDI' : ''})</option>`).join('');
}
function labEngUi() {
  const E = LAB.status ? LAB.status.engines : {}, on = new Set([...$('labEngPick').querySelectorAll('input:checked')].map(i => i.value));
  const first = !$('labEngPick').children.length;
  $('labEngPick').innerHTML = Object.keys(LAB_NAMES).filter(k => E[k]).map(k => `<label class="lab-check${E[k].ready ? '' : ' off'}"><input type="checkbox" value="${k}"${E[k].ready ? '' : ' disabled'}${(first ? ['basicpitch', 'mpm'].includes(k) : on.has(k)) && E[k].ready ? ' checked' : ''}> <span>${esc(E[k].name)} <small>· ${esc(E[k].kind)}${E[k].ready ? '' : ' · not installed'}</small></span></label>`).join('') || '<span class="mut lab-small">Connect the helper to pick tools.</span>';
}

// ---------- audio ----------
async function labDecode(buf) {
  const ab = await getCtx().decodeAudioData(buf), n = ab.length, x = new Float32Array(n), nc = ab.numberOfChannels;
  for (let c = 0; c < nc; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) x[i] += d[i] / nc; }
  return { x, sr: ab.sampleRate };
}
function labSetAudio(buf, mime) { const a = $('labAudio'); if (a.src) URL.revokeObjectURL(a.src); a.src = URL.createObjectURL(new Blob([buf], { type: mime || 'audio/mpeg' })); a.classList.remove('hide'); }
async function labPick(id) {
  if (!id) return; const info = LAB.lib.find(i => i.id === id); if (!info) return;
  labBusy(true); labSay('Loading the clip…');
  try {
    const buf = await (await fetch(`${labBase()}/api/item/${id}/audio`)).arrayBuffer(); labSetAudio(buf.slice(0), 'audio/mpeg');
    const { x, sr } = await labDecode(buf), refs = {};
    for (const e of info.engines) { try { refs[e] = (await labFetchJson(`/api/item/${id}/${e}.json`)).notes; } catch {} }
    LAB.cur = { id, title: info.title, x, sr, dur: x.length / sr, refs, start: info.start }; LAB.last = null; labSay('');
  } catch (e) { labSay('Could not load that clip: ' + e.message, true); }
  labBusy(false); labUi();
}
async function labFileChosen(file) {
  if (!file) return; const start = Math.max(0, +$('labStart').value || 0), len = Math.max(5, Math.min(300, +$('labLen').value || 45));
  labBusy(true);
  try {
    if (LAB.ok && LAB.status.tools.ffmpeg) {                                 // the helper cuts the clip and can make MIDI from it
      labSay('Sending the file to the helper…');
      const r = await fetch(`${labBase()}/api/upload?start=${start}&len=${len}`, { method: 'POST', headers: { 'x-filename': file.name }, body: file }), j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Upload failed'); const res = await labWait(j.job, u => labSay((u.log.slice(-1)[0] || 'Working…')));
      await labLoadLib(); labBusy(false); $('labLib').value = res.id; return labPick(res.id);
    }
    labSay('Reading the file…'); const buf = await file.arrayBuffer(); labSetAudio(buf.slice(0), file.type); const d = await labDecode(buf), a = Math.floor(start * d.sr), x = d.x.subarray(a, a + Math.floor(len * d.sr));
    LAB.cur = { id: null, title: file.name, x, sr: d.sr, dur: x.length / d.sr, refs: {}, start }; LAB.last = null; labSay('Audio ready. Connect the helper to make MIDI from it, or add your own .mid file.');
  } catch (e) { labSay('Could not use that file: ' + e.message, true); }
  labBusy(false); labUi();
}
async function labGetYoutube() {
  if (!LAB.ok) return labSay('Connect the helper first (see the box at the top).', true);
  const url = $('labYt').value.trim(); if (!url) return labSay('Paste a YouTube link first.', true);
  labBusy(true); labProg(0); labSay('Starting…');
  try {
    const { job } = await labFetchJson('/api/fetch', { url, start: +$('labStart').value || 0, len: +$('labLen').value || 45 });
    const res = await labWait(job, u => labSay(u.log.slice(-1)[0] || 'Working…')); await labLoadLib(); labBusy(false); labProg(null); $('labLib').value = res.id; return labPick(res.id);
  } catch (e) { labSay(e.message, true); }
  labProg(null); labBusy(false); labUi();
}

// ---------- reference MIDI ----------
async function labMake() {
  const c = LAB.cur; if (!c) return labSay('Get some audio first.', true); if (!c.id) return labSay('Connect the helper to make MIDI from this audio.', true);
  const stem = $('labStem').value, want = [...$('labEngPick').querySelectorAll('input:checked')].map(i => i.value).filter(e => !c.refs[e + (stem ? '.' + stem : '')]); if (!want.length) return labSay(Object.keys(c.refs).length ? 'Those are already made. Nothing to do.' : 'Tick at least one tool.', true);
  labBusy(true);
  try {
    for (let k = 0; k < want.length; k++) {
      const e = want[k], key = e + (stem ? '.' + stem : ''); labSay(`${labRefName(key)} (${k + 1}/${want.length})…`); labProg(0);
      const eng = findEngine('transcriber', 'lab-' + e); if (!eng) throw new Error('No engine registered for ' + e + '.');
      c.refs[key] = await eng.run({ id: c.id, stem }, { onUpdate: u => { labProg(u.progress); labSay(`${labRefName(key)} (${k + 1}/${want.length}): ${u.log.slice(-1)[0] || ''}`); } }); labUi();
    }
    labSay('MIDI is ready and saved. You will not need to make it again.'); await labLoadLib();
  } catch (e) { labSay(e.message, true); }
  labProg(null); labBusy(false); labUi();
}
async function labMidFile(file) {
  if (!file || !LAB.cur) return labSay(file ? 'Get some audio first, then add the .mid file.' : '', true);
  try { const m = parseMidi(await file.arrayBuffer()); LAB.cur.refs.custom = m.notes; labSay(`${m.notes.length} notes read from ${file.name}.`); } catch (e) { labSay('Could not read that MIDI file: ' + e.message, true); }
  labUi();
}
function labSaveBlob(name, bytes, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const labSafe = s => String(s).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'clip';

// ---------- reference selection ----------
function labRefNotes() {
  const c = LAB.cur, sel = $('labRef').value; let r = sel === 'consensus' ? consensusNotes(labEngKeys(c).filter(k => !k.includes('.')).map(k => c.refs[k]), 2) : (c.refs[sel] || []);
  if ($('labRange').checked) { const lo = Math.round(69 + 12 * Math.log2((+$('fmin').value || 60) / a4())) - 1, hi = Math.round(69 + 12 * Math.log2((+$('fmax').value || 1500) / a4())) + 1; r = r.filter(n => n.midi >= lo && n.midi <= hi); }
  if ($('labMelody').checked) r = labSkyline(r);
  return r;
}
function labSkyline(ns) {                                   // drop a note when a higher note covers at least half of it
  const s = ns.slice().sort((a, b) => a.start - b.start);
  return s.filter((n, i) => { const e = n.start + n.dur / 1000; let cov = 0; for (let k = 0; k < s.length; k++) { const m = s[k]; if (m.start >= e) break; if (k !== i && m.midi > n.midi) cov = Math.max(cov, Math.min(e, m.start + m.dur / 1000) - Math.max(n.start, m.start)); } return cov < (e - n.start) * 0.5; });
}

// ---------- compare ----------
function labBusy(b) { LAB.busy = b; for (const id of ['labFetch', 'labMake', 'labRun', 'labTune', 'labConnect']) $(id).disabled = b; }
function labSettings() { const kind = $('labApp').value, mode = $('recMode').value, conf = +$('conf').value; return { app: kind, mode, conf, inst: prof.k, label: kind === 'live' ? `Live · ${REC_NAMES[mode] || mode} · conf ${conf}` : 'Detailed' }; }
function labRunApp(kind, o = {}) {
  const c = LAB.cur, mode = o.mode || $('recMode').value, conf = o.conf || +$('conf').value, fmin = +$('fmin').value, fmax = +$('fmax').value;
  if (kind === 'live') return engineFor('segmenter', 'offline').run({ x: c.x, sr: c.sr }, { ...engineOpts(), auto: mode === 'auto', m: REC_MODES[mode] || REC_MODES.fast, fmin, fmax, conf, a4: a4(), chunk: true, onProgress: o.onProgress });
  return detailedNotes(resample(c.x, c.sr, 22050), { lo: fmin, hi: fmax, poly: isPolyInst(), a4: a4(), onStatus: t => labSay(t), onProgress: o.onProgress });
}
function labRemember(set, c, refKey) {
  const hist = LAB.store.hist; hist.push({ t: Date.now(), clip: LAB.cur.id || LAB.cur.title, ref: refKey, app: set.app, mode: set.mode, conf: set.conf, inst: set.inst, f1: +c.f1.toFixed(3), p: +c.precision.toFixed(3), r: +c.recall.toFixed(3) });
  if (hist.length > 400) hist.splice(0, hist.length - 400); labSave();
}
async function labRun() {
  const c = LAB.cur; if (!c) return labSay('Get some audio first.', true); const ref = labRefNotes(); if (!$('labRef').value) return labSay('Make or add a reference MIDI first.', true);
  labBusy(true); labProg(0); labSay('Running the app on this audio…');
  try {
    const set = labSettings(), got = await labRunApp(set.app, { onProgress: p => labProg(p) }), cmp = compareNotes(ref, got, { autoShift: $('labShift').checked });
    LAB.last = { ref, got, cmp, set, refKey: $('labRef').value }; labRemember(set, cmp, $('labRef').value); labShowResult(); labSay('');
  } catch (e) { labSay('The app could not analyse this audio: ' + (e && e.message || e), true); }
  labProg(null); labBusy(false); labUi();
}
async function labTune() {
  const c = LAB.cur; if (!c) return labSay('Get some audio first.', true); if (!$('labRef').value) return labSay('Make or add a reference MIDI first.', true);
  const ref = labRefNotes(), grid = []; for (const mode of ['auto', 'fast', 'normal', 'strict', 'relaxed']) for (const conf of [0.8, 0.85, 0.9]) grid.push({ mode, conf });
  labBusy(true); const rows = [];
  try {
    for (let i = 0; i < grid.length; i++) {
      const g = grid[i]; labSay(`Trying Live settings ${i + 1} of ${grid.length}: ${REC_NAMES[g.mode]}, confidence ${g.conf}…`); labProg(i / grid.length);
      const got = await labRunApp('live', g), cmp = compareNotes(ref, got, { autoShift: $('labShift').checked }); rows.push({ ...g, cmp, got });
      labRemember({ app: 'live', mode: g.mode, conf: g.conf, inst: prof.k }, cmp, $('labRef').value);
    }
    rows.sort((a, b) => b.cmp.f1 - a.cmp.f1); const best = rows[0]; LAB.last = { ref, got: best.got, cmp: best.cmp, set: { app: 'live', mode: best.mode, conf: best.conf, inst: prof.k, label: `Live · ${REC_NAMES[best.mode]} · conf ${best.conf}` }, refKey: $('labRef').value, tune: rows };
    labShowResult(); labSay(`Best for this clip: ${REC_NAMES[best.mode]}, confidence ${best.conf} (F1 ${labPct(best.cmp.f1)}). Press "Use" to apply it to the Recorder.`);
  } catch (e) { labSay('Tuning stopped: ' + (e && e.message || e), true); }
  labProg(null); labBusy(false); labUi();
}
function labApply(mode, conf) {
  $('recMode').value = mode; $('recMode').dispatchEvent(new Event('change', { bubbles: true }));
  $('conf').value = conf; $('conf').dispatchEvent(new Event('input', { bubbles: true })); $('conf').dispatchEvent(new Event('change', { bubbles: true }));
  labSay(`Recorder now listens with "${REC_NAMES[mode]}" and confidence ${conf}.`);
}

// ---------- results ----------
function labShowResult() {
  const L = LAB.last; if (!L) { $('labRes').innerHTML = ''; $('labRoll').classList.add('hide'); $('labLegend').classList.add('hide'); return; }
  const c = L.cmp, cls = v => v >= 0.8 ? 'good' : v >= 0.55 ? 'mid' : 'low', why = c.why, miss = [why.octave && `${why.octave} an octave off`, why.semitone && `${why.semitone} a semitone off`, why.otherPitch && `${why.otherPitch} at another pitch`, why.none && `${why.none} not heard at all`].filter(Boolean).join(', ');
  let h = `<div class="lab-small mut" style="margin-bottom:6px">${esc(L.set.label)} against ${esc(labRefName(L.refKey))}${c.shift ? ` · timing offset ${(c.shift * 1000).toFixed(0)} ms` : ''}</div>
    <div class="lab-tiles"><div class="${cls(c.f1)}"><span>Agreement (F1)</span><b>${labPct(c.f1)}</b></div><div class="${cls(c.precision)}"><span>App notes also in reference</span><b>${labPct(c.precision)}</b></div><div class="${cls(c.recall)}"><span>Reference notes the app found</span><b>${labPct(c.recall)}</b></div>
    <div><span>Timing (median)</span><b>${c.onsetMedianMs == null ? '–' : Math.round(c.onsetMedianMs) + ' ms'}</b></div><div><span>Note length vs ref</span><b>${c.durRatioMedian == null ? '–' : Math.round(c.durRatioMedian * 100) + '%'}</b></div><div><span>Time overlap (F1)</span><b>${labPct(c.overlapF1)}</b></div></div>
    <div class="lab-small" style="margin-top:8px">Reference has ${c.nRef} notes, the app found ${c.nGot}. <b>${c.tp}</b> match. ${c.fn ? `Missed ${c.fn}${miss ? ': ' + miss : ''}. ` : ''}${c.fp ? `${c.fp} extra notes only the app heard.` : ''}</div>`;
  if (L.refKey.split('.')[0] === 'basicpitch' && !$('labMelody').checked && !isPolyInst()) h += '<div class="lab-note" style="margin-top:8px">This reference lists every note it hears, but Live follows one melody line, so recall will look low. Tick "melody only" for a fairer score.</div>';
  const keys = labEngKeys(LAB.cur).filter(k => !k.includes('.'));
  if (keys.length > 1) h += `<div class="lab-small mut" style="margin-top:8px">How much the reference tools agree with each other: ${keys.slice(1).map(k => `${esc(labRefName(keys[0]))} vs ${esc(labRefName(k))} <b>${labPct(compareNotes(LAB.cur.refs[keys[0]], LAB.cur.refs[k]).f1)}</b>`).join(' · ')}. Where they disagree, the reference itself is unsure.</div>`;
  if (L.tune) h += `<div class="lab-tbl-wrap" style="margin-top:10px"><table class="lab-tbl"><tr><th>Live settings</th><th>F1</th><th>Found</th><th>Missed</th><th>Extra</th><th></th></tr>${L.tune.map((r, i) => `<tr class="${i ? '' : 'best'}"><td>${esc(REC_NAMES[r.mode])} · ${r.conf}</td><td>${labPct(r.cmp.f1)}</td><td>${r.cmp.tp}</td><td>${r.cmp.fn}</td><td>${r.cmp.fp}</td><td><button class="sec" data-use="${r.mode}|${r.conf}">Use</button></td></tr>`).join('')}</table></div>`;
  $('labRes').innerHTML = h; $('labDl').disabled = !L.got.length; $('labLegend').classList.remove('hide'); labDraw(L);
}
function labDraw(L) {
  const wrap = $('labRoll'), cv = $('labCv'), ref = L.ref, app = L.got, all = ref.concat(app);
  if (!all.length) { wrap.classList.add('hide'); return; } wrap.classList.remove('hide');
  const dur = Math.max(...all.map(n => n.start + n.dur / 1000)) + 0.3, lo = Math.min(...all.map(n => n.midi)) - 1, hi = Math.max(...all.map(n => n.midi)) + 1;
  const rowH = Math.max(6, Math.min(14, 240 / (hi - lo + 1))), H = Math.round((hi - lo + 1) * rowH) + 20, W = Math.max(wrap.clientWidth || 320, Math.round(dur * 60)), dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0f121a'; g.fillRect(0, 0, W, H); const X = t => 2 + t / dur * (W - 4), Y = m => 2 + (hi - m) * rowH;
  g.font = '10px sans-serif'; for (let m = lo; m <= hi; m++) if (m % 12 === 0) { g.fillStyle = '#252c3d'; g.fillRect(0, Y(m) + rowH - 1, W, 1); g.fillStyle = '#8791ab'; g.fillText('C' + (m / 12 - 1), 3, Y(m) + rowH - 2); }
  g.fillStyle = '#8791ab'; for (let s = 0; s < dur; s += s < 20 ? 2 : 5) g.fillText(s + 's', X(s) + 2, H - 4);
  const mr = new Set(L.cmp.pairs.map(p => p[0])), mg = new Set(L.cmp.pairs.map(p => p[1]));
  ref.forEach((n, i) => { g.fillStyle = mr.has(i) ? 'rgba(52,211,153,.28)' : 'rgba(251,191,36,.85)'; g.fillRect(X(n.start), Y(n.midi), Math.max(2, X(n.start + n.dur / 1000) - X(n.start)), rowH - 1); });
  app.forEach((n, j) => { g.fillStyle = mg.has(j) ? '#34d399' : '#f87171'; const x0 = X(n.start + L.cmp.shift); g.fillRect(x0, Y(n.midi) + rowH * 0.28, Math.max(2, X(n.start + n.dur / 1000) - X(n.start)), rowH * 0.42); });
}

// ---------- what it has learned ----------
function labLearned() {
  const G = new Map(); for (const h of LAB.store.hist) { const k = [h.inst, h.app, h.mode, h.conf].join('|'); if (!G.has(k)) G.set(k, { inst: h.inst, app: h.app, mode: h.mode, conf: h.conf, f: [], clips: new Set() }); const g = G.get(k); g.f.push(h.f1); g.clips.add(h.clip); }
  const rows = [...G.values()].map(g => ({ ...g, mean: g.f.reduce((a, b) => a + b, 0) / g.f.length })).sort((a, b) => (a.inst > b.inst ? 1 : a.inst < b.inst ? -1 : b.mean - a.mean));
  if (!rows.length) { $('labHist').innerHTML = '<span class="mut">Nothing yet. Every comparison you run is remembered here, so the app can show which settings agree best with the reference across your clips.</span>'; return; }
  const seen = new Set(), name = k => (INST_PROFILES.find(p => p.k === k) || { name: k }).name;
  $('labHist').innerHTML = `<div class="lab-tbl-wrap"><table class="lab-tbl"><tr><th>Instrument</th><th>Settings</th><th>Clips</th><th>Avg F1</th><th></th></tr>${rows.slice(0, 14).map(r => { const best = !seen.has(r.inst); seen.add(r.inst); return `<tr class="${best ? 'best' : ''}"><td>${esc(name(r.inst) === 'All' ? 'All instruments' : name(r.inst))}</td><td>${r.app === 'live' ? esc((REC_NAMES[r.mode] || r.mode) + ' · ' + r.conf) : 'Detailed'}</td><td>${r.clips.size}</td><td>${labPct(r.mean)}</td><td>${r.app === 'live' ? `<button class="sec" data-use="${r.mode}|${r.conf}">Use</button>` : ''}</td></tr>`; }).join('')}</table></div><div class="mut" style="margin-top:6px">${LAB.store.hist.length} comparisons remembered. Scores show agreement with a reference, not the truth. More clips make the averages more trustworthy.</div>`;
}

// ---------- page ----------
function labUi() {
  const c = LAB.cur, refs = c ? labEngKeys(c) : [], plain = refs.filter(k => !k.includes('.')), opts = refs.concat(plain.length > 1 ? ['consensus'] : []);
  const old = $('labRef').value; $('labRef').innerHTML = opts.map(k => `<option value="${k}">${esc(labRefName(k))}${k === 'consensus' ? '' : ' · ' + c.refs[k].length + ' notes'}</option>`).join('') || '<option value="">— none yet —</option>';
  if (opts.includes(old)) $('labRef').value = old; else if (opts.length) $('labRef').value = opts.includes('consensus') ? 'consensus' : opts[0];
  $('labClipInfo').textContent = c ? `${c.title} · ${c.dur.toFixed(1)} s from ${c.start || 0} s` : '';
  $('labRefs').innerHTML = refs.map(k => `<div class="lab-ref"><span>${esc(labRefName(k))} · ${c.refs[k].length} notes</span>${k !== 'custom' && c.id ? `<a href="#" data-mid="${k}">Download .mid</a>` : `<a href="#" data-mid="${k}">Download .mid</a>`}</div>`).join('');
  labLearned();
}
function labShow() { if (!LAB.tried) { $('labUrl').value = LAB.store.url; labConnect(); } else labUi(); if (LAB.last) requestAnimationFrame(() => labShowResult()); }

$('labConnect').onclick = labConnect;
$('labFetch').onclick = labGetYoutube;
$('labMake').onclick = labMake;
$('labRun').onclick = labRun;
$('labTune').onclick = labTune;
$('labLib').onchange = () => labPick($('labLib').value);
$('labFile').onchange = () => labFileChosen($('labFile').files[0]);
$('labMid').onchange = () => labMidFile($('labMid').files[0]);
for (const id of ['labRef', 'labRange', 'labMelody', 'labShift']) $(id).onchange = () => { LAB.last = null; labShowResult(); };
$('labDl').onclick = () => { const L = LAB.last; if (L && L.got.length) labSaveBlob(`app-notes-${labSafe(LAB.cur.title)}.mid`, writeMidi(L.got, { name: 'app notes' }), 'audio/midi'); };
$('labClear').onclick = () => { if (confirm('Forget everything the Lab has learned from your comparisons?')) { LAB.store.hist = []; labSave(); labLearned(); } };
document.addEventListener('click', e => {
  const u = e.target.closest && e.target.closest('[data-use]'); if (u) { const [m, cf] = u.dataset.use.split('|'); labApply(m, +cf); return; }
  const d = e.target.closest && e.target.closest('[data-mid]'); if (d) { e.preventDefault(); const k = d.dataset.mid, c = LAB.cur; if (c && c.refs[k]) labSaveBlob(`${labSafe(c.title)}-${k}.mid`, writeMidi(c.refs[k], { name: k }), 'audio/midi'); }
});
