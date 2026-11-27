// Scale run history and the result card: evaluates every completed run (core/evaluation.js), keeps it on this device, shows the score with the teacher coach's
// feedback (core/coach.js), and draws the "Scale scores" view of the Progress tab.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.
//
// Storage: IndexedDB (database "tuner-runs"), because a run holds per-note figures and a long practice life would crowd the 5 MB of localStorage that the scorecards already use.
// All reads come from the in-memory list RUNS (loaded once at start-up), so the screens stay synchronous. If IndexedDB is not available the same list is kept in localStorage.

const RUNS_KEY = 'tuner-runs-v1';
let RUNS = [], RUNS_LS = false, runsDbP = null;

// ---- storage
function runsDb() {
  if (!runsDbP) runsDbP = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB is not available'));
    let q; try { q = indexedDB.open('tuner-runs', 1); } catch (e) { return rej(e); }
    q.onupgradeneeded = () => q.result.createObjectStore('runs', { keyPath: 'id', autoIncrement: true });
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); q.onblocked = () => rej(new Error('blocked'));
  });
  return runsDbP;
}
// Runs one transaction. fn(store) may return a request; its result is passed on once the transaction has committed.
async function runsTx(mode, fn) {
  const db = await runsDb();
  return new Promise((res, rej) => { const tx = db.transaction('runs', mode); let out; try { out = fn(tx.objectStore('runs')); } catch (e) { return rej(e); } tx.oncomplete = () => res(out && 'result' in out ? out.result : undefined); tx.onerror = tx.onabort = () => rej(tx.error); });
}
async function runsLoad() {
  try {
    const got = await runsTx('readonly', st => st.getAll());
    const pending = RUNS.filter(r => r.id == null);   // runs finished before the load came back
    RUNS = histFilter(got, {}).concat(pending); RUNS_LS = false;
  } catch { RUNS_LS = true; RUNS = lsGet(RUNS_KEY, []).concat(RUNS.filter(r => !lsGet(RUNS_KEY, []).includes(r))); }
  if (typeof renderAnalysis === 'function') renderAnalysis();
}
function runsPersistFail() { RUNS_LS = true; lsSet(RUNS_KEY, RUNS); }
function runsAdd(rec) {
  if (window.stActive) return;   // the speaker test runs the real drill on a scratch player: its runs are not kept
  const before = RUNS; RUNS = histAdd(RUNS, rec);
  if (RUNS_LS) { lsSet(RUNS_KEY, RUNS); return; }
  const dropped = before.filter(r => !RUNS.includes(r));
  runsTx('readwrite', st => { const r = st.add(rec); r.onsuccess = () => { rec.id = r.result; }; dropped.forEach(d => { if (d.id != null) st.delete(d.id); }); return r; }).catch(runsPersistFail);
}
const runsOf = player => histFilter(RUNS, { player });
function runsDeleteFor(player) {
  const gone = RUNS.filter(r => r.p === player); RUNS = RUNS.filter(r => r.p !== player);
  if (RUNS_LS) { lsSet(RUNS_KEY, RUNS); return; }
  runsTx('readwrite', st => { gone.forEach(r => { if (r.id != null) st.delete(r.id); }); }).catch(runsPersistFail);
}
// Backup and restore: a restored player's runs replace what this device has for that player.
function runsClean(a, player) {
  const num = (x, d = 0) => Number.isFinite(+x) ? +x : d, str = (x, n = 60) => String(x == null ? '' : x).slice(0, n), dir = o => ({ n: num(o && o.n), played: num(o && o.played), bias: o && o.bias == null ? null : num(o && o.bias), abs: o && o.abs == null ? null : num(o && o.abs), pitch: o && o.pitch == null ? null : num(o && o.pitch) });
  return (Array.isArray(a) ? a : []).slice(-HIST_MAX).filter(r => r && typeof r === 'object' && Number.isFinite(+r.t) && Number.isFinite(+r.total) && Array.isArray(r.notes) && SCALE_DEFS[r.type]).map(r => ({
    v: HIST_VERSION, t: num(r.t), p: player, inst: str(r.inst, 20), type: str(r.type, 20), root: num(r.root), span: num(r.span, 1), pos: str(r.pos, 12), bow: str(r.bow, 12), bpm: num(r.bpm, 80), mode: r.mode === 'wait' ? 'wait' : 'tempo', label: str(r.label), pass: num(r.pass, 1),
    total: num(r.total), band: evalBand(num(r.total)), pitch: num(r.pitch), fluency: num(r.fluency), tone: num(r.tone), pulse: r.pulse == null ? null : num(r.pulse), continuity: num(r.continuity), lag: r.lag == null ? null : num(r.lag), cov: r.cov == null ? null : num(r.cov),
    wrong: num(r.wrong), skipped: num(r.skipped), retries: num(r.retries), stalls: num(r.stalls), slots: num(r.slots), played: num(r.played), up: dir(r.up), down: dir(r.down),
    notes: r.notes.slice(0, 200).map(x => ({ n: str(x && x.n, 6), m: num(x && x.m), d: x && x.d === 'u' ? 'u' : 'd', k: x && x.k ? 1 : 0, c: x && x.c == null ? null : num(x && x.c), s: x && x.s == null ? null : num(x && x.s), e: x && x.e == null ? null : num(x && x.e) })),
  }));
}
function runsReplaceFor(player, runs) { runsDeleteFor(player); runs.forEach(r => { RUNS = histAdd(RUNS, r); }); if (RUNS_LS) lsSet(RUNS_KEY, RUNS); else runsTx('readwrite', st => { runs.forEach(r => { const q = st.add(r); q.onsuccess = () => { r.id = q.result; }; }); }).catch(runsPersistFail); }

