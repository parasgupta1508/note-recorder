// Scale practice visuals: the notation (staff, key signature, slurs, finger numbers), the instrument view (violin / guitar / ukulele neck or piano keys),
// and the moving cursor that follows the click. The numbers come from js/core/visual.js; this file only draws.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.
//
// Why custom SVG and not a notation library: a scale needs noteheads, a key signature, ledger lines, accidentals and slurs, nothing else. A library would add a
// large file the offline cache has to hold, and it re-lays-out the whole score on every change. Here the staff is built once per scale; while you play only the
// colour of a notehead, the cursor and one dot on the neck change, so 60 frames a second cost almost nothing.

const SV = { key: '', nodes: [], where: [], rows: [], geo: [], hints: [], neckKey: '', neckDot: null, raf: 0, curRow: -1, W: 0 };
const SV_LG = 8, SV_ST = SV_LG / 2, SV_SP = 27;   // staff line gap, pixels per step (half a gap), space per note
const svSharp = n => n.replace('#', '♯').replace(/^([A-G])b/, '$1♭');
const svFont = '"Noto Music","Segoe UI Symbol","Apple Symbols",serif';

// What the finger or fret is for one note: violin finger numbers, guitar and ukulele fret numbers.
function svFingerLabel(inst, hint, midi, strings) {
  const pl = visPlace(hint, strings, midi); if (!pl) return '';
  return ruleFor(inst).fingering === 'bowed' ? pl.finger : pl.offset === 0 ? '0' : String(pl.offset);
}

function svBuildStaff(W) {
  const p = sc.plan, tl = p.tl, inst = p.inst, strings = stringsOf(inst), flats = prefersFlats(p.pc, p.type, useFlats ? true : null);
  const sig = visKeySig(p.pc, p.type, flats), left = 50 + 11 * sig.n, per = Math.max(6, Math.floor((W - left - 8) / SV_SP));
  const rows = visLayout(tl, { perRow: per, beatsPerBar: sigBeats(), octaveShift: inst === 'guitar' ? 1 : 0, sig, left, spacing: SV_SP });
  const hints = tl.map(n => ruleFor(inst).fingering ? fingerHint(inst, n.midi, strings, p.pos) : null);
  const slurs = visSlurs(tl), glyph = typeof clefGlyphs === 'function' && clefGlyphs();
  let y = 6, out = '';
  SV.geo = []; SV.where = new Array(tl.length); SV.rows = rows;
  rows.forEach((row, r) => {
    const ext = visRowExtent(row), top = y + 28 + SV_ST * (ext.hi - VIS_TOP), yS = s => top + (VIS_TOP - s) * SV_ST, bottom = yS(VIS_BOTTOM), end = yS(Math.min(ext.lo, VIS_BOTTOM)) + 30;
    SV.geo.push({ top, bottom, y0: y, y1: end });
    for (let k = 0; k < 5; k++) out += `<line class="sl" x1="4" x2="${W - 4}" y1="${top + k * SV_LG}" y2="${top + k * SV_LG}"/>`;
    out += `<line class="sl" x1="4" x2="4" y1="${top}" y2="${bottom}"/>`;
    out += glyph ? `<text class="clef" x="8" y="${yS(32) + 7}" font-family='${svFont}' font-size="${SV_LG * 5.2}">\u{1D11E}</text>` : `<text class="clef" x="10" y="${yS(32) + 9}" font-family="serif" font-size="30" font-style="italic" font-weight="700">G</text>`;
    sig.marks.forEach((m, k) => { out += `<text class="ks" x="${36 + k * 10}" y="${yS(m.step) + 6}" font-size="20" font-family='${svFont}'>${sig.kind === 'flat' ? '♭' : '♯'}</text>`; });
    if (row.label) out += `<text class="oct" x="${left}" y="${top - 6 - SV_ST * Math.max(0, ext.hi - VIS_TOP) + 4}" font-size="11" font-style="italic">${row.label}</text>`;
    row.bars.forEach(x => { out += `<line class="bar" x1="${x}" x2="${x}" y1="${top}" y2="${bottom}"/>`; });
    for (const g of slurs) {   // the part of a slur that falls in this row
      const a = Math.max(g.from, row.from), b = Math.min(g.to, row.to); if (b <= a) continue;
      const na = row.notes.find(n => n.i === a), nb = row.notes.find(n => n.i === b); if (!na || !nb) continue;
      const hi = Math.max(...row.notes.filter(n => n.i >= a && n.i <= b).map(n => n.step + (n.step < 34 ? 7 : 1))), yy = yS(Math.max(hi, VIS_TOP + 2) + 1);
      out += `<path class="slur" d="M${na.x} ${yy} Q${(na.x + nb.x) / 2} ${yy - 11} ${nb.x} ${yy}"/>`;
    }
    for (const n of row.notes) {
      const cy = yS(n.step), up = n.step < 34, sx = up ? n.x + 5 : n.x - 5, sy = up ? cy - 26 : cy + 26;
      SV.where[n.i] = { r, x: n.x, y: cy };
      out += `<g class="nh${n.d === 'down' ? ' dn' : ''}" data-i="${n.i}"><circle class="halo" cx="${n.x}" cy="${cy}" r="10"/>`;
      for (const l of n.ledgers) out += `<line class="led" x1="${n.x - 9}" x2="${n.x + 9}" y1="${yS(l)}" y2="${yS(l)}"/>`;
      if (n.acc) out += `<text class="acc" x="${n.x - 14}" y="${cy + 5}" font-size="17" font-family='${svFont}'>${{ '#': '♯', b: '♭', n: '♮' }[n.acc]}</text>`;
      out += `<line class="stem" x1="${sx}" y1="${cy}" x2="${sx}" y2="${sy}"/><ellipse class="head" cx="${n.x}" cy="${cy}" rx="5.6" ry="4.1" transform="rotate(-20 ${n.x} ${cy})"/></g>`;
      const f = hints[n.i] ? svFingerLabel(inst, hints[n.i], tl[n.i].midi, strings) : '';
      if (f !== '') out += `<text class="fing" x="${n.x}" y="${end - 6}" text-anchor="middle" font-size="12">${f}</text>`;
    }
    y = end + 6;
  });
  out += `<line id="svCur" class="cur" x1="0" x2="0" y1="0" y2="0" style="display:none"/>`;
  SV.hints = hints;
  $('scStaff').innerHTML = `<svg viewBox="0 0 ${W} ${y}" role="img" aria-label="Scale notation: ${tl.length} notes">${out}</svg>`;
  SV.nodes = [...$('scStaff').querySelectorAll('g.nh')].reduce((a, g) => (a[+g.dataset.i] = g, a), []);
  SV.curEl = $('svCur'); SV.curRow = -1;
}

