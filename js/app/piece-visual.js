// The Piece practice displays: Staff, Tab, Fingerboard (or keys) and Piano roll, drawn as SVG once per piece, with only classes and one cursor changing while it plays.
// These are the Scale drills' displays (js/app/scale-visual.js) adapted for a piece: notes are not one per beat (rests, long notes), bar lines come from the score, note lengths
// show on the staff, and the violin's hand position moves from note to note. This file is a copy-and-adapt, not a change to the Scale drills: they keep their own code, their own
// element ids (here pz...) and their own SVG ids (here pw...), so the two screens can never disturb each other. The geometry (js/core/visual.js) is shared.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

const PW = { key: '', nodes: [], where: [], rows: [], geo: [], hints: [], places: [], neckDot: null, dotAt: [], raf: 0, curRow: -1, view: 'staff', showNeck: true, hw: null, hwNodes: [], hwCur: 0, hwKey: '', neckKey: '', staffKey: '', glide: null, glideT: 0, demoT0: null, playX: 84, sw: 0, paintIdx: -2 };
const PW_LG = 10, PW_ST = PW_LG / 2, PW_SP = 54, PW_PPB = 72;   // staff line gap, pixels per step, space per note, pixels per beat in Tab and Roll
const PW_VIEWS = ['staff', 'tab', 'board', 'roll'], PW_VIEW_KEY = 'tuner-pzview', PW_NECK_KEY = 'tuner-pzneck', PW_ENG_KEY = 'tuner-pzeng';
const pwSharp = n => n.replace('#', '♯').replace(/^([A-G])b/, '$1♭');
const pwFont = '"Noto Music","Segoe UI Symbol","Apple Symbols",serif';
try { const v = localStorage.getItem(PW_VIEW_KEY); if (PW_VIEWS.includes(v)) PW.view = v; const n = localStorage.getItem(PW_NECK_KEY); if (n != null) PW.showNeck = n === '1'; PW.eng = localStorage.getItem(PW_ENG_KEY) === '1'; } catch {}

const pwStrings = inst => (PRESETS[inst] && PRESETS[inst].strings || []).map(nameToMidi);
const pwBowed = inst => ruleFor(inst).fingering === 'bowed', pwTabOk = inst => !!ruleFor(inst).fingering;
const pwEffective = inst => PW.view === 'tab' && !pwTabOk(inst) ? 'staff' : PW.view;
const pwBeats = () => (PE.plan && PE.plan.beats) || PE.tl.length;   // how many beats the run lasts (the loop length)
function pwFingerLabel(inst, hint, midi, strings) { const pl = visPlace(hint, strings, midi); if (!pl) return ''; return pwBowed(inst) ? pl.finger : pl.offset === 0 ? '0' : String(pl.offset); }
// Everything per note that more than one view needs: the fingering hint and where it falls on the neck. The violin hand moves, so each note has its own position (plan.posList).
function pwPlan() {
  const p = PE.plan, strings = pwStrings(p.inst), fing = ruleFor(p.inst).fingering;
  PW.hints = p.tl.map((n, i) => fing ? fingerHint(p.inst, n.midi, strings, p.posList ? p.posList[i] : p.pos) : null);
  PW.places = p.tl.map((n, i) => visPlace(PW.hints[i], strings, n.midi));
}
const pwNoteName = i => pwSharp(PE.tl[i].noteName);

