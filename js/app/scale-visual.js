// Scale practice displays. Four views of the same timeline, chosen with the buttons above the display:
//   Staff        notation with key signature, slurs, finger numbers and a cursor that follows the click (the instrument below it)
//   Tab          one line per string, the fret or finger number on it, scrolling to a playhead
//   Fingerboard  the neck (violin, guitar, ukulele) or the keys (piano) with the finger to place next
//   Piano roll   one bar per note on a pitch grid, scrolling to a playhead
// The numbers come from js/core/visual.js; this file only draws. Part of the app: scripts in js/app share one scope, in the order index.html lists them.
//
// Why custom SVG and not a notation library: a scale needs noteheads, a key signature, ledger lines, accidentals and slurs, nothing else. A library would add a large file the
// offline cache has to hold, and it re-lays-out the whole score on every change. Here each view is built once per scale. While you play, a note's colour changes, and one
// element moves (the cursor on the staff, the group of notes in Tab and Roll), so 60 frames a second cost almost nothing.

const SV = { key: '', nodes: [], where: [], rows: [], geo: [], hints: [], places: [], neckDot: null, raf: 0, curRow: -1, W: 0, view: 'staff', hw: null, hwNodes: [], hwCur: 0, hwKey: '', neckKey: '' };
const SV_LG = 10, SV_ST = SV_LG / 2, SV_SP = 54, SV_PPB = 72;   // staff line gap, pixels per step, space per note, pixels per beat in Tab and Roll
const SV_NECK_KEY = 'tuner-scneck';
const SV_VIEWS = ['staff', 'tab', 'board', 'roll'], SV_VIEW_KEY = 'tuner-scview';
const svSharp = n => n.replace('#', '♯').replace(/^([A-G])b/, '$1♭');
const svFont = '"Noto Music","Segoe UI Symbol","Apple Symbols",serif';
try { SV.showNeck = localStorage.getItem(SV_NECK_KEY) === '1'; } catch {}
try { const v = localStorage.getItem(SV_VIEW_KEY); if (SV_VIEWS.includes(v)) SV.view = v; } catch {}

const svIsFretted = inst => ruleFor(inst).fingering === 'fretted', svIsBowed = inst => ruleFor(inst).fingering === 'bowed';
// Tab and Fingerboard need strings; the piano has keys instead (its Fingerboard view is the keyboard, its Tab view is not offered).
const svTabOk = inst => !!ruleFor(inst).fingering;
// The view that is actually shown: the chosen one, unless this instrument cannot show it.
const svEffective = inst => SV.view === 'tab' && !svTabOk(inst) ? 'staff' : SV.view;

// What the finger or fret is for one note: violin finger numbers, guitar and ukulele fret numbers.
function svFingerLabel(inst, hint, midi, strings) {
  const pl = visPlace(hint, strings, midi); if (!pl) return '';
  return svIsBowed(inst) ? pl.finger : pl.offset === 0 ? '0' : String(pl.offset);
}
// Everything per note that more than one view needs: the fingering hint and where it falls on the neck. Cached by scale.
function svPlan() {
  const p = sc.plan, strings = stringsOf(p.inst), fing = ruleFor(p.inst).fingering;
  SV.hints = p.tl.map(n => fing ? fingerHint(p.inst, n.midi, strings, p.pos) : null);
  SV.places = p.tl.map((n, i) => visPlace(SV.hints[i], strings, n.midi));
  return strings;
}
const svNoteName = i => svSharp(sc.tl[i].noteName);