// ---- a run is finished: evaluate, save, show
// endPass() queues the run. The last note is still being held at that moment, so the run is evaluated once that note has been scored (finalizeHold), or after a moment.
function queueRun() {
  sc.runPass = sc.pass; clearTimeout(sc.runTimer);
  if (!hold) flushRun(); else sc.runTimer = setTimeout(() => { finalizeHold(); flushRun(); }, 1500);
}
function flushRun() {
  clearTimeout(sc.runTimer); const pass = sc.runPass; sc.runPass = 0; if (!pass || !sc.plan) return;
  const slots = sc.slots.filter(s => s.pass === pass); if (!slots.length) return;
  const p = sc.plan, ev = scoreRun(slots, { beatMs: 60000 / sc.bpm, mode: sc.mode, wobbleCap: ruleFor(p.inst).wobble });
  const rec = histRecord(ev, { t: Date.now(), player: profile, inst: p.inst, type: p.type, root: p.pc, span: p.span, pos: p.pos, bow: p.bow, bpm: sc.bpm, mode: sc.mode, label: scaleLabel(), pass });
  const prior = runsOf(profile), sameScale = prior.filter(r => r.inst === rec.inst && histScaleKey(r) === histScaleKey(rec)), best = histIsBest(sameScale, rec);
  const coach = coachReview(rec, prior, { best });
  runsAdd(rec);
  sc.lastRun = { rec, coach, best, streak: histDayStreak(runsOf(profile)) };
  renderResult();
}

// ---- the result card
const BAND_CLS = { Distinction: 'dist', Merit: 'merit', Pass: 'pass', 'Below Pass': 'below' };
const resBar = (label, w, v) => `<div class="rb"><span>${label}<small> ${w}%</small></span><div class="rb-t"><i style="width:${Math.max(2, Math.min(100, v)).toFixed(0)}%"></i></div><b>${v.toFixed(0)}</b></div>`;
const resDir = (name, d) => d.n ? `${name} ${d.bias == null ? 'not played' : `${d.bias >= 0 ? '+' : '−'}${Math.abs(d.bias).toFixed(0)}¢ ${Math.abs(d.bias) < 5 ? '(centred)' : d.bias > 0 ? '(sharp)' : '(flat)'}`}` : '';
// The result stays until the next session starts, so it has a Result button like the Scorecard: shown when a run ends, hidden or shown again on demand.
let resOpen = true;
function syncResBtn() { const b = $('scResBtn'), el = $('scResult'); if (!b || !el) return; const has = !!sc.lastRun; b.disabled = !has; el.hidden = !has || !resOpen; b.setAttribute('aria-expanded', String(has && resOpen)); }
function clearResult() { sc.lastRun = null; const el = $('scResult'); if (el) el.innerHTML = ''; resOpen = true; syncResBtn(); }
function renderResult() {
  const el = $('scResult'), L = sc.lastRun; if (!el) return;
  if (!L) { el.innerHTML = ''; syncResBtn(); return; }
  const r = L.rec, list = a => `<ul>${a.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  el.innerHTML = `<div class="res-head"><div class="res-score"><b>${r.total}</b><small>/100</small></div>
    <div><span class="band ${BAND_CLS[r.band]}">${r.band}</span>${L.best ? ' <span class="pbadge">★ Personal best</span>' : ''}
    <div class="mut res-sub">${esc(r.label.split(' · ').slice(0, 2).join(' · '))} · ${r.bpm} BPM · ${r.mode === 'wait' ? 'Wait for note' : 'Tempo-locked'} · pass ${r.pass}${r.eng ? ' · ' + (r.eng === 'strict' ? 'Strict' : 'Practical') + ' grading' : ''}</div>
    ${r.cov != null && r.cov < 0.6 ? `<div class="warn-t res-sub">The microphone heard only ${Math.round(r.cov * 100)}% of each note. Move it closer, quiet the room, or raise the input level: this score may be lower than your playing deserves.</div>` : ''}
    ${r.off != null && Math.abs(r.off) >= 8 ? `<div class="mut res-sub">Your whole scale sat ${Math.abs(r.off).toFixed(0)}¢ ${r.off > 0 ? 'sharp' : 'flat'}. Up to 12¢ of that is forgiven in the score${Math.abs(r.off) > 12 ? ' and the rest counts against you' : ''}, so check your tuning or your first note.</div>` : ''}
    ${L.streak > 1 ? `<div class="mut res-sub">${L.streak}-day practice streak</div>` : ''}</div></div>
    <div class="res-bars">${resBar('Pitch &amp; intonation', 50, r.pitch)}${resBar('Fluency &amp; pulse', 30, r.fluency)}${resBar('Tone &amp; steadiness', 20, r.tone)}</div>
    <div class="mut res-dir">${[resDir('Going up', r.up), resDir('Coming down', r.down)].filter(Boolean).join(' · ')}</div>
    <h4>What you're doing well</h4>${list(L.coach.strengths)}<h4>What to improve</h4>${list(L.coach.focus)}`;
  resOpen = true; syncResBtn();   // a fresh result opens by itself
}
if ($('scResBtn')) $('scResBtn').onclick = () => { resOpen = !resOpen; syncResBtn(); if (resOpen) $('scResult').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };

// ---- the "Scale scores" view of the Progress tab
const RH = { inst: 'all', scale: 'all' };
const instLabel = k => (PRACTICE_INSTRUMENTS.find(x => x[0] === k) || [k, k])[1];
const scaleShort = r => r.label.split(' · ').slice(0, 2).join(' · ');
function runsChart(runs, best) {
  const pts = runs.slice(-40), W = 420, H = 240, L = 30, R = 12, T = 12, B = 26, x = i => pts.length < 2 ? (L + W - R) / 2 : L + (W - L - R) * i / (pts.length - 1), lo = Math.max(0, Math.min(50, Math.floor((Math.min(...pts.map(p => p.total)) - 8) / 10) * 10)), y = v => T + (H - T - B) * (1 - (v - lo) / (100 - lo));   // the bottom of the chart follows the lowest score
  let o = '';
  for (const [v, name] of [[87, 'Distinction'], [75, 'Merit'], [60, 'Pass']].filter(b => b[0] > lo)) o += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="gt" x="${W - R}" y="${y(v) - 3}" text-anchor="end">${name} ${v}</text>`;
  for (const v of [lo, Math.round((lo + 100) / 2), 100]) o += `<text class="gt" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  o += `<polyline class="ln" points="${pts.map((p, i) => `${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ')}"/>`;
  pts.forEach((p, i) => { o += `<circle class="pt ${BAND_CLS[p.band]}${p === best ? ' pb' : ''}" cx="${x(i).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="${p === best ? 6 : 4}"><title>${dateOf(p.t)} · ${p.total} ${p.band} · ${esc(scaleShort(p))} · ${esc(instLabel(p.inst))}</title></circle>`; });
  o += `<text class="gt" x="${L}" y="${H - 6}">${dateOf(pts[0].t)}</text><text class="gt" x="${W - R}" y="${H - 6}" text-anchor="end">${dateOf(pts[pts.length - 1].t)}</text>`;
  return `<svg class="runchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score for each run, ${pts.length} runs">${o}</svg>`;
}
function renderRunHistory() {
  const mine = runsOf(profile), insts = [...new Set(mine.map(r => r.inst))];
  if (RH.inst !== 'all' && !insts.includes(RH.inst)) RH.inst = 'all';
  const ofInst = histFilter(mine, { inst: RH.inst }), scales = [...new Map(ofInst.map(r => [histScaleKey(r), scaleShort(r)]))];
  if (RH.scale !== 'all' && !scales.some(s => s[0] === RH.scale)) RH.scale = 'all';
  const runs = histFilter(mine, { inst: RH.inst, scale: RH.scale }), best = histBest(runs), last = runs[runs.length - 1], streak = histDayStreak(mine);
  const head = `<div class="card2"><h3 style="color:${PCOLOR[profile] || 'inherit'}">${esc(profile || 'Scale scores')}</h3>
    <div class="rh-filters"><label class="field"><span>Instrument</span><select id="rhInst"><option value="all">All instruments</option>${insts.map(k => `<option value="${k}"${k === RH.inst ? ' selected' : ''}>${esc(instLabel(k))}</option>`).join('')}</select></label>
    <label class="field"><span>Scale</span><select id="rhScale"><option value="all">All scales</option>${scales.map(([k, n]) => `<option value="${k}"${k === RH.scale ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>`;
  if (!runs.length) { $('anBody').innerHTML = head + `<p class="mut" style="margin-top:12px">No scored runs yet${mine.length ? ' for this choice' : ''}. Finish a scale in Scale drills (one pass up and down) and it is scored out of 100 and saved here.</p></div>`; bindRunHistory(); return; }
  const tile = (v, l) => `<div><b>${v}</b>${l}</div>`;
  const tiles = `<div class="sum-big four">${tile(runs.length, 'Runs')}${tile(`${best.total}<small class="band ${BAND_CLS[best.band]}">${best.band}</small>`, `Personal best · ${dateOf(best.t)}`)}${tile(last.total, 'Latest · ' + last.band)}${tile(streak, streak === 1 ? 'day streak' : 'days streak')}</div>`;
  const spark = k => { const v = runs.slice(-10).map(r => r[k]); const lo = Math.min(...v), hi = Math.max(...v); return v.map(y => SPARK[hi === lo ? 3 : Math.round((y - lo) / (hi - lo) * 7)]).join(''); };
  const subs = `<div class="rh-subs">${[['pitch', 'Pitch'], ['fluency', 'Fluency'], ['tone', 'Tone']].map(([k, n]) => `<div><span>${n}</span><b>${last[k]}</b><i>${spark(k)}</i></div>`).join('')}</div>`;
  const rows = runs.slice(-10).reverse().map(r => {
    const weak = r.notes.filter(n => n.k && typeof n.c === 'number').sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 3).map(n => `${svSharp(n.n)} ${n.d === 'u' ? '↑' : '↓'} ${n.c >= 0 ? '+' : '−'}${Math.abs(n.c).toFixed(0)}¢`).join(', ');
    const f = o => o.bias == null ? '–' : `${o.bias >= 0 ? '+' : '−'}${Math.abs(o.bias).toFixed(0)}¢`;
    return `<details class="rh-run"><summary><span>${dateOf(r.t)}</span><span class="rh-n">${esc(scaleShort(r))} · ${esc(instLabel(r.inst))}</span><b>${r.total}</b><span class="band ${BAND_CLS[r.band]}">${r.band}</span>${r === best ? ' <span class="pbadge">★</span>' : ''}</summary>
      <div class="mut rh-d">Pitch ${r.pitch} · Fluency ${r.fluency} · Tone ${r.tone} · ${r.bpm} BPM ${r.mode === 'wait' ? '(wait for note)' : ''}<br>Going up ${f(r.up)} · coming down ${f(r.down)} · ${r.wrong} wrong · ${r.skipped} skipped${weak ? `<br>Furthest from centre: ${weak}` : ''}</div></details>`;
  }).join('');
  $('anBody').innerHTML = head + `${tiles}${runsChart(runs, best)}${subs}<h4 style="margin:12px 0 4px">Recent runs</h4>${rows}
    <div class="row" style="margin-top:10px"><button id="rhCsv" class="sec">Export CSV</button><button id="rhClear" class="sec">Clear history</button></div>
    <div class="mut" style="font-size:13px;margin-top:6px">One run is one pass up and down. Score = 50% pitch &amp; intonation, 30% fluency &amp; pulse, 20% tone &amp; steadiness. Distinction 87+, Merit 75+, Pass 60+. Kept on this device and included in the backup file.</div></div>`;
  bindRunHistory();
}
function bindRunHistory() {
  const i = $('rhInst'), s = $('rhScale'); if (!i) return;
  i.onchange = () => { RH.inst = i.value; RH.scale = 'all'; renderRunHistory(); };
  s.onchange = () => { RH.scale = s.value; renderRunHistory(); };
  const c = $('rhCsv'); if (c) c.onclick = () => download(`scale-scores-${stamp()}.csv`, ['date,instrument,scale,bpm,mode,total,band,pitch,fluency,tone,pulse,lag_ms,up_bias_c,down_bias_c,wrong,skipped',
    ...runsOf(profile).map(r => [new Date(r.t).toISOString(), r.inst, `"${scaleShort(r)}"`, r.bpm, r.mode, r.total, r.band, r.pitch, r.fluency, r.tone, r.pulse == null ? '' : r.pulse, r.lag == null ? '' : r.lag, r.up.bias == null ? '' : r.up.bias, r.down.bias == null ? '' : r.down.bias, r.wrong, r.skipped].join(','))].join('\n'), 'text/csv');
  const x = $('rhClear'); if (x) x.onclick = () => { if (confirm(`Delete all scored runs for ${profile}? This cannot be undone (a backup file can bring them back).`)) { runsDeleteFor(profile); renderRunHistory(); } };
}
runsLoad();