// ================= Staff =================
function pwBuildStaff(W) {
  const p = PE.plan, tl = p.tl, inst = p.inst, strings = pwStrings(inst), sig = visKeySig(p.pc, 'major', p.flats), left = 62 + 14 * sig.n, n = tl.length;
  // one row, never squeezed: at least 54px per note (wider when the screen has room); a longer piece scrolls sideways and the cursor keeps itself centred
  const sp = Math.min(84, Math.max(PW_SP, (W - left - 14) / n)), full = left + n * sp + 14, SW = Math.max(W, Math.ceil(full)); PW.sw = SW;
  const rows = pwLayout(tl, { left, spacing: sp, sig, octaveShift: inst === 'guitar' ? 1 : 0 });
  const hints = PW.hints, glyph = typeof clefGlyphs === 'function' && clefGlyphs();
  let y = 6, out = '', pre = '';   // pre: clef, key and time signature, drawn in their own layer that stays put while the notes scroll
  PW.geo = []; PW.where = new Array(tl.length); PW.rows = rows;
  // A piano is written on a grand staff: the treble staff for middle C and above, the bass staff below it. (Everything else: one treble staff.)
  const grand = inst === 'chromatic', TREB = 28, bassLedgers = step => { const l = []; for (let e = 16; e >= step; e -= 2) l.push(e); return l; };   // 28 = C4; the bass staff's lines are G2 (18) to A3 (26)
  rows.forEach((row, r) => {
    const bowed = pwBowed(inst), nT = grand ? row.notes.filter(n => n.step >= TREB) : row.notes, nB = grand ? row.notes.filter(n => n.step < TREB) : [];
    const exT = { hi: Math.max(VIS_TOP, ...nT.map(n => n.step)), lo: Math.min(VIS_BOTTOM, ...nT.map(n => n.step)) };
    const top = y + 46 + PW_ST * (exT.hi - VIS_TOP), yS = s => top + (VIS_TOP - s) * PW_ST, bottom = yS(VIS_BOTTOM);
    let bYS = null, bBottom = bottom, base = yS(Math.min(exT.lo, VIS_BOTTOM));
    if (grand) {
      const exB = { hi: Math.max(26, ...nB.map(n => n.step)), lo: Math.min(18, ...nB.map(n => n.step)) }, bTop = base + 34 + PW_ST * (exB.hi - 26);   // room between the staves for middle C's ledger line
      bYS = s => bTop + (26 - s) * PW_ST; bBottom = bYS(18); base = bYS(Math.min(exB.lo, 18));
    }
    const end = base + (bowed ? 66 : 40);
    PW.geo.push({ top, bottom: bBottom, y0: y, y1: end });
    const lines = (t, x2) => { let o = ''; for (let k = 0; k < 5; k++) o += `<line class="sl" x1="4" x2="${x2}" y1="${t + k * PW_LG}" y2="${t + k * PW_LG}"/>`; return o; };
    out += lines(top, SW - 4); pre += lines(top, left);
    if (grand) { out += lines(bYS(26), SW - 4); pre += lines(bYS(26), left); }
    pre += `<line class="sl" x1="4" x2="4" y1="${top}" y2="${bBottom}"/>`;   // the line at the left joins both staves of a grand staff
    pre += glyph ? `<text class="clef" x="8" y="${yS(32) + 9}" font-family='${pwFont}' font-size="${PW_LG * 5.4}">\u{1D11E}</text>` : `<text class="clef" x="10" y="${yS(32) + 11}" font-family="serif" font-size="38" font-style="italic" font-weight="700">G</text>`;
    if (grand) pre += glyph ? `<text class="clef" x="8" y="${bYS(24) + 3}" font-family='${pwFont}' font-size="${PW_LG * 4.6}">\u{1D122}</text>` : `<text class="clef" x="10" y="${bYS(24) + 12}" font-family="serif" font-size="34" font-style="italic" font-weight="700">F</text>`;
    sig.marks.forEach((m, k) => { pre += `<text class="ks" x="${46 + k * 13}" y="${yS(m.step) + 8}" font-size="26" font-family='${pwFont}'>${sig.kind === 'flat' ? '♭' : '♯'}</text>`; if (grand) pre += `<text class="ks" x="${46 + k * 13}" y="${bYS(m.step - 14) + 8}" font-size="26" font-family='${pwFont}'>${sig.kind === 'flat' ? '♭' : '♯'}</text>`; });
    { const ts = p.timeSig || [4, 4], tx = 50 + 13 * sig.n + 8, tsAt = (f, s0) => `<text class="ts" x="${tx}" y="${f(s0) + 6}" text-anchor="middle" font-size="${PW_LG * 2.2}" font-weight="700">${ts[0]}</text><text class="ts" x="${tx}" y="${f(s0) + 6 + PW_LG * 2}" text-anchor="middle" font-size="${PW_LG * 2.2}" font-weight="700">${ts[1]}</text>`;
      pre += tsAt(yS, 36); if (grand) pre += tsAt(bYS, 24); }
    row.bars.forEach(x => { out += `<line class="bar" x1="${x}" x2="${x}" y1="${top}" y2="${bBottom}"/>`; });
    for (const n of row.notes) {
      const onB = grand && n.step < TREB, ys = onB ? bYS : yS, cy = ys(n.step), up = n.step < (onB ? 22 : 34), sx = up ? n.x + 6.4 : n.x - 6.4, sy = up ? cy - 33 : cy + 33;
      PW.where[n.i] = { r, x: n.x, y: cy };
      out += `<g class="nh" data-i="${n.i}"><circle class="halo" cx="${n.x}" cy="${cy}" r="14"/>`;
      for (const l of onB ? bassLedgers(n.step) : n.ledgers) out += `<line class="led" x1="${n.x - 12}" x2="${n.x + 12}" y1="${ys(l)}" y2="${ys(l)}"/>`;
      if (n.acc) out += `<text class="acc" x="${n.x - 19}" y="${cy + 7}" font-size="22" font-family='${pwFont}'>${{ '#': '♯', b: '♭', n: '♮' }[n.acc]}</text>`;
      // how long the note lasts: an open head for a half or whole note, no stem for a whole note, flags for eighths and sixteenths, a dot for a dotted value
      const dq = tl[n.i].dq, whole = dq >= 3.5, hollow = dq >= 1.75, nf = dq == null ? 0 : dq <= 0.375 ? 2 : dq <= 0.75 ? 1 : 0, dotted = dq != null && [0.75, 1.5, 3, 6].some(v => Math.abs(dq - v) < 0.06);
      let flags = ''; for (let f = 0; f < nf; f++) flags += `<path class="flag" d="M${sx} ${up ? sy + f * 7 : sy - f * 7} c0 ${up ? 8 : -8} 10 ${up ? 10 : -10} 8 ${up ? 20 : -20}"/>`;
      out += (whole ? '' : `<line class="stem" x1="${sx}" y1="${cy}" x2="${sx}" y2="${sy}"/>`) + `<ellipse class="head" cx="${n.x}" cy="${cy}" rx="7.4" ry="5.4" transform="rotate(-20 ${n.x} ${cy})"/>` + (hollow ? `<ellipse class="hole" cx="${n.x}" cy="${cy}" rx="4.4" ry="2.4" transform="rotate(-20 ${n.x} ${cy})"/>` : '') + flags + (dotted ? `<circle class="dotn" cx="${n.x + 13}" cy="${cy - (n.step % 2 === 0 ? PW_ST : 0)}" r="2"/>` : '') + `</g>`;
      const f = hints[n.i] ? pwFingerLabel(inst, hints[n.i], tl[n.i].midi, strings) : '';
      out += `<text class="nm" x="${n.x}" y="${base + 28}" text-anchor="middle" font-size="12">${pwNoteName(n.i)}</text>`;
      if (f !== '') out += `<text class="fing" x="${n.x}" y="${y + 20}" text-anchor="middle" font-size="16">${f}</text>`;
    }
    if (bowed) {   // a bracket under the notes that stay on one string
      let a = 0; const ns = row.notes;
      while (a < ns.length) {
        let b = a; const q = PW.places[ns[a].i]; while (b + 1 < ns.length && PW.places[ns[b + 1].i] && q && PW.places[ns[b + 1].i].row === q.row) b++;
        if (q && b > a) { const x1 = ns[a].x - 12, x2 = ns[b].x + 12, nm = midiName(strings[strings.length - 1 - q.row]).replace(/-?\d+$/, '');
          out += `<path class="sbr" d="M${x1} ${base + 40} v5 H${x2} v-5"/><text class="sbt" x="${(x1 + x2) / 2}" y="${base + 61}" text-anchor="middle" font-size="12.5">${pwSharp(nm)} string</text>`; }
        a = b + 1;
      }
    }
    y = end + 6;
  });
  out = `<rect id="pwBand" class="bandhl" x="-18" width="36" y="0" height="0" rx="4" style="display:none"/>` + out + `<line id="pwCur" class="cur" x1="0" x2="0" y1="0" y2="0" style="display:none"/>`;
  $('pzStaff').innerHTML = `<div class="stin" style="width:${SW}px"><svg class="stk" style="width:${left}px;height:${y}px" viewBox="0 0 ${left} ${y}" aria-hidden="true"><rect class="stbg" width="${left}" height="${y}"/>${pre}</svg><svg class="stm" viewBox="0 0 ${SW} ${y}" style="width:${SW}px;height:${y}px;margin-top:-${y}px" role="img" aria-label="Piece notation: ${tl.length} notes">${out}</svg></div>`;
  PW.nodes = [...$('pzStaff').querySelectorAll('g.nh')].reduce((a, g) => (a[+g.dataset.i] = g, a), []);
  PW.curEl = $('pwCur'); PW.bandEl = $('pwBand'); PW.curRow = -1;
}

