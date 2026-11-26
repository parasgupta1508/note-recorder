// Scale practice tab and the per-note scorecard.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.
// The pure parts (scale + timeline in core/scales.js, instrument rules in core/instruments.js, scoring in core/scoring.js) live in js/core.

// ----- SCALE -----
// sc.tl is the reference timeline (core/scales.js) used by Hear scale and by the live scoring; sc.seq is its MIDI list.
// sc.slots holds one result per scale position per pass of this run (what the summary and "Spots to fix" use).
// ----- the scale-drill grader (Settings > Engines > "Scale drills: grading"): Practical (default) or Strict -----
// Frames are stored as the grader's deviation (scaleDev: for bowed strings the distance to the nearest acceptable pitch, see js/core/engines/scorer-practical.js).
// While playing, the player's overall offset so far is also taken out (scaleShift) so a steady 10 cents flat is not shown as every note being wrong.
const scaleScorer = () => (typeof engineFor === 'function' && engineFor('scorer', 'live')) || findEngine('scorer', 'strict');
const scorerParams = e => { const o = {}; Object.keys(e.params || {}).forEach(k => { o[k] = typeof engineParam === 'function' ? engineParam(e, k) : e.params[k].default; }); return o; };
function scaleCtx(midi) { const e = scaleScorer(), inst = sc.plan ? sc.plan.inst : $('scInst').value; return { e, ctx: { midi, root: sc.plan ? sc.plan.pc : 0, fretless: !!ruleFor(inst).bowing, inst, params: scorerParams(e) } }; }
function scaleDev(cents, midi) { const { e, ctx } = scaleCtx(midi); return e.dev ? e.dev(cents, ctx) : cents; }
function scaleShift() { const { e, ctx } = scaleCtx(0); return e.shift ? e.shift(sc.devHist || [], ctx) : 0; }
function scaleTol() { const { e, ctx } = scaleCtx(0); return e.tol ? e.tol(tol(), ctx) : tol(); }
function scoreRun(slots, opts) { const e = scaleScorer(); return e.evaluate(slots, Object.assign({}, opts, { params: scorerParams(e) })); }
const sc = { seq: [], tl: [], pos: 0, grades: [], attempts: [], running: false, wrong: 0, pass: 1, passes: [], slots: [], slotAt: {}, mode: 'tempo', clock: null, bpm: 80, waitFrames: [], waitOk: 0, label: null, plan: null };
let demoIdx = -1, liveBuf = [], liveC = [], silentFrames = 99;
const det = new AttemptDetector(a => onAttempt(a));   // onAttempt lives in practice-engine.js, which loads later
{ const groups = {};   // scales, modes, arpeggios ... as groups in the list
  for (const k in SCALE_DEFS) { const g = SCALE_DEFS[k].group; if (!groups[g]) { groups[g] = document.createElement('optgroup'); groups[g].label = g; $('scType').appendChild(groups[g]); } groups[g].appendChild(new Option(SCALE_DEFS[k].label, k)); } }
const ROOT_LABELS = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];
ROOT_LABELS.forEach((n, i) => $('scRoot').add(new Option(n, i)));
$('scRoot').value = 0;
PRACTICE_INSTRUMENTS.forEach(([k, label]) => $('scInst').add(new Option(label, k)));   // Violin, Guitar, Piano (chromatic), Ukulele
{ const z = document.createElement('div'); z.className = 'dev-zone'; z.id = 'devZone'; $('devBar').insertBefore(z, $('devMarker')); }   // the green "in tune" band of the ±50¢ meter

