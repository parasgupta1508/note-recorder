// Analysis tab: progress charts and insights.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// ----- ANALYSIS tab: progress per note / per scale over time, net score, insights, and a side-by-side of the two profiles -----
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const METRICS = {
  score: { label: 'Note score', short: 'score', unit: '', max: 100, f: s => s.score },
  acc: { label: 'In-tune %', short: 'in-tune %', unit: '%', max: 100, f: s => 100 * s.acc },
  err: { label: 'Pitch offset (¢, lower is better)', short: 'pitch offset', unit: '¢', max: null, f: s => Math.abs(s.bias) }
};
sortSt.scl = { k: 'net', d: -1 }; sortSt.cmpS = { k: 'name', d: 1 };
let anMode = 'prog'; const anHidden = new Set();
const noteColor = (i, n) => `hsl(${Math.round(i * 360 / Math.max(n, 1))},70%,62%)`;
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const dayKey = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const dateOf = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
// value after each play (from the 3rd on), scoring the 30 most recent plays — the same weighting as the scorecard
const seriesFor = (evs, f, byDate) => { const pts = []; for (let i = 2; i < evs.length; i++) pts.push({ x: byDate && evs[i].t ? evs[i].t : i + 1, y: f(noteScore(evs.slice(Math.max(0, i - 29), i + 1))) }); return pts; };
const latestVal = (evs, f) => { const s = noteScore(evs.slice(-30)); return s ? f(s) : null; };
const fmtV = (v, m) => v == null ? '–' : v.toFixed(0) + m.unit;
const sparkOf = pts => { const v = pts.slice(-10).map(p => p.y); if (v.length < 2) return ''; const lo = Math.min(...v), hi = Math.max(...v); return v.map(y => SPARK[hi === lo ? 3 : Math.round((y - lo) / (hi - lo) * 7)]).join(''); };
const EMPTY = '<div class="mut" style="padding:16px 0">Not enough data yet — play each note at least 3 times.</div>';

// events/notes/passes of one profile inside the chosen scale scope ('cur', 'all', or a scale label)
function scopeData(p, scope) {
  const all = profEvents(p), cur = scaleLabel(), L = scope === 'cur' ? cur : scope;
  let ev = {};
  if (scope === 'all') ev = all; else for (const m in all) { const f = all[m].filter(e => e.sl === L); if (f.length) ev[m] = f; }
  const notes = Object.keys(ev).map(Number);
  if (scope !== 'all' && L === cur) scaleNotes().forEach(n => { if (!notes.includes(n)) notes.push(n); });
  notes.sort((a, b) => a - b);
  return { ev, notes, passes: profPasses(p).filter(x => scope === 'all' || x.s === L), label: scope === 'all' ? 'All scales' : L };
}
// "net score": the average of every note's score as it stood at the end of each practice day
function netSeries(ev, notes, f) {
  const days = [...new Set(Object.values(ev).flat().filter(e => e.t).map(e => dayKey(e.t)))].sort((a, b) => a - b), pts = [];
  for (const d of days) {
    const end = d + 86400000 - 1, vals = [];
    notes.forEach(n => { const v = latestVal((ev[n] || []).filter(e => e.t && e.t <= end), f); if (v != null) vals.push(v); });
    if (vals.length) pts.push({ x: d + 43200000, y: avg(vals) });
  }
  return pts;
}
const chartW = () => Math.max(300, Math.min(900, ($('anBody').clientWidth || 340) - 30));