// ================= Neck and keys =================
// big: the Fingerboard view (taller, all notes optional, a readout of the finger to place); small: the instrument shown under the staff.
function pwBuildNeck(W, big) {
  const p = PE.plan, inst = p.inst, tl = p.tl, strings = pwStrings(inst), box = $('pzNeck'), showAll = big && $('pzShow').value === 'all', inPiece = new Set(tl.map(n => n.midi % 12));
  if (inst === 'chromatic') {   // piano keys, filling the width, the name on every key the piece uses
    const lo = Math.min(...tl.map(n => n.midi)), hi = Math.max(...tl.map(n => n.midi)), kb = visKeys(lo - 1, hi + 1), kw = Math.min(big ? 72 : 60, (W - 8) / kb.units), H = big ? 170 : 110, ox = Math.max(4, (W - kb.units * kw) / 2), inMidi = new Set(tl.map(n => n.midi));
    let out = '';
    for (const k of kb.keys.filter(k => !k.black)) out += `<rect class="pk${inMidi.has(k.midi) ? ' sc' : ''}" data-m="${k.midi}" x="${ox + k.x * kw}" y="2" width="${kw - 1.5}" height="${H}" rx="4"/>` + (inMidi.has(k.midi) || k.midi % 12 === 0 ? `<text class="kn${inMidi.has(k.midi) ? ' sc' : ''}" x="${ox + k.x * kw + (kw - 1.5) / 2}" y="${H - 8}" text-anchor="middle" font-size="${big ? 13 : 12}">${pwSharp(midiName(k.midi))}</text>` : '');
    for (const k of kb.keys.filter(k => k.black)) out += `<rect class="pk blk${inMidi.has(k.midi) ? ' sc' : ''}" data-m="${k.midi}" x="${ox + k.x * kw}" y="2" width="${k.w * kw}" height="${H * 0.6}" rx="3"/>` + (inMidi.has(k.midi) ? `<text class="kn blkn" x="${ox + k.x * kw + k.w * kw / 2}" y="${H * 0.6 - 7}" text-anchor="middle" font-size="${big ? 11 : 10}">${pwSharp(midiName(k.midi).replace(/-?\d+$/, ''))}</text>` : '');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H + 6}" role="img" aria-label="Keyboard">${out}</svg>` + (big ? '<div id="pwRead" class="sv-read mut" aria-live="polite"></div>' : ''); PW.neckDot = null; return;
  }
  const bowed = pwBowed(inst), places = PW.places, rowsN = strings.length, vp = VIOLIN_POSITIONS[p.pos] ? VIOLIN_POSITIONS[p.pos][1] : VIOLIN_POSITIONS[1][1];
  const maxOff = Math.max(5, ...places.filter(Boolean).map(q => q.offset)), total = bowed ? Math.max(big ? 9 : 8, maxOff + 2) : Math.min(15, Math.max(big ? 8 : 5, maxOff + 1));
  const x0 = 52, bw = W - x0 - 10, rh = big ? 40 : 28, H = 14 + rowsN * rh, xAt = n => x0 + visFretX(n, total) * bw, yRow = r => 12 + r * rh + rh / 2 - 2;
  const xDot = off => off === 0 ? x0 - 18 : bowed ? xAt(off) : (xAt(off - 1) + xAt(off)) / 2, openOf = r => strings[strings.length - 1 - r];
  let out = `<defs><linearGradient id="pwWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a3422"/><stop offset=".5" stop-color="#2c1f14"/><stop offset="1" stop-color="#1a120b"/></linearGradient><linearGradient id="pwStr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f3f8"/><stop offset="1" stop-color="#9aa3b8"/></linearGradient></defs><rect class="board" x="${x0}" y="8" width="${bw}" height="${rowsN * rh}" rx="4"/>`;
  if (!bowed) for (let f = 0; f <= total; f++) out += `<line class="fret${f === 0 ? ' nut' : ''}" x1="${xAt(f)}" x2="${xAt(f)}" y1="8" y2="${8 + rowsN * rh}"/>` + (f > 0 && (big || [3, 5, 7, 9, 12, 15].includes(f)) ? `<text class="fn" x="${(xAt(f - 1) + xAt(f)) / 2}" y="${H + 9}" text-anchor="middle" font-size="9">${f}</text>` : '');
  else out += `<line class="fret nut" x1="${x0}" x2="${x0}" y1="8" y2="${8 + rowsN * rh}"/>`;
  for (let r = 0; r < rowsN; r++) { out += `<line class="str" x1="${x0 - 30}" x2="${x0 + bw}" y1="${yRow(r)}" y2="${yRow(r)}" stroke-width="${1.2 + (rowsN - 1 - r) * 0.45}"/>`; out += `<circle class="snc" cx="14" cy="${yRow(r)}" r="11"/><text class="sn" x="14" y="${yRow(r) + 4.5}" text-anchor="middle" font-size="12">${pwSharp(midiName(openOf(r)).replace(/-?\d+$/, ''))}</text>`; }
  const seen = new Set(), dots = [];
  places.forEach(q => { if (!q) return; const k = q.row + ':' + q.offset; if (seen.has(k)) return; seen.add(k); dots.push({ row: q.row, off: q.offset, scale: true, f: q.finger }); });
  if (showAll) for (let r = 0; r < rowsN; r++) for (let off = 0; off <= (bowed ? vp.f1 + 6 : total - 0); off++) {   // every note in reach of the first position
    if (seen.has(r + ':' + off)) continue;
    let f = ''; if (bowed) { const d = FINGER_BY_DELTA[off - vp.f1]; if (off === 0) f = '0'; else if (d) f = d[0]; else continue; } else if (off > total) continue;
    seen.add(r + ':' + off); dots.push({ row: r, off, scale: inPiece.has((openOf(r) + off) % 12), f });
  }
  dots.sort((a, b) => a.scale - b.scale).forEach(d => { out += `<circle class="dot${d.scale ? ' sc' : ''} f${/^\d$/.test(d.f) ? d.f : 'x'}" cx="${xDot(d.off)}" cy="${yRow(d.row)}" r="${big ? (d.scale ? 12 : 6) : (d.scale ? 8 : 4)}"/>` + (d.scale && d.f !== '' && (big || d.off === 0) ? `<text class="df" x="${xDot(d.off)}" y="${yRow(d.row) + (big ? 4.5 : 3.5)}" text-anchor="middle" font-size="${big ? 13 : 10}">${d.f}</text>` : ''); });
  out += `<g id="pwDot" style="display:none"><circle class="ring" r="${big ? 19 : 14}"/><circle class="on" r="${big ? 14 : 10}"/><text class="dn2" text-anchor="middle" y="${big ? 5 : 4}" font-size="${big ? 14 : 12}"></text></g>`;
  const legend = big && bowed ? `<div class="sv-leg"><i class="f0"></i>Open<i class="f1"></i>1st finger<i class="f2"></i>2nd finger<i class="f3"></i>3rd finger<i class="f4"></i>4th finger</div>` : '';
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="${bowed ? 'Fingerboard' : 'Fretboard'}">${out}</svg>` + legend + (big ? '<div id="pwRead" class="sv-read mut" aria-live="polite"></div>' : '');
  PW.neckDot = $('pwDot'); PW.dotAt = places.map(q => q ? { x: xDot(q.offset), y: yRow(q.row), t: bowed ? q.finger : q.offset === 0 ? '0' : String(q.offset) } : null);
}

// ================= Tab and Piano roll: notes scroll toward a playhead =================
// Both views put every note in one group that is moved as time passes. x = beat * PW_PPB, so the note on the playhead is the one being played.
function pwHighwayFrame(W, H, dyn, stat, tag, clipX, pill) {
  const playX = Math.max(84, Math.round(W * 0.3)), grad = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  const defs = `<clipPath id="pwc${pill ? 'T' : 'R'}"><rect x="${clipX}" y="0" width="${W}" height="${H}"/></clipPath>` + grad('pwBlue', '#3b6bff', '#27c4ee') + grad('pwOk', '#1f9d6c', '#34d399') + grad('pwClose', '#c98a12', '#fbbf24') + grad('pwBad', '#c24545', '#f87171') + grad('pwCurG', '#bff6ff', '#22d3ee');
  const mark = pill ? `<rect class="pill" x="${playX - 26}" y="1" width="52" height="19" rx="9.5"/><text class="pilt" x="${playX}" y="14.5" text-anchor="middle" font-size="11" font-weight="700">NOW</text>` : `<path class="pmark" d="M${playX - 7} 1 h14 l-7 10z"/>`;
  return { playX, svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${tag}"><defs>${defs}</defs>${stat}<g clip-path="url(#pwc${pill ? 'T' : 'R'})"><g id="pwHw">${dyn}</g></g><rect class="playglow" x="${playX - 14}" y="0" width="28" height="${H}" rx="6"/><line class="play" x1="${playX}" x2="${playX}" y1="${pill ? 20 : 8}" y2="${H - 2}"/>${mark}</svg>` };
}
function pwBuildTab(W) {
  const p = PE.plan, tl = p.tl, inst = p.inst, strings = pwStrings(inst), rowsN = strings.length, rh = 38, H = 32 + rowsN * rh + 16, yRow = r => 30 + r * rh + rh / 2, bowed = pwBowed(inst);
  let stat = '', dyn = '';
  for (let r = 0; r < rowsN; r++) stat += `<line class="tl" x1="34" x2="${W}" y1="${yRow(r)}" y2="${yRow(r)}"/>`;
  for (let b = 0; b < pwBeats(); b++) dyn += `<line class="bt" x1="${b * PW_PPB}" x2="${b * PW_PPB}" y1="22" y2="${H - 16}"/>`;
  tl.forEach((n, i) => {
    const q = PW.places[i], x = pwBeatAt(tl, i) * PW_PPB; if (!q) return;
    const lab = bowed ? q.finger : String(q.offset);
    dyn += `<g class="hn" data-i="${i}"><rect x="${x - 15}" y="${yRow(q.row) - 13}" width="30" height="26" rx="8"/><text x="${x}" y="${yRow(q.row) + 5.5}" text-anchor="middle" font-size="15" font-weight="700">${lab}</text>` +
      `<text class="cap" x="${x}" y="${H - 3}" text-anchor="middle" font-size="11">${pwNoteName(i)}</text></g>`;
  });
  for (let r = 0; r < rowsN; r++) stat += `<circle class="snc" cx="16" cy="${yRow(r)}" r="12"/><text class="sn" x="16" y="${yRow(r) + 4.5}" text-anchor="middle" font-size="12" font-weight="700">${pwSharp(midiName(strings[strings.length - 1 - r]).replace(/-?\d+$/, ''))}</text>`;
  const fr = pwHighwayFrame(W, H, dyn, stat, `Tab: ${tl.length} notes`, 34, true); PW.playX = fr.playX;
  $('pzTab').innerHTML = fr.svg; PW.hw = $('pzTab').querySelector('#pwHw');   // Tab and Piano roll each have a #pwHw: look inside this view
  PW.hwNodes = [...$('pzTab').querySelectorAll('g.hn')].reduce((a, g) => (a[+g.dataset.i] = g, a), []);
}
function pwBuildRoll(W) {
  const p = PE.plan, tl = p.tl, lo = Math.min(...tl.map(n => n.midi)) - 1, hi = Math.max(...tl.map(n => n.midi)) + 1, n = hi - lo + 1, rh = Math.max(10, Math.min(20, Math.floor(300 / n))), top = 14, H = n * rh + top + 6, gut = 44;
  const yOf = m => top + (hi - m) * rh, black = m => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
  let stat = '', dyn = '', keys = '', bk = '';
  for (let m = lo; m <= hi; m++) {
    stat += `<rect class="rr${black(m) ? ' blk' : ''}" x="${gut}" y="${yOf(m)}" width="${W}" height="${rh}"/>`;
    if (black(m)) bk += `<rect class="gk blk" x="0" y="${yOf(m) + 1}" width="${gut * 0.6}" height="${rh - 2}" rx="2"/>`;
    else keys += `<rect class="gk" x="0" y="${yOf(m)}" width="${gut}" height="${rh}"/>` + (rh >= 11 || m % 12 === 0 ? `<text class="sn" x="${gut - 4}" y="${yOf(m) + rh - 3.5}" text-anchor="end" font-size="${Math.min(11, rh - 2)}">${pwSharp(midiName(m))}</text>` : '');
  }
  stat += keys + bk;
  const ppm = PW_PPB / (60000 / PE.bpm);
  for (let b = 0; b < pwBeats(); b++) dyn += `<line class="bt" x1="${b * PW_PPB}" x2="${b * PW_PPB}" y1="${top}" y2="${H - 6}"/>`;
  tl.forEach((nt, i) => {
    const w = Math.max(10, nt.durationMs * ppm - 3), x = pwBeatAt(tl, i) * PW_PPB;
    dyn += `<g class="hn" data-i="${i}"><rect x="${x}" y="${yOf(nt.midi) + 1}" width="${w}" height="${rh - 2}" rx="${Math.min(6, (rh - 2) / 2)}"/>` + (rh >= 12 && w > 34 ? `<text x="${x + 7}" y="${yOf(nt.midi) + rh / 2 + 4}" font-size="${Math.min(11, rh - 4)}">${pwNoteName(i)}</text>` : '') + `</g>`;
  });
  const fr = pwHighwayFrame(W, H, dyn, stat, `Piano roll: ${tl.length} notes`, gut); PW.playX = fr.playX;
  $('pzRoll').innerHTML = fr.svg; PW.hw = $('pzRoll').querySelector('#pwHw');
  PW.hwNodes = [...$('pzRoll').querySelectorAll('g.hn')].reduce((a, g) => (a[+g.dataset.i] = g, a), []);
}