// ================= Staff =================
function svBuildStaff(W) {
  const p = sc.plan, tl = p.tl, inst = p.inst, strings = stringsOf(inst), flats = prefersFlats(p.pc, p.type, useFlats ? true : null);
  const sig = visKeySig(p.pc, p.type, flats), left = 62 + 14 * sig.n, n = tl.length;
  // one row, never squeezed: at least 54px per note (wider when the screen has room, so nothing is left empty); a longer scale scrolls sideways and the cursor keeps itself centred
  const sp = Math.min(84, Math.max(SV_SP, (W - left - 14) / n)), full = left + n * sp + 14, SW = Math.max(W, Math.ceil(full)); SV.sw = SW;
  const rows = visLayout(tl, { perRow: n, beatsPerBar: sigBeats(), octaveShift: inst === 'guitar' ? 1 : 0, sig, left, spacing: sp, noShift: true });
  const hints = SV.hints, slurs = visSlurs(tl), glyph = typeof clefGlyphs === 'function' && clefGlyphs();
  let y = 6, out = '';
  SV.geo = []; SV.where = new Array(tl.length); SV.rows = rows;
  rows.forEach((row, r) => {
    const ext = visRowExtent(row), top = y + 46 + SV_ST * (ext.hi - VIS_TOP), yS = s => top + (VIS_TOP - s) * SV_ST, bottom = yS(VIS_BOTTOM), base = yS(Math.min(ext.lo, VIS_BOTTOM)), bowed = svIsBowed(inst), end = base + (bowed ? 66 : 40);
    SV.geo.push({ top, bottom, y0: y, y1: end });
    for (let k = 0; k < 5; k++) out += `<line class="sl" x1="4" x2="${SW - 4}" y1="${top + k * SV_LG}" y2="${top + k * SV_LG}"/>`;
    out += `<line class="sl" x1="4" x2="4" y1="${top}" y2="${bottom}"/>`;
    out += glyph ? `<text class="clef" x="8" y="${yS(32) + 9}" font-family='${svFont}' font-size="${SV_LG * 5.4}">\u{1D11E}</text>` : `<text class="clef" x="10" y="${yS(32) + 11}" font-family="serif" font-size="38" font-style="italic" font-weight="700">G</text>`;
    sig.marks.forEach((m, k) => { out += `<text class="ks" x="${46 + k * 13}" y="${yS(m.step) + 8}" font-size="26" font-family='${svFont}'>${sig.kind === 'flat' ? '♭' : '♯'}</text>`; });
    if (r === 0) { const bt = sigBeats(), ts = [bt, bt === 2 ? 2 : 4], tx = 50 + 13 * sig.n + 8; out += `<text class="ts" x="${tx}" y="${yS(36) + 6}" text-anchor="middle" font-size="${SV_LG * 2.2}" font-weight="700">${ts[0] || 4}</text><text class="ts" x="${tx}" y="${yS(36) + 6 + SV_LG * 2}" text-anchor="middle" font-size="${SV_LG * 2.2}" font-weight="700">${ts[1] || 4}</text>`; }
    if (row.label) out += `<text class="oct" x="${left}" y="${y + 20}" font-size="12" font-style="italic">${row.label}</text>`;
    row.bars.forEach(x => { out += `<line class="bar" x1="${x}" x2="${x}" y1="${top}" y2="${bottom}"/>`; });
    for (const g of slurs) {   // the part of a slur that falls in this row
      const a = Math.max(g.from, row.from), b = Math.min(g.to, row.to); if (b <= a) continue;
      const na = row.notes.find(n => n.i === a), nb = row.notes.find(n => n.i === b); if (!na || !nb) continue;
      const hi = Math.max(...row.notes.filter(n => n.i >= a && n.i <= b).map(n => n.step + (n.step < 34 ? 7 : 1))), yy = yS(Math.max(hi, VIS_TOP + 2) + 1);
      out += `<path class="slur" d="M${na.x} ${yy} Q${(na.x + nb.x) / 2} ${yy - 16} ${nb.x} ${yy}"/>`;
    }
    for (const n of row.notes) {
      const cy = yS(n.step), up = n.step < 34, sx = up ? n.x + 6.4 : n.x - 6.4, sy = up ? cy - 33 : cy + 33;
      SV.where[n.i] = { r, x: n.x, y: cy };
      out += `<g class="nh${n.d === 'down' ? ' dn' : ''}" data-i="${n.i}"><circle class="halo" cx="${n.x}" cy="${cy}" r="14"/>`;
      for (const l of n.ledgers) out += `<line class="led" x1="${n.x - 12}" x2="${n.x + 12}" y1="${yS(l)}" y2="${yS(l)}"/>`;
      if (n.acc) out += `<text class="acc" x="${n.x - 19}" y="${cy + 7}" font-size="22" font-family='${svFont}'>${{ '#': '♯', b: '♭', n: '♮' }[n.acc]}</text>`;
      out += `<line class="stem" x1="${sx}" y1="${cy}" x2="${sx}" y2="${sy}"/><ellipse class="head" cx="${n.x}" cy="${cy}" rx="7.4" ry="5.4" transform="rotate(-20 ${n.x} ${cy})"/></g>`;
      const f = hints[n.i] ? svFingerLabel(inst, hints[n.i], tl[n.i].midi, strings) : '';
      out += `<text class="nm" x="${n.x}" y="${base + 28}" text-anchor="middle" font-size="12">${svNoteName(n.i)}</text>`;
      if (f !== '') out += `<text class="fing" x="${n.x}" y="${y + 20}" text-anchor="middle" font-size="16">${f}</text>`;
    }
    if (bowed) {
      let a = 0; const ns = row.notes;
      while (a < ns.length) {
        let b = a; const q = SV.places[ns[a].i]; while (b + 1 < ns.length && SV.places[ns[b + 1].i] && q && SV.places[ns[b + 1].i].row === q.row) b++;
        if (q && b > a) { const x1 = ns[a].x - 12, x2 = ns[b].x + 12, nm = midiName(strings[strings.length - 1 - q.row]).replace(/-?\d+$/, '');
          out += `<path class="sbr" d="M${x1} ${base + 40} v5 H${x2} v-5"/><text class="sbt" x="${(x1 + x2) / 2}" y="${base + 61}" text-anchor="middle" font-size="12.5">${svSharp(nm)} string</text>`; }
        a = b + 1;
      }
    }
    y = end + 6;
  });
  out = `<rect id="svBand" class="bandhl" x="-18" width="36" y="0" height="0" rx="4" style="display:none"/>` + out + `<line id="svCur" class="cur" x1="0" x2="0" y1="0" y2="0" style="display:none"/>`;
  $('scStaff').innerHTML = `<svg viewBox="0 0 ${SW} ${y}" style="${SW > W ? 'width:' + SW + 'px;max-width:none' : ''}" role="img" aria-label="Scale notation: ${tl.length} notes">${out}</svg>`;
  SV.nodes = [...$('scStaff').querySelectorAll('g.nh')].reduce((a, g) => (a[+g.dataset.i] = g, a), []);
  SV.curEl = $('svCur'); SV.bandEl = $('svBand'); SV.curRow = -1;
}