// What the controls ask for, with the instrument's rules applied: start note, effective span, warnings, and the timeline.
function planNow() {
  const inst = $('scInst').value, pc = +$('scRoot').value, type = $('scType').value, bow = $('scBow').value, pos = $('scPos').value, bpm = Math.max(30, Math.min(240, +$('scBpm').value || 80));
  const plan = planScale(inst, pc, +$('scSpan').value, pos);
  const tl = buildTimeline({ start: plan.start, type, span: plan.span, bpm, rootPc: pc, slur: slurSize(inst, bow), flats: useFlats ? true : null });
  return { ...plan, tl, inst, pc, type, bow, pos, bpm };
}
const currentPlan = planNow;
const techLabel = (inst, bow, pos) => { const c = controls(inst), l = o => o ? (o.options.find(x => x.value === (o === c.bowing ? bow : pos)) || { label: '' }).label : ''; return [l(c.bowing), l(c.position)].filter(Boolean).join(' · '); };
const scaleLabel = () => sc.label || (sc.label = (() => { const p = planNow(); return `${p.tl[0].noteName.replace(/-?\d+$/, '')} ${SCALE_DEFS[p.type].label} · ${p.span} oct` + (techLabel(p.inst, p.bow, p.pos) ? ` · ${techLabel(p.inst, p.bow, p.pos)}` : ''); })());
const nameParts = n => n.match(/^([A-G][#b]?)(-?\d+)$/);
const noteHtml = n => { const m = nameParts(n); return m ? `${m[1].replace('#', '♯').replace(/b$/, '♭')}<small>${m[2]}</small>` : n; };
const stringsOf = inst => (PRESETS[inst] && PRESETS[inst].strings || []).map(nameToMidi);
const complete = () => sc.attempts.length > 0 && sc.pos >= sc.seq.length && !sc.running;

function neutralLive(msg = 'Waiting for note…') {
  $('scHeard').innerHTML = '&nbsp;'; $('scVerdict').textContent = '';
  $('devMarker').className = 'dev-marker'; $('devMarker').style.left = '50%';
  $('devRead').textContent = '–'; $('devRead').className = '';
  $('scAcc').textContent = msg; $('scAcc').className = 'srow center'; liveC = [];
}
// The colour class of scale position i: ok / close / bad (graded), cur (the target), pend (not reached or skipped). The chips and the notation share it.
function noteCls(i, demo) {
  if (demo) return i < demoIdx ? 'ok' : i === demoIdx ? 'cur' : 'pend';
  if (i < sc.pos && sc.grades[i]) return { 'In tune': 'ok', 'Close': 'close', 'Skipped': 'pend' }[sc.grades[i]] || 'bad';
  return sc.running && i === (typeof svCurIdx === 'function' ? svCurIdx() : sc.pos) ? 'cur' : 'pend';
}
function renderScale() {
  const seq = sc.seq, A = a4(), demo = demoIdx >= 0;
  if (seq.length) {
    const lo = Math.min(...seq), hi = Math.max(...seq), fl = noteToFreq(lo, A), fh = noteToFreq(hi, A);
    $('scRange').innerHTML = `${sc.tl[seq.indexOf(lo)].noteName}–${sc.tl[seq.indexOf(hi)].noteName} · ${fl.toFixed(0)}–${fh.toFixed(0)} Hz` + (fl < +$('fmin').value || fh > +$('fmax').value ? ' · <span class="bad-t">outside the detection range — widen it in Settings</span>' : '');
  }
  $('scRow1').className = seq.length > 12 ? 'dense wrap' : seq.length > 9 ? 'dense' : ''; $('scStop').disabled = !(sc.running || demo);
  $('scRow1').innerHTML = sc.tl.map((n, i) => {
    const cls = noteCls(i, demo);
    return `<span class="chip mini ${cls}${n.direction === 'down' ? ' dn' : ''}" title="${n.direction === 'up' ? 'going up' : 'going down'}${sc.grades[i] === 'Skipped' && !demo ? ' · skipped' : ''}">${n.noteName.replace('b', '♭').replace('#', '♯')}</span>`;
  }).join('');
  const idx = demo ? demoIdx : sc.running ? sc.pos : -1;
  if (idx >= 0 && idx < seq.length) {
    const n = sc.tl[idx], fh = sc.plan ? fingerHint(sc.plan.inst, n.midi, stringsOf(sc.plan.inst), sc.plan.pos) : null;
    $('scCur').innerHTML = noteHtml(n.noteName); $('scTarget').textContent = `target ${noteToFreq(n.midi, A).toFixed(2)} Hz`;
    $('scArrow').textContent = n.direction === 'up' ? '↑' : '↓'; $('scFinger').textContent = fh ? fh.text : '';
    if (demo) { neutralLive('Demo playing'); $('scHeard').textContent = 'demo playback'; }
  } else if (complete()) {
    $('scCur').textContent = '✓'; $('scTarget').textContent = 'Scale complete'; $('scArrow').textContent = ''; $('scFinger').textContent = ''; neutralLive('');
  } else { $('scCur').textContent = '–'; $('scTarget').textContent = 'Press Start practice'; $('scArrow').textContent = ''; $('scFinger').textContent = ''; neutralLive(); }
  svRender();   // notation, instrument view and cursor (scale-visual.js loads later; this only runs once everything has loaded)
}
function setMsg(text, cls = 'mut') { $('scMsg').textContent = text; $('scMsg').className = 'sc-msg ' + (cls === 'mut' ? 'mut' : cls + '-t'); }

// The live meter: cents from the target, smoothed (wide window for vibrato on bowed strings, narrow for frets), +-50 cents across the bar.
const liveMedian = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
function liveScaleFrame(f, t) {
  if (!sc.running || demoIdx >= 0) return;
  clockTick(t);
  if (sc.pos >= sc.seq.length) return;
  if (!f) { if (++silentFrames > 8) { neutralLive(); sc.waitFrames = []; sc.waitOk = 0; } return; }   // a bow change or a breath is a short gap, not an error
  const T = scaleTol(), target = sc.seq[sc.pos], rawET = centsOffset(f, target, a4());
  if (isOctaveGlitch(rawET)) return;                         // YIN octave/twelfth glitch: not a pitch the player made
  silentFrames = 0;
  const rule = ruleFor($('scInst').value), raw0 = scaleDev(rawET, target), raw = raw0 - scaleShift();   // raw0 is stored; raw is what is shown and graded (overall offset forgiven)
  liveC.push(raw); if (liveC.length > 15) liveC.shift();
  const c = liveMedian(liveC.slice(-rule.smooth)), a = Math.abs(c);
  const cls = a <= T ? 'ok' : a <= 25 ? 'warn' : 'bad';
  $('scHeard').textContent = `heard ${f.toFixed(2)} Hz   ${c >= 0 ? '+' : '−'}${a.toFixed(0)}¢`;
  $('scVerdict').textContent = gradeCents(c, T); $('scVerdict').className = `verdict ${cls}-t`;
  $('devMarker').style.left = (50 + Math.max(-50, Math.min(50, c)) * 0.9) + '%'; $('devMarker').className = 'dev-marker ' + cls;
  const z = $('devZone'); if (z.dataset.t !== String(T)) { z.dataset.t = T; z.style.left = (50 - T * 0.9) + '%'; z.style.width = (T * 1.8) + '%'; }
  $('devRead').textContent = `${c >= 0 ? '+' : '−'}${a.toFixed(0)}¢`; $('devRead').className = cls + '-t';
  liveBuf.push(a <= T ? 1 : 0); if (liveBuf.length > 90) liveBuf.shift();
  const pct = 100 * liveBuf.reduce((s, x) => s + x, 0) / liveBuf.length;
  $('scAcc').textContent = sc.mode === 'wait' ? `Hold it in tune: ${Math.min(sc.waitOk, rule.holdFrames)}/${rule.holdFrames}` : `Accuracy this note: ${pct.toFixed(0)}% (${liveBuf.length} frames)`;
  $('scAcc').className = 'srow center ' + (pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'bad') + '-t';
  if (sc.mode === 'wait') waitFrame(raw0, a <= T, rule);
}

// ----- per-note scorecard (keybr-style) -----
// Every play of a note adds one event: hit {c: mean cents, a: share of frames in tolerance, s: wobble, e: timing error ms, d: direction},
// skip {k:'s'} or slip {k:'w'} (a wrong note played while this one was expected). Recent events weigh more.
const CARD_MAX = 150;                                   // plays kept per note (older ones fall off)
const ckey = p => 'tuner-scorecard-v2-' + p, pkey = p => 'tuner-passes-v2-' + p;
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
// Players: typed in the app and kept only on this device (no names live in the code). Each player's scores are stored under their name (ckey / pkey).
const PALETTE = ['#6c8dff', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#fb923c'], PLAYERS_KEY = 'tuner-players';
const PROFILES = [], PCOLOR = {};
const validName = n => typeof n === 'string' && /^[\p{L}\p{N} .'_-]{1,24}$/u.test(n) && n === n.trim();   // no characters that could break the page or a storage key
function addPlayerRecord(n, c) { if (!PROFILES.includes(n)) PROFILES.push(n); PCOLOR[n] = /^#[0-9a-f]{6}$/i.test(c) ? c : PALETTE[(PROFILES.indexOf(n)) % PALETTE.length]; }
const savePlayers = () => lsSet(PLAYERS_KEY, PROFILES.map(name => ({ name, color: PCOLOR[name] })));
(function loadPlayers() {
  let list = lsGet(PLAYERS_KEY, null);
  if (!Array.isArray(list)) {   // first start after the update: players who already have saved scores on this device are found by their storage keys, so nothing is lost
    const names = new Set();
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i) || ''; for (const pre of ['tuner-scorecard-v2-', 'tuner-passes-v2-']) if (k.startsWith(pre)) names.add(k.slice(pre.length)); } } catch {}
    list = [...names].sort().map(name => ({ name }));
  }
  list.forEach(p => p && validName(p.name) && addPlayerRecord(p.name, p.color));
  if (PROFILES.length) savePlayers();
})();
let profile = (() => { try { const p = localStorage.getItem('tuner-profile'); return PROFILES.includes(p) ? p : (PROFILES[0] || ''); } catch { return PROFILES[0] || ''; } })();
let cardAll = profile ? lsGet(ckey(profile), {}) : {}, passAll = profile ? lsGet(pkey(profile), []) : [], cardSess = {}, hold = null;
const profEvents = p => p === profile ? cardAll : lsGet(ckey(p), {});
const profPasses = p => p === profile ? passAll : lsGet(pkey(p), []);
function addEv(midi, ev, quiet) {
  ev.t = Date.now(); ev.sl = ev.sl || scaleLabel(); ev.i = ev.i || $('scInst').value;
  for (const s of [cardSess, cardAll]) { const a = (s[midi] = s[midi] || []); a.push(ev); if (a.length > CARD_MAX) a.shift(); }
  if (profile) lsSet(ckey(profile), cardAll);
  if (!quiet) renderCard();
}
function savePass(pct) { passAll.push({ t: Date.now(), pct, s: scaleLabel() }); if (passAll.length > 300) passAll.shift(); if (profile) lsSet(pkey(profile), passAll); }
// While a note is held, keep collecting its frames (after the attack) so we can score accuracy and steadiness.
// An octave glitch frame is skipped like a gap (a few in a row end the note), so one bad YIN frame does not cut a held note short.
function collectHold(f) {
  if (!hold) return;
  if (f) {
    const c = centsBetween(f, noteToFreq(hold.midi, a4()));
    if (Math.abs(c) <= 65) { hold.frames.push(scaleDev(c, hold.midi)); hold.gap = 0; } else if (isOctaveGlitch(c)) { if (++hold.gap >= 4) finalizeHold(); } else finalizeHold();
  } else if (++hold.gap >= 4) finalizeHold();
}
function finalizeHold() {
  const h = hold; hold = null; if (!h) return;
  let c = h.c0, a = Math.abs(h.c0) <= h.T ? 1 : 0, s = null, m = null, sp = null;   // s stays null when the note was too short to measure wobble
  if (h.frames.length >= 4) {
    const st = holdStats(h.frames, h.T, ruleFor(h.i).smooth); c = st.c; s = st.s; a = st.a;
    const body = smoothCents(h.frames.slice(Math.min(3, h.frames.length >> 2)), ruleFor(h.i).smooth);   // the evaluation judges the pitch after the attack
    m = evalMedian(body); sp = Math.abs(h.c0 - m);                                                      // sp: how far the first frame was from where the note settled
  }
  addEv(h.midi, { k: 'h', c, a, s, e: h.e, d: h.d, sl: h.sl, i: h.i }, true);
  Object.assign(slotFor(h.ix, h.pass), { k: 'h', c, a, s, e: h.e, m, sp });
  (sc.devHist = sc.devHist || []).push(m != null ? m : c);   // the grader's view of the player's overall offset
  renderCard(); renderSummary();
  if (sc.runPass && h.pass === sc.runPass) flushRun();   // the last note of a finished pass has just been scored
}
// One result per scale position per pass of this run.
function slotFor(i, pass = sc.pass) {
  const key = pass + ':' + i; let s = sc.slotAt[key];
  if (!s) { const n = sc.tl[i]; s = sc.slotAt[key] = { pass, index: i, name: n.noteName, midi: n.midi, d: n.direction, k: 's', c: null, m: null, a: 0, s: null, e: null, sp: null, wrong: 0, rt: 0 }; sc.slots.push(s); }
  return s;
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
const scaleNotes = () => [...new Set(sc.seq)].sort((a, b) => a - b);   // the analysis page adds the current scale's notes
const scoreCls = s => !s ? 'na' : s.score >= 85 ? 'ok' : s.score >= 70 ? 'mid' : 'bad';
// One row per scale position: F#4 going up and F#4 going down are separate rows.
function cardRows(store) {
  const T = tol(), cap = e => ruleFor(e.i || $('scInst').value).wobble;
  return sc.tl.map(n => {
    const evs = eventsFor(store, n.midi, n.direction), s = noteScore(evs, cap, 1), st = noteStatus(evs, s, T);
    return { m: n.index, midi: n.midi, d: n.direction, name: n.noteName, evs, s, score: s ? s.score : null, stk: s ? s.score : null, bias: s ? s.bias : null, st, cmt: commentFor(evs, s, cap(evs[0] || {})) };
  });
}
function renderCard() {
  const store = $('cardView').value === 'all' ? cardAll : cardSess;
  const rows = cardRows(store);
  const badge = r => r.st ? `<span class="b b-${r.st}">${STATUS_LABEL[r.st]}</span>` : '<span class="b b-na">No data</span>';
  $('cardTable').innerHTML = rows.length ? `<table>${thead('card', [['score', 'Score'], ['m', 'Note'], ['stk', 'Status'], ['bias', 'Comment']])}` +
    sortRows('card', rows).map(r => `<tr><td><span class="sc ${scoreCls(r.s)}">${r.score != null ? r.score.toFixed(0) : '–'}</span></td><td><b>${r.name.replace('b', '♭').replace('#', '♯')}</b> <span class="mut">${r.d === 'up' ? '↑' : '↓'}</span></td><td>${badge(r)}</td><td>${r.cmt}</td></tr>`).join('') + '</table>'
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
// Scorecard export: one row per note and direction (events saved before directions existed are "any").
function cardExportRows(store) {
  const T = tol(), out = [];
  for (const m of Object.keys(store).map(Number).sort((x, y) => x - y)) {
    const groups = new Map(); store[m].forEach(e => { const d = e.d || 'any'; (groups.get(d) || groups.set(d, []).get(d)).push(e); });
    for (const [d, evs] of groups) {
      const s = noteScore(evs, e => ruleFor(e.i).wobble, 1), tm = evs.filter(e => typeof e.e === 'number');
      out.push({ note: midiName(m), midi: m, direction: d, plays: evs.length, score: s ? +s.score.toFixed(0) : null, status: noteStatus(evs, s, T) || '', bias_cents: s ? +s.bias.toFixed(1) : null,
        in_tune_pct: s ? +(100 * s.acc).toFixed(0) : null, wobble_cents: s ? +s.sd.toFixed(1) : null, played_pct: s ? +(100 * s.hitRate).toFixed(0) : null,
        timing_ms: tm.length ? +(tm.reduce((a, b) => a + b.e, 0) / tm.length).toFixed(0) : null, instrument: (evs[evs.length - 1].i || ''), scale: (evs[evs.length - 1].sl || '') });
    }
  }
  return out;
}
const CARD_COLS = ['note', 'direction', 'plays', 'score', 'status', 'bias_cents', 'in_tune_pct', 'wobble_cents', 'played_pct', 'timing_ms', 'instrument', 'scale'];
const csvCell = v => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
$('cardCsv').onclick = () => {
  const store = $('cardView').value === 'all' ? cardAll : cardSess;
  download(`scorecard-${profile}-${stamp()}.csv`, [CARD_COLS.join(','), ...cardExportRows(store).map(r => CARD_COLS.map(c => csvCell(r[c])).join(','))].join('\n'), 'text/csv');
};
// JSON export of this run: settings, the reference timeline, every result, the summary and the scorecard.
function scaleJson() {
  const p = sc.plan || planNow(), store = $('cardView').value === 'all' ? cardAll : cardSess;
  return JSON.stringify({ app: 'scale-drills', version: 2, exported: new Date().toISOString(), player: profile || null,
    settings: { instrument: p.inst, root: p.pc, scale: p.type, span: p.span, requestedSpan: p.requestedSpan, bowing: controls(p.inst).bowing ? p.bow : null, position: controls(p.inst).position ? p.pos : null, bpm: sc.bpm || p.bpm, mode: sc.mode, tolerance_cents: tol() },
    plan: { start: p.start, top: p.top, warnings: p.warnings }, timeline: sc.tl, results: sc.slots, summary: summariseRun(sc.slots, { tol: tol(), beatMs: 60000 / (sc.bpm || p.bpm) }),
    scorecard: cardExportRows(store), attempts: sc.attempts }, null, 2);
}