// ================= state, colours, cursor =================
function pwReadout(idx) {
  const el = $('pwRead'); if (!el) return;
  if (idx < 0 || idx >= PE.tl.length) { el.textContent = PE.plan && PE.plan.inst === 'chromatic' ? 'Start practice to see the key to play.' : 'Start practice to see the finger to place.'; return; }
  const h = PW.hints[idx]; el.innerHTML = `<b>${pwNoteName(idx)}</b>${h ? '<span>' + h.text + '</span>' : ''}`;
}
// The note that is sounding NOW, from the same clock as the cursor (so they change on the same frame). Tempo-locked and Hear piece: the note whose time the clock is in; Wait: the target.
function pwCurIdx() {
  const n = PE.tl.length;
  if (PE.demo >= 0) { const f = pwPosF(); return f == null ? PE.demo : Math.min(n - 1, Math.floor(f + 0.02)); }
  if (!PE.running) return -1;
  if (PE.mode === 'tempo' && PE.clock != null) { const f = pwPosF(); if (f != null) return Math.max(0, Math.min(n - 1, Math.floor(f + 0.02))); }
  return PE.pos;
}
const PW_GRADE = { 'In tune': 'ok', 'Close': 'close', 'Skipped': 'pend' };
function pwPaint() {
  if (!PE.plan) return;
  const demo = PE.demo >= 0, idx = pwCurIdx(), v = pwEffective(PE.plan.inst);
  const grade = i => demo ? (i < idx ? 'ok' : 'pend') : (i < PE.pos && PE.grades[i] ? (PW_GRADE[PE.grades[i]] || 'bad') : 'pend');   // colour = how it was played, glow = where the clock is
  const cls = i => `${grade(i)}${i === idx ? ' cur' : ''}`;
  PW.paintIdx = idx;
  if (v === 'staff' && PW.eng) pgPaint(idx, grade);   // the engraved staff (piece-engrave.js)
  else if (v === 'staff') PW.nodes.forEach((g, i) => g.setAttribute('class', `nh ${cls(i)}`));
  if (v === 'tab' || v === 'roll') PW.hwNodes.forEach((g, i) => g && g.setAttribute('class', `hn ${cls(i)}`));
  if (v === 'staff' || v === 'board') {
    if (PW.neckDot) {
      const d = idx >= 0 && idx < PE.tl.length ? PW.dotAt[idx] : null;
      PW.neckDot.style.display = d ? '' : 'none';
      if (d) { PW.neckDot.setAttribute('transform', `translate(${d.x} ${d.y})`); PW.neckDot.querySelector('text').textContent = d.t; }
    } else {
      $('pzNeck').querySelectorAll('.pk.on').forEach(k => k.classList.remove('on'));
      const k = idx >= 0 && idx < PE.tl.length ? $('pzNeck').querySelector(`.pk[data-m="${PE.tl[idx].midi}"]`) : null; if (k) k.classList.add('on');
    }
    if (v === 'board') pwReadout(idx);
  }
}
// Time in beats (quarter notes from the first bar line); null = nothing is running.
//   Tempo-locked  the audio clock (negative during the count-in)      Hear piece  the audio clock from when it was scheduled
//   Wait          eases toward the target note with a short time constant (about 90 ms), whatever the frame rate
const pwLat = () => { const l = typeof ctx !== 'undefined' && ctx ? ctx.outputLatency : 0; return l > 0 && l < 0.5 ? l : 0; };   // what is heard is later than the audio clock by the output latency
function pwBeatF() {
  const tl = PE.tl, n = tl.length, beat = 60000 / PE.bpm, haveClock = typeof ctx !== 'undefined' && ctx, last = n ? pwBeatAt(tl, n - 1) : 0;
  if (PE.demo >= 0) return haveClock && PW.demoT0 != null ? Math.max(0, Math.min(last, ((ctx.currentTime - pwLat() - PW.demoT0) * 1000) / beat)) : pwBeatAt(tl, Math.max(0, Math.min(n - 1, PE.demo)));
  if (!PE.running || PE.pos >= n) { PW.glide = null; return null; }
  if (PE.mode === 'tempo' && PE.clock != null && haveClock) { PW.glide = null; return Math.min(last, ((ctx.currentTime - pwLat() - t0 - PE.clock) * 1000) / beat); }
  const now = performance.now(), dt = PW.glideT ? Math.min(100, now - PW.glideT) : 16; PW.glideT = now;
  if (PW.glide == null) PW.glide = PE.pos;
  PW.glide += (PE.pos - PW.glide) * (1 - Math.exp(-dt / 90)); if (Math.abs(PE.pos - PW.glide) < 0.003) PW.glide = PE.pos;
  return pwBeatOf(tl, PW.glide);
}
function pwPosF() { const b = pwBeatF(); return b == null ? null : pwPosOf(PE.tl, b); }   // the same time in notes: what the staff cursor and the colours use
function pwNowMs() {   // for the Tab and the Piano roll (eases back to the start when nothing runs)
  const beat = 60000 / PE.bpm, bf = pwBeatF();
  if (bf != null) { PW.hwCur = bf * beat; return Math.max(-2 * beat, PW.hwCur); }
  PW.hwCur += (0 - PW.hwCur) * 0.25; if (Math.abs(PW.hwCur) < 2) PW.hwCur = 0;
  return PW.hwCur;
}
const pwClock = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function pwProgress(nowMs) {   // the bar under the display: time through the piece in Tempo-locked mode and in Hear piece, notes played in Wait mode
  const n = PE.tl.length, beat = 60000 / PE.bpm, total = pwBeats() * beat, wait = PE.demo < 0 && PE.mode === 'wait';
  let frac = 0, txt;
  if (wait) { frac = n ? Math.min(1, (PE.running ? PE.pos : 0) / n) : 0; txt = `${PE.running ? Math.min(PE.pos, n) : 0} / ${n} notes`; }
  else { const t = Math.max(0, Math.min(total, nowMs == null ? 0 : nowMs)); frac = total ? t / total : 0; txt = `${pwClock(t)} / ${pwClock(total)}`; }
  $('pzProgFill').style.width = (frac * 100).toFixed(1) + '%'; $('pzTime').textContent = txt;
}
function pwFrame() {
  PW.raf = 0; if (!PE.plan || tab !== 'piece') return;
  const busy = PE.running || PE.demo >= 0;
  if (busy && pwCurIdx() !== PW.paintIdx) pwPaint();   // the glow moves to the next note on the very frame the cursor reaches it
  if (busy) { const b = 60000 / PE.bpm; pwProgress(PE.demo >= 0 ? (pwBeatF() || 0) * b : PE.mode === 'tempo' && PE.clock != null && typeof ctx !== 'undefined' && ctx ? (ctx.currentTime - pwLat() - t0 - PE.clock) * 1000 : null); }
  const v = pwEffective(PE.plan.inst);
  if (v === 'tab' || v === 'roll') {
    if (!PW.hw) return;
    const now = pwNowMs(), ppm = PW_PPB / (60000 / PE.bpm);
    PW.hw.setAttribute('transform', `translate(${(PW.playX - now * ppm).toFixed(1)} 0)`);
    if (busy || Math.abs(PW.hwCur) > 1) PW.raf = requestAnimationFrame(pwFrame);
    return;
  }
  if (v === 'staff' && PW.eng) { pgCursor(pwPosF()); if (busy) PW.raf = requestAnimationFrame(pwFrame); return; }
  const f = v === 'staff' ? pwPosF() : null, el = PW.curEl; if (!el || !PW.where.length) return;
  if (f == null) { el.style.display = 'none'; PW.bandEl.style.display = 'none'; return; }
  const fc = Math.max(0, f), i = Math.floor(fc), a = PW.where[i], b = PW.where[Math.min(PW.where.length - 1, i + 1)];
  if (!a) return;
  const x = b && b.r === a.r ? a.x + (b.x - a.x) * (fc - i) : a.x, g = PW.geo[a.r];
  if (PW.curRow !== a.r) { el.setAttribute('y1', g.top - 14); el.setAttribute('y2', g.bottom + 14); PW.bandEl.setAttribute('y', g.top - 14); PW.bandEl.setAttribute('height', g.bottom - g.top + 28); PW.curRow = a.r; }
  { const box = $('pzStaff'); if (PW.sw > box.clientWidth + 4 && busy) { const want = Math.max(0, Math.min(PW.sw - box.clientWidth, x - box.clientWidth * 0.4)); box.scrollLeft += (want - box.scrollLeft) * 0.2; } }
  el.style.display = ''; PW.bandEl.style.display = ''; el.setAttribute('transform', `translate(${x.toFixed(1)} 0)`); PW.bandEl.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
  PW.raf = requestAnimationFrame(pwFrame);   // keeps running while a run or a demo is on; pwRender restarts it
}