// ================= Neck and keys =================
// big: the Fingerboard view (taller, all notes optional, a readout of the finger to place); small: the instrument shown under the staff.
function svBuildNeck(W, big) {
  const p = sc.plan, inst = p.inst, tl = p.tl, strings = stringsOf(inst), box = $('scNeck'), showAll = big && $('scShow').value === 'all', inScale = new Set(tl.map(n => n.midi % 12));
  if (inst === 'chromatic') {   // piano keys
    const lo = Math.min(...tl.map(n => n.midi)), hi = Math.max(...tl.map(n => n.midi)), kb = visKeys(lo - 1, hi + 1), kw = Math.min(big ? 34 : 26, (W - 8) / kb.units), H = big ? 120 : 62, inMidi = new Set(tl.map(n => n.midi));
    let out = '';
    for (const k of kb.keys.filter(k => !k.black)) out += `<rect class="pk${inMidi.has(k.midi) ? ' sc' : ''}" data-m="${k.midi}" x="${4 + k.x * kw}" y="2" width="${kw - 1}" height="${H}" rx="2"/>` + (big ? `<text class="kn" x="${4 + k.x * kw + kw / 2}" y="${H - 4}" text-anchor="middle" font-size="9">${k.midi % 12 === 0 ? 'C' + (Math.floor(k.midi / 12) - 1) : ''}</text>` : '');
    for (const k of kb.keys.filter(k => k.black)) out += `<rect class="pk blk${inMidi.has(k.midi) ? ' sc' : ''}" data-m="${k.midi}" x="${4 + k.x * kw}" y="2" width="${k.w * kw}" height="${H * 0.62}" rx="2"/>`;
    box.innerHTML = `<svg viewBox="0 0 ${Math.max(W, 8 + kb.units * kw)} ${H + 6}" role="img" aria-label="Keyboard">${out}</svg>` + (big ? '<div id="svRead" class="sv-read mut" aria-live="polite"></div>' : ''); SV.neckDot = null; return;
  }
  const bowed = svIsBowed(inst), places = SV.places, rowsN = strings.length, vp = VIOLIN_POSITIONS[p.pos] ? VIOLIN_POSITIONS[p.pos][1] : VIOLIN_POSITIONS[1][1];
  const maxOff = Math.max(5, ...places.filter(Boolean).map(q => q.offset)), total = bowed ? Math.max(big ? 9 : 8, maxOff + 2) : Math.min(15, Math.max(big ? 8 : 5, maxOff + 1));
  const x0 = 52, bw = W - x0 - 10, rh = big ? 40 : 28, H = 14 + rowsN * rh, xAt = n => x0 + visFretX(n, total) * bw, yRow = r => 12 + r * rh + rh / 2 - 2;
  const xDot = off => off === 0 ? x0 - 18 : bowed ? xAt(off) : (xAt(off - 1) + xAt(off)) / 2, openOf = r => strings[strings.length - 1 - r];
  let out = `<defs><linearGradient id="svWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a3422"/><stop offset=".5" stop-color="#2c1f14"/><stop offset="1" stop-color="#1a120b"/></linearGradient><linearGradient id="svStr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f3f8"/><stop offset="1" stop-color="#9aa3b8"/></linearGradient></defs><rect class="board" x="${x0}" y="8" width="${bw}" height="${rowsN * rh}" rx="4"/>`;
  if (!bowed) for (let f = 0; f <= total; f++) out += `<line class="fret${f === 0 ? ' nut' : ''}" x1="${xAt(f)}" x2="${xAt(f)}" y1="8" y2="${8 + rowsN * rh}"/>` + (f > 0 && (big || [3, 5, 7, 9, 12, 15].includes(f)) ? `<text class="fn" x="${(xAt(f - 1) + xAt(f)) / 2}" y="${H + 9}" text-anchor="middle" font-size="9">${f}</text>` : '');
  else out += `<line class="fret nut" x1="${x0}" x2="${x0}" y1="8" y2="${8 + rowsN * rh}"/>`;
  for (let r = 0; r < rowsN; r++) { out += `<line class="str" x1="${x0 - 30}" x2="${x0 + bw}" y1="${yRow(r)}" y2="${yRow(r)}" stroke-width="${1.2 + (rowsN - 1 - r) * 0.45}"/>`; out += `<circle class="snc" cx="14" cy="${yRow(r)}" r="11"/><text class="sn" x="14" y="${yRow(r) + 4.5}" text-anchor="middle" font-size="12">${svSharp(midiName(openOf(r)).replace(/-?\d+$/, ''))}</text>`; }
  const seen = new Set(), dots = [];
  places.forEach(q => { if (!q) return; const k = q.row + ':' + q.offset; if (seen.has(k)) return; seen.add(k); dots.push({ row: q.row, off: q.offset, scale: true, f: q.finger }); });
  if (showAll) for (let r = 0; r < rowsN; r++) for (let off = 0; off <= (bowed ? vp.f1 + 6 : total - 0); off++) {   // every note in reach of the position
    if (seen.has(r + ':' + off)) continue;
    let f = ''; if (bowed) { const d = FINGER_BY_DELTA[off - vp.f1]; if (off === 0) f = '0'; else if (d) f = d[0]; else continue; } else if (off > total) continue;
    seen.add(r + ':' + off); dots.push({ row: r, off, scale: inScale.has((openOf(r) + off) % 12), f });
  }
  dots.sort((a, b) => a.scale - b.scale).forEach(d => { out += `<circle class="dot${d.scale ? ' sc' : ''} f${/^\d$/.test(d.f) ? d.f : 'x'}" cx="${xDot(d.off)}" cy="${yRow(d.row)}" r="${big ? (d.scale ? 12 : 6) : (d.scale ? 8 : 4)}"/>` + (d.scale && d.f !== '' && (big || d.off === 0) ? `<text class="df" x="${xDot(d.off)}" y="${yRow(d.row) + (big ? 4.5 : 3.5)}" text-anchor="middle" font-size="${big ? 13 : 10}">${d.f}</text>` : ''); });
  out += `<g id="svDot" style="display:none"><circle class="ring" r="${big ? 19 : 14}"/><circle class="on" r="${big ? 14 : 10}"/><text class="dn2" text-anchor="middle" y="${big ? 5 : 4}" font-size="${big ? 14 : 12}"></text></g>`;
  const legend = big && bowed ? `<div class="sv-leg"><i class="f0"></i>Open<i class="f1"></i>1st finger<i class="f2"></i>2nd finger<i class="f3"></i>3rd finger<i class="f4"></i>4th finger</div>` : '';
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="${bowed ? 'Fingerboard' : 'Fretboard'}">${out}</svg>` + legend + (big ? '<div id="svRead" class="sv-read mut" aria-live="polite"></div>' : '');
  SV.neckDot = $('svDot'); SV.dotAt = places.map(q => q ? { x: xDot(q.offset), y: yRow(q.row), t: bowed ? q.finger : q.offset === 0 ? '0' : String(q.offset) } : null);
}

// ================= Tab and Piano roll: notes scroll toward a playhead =================
// Both views put every note in one group that is moved as time passes. x = beat number * SV_PPB, so the note on the playhead is the one being played.
function svHighwayFrame(W, H, dyn, stat, tag, clipX, pill) {
  const playX = Math.max(84, Math.round(W * 0.3));
  const grad = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  const defs = `<clipPath id="hwc"><rect x="${clipX}" y="0" width="${W}" height="${H}"/></clipPath>` + grad('rbBlue', '#3b6bff', '#27c4ee') + grad('rbOk', '#1f9d6c', '#34d399') + grad('rbClose', '#c98a12', '#fbbf24') + grad('rbBad', '#c24545', '#f87171') + grad('rbCur', '#bff6ff', '#22d3ee');
  const mark = pill ? `<rect class="pill" x="${playX - 26}" y="1" width="52" height="19" rx="9.5"/><text class="pilt" x="${playX}" y="14.5" text-anchor="middle" font-size="11" font-weight="700">NOW</text>` : `<path class="pmark" d="M${playX - 7} 1 h14 l-7 10z"/>`;
  return { playX, svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${tag}"><defs>${defs}</defs>${stat}<g clip-path="url(#hwc)"><g id="svHw">${dyn}</g></g><rect class="playglow" x="${playX - 14}" y="0" width="28" height="${H}" rx="6"/><line class="play" x1="${playX}" x2="${playX}" y1="${pill ? 20 : 8}" y2="${H - 2}"/>${mark}</svg>` };
}
function svBuildTab(W) {
  const p = sc.plan, tl = p.tl, inst = p.inst, strings = stringsOf(inst), rowsN = strings.length, rh = 38, H = 32 + rowsN * rh + 16, yRow = r => 30 + r * rh + rh / 2, bowed = svIsBowed(inst);
  let stat = '', dyn = '';
  for (let r = 0; r < rowsN; r++) { stat += `<line class="tl" x1="34" x2="${W}" y1="${yRow(r)}" y2="${yRow(r)}"/>`; }
  for (let i = 0; i < tl.length; i++) dyn += `<line class="bt" x1="${i * SV_PPB}" x2="${i * SV_PPB}" y1="22" y2="${H - 16}"/>`;
  tl.forEach((n, i) => {
    const q = SV.places[i], x = i * SV_PPB; if (!q) return;
    const lab = bowed ? q.finger : String(q.offset);
    dyn += `<g class="hn" data-i="${i}"><rect x="${x - 15}" y="${yRow(q.row) - 13}" width="30" height="26" rx="8"/><text x="${x}" y="${yRow(q.row) + 5.5}" text-anchor="middle" font-size="15" font-weight="700">${lab}</text>` +
      `<text class="cap" x="${x}" y="${H - 3}" text-anchor="middle" font-size="11">${svNoteName(i)}</text></g>`;
  });
  for (let r = 0; r < rowsN; r++) stat += `<circle class="snc" cx="16" cy="${yRow(r)}" r="12"/><text class="sn" x="16" y="${yRow(r) + 4.5}" text-anchor="middle" font-size="12" font-weight="700">${svSharp(midiName(strings[strings.length - 1 - r]).replace(/-?\d+$/, ''))}</text>`;
  const fr = svHighwayFrame(W, H, dyn, stat, `Tab: ${tl.length} notes`, 34, true); SV.playX = fr.playX;
  $('scTab').innerHTML = fr.svg; SV.hw = $('svHw');
  SV.hwNodes = [...$('scTab').querySelectorAll('g.hn')].reduce((a, g) => (a[+g.dataset.i] = g, a), []);
}
function svBuildRoll(W) {
  const p = sc.plan, tl = p.tl, lo = Math.min(...tl.map(n => n.midi)) - 1, hi = Math.max(...tl.map(n => n.midi)) + 1, n = hi - lo + 1, rh = Math.max(10, Math.min(20, Math.floor(300 / n))), top = 14, H = n * rh + top + 6, gut = 44;
  const yOf = m => top + (hi - m) * rh, black = m => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
  let stat = '', dyn = '', keys = '', bk = '';
  for (let m = lo; m <= hi; m++) {
    stat += `<rect class="rr${black(m) ? ' blk' : ''}" x="${gut}" y="${yOf(m)}" width="${W}" height="${rh}"/>`;
    if (black(m)) bk += `<rect class="gk blk" x="0" y="${yOf(m) + 1}" width="${gut * 0.6}" height="${rh - 2}" rx="2"/>`;
    else keys += `<rect class="gk" x="0" y="${yOf(m)}" width="${gut}" height="${rh}"/>` + (rh >= 11 || m % 12 === 0 ? `<text class="sn" x="${gut - 4}" y="${yOf(m) + rh - 3.5}" text-anchor="end" font-size="${Math.min(11, rh - 2)}">${svSharp(midiName(m))}</text>` : '');
  }
  stat += keys + bk;
  const ppm = SV_PPB / (60000 / sc.bpm);
  for (let i = 0; i < tl.length; i++) dyn += `<line class="bt" x1="${i * SV_PPB}" x2="${i * SV_PPB}" y1="${top}" y2="${H - 6}"/>`;
  tl.forEach((nt, i) => {
    const w = Math.max(10, nt.durationMs * ppm - 3);
    dyn += `<g class="hn" data-i="${i}"><rect x="${i * SV_PPB}" y="${yOf(nt.midi) + 1}" width="${w}" height="${rh - 2}" rx="${Math.min(6, (rh - 2) / 2)}"/>` + (rh >= 12 && w > 34 ? `<text x="${i * SV_PPB + 7}" y="${yOf(nt.midi) + rh / 2 + 4}" font-size="${Math.min(11, rh - 4)}">${svNoteName(i)}</text>` : '') + `</g>`;
  });
  const fr = svHighwayFrame(W, H, dyn, stat, `Piano roll: ${tl.length} notes`, gut); SV.playX = fr.playX;
  $('scRoll').innerHTML = fr.svg; SV.hw = $('svHw');
  SV.hwNodes = [...$('scRoll').querySelectorAll('g.hn')].reduce((a, g) => (a[+g.dataset.i] = g, a), []);
}