function lineChart(series, yMaxFixed, label, dateX) {
  const W = chartW(), H = W < 480 ? 220 : 280, L = 32, R = 12, T = 12, B = 26, all = series.flatMap(s => s.pts);
  if (!all.length) return EMPTY;
  const xMin = Math.min(...all.map(p => p.x)), xMax = Math.max(...all.map(p => p.x));
  const yMax = yMaxFixed || Math.max(10, Math.ceil(Math.max(...all.map(p => p.y)) / 10) * 10);
  const X = x => L + (xMax === xMin ? (W - L - R) / 2 : (x - xMin) / (xMax - xMin) * (W - L - R)), Y = y => T + (1 - y / yMax) * (H - T - B);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = yMax * i / 4, y = Y(v); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#262c3a"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${Math.round(v)}</text>`; }
  const nt = W < 480 ? 4 : 6, seen = new Set();
  for (let i = 0; i < nt; i++) {
    const x = xMin + (xMax - xMin) * i / Math.max(1, nt - 1), lab = dateX ? dateOf(x) : String(Math.round(x));
    if (seen.has(lab)) continue; seen.add(lab);
    g += `<text x="${X(x).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === nt - 1 ? 'end' : 'middle'}">${lab}</text>`;
  }
  for (const s of series) {
    if (!s.pts.length) continue;
    const last = s.pts[s.pts.length - 1];
    if (s.pts.length > 1) g += `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${s.pts.map(p => X(p.x).toFixed(1) + ',' + Y(p.y).toFixed(1)).join(' ')}"/>`;
    g += `<circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="3.5" fill="${s.color}"><title>${esc(s.name)}: ${last.y.toFixed(0)}</title></circle>`;
  }
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g}</svg>`;
}
function barChart(names, A, B, yMaxFixed, label) {
  const W = chartW(), H = W < 480 ? 220 : 280, L = 32, R = 12, T = 12, B_ = 26, vals = [...A, ...B].filter(v => v != null);
  if (!vals.length) return EMPTY;
  const yMax = yMaxFixed || Math.max(10, Math.ceil(Math.max(...vals) / 10) * 10), n = names.length, gw = (W - L - R) / n, bw = Math.min(22, gw / 2.4);
  const Y = y => T + (1 - y / yMax) * (H - T - B_);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = yMax * i / 4, y = Y(v); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#262c3a"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${Math.round(v)}</text>`; }
  names.forEach((nm, i) => {
    const cx = L + gw * (i + .5);
    [[A[i], PROFILES[0]], [B[i], PROFILES[1]]].forEach(([v, p], k) => { if (v != null) g += `<rect x="${(cx + (k ? 1 : -bw - 1)).toFixed(1)}" y="${Y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Y(0) - Y(v)).toFixed(1)}" rx="3" fill="${PCOLOR[p]}"><title>${p} ${nm}: ${v.toFixed(0)}</title></rect>`; });
    if (gw >= 17 || i % 2 === 0) g += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" style="font-size:${gw < 24 ? 9 : 11}px">${nm}</text>`;
  });
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g}</svg>`;
}
function statsFor(d, m) {
  let plays = 0, last = 0; const lat = [];
  for (const n of d.notes) { const e = d.ev[n] || []; plays += e.filter(x => x.k === 'h').length; if (e.length) last = Math.max(last, e[e.length - 1].t || 0); const v = latestVal(e, m.f); if (v != null) lat.push(v); }
  const net = netSeries(d.ev, d.notes, m.f), days = new Set(Object.values(d.ev).flat().filter(e => e.t).map(e => dayKey(e.t))).size;
  return { plays, last, net: lat.length ? avg(lat) : null, scored: lat.length, passes: d.passes.length, best: d.passes.length ? Math.max(...d.passes.map(x => x.pct)) : null, days, gain: net.length > 1 ? net[net.length - 1].y - net[0].y : null };
}
const tilesHtml = (st, m) => `<div class="tiles2">
  <div class="t"><b>${fmtV(st.net, m)}</b><span>Net ${m.short}</span></div>
  <div class="t"><b class="${st.gain == null ? '' : (st.gain >= 0) !== (m === METRICS.err) ? 'ok-t' : 'bad-t'}">${st.gain == null ? '–' : (st.gain >= 0 ? '+' : '−') + Math.abs(st.gain).toFixed(0)}</b><span>Change since first day</span></div>
  <div class="t"><b>${st.plays}</b><span>Notes played</span></div>
  <div class="t"><b>${st.days}</b><span>Days practised</span></div>
  <div class="t"><b>${st.best == null ? '–' : st.best.toFixed(0) + '%'}</b><span>Best full pass</span></div>
  <div class="t"><b>${st.last ? dateOf(st.last) : '–'}</b><span>Last practised</span></div></div>`;

// one row per scale ever practised, for one profile
function scaleRows(p, m) {
  const all = profEvents(p), ps = profPasses(p), labels = new Set(ps.map(x => x.s).filter(Boolean));
  for (const k in all) all[k].forEach(e => { if (e.sl) labels.add(e.sl); });
  return [...labels].map(name => {
    const d = scopeData(p, name), lat = d.notes.map(n => latestVal(d.ev[n] || [], m.f)).filter(v => v != null), pp = d.passes.map(x => x.pct);
    const last = Math.max(0, ...Object.values(d.ev).flat().map(e => e.t || 0), ...d.passes.map(x => x.t || 0));
    return { name, net: lat.length ? avg(lat) : null, passes: pp.length, best: pp.length ? Math.max(...pp) : null, latest: pp.length ? pp[pp.length - 1] : null, last: last || null };
  });
}
function insightsHtml(d, m, rows) {
  const out = [], scored = rows.filter(r => r.latest != null);
  if (!scored.length) return '';
  const byLatest = scored.slice().sort((a, b) => a.latest - b.latest), lowerBetter = m === METRICS.err;
  const weak = (lowerBetter ? byLatest.slice().reverse() : byLatest).slice(0, 3);
  out.push(`<li><b>Needs most work:</b> ${weak.map(r => midiName(r.m)).join(', ')}</li>`);
  const imp = scored.filter(r => r.plays >= 6).sort((a, b) => (lowerBetter ? a.chg - b.chg : b.chg - a.chg))[0];
  if (imp && (lowerBetter ? imp.chg < -3 : imp.chg > 3)) out.push(`<li><b>Most improved:</b> ${midiName(imp.m)} (${imp.chg > 0 ? '+' : '−'}${Math.abs(imp.chg).toFixed(0)}${m.unit})</li>`);
  const biases = d.notes.map(n => { const s = noteScore((d.ev[n] || []).slice(-30)); return s && s.hit ? s.bias : null; }).filter(b => b != null);
  if (biases.length >= 3) { const b = avg(biases); if (Math.abs(b) >= 4) out.push(`<li><b>Pattern:</b> on average ${Math.abs(b).toFixed(0)}¢ ${b > 0 ? 'sharp' : 'flat'} — ${b > 0 ? 'ease the pitch down a little' : 'bring the pitch up a little'}.</li>`); }
  const wob = d.notes.map(n => { const s = noteScore((d.ev[n] || []).slice(-30)); return s && s.hit ? s.sd : null; }).filter(v => v != null);
  if (wob.length >= 3 && avg(wob) > 12) out.push(`<li><b>Steadiness:</b> notes wobble about ±${avg(wob).toFixed(0)}¢ while held — try longer, steadier notes.</li>`);
  const recent = new Set(Object.values(d.ev).flat().filter(e => e.t && e.t > Date.now() - 7 * 86400000).map(e => dayKey(e.t))).size;
  out.push(`<li><b>Consistency:</b> practised on ${recent} of the last 7 days.</li>`);
  return `<div class="card2"><h3>Insights</h3><ul class="ins">${out.join('')}</ul></div>`;
}

function fillScopeOptions() {
  const sel = $('anScope'), keep = sel.value || 'cur', labels = new Set();
  PROFILES.forEach(p => { profPasses(p).forEach(x => x.s && labels.add(x.s)); const e = profEvents(p); for (const k in e) e[k].forEach(v => v.sl && labels.add(v.sl)); });
  sel.innerHTML = '';
  sel.add(new Option(`Current scale (${scaleLabel()})`, 'cur')); sel.add(new Option('All scales', 'all'));
  [...labels].sort().forEach(l => sel.add(new Option(l, l)));
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : 'cur';
}
function renderAnalysis() {
  if (tab !== 'analysis') return;
  fillScopeOptions();
  const m = METRICS[$('anMetric').value], scope = $('anScope').value, byDate = $('anX').value === 'date', lowerBetter = m === METRICS.err;
  if (anMode === 'cmp') return renderCompare(m, scope, lowerBetter);
  const d = scopeData(profile, scope), notes = d.notes, st = statsFor(d, m);
  const info = notes.map((n, i) => ({ n, color: noteColor(i, notes.length), pts: seriesFor(d.ev[n] || [], m.f, byDate), plays: (d.ev[n] || []).length }));
  const rows = info.filter(r => r.pts.length).map(r => ({ m: r.n, plays: r.plays, first: r.pts[0].y, latest: r.pts[r.pts.length - 1].y, chg: r.pts[r.pts.length - 1].y - r.pts[0].y, spark: sparkOf(r.pts) }));
  const net = netSeries(d.ev, notes, m.f), srows = scaleRows(profile, m);
  const fixOk = (r, v) => (v >= 0) !== lowerBetter ? 'ok-t' : 'bad-t';
  $('anBody').innerHTML = `<div class="card2"><h3 style="color:${PCOLOR[profile]}">${profile}</h3><p class="mut">${esc(d.label)}</p>${tilesHtml(st, m)}</div>
    <div class="card2"><h3>Net ${m.short} over time</h3><p class="mut">Average of all notes, at the end of each practice day</p>
      ${lineChart([{ name: 'Net', color: PCOLOR[profile], pts: net }], m.max, 'Net score over time', true)}</div>
    <div class="card2"><h3>Each note over time</h3><p class="mut">${byDate ? 'By date' : 'By play number'} · tap a note to hide or show it</p>
      ${lineChart(info.filter(r => !anHidden.has(r.n)).map(r => ({ name: midiName(r.n), color: r.color, pts: r.pts })), m.max, 'Progress of each note', byDate)}
      <div class="legend">${info.map(r => `<button data-m="${r.n}" class="${anHidden.has(r.n) ? 'off' : ''}"${r.pts.length ? '' : ' disabled'}><i style="background:${r.color}"></i>${midiName(r.n)}${r.pts.length ? '' : ` <span class="hint2">${r.plays}/3</span>`}</button>`).join('')}</div></div>
    <div class="card2"><h3>Full-scale passes</h3><p class="mut">In-tune % of every complete run${d.passes.length ? ` · ${dateOf(d.passes[0].t)} to ${dateOf(d.passes[d.passes.length - 1].t)}` : ''}</p>
      ${d.passes.length ? lineChart([{ name: 'In tune', color: PCOLOR[profile], pts: d.passes.map((x, i) => ({ x: byDate && x.t ? x.t : i + 1, y: x.pct })) }], 100, 'Pass accuracy', byDate) : '<div class="mut" style="padding:16px 0">Finish a full scale to see passes here.</div>'}</div>
    ${insightsHtml(d, m, rows)}
    <div class="card2"><h3>Scale by scale</h3><div class="scroll tbl">${srows.length ? `<table>${thead('scl', [['name', 'Scale'], ['net', 'Net'], ['passes', 'Passes'], ['best', 'Best %'], ['latest', 'Latest %'], ['last', 'Last']])}${sortRows('scl', srows).map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${fmtV(r.net, m)}</td><td>${r.passes}</td><td>${r.best == null ? '–' : r.best.toFixed(0)}</td><td>${r.latest == null ? '–' : r.latest.toFixed(0)}</td><td>${r.last ? dateOf(r.last) : '–'}</td></tr>`).join('')}</table>` : '<span class="mut">No scales practised yet.</span>'}</div></div>
    <div class="card2"><h3>Note by note</h3><div class="scroll tbl">${rows.length ? `<table>${thead('ana', [['m', 'Note'], ['plays', 'Plays'], ['first', 'First'], ['latest', 'Latest'], ['chg', 'Change'], ['spark', 'Trend', false]])}${sortRows('ana', rows).map(r => `<tr><td><b>${midiName(r.m)}</b></td><td>${r.plays}</td><td>${fmtV(r.first, m)}</td><td><b>${fmtV(r.latest, m)}</b></td><td class="${fixOk(r, r.chg)}">${r.chg >= 0 ? '+' : '−'}${Math.abs(r.chg).toFixed(0)}</td><td>${r.spark}</td></tr>`).join('')}</table>` : EMPTY}</div></div>`;
}
function renderCompare(m, scope, lowerBetter) {
  if (PROFILES.length < 2) { $('anBody').innerHTML = '<div class="card2"><h3>Compare players</h3><p class="mut">Add a second player in Settings > Players to compare.</p></div>'; return; }
  const byDate = $('anX').value === 'date', CMP = PROFILES.slice(0, 2);   // the comparison shows the first two players
  const ds = CMP.map(p => ({ p, ...scopeData(p, scope) }));
  const notes = [...new Set(ds.flatMap(d => d.notes))].sort((a, b) => a - b);
  const A = notes.map(n => latestVal(ds[0].ev[n] || [], m.f)), B = notes.map(n => latestVal(ds[1].ev[n] || [], m.f));
  const rows = notes.map((n, i) => ({ m: n, a: A[i], b: B[i], gap: A[i] != null && B[i] != null ? A[i] - B[i] : null }));
  const winner = g => (g > 0) !== lowerBetter ? PROFILES[0] : PROFILES[1];
  const ahead = g => g == null || Math.abs(g) < 0.5 ? '–' : `<span style="color:${PCOLOR[winner(g)]}">${winner(g)}</span> +${Math.abs(g).toFixed(0)}`;
  const legend = `<div class="legend">${CMP.map(p => `<span class="chip mini" style="flex:none"><i style="width:9px;height:9px;border-radius:50%;background:${PCOLOR[p]}"></i>&nbsp;${p}</span>`).join('')}</div>`;
  const sA = scaleRows(PROFILES[0], m), sB = scaleRows(PROFILES[1], m), names = [...new Set([...sA, ...sB].map(r => r.name))];
  const srows = names.map(name => { const a = sA.find(r => r.name === name), b = sB.find(r => r.name === name); return { name, a: a ? a.net : null, b: b ? b.net : null, gap: a && b && a.net != null && b.net != null ? a.net - b.net : null }; });
  $('anBody').innerHTML = `<div class="two">${ds.map(d => `<div class="card2"><h3 style="color:${PCOLOR[d.p]}">${d.p}</h3><p class="mut">${esc(d.label)}</p>${tilesHtml(statsFor(d, m), m)}</div>`).join('')}</div>
    <div class="card2"><h3>Net ${m.short} over time</h3><p class="mut">Average of all notes, end of each practice day</p>
      ${lineChart(ds.map(d => ({ name: d.p, color: PCOLOR[d.p], pts: netSeries(d.ev, d.notes, m.f) })), m.max, 'Net score, both profiles', true)}${legend}</div>
    <div class="card2"><h3>Full-scale passes</h3><p class="mut">In-tune % of each complete run · ${byDate ? 'by date' : 'by pass number'}</p>
      ${lineChart(ds.map(d => ({ name: d.p, color: PCOLOR[d.p], pts: d.passes.map((x, i) => ({ x: byDate && x.t ? x.t : i + 1, y: x.pct })) })), 100, 'Pass accuracy, both profiles', byDate)}${legend}</div>
    <div class="card2"><h3>${m.label} by note</h3><p class="mut">Latest value for each note</p>
      ${barChart(notes.map(midiName), A, B, m.max, 'Per-note comparison')}${legend}</div>
    <div class="card2"><h3>Scale by scale</h3><div class="scroll tbl">${srows.length ? `<table>${thead('cmpS', [['name', 'Scale'], ['a', PROFILES[0]], ['b', PROFILES[1]], ['gap', 'Ahead']])}${sortRows('cmpS', srows).map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${fmtV(r.a, m)}</td><td>${fmtV(r.b, m)}</td><td>${ahead(r.gap)}</td></tr>`).join('')}</table>` : '<span class="mut">No scales practised yet.</span>'}</div></div>
    <div class="card2"><h3>Note by note</h3><div class="scroll tbl">${rows.length ? `<table>${thead('cmp', [['m', 'Note'], ['a', PROFILES[0]], ['b', PROFILES[1]], ['gap', 'Ahead']])}${sortRows('cmp', rows).map(r => `<tr><td><b>${midiName(r.m)}</b></td><td>${fmtV(r.a, m)}</td><td>${fmtV(r.b, m)}</td><td>${ahead(r.gap)}</td></tr>`).join('')}</table>` : EMPTY}</div></div>`;
}
$('anBody').onclick = e => { const b = e.target.closest('.legend button'); if (!b) return; const n = +b.dataset.m; anHidden.has(n) ? anHidden.delete(n) : anHidden.add(n); renderAnalysis(); };
document.querySelectorAll('#anMode button').forEach(b => b.onclick = () => { anMode = b.dataset.m; document.querySelectorAll('#anMode button').forEach(x => x.classList.toggle('on', x === b)); renderAnalysis(); });
$('anMetric').onchange = $('anScope').onchange = $('anX').onchange = renderAnalysis;
let rzT = null; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(renderAnalysis, 150); });
function switchPlayer(name) {
  finalizeHold(); stopScale(); profile = name;
  try { localStorage.setItem('tuner-profile', profile); } catch {}
  cardAll = profile ? lsGet(ckey(profile), {}) : {}; passAll = profile ? lsGet(pkey(profile), []) : []; cardSess = {};
  resetPractice(); renderScale(); renderCard(); renderAnalysis();
}
$('profile').onchange = () => switchPlayer($('profile').value);

