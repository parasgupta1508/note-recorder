// Recorder tab: recording state, Live vs Detailed analysis, file analysis (parked), stats, replay.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// ----- RECORDER -----
// Only the CURRENT recording is kept, in memory. Nothing is written to storage; Clear (or a new recording) discards it.
const REC_MAX_S = 600;                                   // safety cap: 10 minutes per recording
let events = [], recording = false, recT0 = 0, recEnd = 0, recSel = -1;
const view = { vs: 0, pps: 0, follow: true, mode: 'sheet', fps: 120, spanF: 4, fallMid: null };            // vs = time (s) at the left edge, pps = pixels per second
const pb = { playing: false, pos: 0, startCtx: 0, startPos: 0, rate: 1, nodes: [], abuf: null };
const cap = { chunks: [], n: 0, k: 1, rate: 44100, acc: 0, cnt: 0 };   // recorded sound: 16-bit at the device's own sample rate (k stays 1), so nothing is lost before analysis
let capNode = null, capSink = null;
const seg = engineFor('segmenter', 'live').create(ev => { if (recording) addEvent(ev); });

const autoM = new AutoMode();
const recModeCfg = () => $('recMode').value === 'auto' ? REC_MODES[autoM.mode] : (REC_MODES[$('recMode').value] || REC_MODES.fast);
const recPitch = (r, rms, pk, conf) => engineFor('segmenter', 'live').gate(r, rms, pk, conf, recModeCfg(), seg, +$('gate').value, a4(), recModeCfg() === REC_MODES.relaxed);