// ---- the instrument view
function svBuildNeck(W) {
  const p = sc.plan, inst = p.inst, tl = p.tl, strings = stringsOf(inst), box = $('scNeck');
  if (inst === 'chromatic') {   // piano keys
    const lo = Math.min(...tl.map(n => n.midi)), hi = Math.max(...tl.map(n => n.midi)), kb = visKeys(lo - 1, hi + 1), kw = Math.min(26, (W - 8) / kb.units), H = 62, inScale = new Set(tl.map(n => n.midi));
    let out = '';
    for (const k of kb.keys.filter(k => !k.black)) out += `<rect class="pk${inScale.has(k.midi) ? ' sc' : ''}" data-m="${k.midi}" x="${4 + k.x * kw}" y="2" width="${kw - 1}" height="${H}" rx="2"/>`;
    for (const k of kb.keys.filter(k => k.black)) out += `<rect class="pk blk${inScale.has(k.midi) ? ' sc' : ''}" data-m="${k.midi}" x="${4 + k.x * kw}" y="2" width="${k.w * kw}" height="${H * 0.62}" rx="2"/>`;
    box.innerHTML = `<svg viewBox="0 0 ${Math.max(W, 8 + kb.units * kw)} ${H + 6}" role="img" aria-label="Keyboard">${out}</svg>`; SV.neckDot = null; return;
  }
  const bowed = ruleFor(inst).fingering === 'bowed', places = tl.map((n, i) => visPlace(SV.hints[i], strings, n.midi));
  const rowsN = strings.length, maxOff = Math.max(5, ...places.filter(Boolean).map(q => q.offset)), total = bowed ? Math.max(8, maxOff + 2) : Math.min(15, Math.max(5, maxOff + 1));
  const x0 = 34, bw = W - x0 - 10, rh = 20, H = 12 + rowsN * rh, xAt = n => x0 + visFretX(n, total) * bw, yRow = r => 10 + r * rh + rh / 2 - 2;
  const xDot = q => q.offset === 0 ? x0 - 11 : bowed ? xAt(q.offset) : (xAt(q.offset - 1) + xAt(q.offset)) / 2;
  let out = `<rect class="board" x="${x0}" y="6" width="${bw}" height="${rowsN * rh}" rx="3"/>`;
  if (!bowed) for (let f = 0; f <= total; f++) out += `<line class="fret${f === 0 ? ' nut' : ''}" x1="${xAt(f)}" x2="${xAt(f)}" y1="6" y2="${6 + rowsN * rh}"/>` + (f > 0 && [3, 5, 7, 9, 12, 15].includes(f) ? `<text class="fn" x="${(xAt(f - 1) + xAt(f)) / 2}" y="${H + 8}" text-anchor="middle" font-size="9">${f}</text>` : '');
  else out += `<line class="fret nut" x1="${x0}" x2="${x0}" y1="6" y2="${6 + rowsN * rh}"/>`;
  for (let r = 0; r < rowsN; r++) { out += `<line class="str" x1="${x0 - 14}" x2="${x0 + bw}" y1="${yRow(r)}" y2="${yRow(r)}" stroke-width="${1 + r * 0.25}"/>`; const nm = strings[strings.length - 1 - r]; out += `<text class="sn" x="3" y="${yRow(r) + 4}" font-size="10">${svSharp(midiName(nm).replace(/-?\d+$/, ''))}</text>`; }
  const seen = new Set();
  places.forEach(q => { if (!q) return; const k = q.row + ':' + q.offset; if (seen.has(k)) return; seen.add(k); out += `<circle class="dot" cx="${xDot(q)}" cy="${yRow(q.row)}" r="${bowed ? 3.6 : 4.2}"/>`; });
  out += `<g id="svDot" style="display:none"><circle class="on" r="9"/><text class="dn2" text-anchor="middle" y="4" font-size="11"></text></g>`;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="${bowed ? 'Fingerboard' : 'Fretboard'}">${out}</svg>`;
  SV.neckDot = $('svDot'); SV.dotAt = places.map(q => q ? { x: xDot(q), y: yRow(q.row), t: bowed ? q.finger : q.offset === 0 ? '0' : String(q.offset) } : null);
}

// ---- state: colours, the target, the cursor
function svPaint() {
  const demo = demoIdx >= 0, idx = demo ? demoIdx : sc.running ? sc.pos : -1;
  SV.nodes.forEach((g, i) => { g.setAttribute('class', `nh ${noteCls(i, demo)}${sc.tl[i].direction === 'down' ? ' dn' : ''}`); });
  if (SV.neckDot) {
    const d = idx >= 0 && idx < sc.tl.length ? SV.dotAt[idx] : null;
    SV.neckDot.style.display = d ? '' : 'none';
    if (d) { SV.neckDot.setAttribute('transform', `translate(${d.x} ${d.y})`); SV.neckDot.querySelector('text').textContent = d.t; }
  } else if (idx >= 0) {
    $('scNeck').querySelectorAll('.pk.on').forEach(k => k.classList.remove('on'));
    const k = idx < sc.tl.length ? $('scNeck').querySelector(`.pk[data-m="${sc.tl[idx].midi}"]`) : null; if (k) k.classList.add('on');
  } else $('scNeck').querySelectorAll('.pk.on').forEach(k => k.classList.remove('on'));
}
// Where the cursor should be: a smooth position between notes while the click runs, the target note otherwise. Returns null when it should be hidden.
function svCursorAt() {
  if (demoIdx >= 0) return demoIdx;
  if (!sc.running || sc.pos >= sc.tl.length) return null;
  if (sc.mode === 'tempo' && sc.clock != null && typeof ctx !== 'undefined' && ctx) {
    const f = ((ctx.currentTime - t0 - sc.clock) * 1000) / (60000 / sc.bpm);
    return Math.max(0, Math.min(sc.tl.length - 1, f));
  }
  return sc.pos;
}
function svFrame() {
  SV.raf = 0;
  const f = svCursorAt(), el = SV.curEl; if (!el || !SV.where.length) return;
  if (f == null) { el.style.display = 'none'; return; }
  const i = Math.floor(f), a = SV.where[i], b = SV.where[Math.min(SV.where.length - 1, i + 1)];
  if (!a) return;
  const x = b && b.r === a.r ? a.x + (b.x - a.x) * (f - i) : a.x, g = SV.geo[a.r];
  if (SV.curRow !== a.r) { el.setAttribute('y1', g.top - 14); el.setAttribute('y2', g.bottom + 14); SV.curRow = a.r; }
  el.style.display = ''; el.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
  SV.raf = requestAnimationFrame(svFrame);   // keeps running while a run or a demo is on; svRender restarts it
}

function svRender() {
  const box = $('scStaff'); if (!box || !sc.plan) return;
  const W = Math.max(260, Math.floor(box.clientWidth || (box.parentElement && box.parentElement.clientWidth) || 340)), p = sc.plan;
  const key = [p.tl.map(n => n.midi).join(), p.inst, p.pc, p.type, p.pos, p.bow, sigBeats(), W, useFlats].join('|');
  if (key !== SV.key) { SV.key = key; svBuildStaff(W); svBuildNeck(Math.max(260, Math.floor($('scNeck').clientWidth || W))); }
  svPaint();
  if (!SV.raf && (sc.running || demoIdx >= 0)) SV.raf = requestAnimationFrame(svFrame); else if (!sc.running && demoIdx < 0 && SV.curEl) SV.curEl.style.display = 'none';
}
if (typeof ResizeObserver !== 'undefined') { let rz = 0; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { if (Math.abs(($('scStaff').clientWidth || 0) - SV.W) > 8) { SV.W = $('scStaff').clientWidth; SV.key = ''; svRender(); } }, 120); }).observe($('scStaff')); }
