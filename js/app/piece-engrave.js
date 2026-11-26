// The engraved staff for Piece practice (prototype): the score drawn by Verovio (https://www.verovio.org, LGPL-3.0, vendor/verovio/), with the same colours and cursor as the simple staff.
// Verovio draws the chosen part exactly as written (beams, ties, slurs, rests, dynamics, grand staff ...). This file only loads it, hands it the part and the bars, finds which drawn note
// is which of our timeline notes (by time and pitch), then paints and moves a cursor over them. The simple staff in piece-visual.js stays as the fallback.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

const PG = { tk: null, loading: null, key: '', els: [], cls: [], mapped: 0 };
const PG_FILES = ['vendor/verovio/verovio-module.mjs', 'vendor/verovio/verovio.mjs'];
const pgMsg = (t, bad) => { const m = $('pzEngMsg'); m.textContent = t; m.className = 'hint2' + (bad ? ' bad-t' : ''); };
// The engine is 2.4 MB (compressed): fetched the first time it is wanted, then kept by the service worker like the other vendor files.
async function pgLoad() {
  if (PG.tk) return PG.tk;
  if (!PG.loading) PG.loading = (async () => {
    const url = f => new URL(f, document.baseURI).href;
    const [mod, api] = await Promise.all(PG_FILES.map(f => import(url(f))));
    PG.tk = new api.VerovioToolkit(await mod.default()); return PG.tk;
  })().catch(e => { PG.loading = null; throw e; });
  return PG.loading;
}
const pgOpts = W => ({ scale: 40, pageWidth: Math.round(W * 100 / 40), pageHeight: 60000, adjustPageHeight: true, breaks: 'auto', header: 'none', footer: 'none', svgViewBox: true, pageMarginLeft: 30, pageMarginRight: 30, pageMarginTop: 30, pageMarginBottom: 30 });
// Draws the plan's part and bars. Called by pwRender (piece-visual.js) while the engraved staff is on; does nothing when nothing changed.
async function pgRender(W) {
  const p = PE.plan; if (!p || !PP.xml) return;
  const key = [p.key, W, PP.id, PP.idx].join('|'); if (PG.key === key) return; PG.key = key; PG.els = []; PG.cls = []; PG.mapped = 0;
  const first = !PG.tk; pgMsg(first ? 'Loading the engraving engine (about 2.4 MB, only the first time)…' : 'Drawing…');
  try {
    const tk = await pgLoad(); if (PG.key !== key) return;
    const part = PP.parsed.parts[PP.idx], last = ppLastBar(part);
    tk.setOptions(pgOpts(W)); tk.loadData(ppPartXml(PP.xml, part.id));
    if (p.from > 1 || p.to < last) { tk.select({ measureRange: `${p.from}-${p.to}` }); tk.redoLayout(); }
    const n = Math.min(tk.getPageCount(), 12); let svg = ''; for (let i = 1; i <= n; i++) svg += tk.renderToSVG(i);
    $('pzEng').innerHTML = svg;
    pgMap(tk, p); pgMsg(PG.mapped < p.tl.length ? `${PG.mapped} of ${p.tl.length} notes could be matched to the drawing; the rest are not coloured.` : '');
    pgPaint(-1, () => 'pend', true);
  } catch (e) { PG.key = ''; pgMsg('The engraved staff could not be drawn: ' + (e && e.message || e), true); $('pzEng').innerHTML = ''; }
}
// Which drawn note is each timeline note: Verovio's timemap gives the notes that start at each moment (in quarter notes); ours carry their beat. The two clocks may start at different
// places (a pickup bar), so the offset is taken from the first note that matches, then every note is found by moment and pitch.
function pgMap(tk, p) {
  const tm = tk.renderToTimemap({ includeRests: false, includeMeasures: false }), ev = [];
  for (const e of Array.isArray(tm) ? tm : JSON.parse(tm)) for (const id of e.on || []) { if (!$('pzEng').querySelector('#' + CSS.escape(id))) continue; const v = tk.getMIDIValuesForElement(id); ev.push({ id, q: e.qstamp, pitch: v && v.pitch }); }   // (a repeated bar's second pass has copies of the notes that are not drawn: skipped)
  const byQ = new Map(); for (const e of ev) { const k = Math.round(e.q * 1000); (byQ.get(k) || byQ.set(k, []).get(k)).push(e); }
  const tl = p.tl, want = i => tl[i].midi - p.shift; let off = null;
  for (const e of ev) if (e.pitch === want(0)) { off = e.q - tl[0].beat; break; }
  if (off == null) return;
  const used = new Set(), take = (i, c) => { used.add(c.id); const el = $('pzEng').querySelector('#' + CSS.escape(c.id)); if (el) { PG.els[i] = el; PG.mapped++; } };
  tl.forEach((n, i) => { const c = (byQ.get(Math.round((n.beat + off) * 1000)) || []).find(e => e.pitch === want(i) && !used.has(e.id)); if (c) take(i, c); });
  // A repeat: Verovio's timeline plays the repeated bars twice, ours reads each bar once, so after a repeat the times no longer agree. Notes still unmatched are found by order instead:
  // the first unused drawn note with the right pitch after the note matched just before them (each drawn note counted once, at its first moment).
  if (PG.mapped < tl.length) {
    const seen = new Set(), U = ev.filter(e => !seen.has(e.id) && seen.add(e.id)), at = new Map(U.map((e, j) => [e.id, j]));
    let last = -1;
    tl.forEach((n, i) => {
      const done = PG.els[i] && PG.els[i].id; if (done != null && at.has(done)) { last = at.get(done); return; }
      if (PG.els[i]) return;
      for (let j = last + 1; j < U.length; j++) if (U[j].pitch === want(i) && !used.has(U[j].id)) { take(i, U[j]); last = j; break; }
    });
  }
}
// colour = how the note was played; glow = where the clock is (the same classes as the simple staff, with the pg- prefix)
function pgPaint(idx, gradeOf, force) {
  PG.els.forEach((el, i) => {
    if (!el) return; const c = `${gradeOf(i)}${i === idx ? ' cur' : ''}`;
    if (!force && PG.cls[i] === c) return; PG.cls[i] = c;
    el.classList.remove('pg-ok', 'pg-close', 'pg-bad', 'pg-pend', 'pg-cur'); for (const k of c.split(' ')) el.classList.add('pg-' + k);
  });
}
// The cursor: a line over the system the current note is in, sliding between this note and the next when they are on the same system.
function pgCursor(f) {
  const cur = $('pzEngCur'), box = $('pzEngBox');
  if (f == null || !PG.els.length) { cur.style.display = 'none'; return; }
  const fc = Math.max(0, f), i = Math.min(PG.els.length - 1, Math.floor(fc)), a = PG.els[i]; if (!a) { cur.style.display = 'none'; return; }
  const bx = box.getBoundingClientRect(), ra = a.getBoundingClientRect(), sys = (a.closest('.system') || a).getBoundingClientRect();
  let x = ra.left + ra.width / 2;
  const b = PG.els[i + 1]; if (b) { const rb = b.getBoundingClientRect(); if (Math.abs(rb.top - ra.top) < sys.height) x += (rb.left + rb.width / 2 - x) * (fc - i); }
  cur.style.display = ''; cur.style.left = (x - bx.left + box.scrollLeft).toFixed(1) + 'px'; cur.style.top = (sys.top - bx.top + box.scrollTop).toFixed(1) + 'px'; cur.style.height = sys.height.toFixed(1) + 'px';
  const top = sys.top - bx.top;   // keep the system in view
  if (top < 0 || top + sys.height > box.clientHeight) box.scrollTo({ top: box.scrollTop + top - 20, behavior: 'smooth' });
}