const infoHint = () => '';
const FLN = { C: 'D♭', D: 'E♭', F: 'G♭', G: 'A♭', A: 'B♭' };
const nm = s => useFlats ? s.replace(/([CDFGA])#/g, (_, l) => FLN[l]) : s.replace('#', '♯');
const fmtT = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const centsCls = c => { const a = Math.abs(c); return a <= tol() ? 'cg' : a <= 25 ? 'cy' : 'cr'; };
const fmtC = c => { const r = Math.round(c); return r === 0 ? '0¢' : (r > 0 ? '+' : '−') + Math.abs(r) + '¢'; };
const bpmVal = () => Math.max(0, Math.min(300, +$('recBpm').value || 0));
const recLen = () => recording ? Math.max(0, ctx.currentTime - t0 - recT0)
  : Math.max(recEnd, cap.n / cap.rate, events.reduce((m, e) => Math.max(m, e.start + e.dur / 1000), 0));
const hasRec = () => events.length > 0 || cap.n > 0;

function newRecording() {
  view.fallMid = null; view.spanF = 4;
  recGen++; liveEv = detEv = null; shownRes = 'live';
  events = []; $('rows').innerHTML = ''; recSel = -1; recEnd = 0;
  cap.chunks = []; cap.n = 0; cap.acc = 0; cap.cnt = 0; pb.abuf = null; pb.pos = 0; view.vs = 0;
  $('noteInfo').textContent = infoHint(); $('noteInfo').className = 'mut';
  updateStats();
}
function capPush(x) {
  const k = cap.k, out = new Int16Array(Math.ceil((x.length + cap.cnt) / k)); let o = 0;
  for (let i = 0; i < x.length; i++) {
    cap.acc += x[i];
    if (++cap.cnt === k) { out[o++] = Math.max(-32768, Math.min(32767, Math.round(cap.acc / k * 32767))); cap.acc = 0; cap.cnt = 0; }
  }
  if (o) { cap.chunks.push(o === out.length ? out : out.subarray(0, o)); cap.n += o; }
  if (cap.n / cap.rate > REC_MAX_S) setTimeout(() => { if (recording) { setRecording(false); $('recInfo').textContent = 'Stopped: 10 minute limit reached.'; } }, 0);
}
function addEvent(ev) {
  ev.start -= recT0; if (ev.start < 0) { ev.dur = Math.max(0, ev.dur + ev.start * 1000); ev.start = 0; }   // frames are stamped mid-window, so the very first note can begin a hair before Record was pressed
  events.push(ev);
  const tr = document.createElement('tr'); tr.dataset.i = events.length - 1;
  tr.innerHTML = `<td>${events.length}</td><td><b>${nm(ev.note)}</b></td><td>${ev.hz.toFixed(2)}</td><td class="${centsCls(ev.cents)}">${ev.cents >= 0 ? '+' : ''}${ev.cents.toFixed(1)}</td><td>${ev.start.toFixed(3)}</td><td>${ev.dur.toFixed(0)}</td>`;
  $('rows').prepend(tr);
  updateStats();
}
function setRecording(on) {
  if (on && detBusy) return;                           // still analysing the last recording
  if (on && !recording) {
    pbStop(); newRecording();                            // a new recording replaces the previous one
    cap.k = 1; cap.rate = ctx.sampleRate;   // a loaded file may have changed these
    recT0 = ctx.currentTime - t0; seg.reset(); autoM.reset(); view.follow = true;
  }
  if (!on && recording) {
    seg.end(); recEnd = Math.max(0, ctx.currentTime - t0 - recT0); if (engine === 'det') setTimeout(analyseDetailed, 0);
    const Wc = cv.clientWidth || 360; view.follow = false; view.vs = 0; view.pps = Math.min(Math.max(8, (Wc - GUT) / 8), Math.max(20, (Wc - GUT - 24) / Math.max(2, recEnd)));
  }
  recording = on; $('rec').textContent = on ? '■ Stop' : '● Record'; $('rec').className = on ? 'rec' : ''; engUi();
  recUi(); requestDraw();
}

// ----- analyse a saved audio file with the same detector (offline) -----

// ----- Live vs Detailed analysis -----
// Live: the light detector runs while you play. Detailed: after you stop, the recording goes through Basic Pitch
// (a small neural network, files in vendor/, loaded only when needed) and the melody is picked out of it.
const BP_PARAMS = { onset: 0.5, frame: 0.3, minLen: 11 };      // Basic Pitch note settings (minLen in 11.6 ms frames)
const ENG_KEY = 'tuner-recengine';
let recGen = 0, engine = 'live', liveEv = null, detEv = null, detBusy = false, shownRes = 'live', bpLoad = null;
try { if (localStorage.getItem(ENG_KEY) === 'det') engine = 'det'; } catch {}
function engUi() {
  for (const b of $('engSeg').children) b.classList.toggle('on', b.dataset.e === engine);
  $('engHint').textContent = engine === 'det' ? 'Notes appear as you play, then press Stop: the app studies the whole recording and shows a more accurate result (takes a little while). Guitar and ukulele keep every note of a chord; other instruments get one melody line.' + (bpReady === 'loading' ? ' Getting the analysis files…' : bpReady === 'ready' ? ' Ready, and works offline.' : '') : 'Notes appear instantly as you play. Light and fast.';
  const both = !!(liveEv && detEv); $('showWrap').classList.toggle('hide', !both);
  for (const b of $('showSeg').children) b.classList.toggle('on', b.dataset.s === shownRes);
  if (detBusy) $('rec').disabled = true;
}
let bpReady = '';
function prefetchBP() {                                    // download the detailed-analysis files once, so they work offline later (the service worker keeps them)
  if (bpReady || !navigator.onLine || !('serviceWorker' in navigator) || !window.caches) return; bpReady = 'loading'; engUi();
  const urls = ['vendor/basic-pitch.js', 'vendor/model/model.json', 'vendor/model/group1-shard1of1.bin'];
  navigator.serviceWorker.ready.then(() => Promise.all(urls.map(u => fetch(u).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); }))))
    .then(() => Promise.all(urls.map(u => caches.match(u))))
    .then(hits => { bpReady = hits.every(Boolean) ? 'ready' : ''; engUi(); }).catch(() => { bpReady = ''; engUi(); });
}
$('engSeg').addEventListener('click', e => { const b = e.target.closest('button[data-e]'); if (!b) return; engine = b.dataset.e; try { localStorage.setItem(ENG_KEY, engine); } catch {} if (engine === 'det') prefetchBP(); engUi(); });
$('showSeg').addEventListener('click', e => { const b = e.target.closest('button[data-s]'); if (b) showResult(b.dataset.s); });
function showEvents(list) {                                // replace what is shown (table, stats, chart)
  const t = recT0; recT0 = 0; events = []; $('rows').innerHTML = ''; recSel = -1;
  list.forEach(ev => addEvent({ ...ev })); recT0 = t; requestDraw(); recUi();
}
function showResult(k) { if (k === 'det' && !detEv) return; if (k === 'live' && !liveEv) return; shownRes = k; showEvents(k === 'det' ? detEv : liveEv); engUi(); }
function loadBP() {
  if (window.BP) return Promise.resolve();
  return bpLoad || (bpLoad = new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'vendor/basic-pitch.js';
    sc.onload = res; sc.onerror = () => { bpLoad = null; rej(new Error('offline')); }; document.head.appendChild(sc);
  }));
}
function capSamples22() {                                   // the recorded sound as 22,050 Hz floats (what Basic Pitch needs)
  const all = new Int16Array(cap.n); let o = 0;
  for (const c of cap.chunks) { all.set(c, o); o += c.length; }
  return resample(all, cap.rate, 22050, 32768);
}
// Detailed analysis of 22,050 Hz samples: Basic Pitch, then the app's own refinement. Shared by the Recorder and the Lab page.
// o: { lo, hi (Hz), poly (keep every chord note), a4, onStatus(text), onProgress(0..1) }  ->  notes
async function detailedNotes(x, o) { return engineFor('transcriber', 'offline').run(x, o); }   // default engine: Basic Pitch + refinement (js/app/engines/basicpitch.js)
const isPolyInst = () => ['guitar', 'ukulele', 'mandolin'].includes(prof.k);
async function analyseDetailed() {
  if (detBusy || cap.n < cap.rate * 0.5) return;
  const info = $('recInfo'), gen = recGen; detBusy = true; $('rec').disabled = true; liveEv = events.map(e => ({ ...e }));
  const x = capSamples22();                            // snapshot now, so a later Clear or new recording cannot change what is analysed
  try {
    const res = await detailedNotes(x, { lo: +$('fmin').value, hi: +$('fmax').value, poly: isPolyInst(), a4: a4(), onStatus: t => { info.textContent = t; }, onProgress: p => { info.textContent = 'Analysing in detail… ' + Math.round(p * 100) + '%'; } });
    if (gen !== recGen) { detBusy = false; engUi(); return; }   // the recording was cleared or replaced meanwhile: drop this result
    detEv = res;
    showResult('det');
    info.textContent = `Detailed result: ${detEv.length} notes (Live found ${liveEv.length}).`;
  } catch (err) {
    console.warn('Detailed analysis failed:', err && (err.stack || err.message || err));
    detEv = null; info.textContent = err && err.message === 'offline' ? 'Detailed analysis needs its files. Connect to the internet once, then it works offline.' : 'Detailed analysis could not run on this device. The Live result is shown.';
  }
  detBusy = false; $('rec').disabled = false; engUi(); recUi();
}