function pwRender() {
  const box = $('pzStaff'); if (!box || !PE.plan || tab !== 'piece') return;
  const p = PE.plan, inst = p.inst, v = pwEffective(inst), vis = $('pzVis');
  const W = Math.max(260, Math.floor(box.clientWidth && !box.hidden ? box.clientWidth : vis.clientWidth ? vis.clientWidth - 22 : 340));
  document.querySelectorAll('#pzView button').forEach(b => { const ok = b.dataset.v !== 'tab' || pwTabOk(inst), on = b.dataset.v === v; b.hidden = !ok; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); const narrow = vis.clientWidth < 440; if (b.dataset.v === 'board') b.textContent = inst === 'chromatic' ? 'Keys' : narrow ? 'Neck' : pwBowed(inst) ? 'Fingerboard' : 'Fretboard'; if (b.dataset.v === 'roll') b.textContent = narrow ? 'Roll' : 'Piano roll'; });
  $('pzVisTitle').textContent = p.title;
  $('pzShowW').hidden = v !== 'board' || inst === 'chromatic';
  const eng = v === 'staff' && PW.eng; $('pzStaff').hidden = v !== 'staff' || eng; $('pzEngBox').hidden = !eng; $('pzEngBtn').hidden = v !== 'staff'; $('pzEngBtn').classList.toggle('on', !!PW.eng); $('pzEngBtn').setAttribute('aria-pressed', String(!!PW.eng));
  $('pzTab').hidden = v !== 'tab'; $('pzNeck').hidden = !(v === 'board' || (v === 'staff' && PW.showNeck));
  { const nb = $('pzNeckBtn'); nb.hidden = v !== 'staff'; nb.textContent = inst === 'chromatic' ? '🎹' : inst === 'guitar' ? '🎸' : inst === 'ukulele' ? '🪕' : '🎻'; nb.classList.toggle('on', !!PW.showNeck); nb.setAttribute('aria-pressed', PW.showNeck ? 'true' : 'false'); } $('pzRoll').hidden = v !== 'roll';
  const base = [p.tl.map(n => n.midi).join(), inst, p.pc, p.pos, p.bow, p.timeSig.join('/'), W, p.key].join('|');
  if (base !== PW.key) { PW.key = base; pwPlan(); PW.staffKey = PW.neckKey = PW.hwKey = ''; }
  if (v === 'staff' && !eng && PW.staffKey !== base) { PW.staffKey = base; pwBuildStaff(W); }
  if (eng) pgRender(W);
  const nk = base + '|' + v + '|' + $('pzShow').value; if ((v === 'board' || (v === 'staff' && PW.showNeck)) && PW.neckKey !== nk) { PW.neckKey = nk; pwBuildNeck(W, v === 'board'); }
  const hk = base + '|' + v + '|' + PE.bpm; if ((v === 'tab' || v === 'roll') && PW.hwKey !== hk) { PW.hwKey = hk; (v === 'tab' ? pwBuildTab : pwBuildRoll)(W); PW.hwCur = 0; }
  pwPaint(); if (!PE.running && PE.demo < 0) pwProgress(0);
  if (!PW.raf && (PE.running || PE.demo >= 0 || ((v === 'tab' || v === 'roll') && PW.hw))) PW.raf = requestAnimationFrame(pwFrame);
  else if (v === 'staff' && !PE.running && PE.demo < 0 && PW.curEl) { PW.curEl.style.display = 'none'; PW.bandEl.style.display = 'none'; }
}
document.querySelectorAll('#pzView button').forEach(b => b.onclick = () => { PW.view = b.dataset.v; try { localStorage.setItem(PW_VIEW_KEY, PW.view); } catch {} pwRender(); });
$('pzShow').onchange = pwRender;
$('pzEngBtn').onclick = () => { PW.eng = !PW.eng; try { localStorage.setItem(PW_ENG_KEY, PW.eng ? '1' : '0'); } catch {} PW.key = ''; pwRender(); };
$('pzNeckBtn').onclick = () => { PW.showNeck = !PW.showNeck; try { localStorage.setItem(PW_NECK_KEY, PW.showNeck ? '1' : '0'); } catch {} pwRender(); };
if (window.ResizeObserver) new ResizeObserver(() => { if (tab === 'piece' && PE.plan) pwRender(); }).observe($('pzVis'));

// full screen: the player covers the screen (Esc leaves)
function pwFull(on) {
  const P = $('pzPlayer'); P.classList.toggle('fs', !!on); document.body.classList.toggle('fsrec', !!on); $('pzFs').setAttribute('aria-pressed', on ? 'true' : 'false');
  setTimeout(pwRender, 50);
}
$('pzFs').onclick = () => pwFull(!$('pzPlayer').classList.contains('fs'));
addEventListener('keydown', e => { if (e.key === 'Escape' && $('pzPlayer').classList.contains('fs')) pwFull(false); });
