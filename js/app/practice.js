// Scale practice tab and the per-note scorecard.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// ----- SCALE -----
const sc = { seq: [], pos: 0, grades: [], attempts: [], running: false, wrong: 0, pass: 1, passes: [] };
let demoIdx = -1, demoTimers = [], liveBuf = [], silentFrames = 99;
const det = new AttemptDetector(a => onAttempt(a));   // onAttempt lives in practice-engine.js, which loads later
for (const k in SCALES) $('scType').add(new Option(SCALES[k][0], k));
NOTES.forEach((n, i) => $('scRoot').add(new Option(n, i)));
$('scRoot').value = 0;
for (const k in PRESETS) $('scInst').add(new Option(PRESETS[k].label, k));

const scaleSeq = () => buildScale(+$('scRoot').value, +$('scOct').value, $('scType').value, +$('scSpan').value, $('scDir').value);
const noteHtml = m => { const n = midiName(m).match(/^([A-G][#♭]?)(-?\d+)$/); return `${n[1]}<small>${n[2]}</small>`; };
const complete = () => sc.attempts.length > 0 && sc.pos >= sc.seq.length && !sc.running;

function neutralLive(msg = 'Waiting for note…') {
  $('scHeard').innerHTML = '&nbsp;'; $('scVerdict').textContent = '';
  $('devMarker').className = 'dev-marker'; $('devMarker').style.left = '50%';
  $('devRead').textContent = '–'; $('devRead').className = '';
  $('scAcc').textContent = msg; $('scAcc').className = 'srow center';
}
function renderScale() {
  const seq = sc.seq, A = a4(), demo = demoIdx >= 0;
  { const lo = Math.min(...seq), hi = Math.max(...seq), fl = noteToFreq(lo, A), fh = noteToFreq(hi, A);
    $('scRange').innerHTML = `${midiName(lo)}–${midiName(hi)} · ${fl.toFixed(0)}–${fh.toFixed(0)} Hz` + (fl < +$('fmin').value || fh > +$('fmax').value ? ' · <span class="bad-t">outside the detection range — widen it in Settings</span>' : ''); }
  $('scRow1').className = seq.length > 16 ? 'dense wrap' : seq.length > 9 ? 'dense' : ''; $('scStop').disabled = !(sc.running || demo);
  $('scRow1').innerHTML = seq.map((m, i) => {
    let cls;
    if (demo) cls = i < demoIdx ? 'ok' : i === demoIdx ? 'cur' : 'pend';
    else if (i < sc.pos && sc.grades[i]) cls = { 'In tune': 'ok', 'Close': 'close', 'Skipped': 'pend' }[sc.grades[i]] || 'bad';
    else cls = sc.running && i === sc.pos ? 'cur' : 'pend';
    return `<span class="chip mini ${cls}"${sc.grades[i] === 'Skipped' && !demo ? ' title="Skipped"' : ''}>${midiName(m)}</span>`;
  }).join('');
  const idx = demo ? demoIdx : sc.running ? sc.pos : -1;
  if (idx >= 0 && idx < seq.length) {
    $('scCur').innerHTML = noteHtml(seq[idx]); $('scTarget').textContent = `target ${noteToFreq(seq[idx], A).toFixed(2)} Hz`;
    if (demo) { neutralLive('Demo playing'); $('scHeard').textContent = 'demo playback'; }
  } else if (complete()) {
    $('scCur').textContent = '✓'; $('scTarget').textContent = 'Scale complete'; neutralLive('');
  } else { $('scCur').textContent = '–'; $('scTarget').textContent = 'Press Start practice'; neutralLive(); }
}
function setMsg(text, cls = 'mut') { $('scMsg').textContent = text; $('scMsg').className = 'center ' + (cls === 'mut' ? 'mut' : cls + '-t'); }

function liveScaleFrame(f) {
  if (!sc.running || demoIdx >= 0 || sc.pos >= sc.seq.length) return;
  if (!f) { if (++silentFrames > 8) neutralLive(); return; }
  silentFrames = 0;
  const T = tol(), target = noteToFreq(sc.seq[sc.pos], a4()), c = centsBetween(f, target), a = Math.abs(c);
  const cls = a <= T ? 'ok' : a <= 25 ? 'warn' : 'bad';
  $('scHeard').textContent = `heard ${f.toFixed(2)} Hz   ${c >= 0 ? '+' : '−'}${a.toFixed(0)}¢`;
  $('scVerdict').textContent = gradeCents(c, T); $('scVerdict').className = `verdict ${cls}-t`;
  const u = Math.max(-10, Math.min(10, c / 10));
  $('devMarker').style.left = (50 + u * 5) + '%'; $('devMarker').className = 'dev-marker ' + cls;
  $('devRead').textContent = `${c >= 0 ? '+' : '−'}${a.toFixed(0)}¢`; $('devRead').className = cls + '-t';
  liveBuf.push(a <= T ? 1 : 0); if (liveBuf.length > 90) liveBuf.shift();
  const pct = 100 * liveBuf.reduce((s, x) => s + x, 0) / liveBuf.length;
  $('scAcc').textContent = `Accuracy this note: ${pct.toFixed(0)}% (${liveBuf.length} frames)`;
  $('scAcc').className = 'srow center ' + (pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'bad') + '-t';
}

// ----- per-note scorecard (keybr-style) -----
// Every play of a note adds one event: hit {c: mean cents, a: share of frames in tolerance, s: wobble},
// skip {k:'s'} or slip {k:'w'} (a wrong note played while this one was expected). Recent events weigh more.
const PROFILES = ['Nandini', 'Nayonika'], PCOLOR = { Nandini: '#6c8dff', Nayonika: '#f472b6' };
const CARD_MAX = 150;                                   // plays kept per note (older ones fall off)
const ckey = p => 'tuner-scorecard-v2-' + p, pkey = p => 'tuner-passes-v2-' + p;
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let profile = (() => { try { const p = localStorage.getItem('tuner-profile'); return PROFILES.includes(p) ? p : PROFILES[0]; } catch { return PROFILES[0]; } })();
let cardAll = lsGet(ckey(profile), {}), passAll = lsGet(pkey(profile), []), cardSess = {}, hold = null;
$('profile').value = profile;
const profEvents = p => p === profile ? cardAll : lsGet(ckey(p), {});
const profPasses = p => p === profile ? passAll : lsGet(pkey(p), []);
function addEv(midi, ev, quiet) {
  ev.t = Date.now(); ev.sl = ev.sl || scaleLabel(); ev.i = ev.i || $('scInst').value;
  for (const s of [cardSess, cardAll]) { const a = (s[midi] = s[midi] || []); a.push(ev); if (a.length > CARD_MAX) a.shift(); }
  lsSet(ckey(profile), cardAll);
  if (!quiet) renderCard();
}
function savePass(pct) { passAll.push({ t: Date.now(), pct, s: scaleLabel() }); if (passAll.length > 300) passAll.shift(); lsSet(pkey(profile), passAll); }
const clamp01 = x => Math.max(0, Math.min(1, x));
// Instrument-specific steadiness: how much pitch wobble (¢, std-dev) earns zero steadiness credit.
// Bowed/vibrato instruments forgive more; fretted instruments (fixed pitch) are held to a tighter standard.
const INST_WOBBLE = { chromatic: 25, guitar: 20, ukulele: 20, ukuleleLow: 20, ukuleleBar: 20, bass: 20, bass5: 20, violin: 40, viola: 40, cello: 40, mandolin: 25 };
const wobbleCap = e => INST_WOBBLE[e.i] || 25;
function noteScore(evs) {
  const n = evs.length; if (n < 3) return null;                 // not enough data yet
  let W = 0, Wh = 0, Ws = 0, acc = 0, bias = 0, sd = 0, sdn = 0;
  evs.forEach((e, i) => {
    const w = Math.pow(0.9, n - 1 - i); W += w;
    if (e.k === 'h') {
      Wh += w; acc += w * e.a; bias += w * e.c;
      if (typeof e.s === 'number') { Ws += w; sd += w * e.s; sdn += w * e.s / wobbleCap(e); }   // very short notes carry no wobble measurement
    }
  });
  const hitRate = Wh / W; if (Wh) { acc /= Wh; bias /= Wh; }
  const sdv = Ws ? sd / Ws : 0, sdnv = Ws ? sdn / Ws : 0.5;     // wobble unknown => half steadiness credit, never full
  const hit = Wh > 0;                                            // never actually played => no credit for "centred"/"steady"
  const score = 100 * (0.4 * acc + (hit ? 0.25 * clamp01(1 - Math.abs(bias) / 30) + 0.15 * clamp01(1 - sdnv) : 0) + 0.2 * hitRate);
  return { score, bias, acc, sd: sdv, hitRate, n, hit };
}
const biasText = (b, hit = true) => !hit ? 'never played' : Math.abs(b) < 5 ? 'centred' : `${b > 0 ? 'sharp' : 'flat'} by ${Math.abs(b).toFixed(0)}¢`;
// While a note is held, keep collecting its frames (after the attack) so we can score accuracy and steadiness.
function collectHold(f) {
  if (!hold) return;
  if (f) {
    const c = centsBetween(f, noteToFreq(hold.midi, a4()));
    if (Math.abs(c) <= 65) { hold.frames.push(c); hold.gap = 0; } else finalizeHold();
  } else if (++hold.gap >= 4) finalizeHold();
}
function finalizeHold() {
  const h = hold; hold = null; if (!h) return;
  let c = h.c0, a = Math.abs(h.c0) <= h.T ? 1 : 0, s = null;   // s stays null when the note was too short to measure wobble
  const fr = h.frames;
  if (fr.length >= 4) {
    c = fr.reduce((x, y) => x + y, 0) / fr.length;
    s = Math.sqrt(fr.reduce((x, y) => x + (y - c) * (y - c), 0) / fr.length);
    a = fr.filter(x => Math.abs(x) <= h.T).length / fr.length;
  }
  addEv(h.midi, { k: 'h', c, a, s, sl: h.sl, i: h.i });
}
const SPARK = '▁▂▃▄▅▆▇█';
const sortSt = { card: { k: 'm', d: 1 }, ana: { k: 'latest', d: 1 }, cmp: { k: 'm', d: 1 } };
function sortRows(id, rows) { const s = sortSt[id]; return rows.slice().sort((a, b) => { const x = a[s.k], y = b[s.k]; if (x == null || y == null) return (x == null) - (y == null); return (x - y) * s.d; }); }
function thead(id, cols) { const s = sortSt[id]; return '<tr>' + cols.map(c => c[2] === false ? `<th>${c[1]}</th>` : `<th class="srt" data-t="${id}" data-k="${c[0]}">${c[1]}${s.k === c[0] ? (s.d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr>'; }
document.addEventListener('click', e => {
  const th = e.target.closest('th.srt'); if (!th) return;
  const s = sortSt[th.dataset.t], k = th.dataset.k;
  if (s.k === k) s.d = -s.d; else { s.k = k; s.d = 1; }
  if (th.dataset.t === 'card') renderCard(); else renderAnalysis();
});
const scaleNotes = () => [...new Set(sc.seq)].sort((a, b) => a - b);
const scaleLabel = () => `${$('scRoot').selectedOptions[0].text} ${$('scType').selectedOptions[0].text} · oct ${$('scOct').value} · ${$('scSpan').value} oct · ${$('scDir').value}`;
const statusOf = s => !s ? ['Needs data', 'na'] : s.score >= 85 ? ['Strong', 'ok'] : s.score >= 70 ? ['OK', 'mid'] : ['Weak', 'bad'];
const cmtOf = (evs, s) => {
  const sk = evs.filter(e => e.k === 's').length, wr = evs.filter(e => e.k === 'w').length, p = [];
  p.push(s ? biasText(s.bias, s.hit) : evs.length ? `${evs.length}/3 plays so far` : 'not played yet');
  if (sk) p.push(`${sk} skipped`); if (wr) p.push(`${wr} wrong`);
  return p.join(' · ');
};
function renderCard() {
  const store = $('cardView').value === 'all' ? cardAll : cardSess;
  const mids = scaleNotes();            // the scorecard always follows the scale chosen in the options
  const rows = mids.map(m => {
    const evs = store[m] || [], s = noteScore(evs), [st, cls] = statusOf(s);
    return { m, name: midiName(m), score: s ? s.score : null, stk: s ? s.score : null, bias: s ? s.bias : null, st, cls, cmt: cmtOf(evs, s) };
  });
  $('cardTable').innerHTML = rows.length ? `<table>${thead('card', [['score', 'Score'], ['m', 'Note'], ['stk', 'Status'], ['bias', 'Comment']])}` +
    sortRows('card', rows).map(r => `<tr><td><span class="sc ${r.cls}">${r.score != null ? r.score.toFixed(0) : '–'}</span></td><td><b>${r.name}</b></td><td class="${r.cls === 'na' ? 'mut' : r.cls + '-t'}">${r.st}</td><td>${r.cmt}</td></tr>`).join('') + '</table>'
    : '<span class="mut">Play a scale to build the scorecard.</span>';
  const ps = sc.passes;
  $('cardTrend').textContent = ps.length ? `Passes: ${ps.map(p => SPARK[Math.min(7, Math.floor(p.pct / 12.5))]).join('')}  ${ps.map(p => p.pct.toFixed(0) + '%').join(' → ')}` : '';
}
$('cardView').onchange = renderCard;
$('cardReset').onclick = () => {
  const all = $('cardView').value === 'all';
  if (!confirm(all ? `Delete ALL saved note scores for ${profile}?` : 'Clear this session\'s note scores?')) return;
  if (all) { cardAll = {}; passAll = []; try { localStorage.removeItem(ckey(profile)); localStorage.removeItem(pkey(profile)); } catch {} } else cardSess = {};
  renderCard(); renderAnalysis();
};
$('cardCsv').onclick = () => {
  const store = $('cardView').value === 'all' ? cardAll : cardSess;
  const rows = Object.keys(store).map(Number).sort((x, y) => x - y).map(m => {
    const s = noteScore(store[m]);
    return [midiName(m), store[m].length, s ? s.score.toFixed(0) : '', s ? s.bias.toFixed(1) : '', s ? (100 * s.acc).toFixed(0) : '', s ? s.sd.toFixed(1) : '', s ? (100 * s.hitRate).toFixed(0) : ''].join(',');
  });
  download(`scorecard-${profile}-${stamp()}.csv`, ['note,plays,score,bias_cents,in_tune_pct,wobble_cents,played_pct', ...rows].join('\n'), 'text/csv');
};