// Offline audio-file analysis. Parked: not wired to any button right now. To bring it back, add
//   <input id="recFile" type="file" accept="audio/*">  in the Recorder options and call  analyseFile(input.files[0]).
async function analyseFile(file) {
  if (!file) return;
  if (recording) setRecording(false);
  const info = $('recInfo'); info.textContent = 'Reading ' + file.name + '…';
  try {
    const ab = await getCtx().decodeAudioData(await file.arrayBuffer());
    if (ab.duration > REC_MAX_S) { info.textContent = 'File is longer than 10 minutes.'; return; }
    const n = ab.length, x = new Float32Array(n), nc = ab.numberOfChannels;
    for (let c = 0; c < nc; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) x[i] += d[i] / nc; }
    pbStop(); newRecording(); recT0 = 0;
    const notes = await engineFor('segmenter', 'offline').run({ x, sr: ab.sampleRate }, { auto: $('recMode').value === 'auto', m: REC_MODES[$('recMode').value] || REC_MODES.fast, fmin: +$('fmin').value, fmax: +$('fmax').value, conf: +$('conf').value, a4: a4(), chunk: true, onProgress: p => { info.textContent = 'Analysing… ' + Math.round(p * 100) + '%'; } });
    notes.forEach(addEvent);
    const k = 1; cap.k = k; cap.rate = ab.sampleRate;       // keep the sound for Replay
    for (let o = 0; o < n; o += 65536) capPush(x.subarray(o, Math.min(n, o + 65536)));
    cap.rate = ab.sampleRate; recEnd = ab.duration;
    const Wc = cv.clientWidth || 360; view.follow = false; view.vs = 0; view.pps = Math.min(Math.max(8, (Wc - GUT) / 8), Math.max(20, (Wc - GUT - 24) / Math.max(2, recEnd)));
    info.textContent = notes.length + ' notes found in ' + file.name; recUi(); requestDraw();
  } catch (err) { info.textContent = 'Could not read that file.'; }
}
function clearRec() {
  pbStop(); if (recording) setRecording(false);
  newRecording(); recUi(); requestDraw();
}