// ================= state, colours, cursor =================
function svReadout(idx) {
  const el = $('svRead'); if (!el) return;
  if (idx < 0 || idx >= sc.tl.length) { el.textContent = sc.plan && sc.plan.inst === 'chromatic' ? 'Start practice to see the key to play.' : 'Start practice to see the finger to place.'; return; }
  const n = sc.tl[idx], h = SV.hints[idx];
  el.innerHTML = `<b>${svNoteName(idx)}</b>${h ? '<span>' + h.text + '</span>' : ''}`;
}
function svPaint() {
  const demo = demoIdx >= 0, idx = demo ? demoIdx : sc.running ? sc.pos : -1, v = svEffective(sc.plan.inst);
  const cls = i => `${noteCls(i, demo)}${sc.tl[i].direction === 'down' ? ' dn' : ''}`;
  if (v === 'staff') SV.nodes.forEach((g, i) => g.setAttribute('class', `nh ${cls(i)}`));
  if (v === 'tab' || v === 'roll') SV.hwNodes.forEach((g, i) => g && g.setAttribute('class', `hn ${cls(i)}`));
  if (v === 'staff' || v === 'board') {
    if (SV.neckDot) {
      const d = idx >= 0 && idx < sc.tl.length ? SV.dotAt[idx] : null;
      SV.neckDot.style.display = d ? '' : 'none';
      if (d) { SV.neckDot.setAttribute('transform', `translate(${d.x} ${d.y})`); SV.neckDot.querySelector('text').textContent = d.t; }
    } else {
      $('scNeck').querySelectorAll('.pk.on').forEach(k => k.classList.remove('on'));
      const k = idx >= 0 && idx < sc.tl.length ? $('scNeck').querySelector(`.pk[data-m="${sc.tl[idx].midi}"]`) : null; if (k) k.classList.add('on');
    }
    if (v === 'board') svReadout(idx);
  }
}
// Where time is, in ms from the first note: from the click in Tempo-locked mode (negative during the count-in), else eased toward the target note.
function svNowMs() {
  const beat = 60000 / sc.bpm, last = (sc.tl.length - 1) * beat;
  if (demoIdx < 0 && sc.running && sc.mode === 'tempo' && sc.clock != null && typeof ctx !== 'undefined' && ctx) { SV.hwCur = (ctx.currentTime - t0 - sc.clock) * 1000; return Math.max(-2 * beat, Math.min(last, SV.hwCur)); }
  const target = demoIdx >= 0 ? demoIdx * beat : sc.running ? Math.min(sc.pos, sc.tl.length - 1) * beat : 0;
  SV.hwCur += (target - SV.hwCur) * 0.25; if (Math.abs(target - SV.hwCur) < 2) SV.hwCur = target;
  return SV.hwCur;
}
// Staff cursor position: a smooth place between notes while the click runs, the target note otherwise. null = hidden.
function svCursorAt() {
  if (demoIdx >= 0) return demoIdx;
  if (!sc.running || sc.pos >= sc.tl.length) return null;
  if (sc.mode === 'tempo' && sc.clock != null && typeof ctx !== 'undefined' && ctx) return Math.max(0, Math.min(sc.tl.length - 1, ((ctx.currentTime - t0 - sc.clock) * 1000) / (60000 / sc.bpm)));
  return sc.pos;
}
const svClock = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function svProgress(now) {   // the bar under the display: time through the scale in Tempo-locked mode and in Hear scale, notes played in Wait mode
  const n = sc.tl.length, beat = 60000 / sc.bpm, total = n * beat, wait = demoIdx < 0 && sc.mode === 'wait';
  let frac = 0, txt;
  if (wait) { frac = n ? Math.min(1, (sc.running ? sc.pos : 0) / n) : 0; txt = `${sc.running ? Math.min(sc.pos, n) : 0} / ${n} notes`; }
  else { const t = Math.max(0, Math.min(total, now == null ? 0 : now + (demoIdx >= 0 ? 0 : 0))); frac = total ? t / total : 0; txt = `${svClock(t)} / ${svClock(total)}`; }
  $('scProgFill').style.width = (frac * 100).toFixed(1) + '%'; $('scTime').textContent = txt;
}
function svFrame() {
  SV.raf = 0; if (!sc.plan) return;
  if (sc.running || demoIdx >= 0) { const b = 60000 / sc.bpm; svProgress(demoIdx >= 0 ? demoIdx * b : sc.mode === 'tempo' && sc.clock != null && typeof ctx !== 'undefined' && ctx ? (ctx.currentTime - t0 - sc.clock) * 1000 : null); }
  const v = svEffective(sc.plan.inst), busy = sc.running || demoIdx >= 0;
  if (v === 'tab' || v === 'roll') {
    if (!SV.hw) return;
    const now = svNowMs(), ppm = SV_PPB / (60000 / sc.bpm);
    SV.hw.setAttribute('transform', `translate(${(SV.playX - now * ppm).toFixed(1)} 0)`);
    if (busy || Math.abs(SV.hwCur) > 1) SV.raf = requestAnimationFrame(svFrame);
    return;
  }
  const f = v === 'staff' ? svCursorAt() : null, el = SV.curEl; if (!el || !SV.where.length) return;
  if (f == null) { el.style.display = 'none'; SV.bandEl.style.display = 'none'; return; }
  const i = Math.floor(f), a = SV.where[i], b = SV.where[Math.min(SV.where.length - 1, i + 1)];
  if (!a) return;
  const x = b && b.r === a.r ? a.x + (b.x - a.x) * (f - i) : a.x, g = SV.geo[a.r];
  if (SV.curRow !== a.r) { el.setAttribute('y1', g.top - 14); el.setAttribute('y2', g.bottom + 14); SV.bandEl.setAttribute('y', g.top - 14); SV.bandEl.setAttribute('height', g.bottom - g.top + 28); SV.curRow = a.r; }
  { const box = $('scStaff'); if (SV.sw > box.clientWidth + 4 && (sc.running || demoIdx >= 0)) { const want = Math.max(0, Math.min(SV.sw - box.clientWidth, x - box.clientWidth * 0.4)); box.scrollLeft += (want - box.scrollLeft) * 0.2; } }
  el.style.display = ''; SV.bandEl.style.display = ''; el.setAttribute('transform', `translate(${x.toFixed(1)} 0)`); SV.bandEl.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
  SV.raf = requestAnimationFrame(svFrame);   // keeps running while a run or a demo is on; svRender restarts it
}