// ----- summary chips: key guess + stats -----
const KRUM_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], KRUM_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function guessKey(pc) {
  const corr = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y) / n, mb = b.reduce((x, y) => x + y) / n; let s = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return va && vb ? s / Math.sqrt(va * vb) : 0; };
  let best = null;
  for (let k = 0; k < 12; k++) for (const [prof, name] of [[KRUM_MAJ, 'major'], [KRUM_MIN, 'minor']]) {
    const r = corr(pc, prof.map((_, i) => prof[(i - k + 12) % 12]));
    if (!best || r > best.r) best = { r, s: nm(NOTES[k]) + ' ' + name };
  }
  return best && best.r >= 0.55 ? best.s : null;
}
function updateStats() {
  const n = events.length, box = $('recStats');
  if (!n) { box.innerHTML = ''; return; }
  let tot = 0, ab = 0, ok = 0, lo = 1e9, hi = -1; const pc = new Array(12).fill(0), by = {};
  for (const e of events) {
    const d = e.dur / 1000; tot += d; ab += Math.abs(e.cents); if (Math.abs(e.cents) <= tol()) ok++;
    lo = Math.min(lo, e.midi); hi = Math.max(hi, e.midi); pc[e.midi % 12] += d; by[e.note] = (by[e.note] || 0) + d;
  }
  const key = n >= 4 ? guessKey(pc) : null;
  box.innerHTML = [[n, n === 1 ? 'note' : 'notes'], [tot.toFixed(1) + ' s', 'time sounding'], [nm(midiName(lo)) + '–' + nm(midiName(hi)), 'range'],
    [Math.round(100 * ok / n) + '%', `in tune (±${tol()}¢)`], [Math.round(ab / n) + '¢', 'average off-pitch'], [key || '–', 'likely key']]
    .map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('');
}
function renderLegend() {
  const T = tol(), dot = c => `<i style="background:${c}"></i>`;
  $('rLegend').innerHTML = $('recColor').value === 'note'
    ? NOTES.map((n, i) => `<span>${dot(`hsl(${i * 30},85%,62%)`)}${nm(n)}</span>`).join('')
    : `<span>${dot('#34d399')}In tune (±${T}¢)</span><span>${dot('#fbbf24')}Close (≤25¢)</span><span>${dot('#fb7185')}Off (&gt;25¢)</span>`
      + `<span class="mut">Bar length = how long the note was held · white wiggle = pitch drift · bottom lane = volume</span>`;
}
function recUi() {
  const len = recLen(), has = hasRec();
  $('pbPlay').disabled = !has || recording; $('pbPlay').textContent = pb.playing ? '⏸ Pause' : '▶ Replay'; $('pbPlay').classList.toggle('playing', pb.playing);
  $('pbMode').disabled = !has; $('pbSpeed').disabled = !has || $('pbMode').value !== 'notes';
  $('pbTime').textContent = `${fmtT(recording ? len : pbPos())} / ${fmtT(len)}`;
  $('recInfo').textContent = recording ? `REC ${fmtT(len)} · ${events.length} ${events.length === 1 ? 'note' : 'notes'}`
    : has ? `${events.length} ${events.length === 1 ? 'note' : 'notes'} recorded` : 'Press Record.';
}

// ----- replay: the recorded sound, or clean tones of the notes the app detected -----
const pbPos = () => pb.playing ? Math.min(recLen(), pb.startPos + Math.max(0, ctx.currentTime - pb.startCtx) * pb.rate) : pb.pos;
function pbKill() { for (const n of pb.nodes) { n.onended = null; try { n.stop(); } catch {} try { n.disconnect(); } catch {} } pb.nodes = []; }
function pbStop() { if (pb.playing) pb.pos = pbPos(); pb.playing = false; pbKill(); recUi(); }
function audioBuf(c) {
  if (pb.abuf) return pb.abuf;
  const ab = c.createBuffer(1, Math.max(1, cap.n), cap.rate), ch = ab.getChannelData(0); let o = 0;
  for (const ck of cap.chunks) for (let i = 0; i < ck.length; i++) ch[o++] = ck[i] / 32768;
  return (pb.abuf = ab);
}
function pbPlay() {
  if (!hasRec() || recording) return;
  const c = getCtx(), len = recLen(); pbKill();
  if (pb.pos >= len - 0.05) pb.pos = 0;
  const when = c.currentTime + 0.06, mode = $('pbMode').value === 'audio' && cap.n ? 'audio' : 'notes', rate = mode === 'notes' ? (+$('pbSpeed').value || 1) : 1;
  if (mode === 'audio') {
    const s = c.createBufferSource(); s.buffer = audioBuf(c); s.connect(c.destination); s.start(when, pb.pos); pb.nodes.push(s);
  } else {
    for (const e of events) {
      const e1 = e.start + e.dur / 1000; if (e1 <= pb.pos) continue;
      const s0 = Math.max(e.start, pb.pos), w = when + (s0 - pb.pos) / rate, l = (e1 - s0) / rate;
      const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = e.hz;
      g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(0.28, w + 0.012); g.gain.setValueAtTime(0.28, Math.max(w + 0.012, w + l - 0.03)); g.gain.linearRampToValueAtTime(0, w + l);
      o.connect(g); g.connect(c.destination); o.start(w); o.stop(w + l + 0.02); pb.nodes.push(o);
    }
  }
  pb.startCtx = when; pb.startPos = pb.pos; pb.rate = rate; pb.playing = true; view.follow = true;
  recUi(); pbTick();
}
function pbTick() {
  if (!pb.playing) return;
  const p = pbPos(), len = recLen();
  if (p >= len) { pb.playing = false; pb.pos = len; pbKill(); recUi(); requestDraw(); return; }
  recUi(); drawRoll(); requestAnimationFrame(pbTick);
}
function pbSeek(t) {
  const was = pb.playing; pbKill(); pb.playing = false; pb.pos = Math.max(0, Math.min(recLen(), t));
  if (was) pbPlay(); else { recUi(); requestDraw(); }
}
$('pbPlay').onclick = () => { if (pb.playing) pbStop(); else pbPlay(); requestDraw(); };
$('pbMode').onchange = () => { recUi(); if (pb.playing) pbSeek(pbPos()); };
$('pbSpeed').onchange = () => { if (pb.playing) pbSeek(pbPos()); };