function svRender() {
  const box = $('scStaff'); if (!box || !sc.plan) return;
  const p = sc.plan, inst = p.inst, v = svEffective(inst), vis = $('scVis');
  const W = Math.max(260, Math.floor(vis.clientWidth ? vis.clientWidth - 16 : box.clientWidth || 340));
  // the buttons: Tab is offered only where there are strings; the keyboard is the Fingerboard of a piano
  document.querySelectorAll('#scView button').forEach(b => { const ok = b.dataset.v !== 'tab' || svTabOk(inst), on = b.dataset.v === v; b.hidden = !ok; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); if (b.dataset.v === 'board') b.textContent = inst === 'chromatic' ? 'Keys' : svIsBowed(inst) ? 'Fingerboard' : 'Fretboard'; });
  $('scVisTitle').textContent = `${svSharp(p.tl[0].noteName.replace(/-?\d+$/, ''))} ${SCALE_DEFS[p.type].label} — ${p.span} ${p.span > 1 ? 'Octaves' : 'Octave'}`;
  $('scShowW').hidden = v !== 'board' || inst === 'chromatic';
  $('scStaff').hidden = v !== 'staff'; $('scTab').hidden = v !== 'tab'; $('scNeck').hidden = !(v === 'board' || (v === 'staff' && SV.showNeck));
  { const nb = $('scNeckBtn'); nb.hidden = v !== 'staff'; nb.textContent = inst === 'chromatic' ? '🎹' : inst === 'guitar' ? '🎸' : inst === 'ukulele' ? '🪕' : '🎻'; nb.classList.toggle('on', !!SV.showNeck); nb.setAttribute('aria-pressed', SV.showNeck ? 'true' : 'false'); } $('scRoll').hidden = v !== 'roll';
  const base = [p.tl.map(n => n.midi).join(), inst, p.pc, p.type, p.pos, p.bow, sigBeats(), W, useFlats].join('|');
  if (base !== SV.key) { SV.key = base; svPlan(); SV.staffKey = SV.neckKey = SV.hwKey = ''; }
  if (v === 'staff' && SV.staffKey !== base) { SV.staffKey = base; svBuildStaff(W); }
  const nk = base + '|' + v + '|' + $('scShow').value; if ((v === 'board' || (v === 'staff' && SV.showNeck)) && SV.neckKey !== nk) { SV.neckKey = nk; svBuildNeck(W, v === 'board'); }
  const hk = base + '|' + v + '|' + sc.bpm; if ((v === 'tab' || v === 'roll') && SV.hwKey !== hk) { SV.hwKey = hk; (v === 'tab' ? svBuildTab : svBuildRoll)(W); SV.hwCur = 0; }
  svPaint(); if (!sc.running && demoIdx < 0) svProgress(0);
  if (!SV.raf && (sc.running || demoIdx >= 0 || ((v === 'tab' || v === 'roll') && SV.hw))) SV.raf = requestAnimationFrame(svFrame);
  else if (v === 'staff' && !sc.running && demoIdx < 0 && SV.curEl) { SV.curEl.style.display = 'none'; SV.bandEl.style.display = 'none'; }
}
document.querySelectorAll('#scView button').forEach(b => b.onclick = () => { SV.view = b.dataset.v; try { localStorage.setItem(SV_VIEW_KEY, SV.view); } catch {} svRender(); });
$('scShow').onchange = () => svRender();
if (typeof ResizeObserver !== 'undefined') { let rz = 0; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { const w = $('scVis').clientWidth || 0; if (Math.abs(w - SV.W) > 8) { SV.W = w; SV.key = ''; svRender(); } }, 120); }).observe($('scVis')); }

// ---- full screen for the whole player card (the controls and the result stay usable); Esc leaves. Browsers without element full screen (iPhone) get a fixed overlay instead.
function svFull(on) {
  const el = $('scPlayer'), now = document.fullscreenElement === el || el.classList.contains('fs');
  if (on === undefined) on = !now;
  if (on && !now) { if (el.requestFullscreen) el.requestFullscreen().catch(() => el.classList.add('fs')); else el.classList.add('fs'); }
  else if (!on && now) { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); el.classList.remove('fs'); }
  setTimeout(() => { SV.key = ''; svRender(); }, 200);
}
$('scFs').onclick = () => svFull();
document.addEventListener('fullscreenchange', () => { SV.key = ''; svRender(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('scPlayer').classList.contains('fs')) svFull(false); });
// the scorecard stays hidden until asked for, so the display has the screen
$('scCardBtn').onclick = () => { const p = $('scCardPanel'), open = p.hidden; p.hidden = !open; $('scCardBtn').setAttribute('aria-expanded', String(open)); if (open) { renderCard(); renderSummary(); p.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } };

$('scSig').addEventListener('change', () => { SV.key = ''; svRender(); });   // the barlines and the time signature follow the Beats choice

$('scNeckBtn').onclick = () => { SV.showNeck = !SV.showNeck; try { localStorage.setItem(SV_NECK_KEY, SV.showNeck ? '1' : '0'); } catch {} SV.neckKey = ''; svRender(); };   // the instrument under the notation is optional
