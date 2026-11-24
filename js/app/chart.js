// Recorder chart: sheet view, falling view, zoom and scrolling.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// ----- the chart: a music staff with time running left → right -----
const cv = $('roll'), g2 = cv.getContext('2d'), GUT = 34;   // GUT = left gutter (clef)
const DIA = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6], SHARPPC = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const dia = m => Math.floor(m / 12) * 7 + DIA[((m % 12) + 12) % 12];   // diatonic step: C4 = 35, treble lines 37…45, bass lines 25…33
let drawReq = 0, lay = { rulerTop: 1e9 }, clefOK = null;
const requestDraw = () => { if (!drawReq) drawReq = requestAnimationFrame(drawRoll); };
function clefGlyphs() {
  if (clefOK == null) {
    try { const c = document.createElement('canvas').getContext('2d'); c.font = '40px serif'; const a = c.measureText('\u{1D11E}').width, b = c.measureText('\u{10FFFF}').width, d = c.measureText('\u{1D122}').width; clefOK = Math.abs(a - b) > 0.5 && Math.abs(d - b) > 0.5; } catch { clefOK = false; }
  }
  return clefOK;
}
const DUR_NAMES = [[4, 'whole'], [3, '1/2.'], [2, '1/2'], [1.5, '1/4.'], [1, '1/4'], [0.75, '1/8.'], [0.5, '1/8'], [0.25, '1/16'], [0.125, '1/32']];
function durName(beats) {
  if (beats < 0.09) return '';
  let best = DUR_NAMES[0], bd = 1e9; for (const d of DUR_NAMES) { const e = Math.abs(Math.log(beats / d[0])); if (e < bd) { bd = e; best = d; } }
  return best[1];
}
function accColor(e) { const a = Math.abs(e.cents), T = tol(); return a <= T ? '#34d399' : a <= 25 ? '#fbbf24' : '#fb7185'; }
function recColorOf(e) { return $('recColor').value === 'note' ? `hsl(${(((e.midi % 12) + 12) % 12) * 30},85%,62%)` : accColor(e); }
function liveEvent() {
  const c = seg.cur; if (!recording || !c) return null;
  const sm = seg.summary(c), hz = sm.hz;
  return { midi: sm.midi, note: midiName(sm.midi), hz, cents: sm.cents, start: c.start - recT0, dur: (c.last - c.start) * 1000, lvl: 20 * Math.log10(Math.max(1e-6, median(c.l))), live: true };
}
function niceStep(pps) { for (const s of [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * pps >= 76) return s; return 600; }
const fmtTick = (t, s) => s < 1 ? t.toFixed(1) + 's' : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
function rrect(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g2.beginPath(); g2.moveTo(x + r, y); g2.arcTo(x + w, y, x + w, y + h, r); g2.arcTo(x + w, y + h, x, y + h, r); g2.arcTo(x, y + h, x, y, r); g2.arcTo(x, y, x + w, y, r); g2.closePath(); }
function haloText(s, x, y, col, bg) { g2.lineWidth = 3.5; g2.strokeStyle = bg; g2.lineJoin = 'round'; g2.strokeText(s, x, y); g2.fillStyle = col; g2.fillText(s, x, y); }

const durText = (e, bpm) => {
  const s = e.dur / 1000;
  if (bpm > 0) { const d = durName(s * bpm / 60); if (d) return d; }
  return s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s';
};
function sizeCanvas(Wc, H) {
  const dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1)), pw = Math.round(Wc * dpr), ph = Math.round(H * dpr);
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  if (cv._h !== H) { cv.style.height = H + 'px'; cv._h = H; }
  g2.setTransform(dpr, 0, 0, dpr, 0, 0); g2.textBaseline = 'alphabetic';
}
function syncCtl(pos, max) {      // slider + follow button
  const sl = $('rvPos'); sl.disabled = max <= 0 || (view.mode === 'fall' && recording);
  sl.value = max > 0 ? Math.round(Math.max(0, Math.min(1, pos / max)) * 1000) : 0;
  $('rvLive').classList.toggle('on', view.follow);
}
// Display scale: Auto looks at this screen (phone / tablet / laptop) so notes and text stay comfortable to read; Large and Extra large add to that.
const uiK = () => { const w = innerWidth, base = w >= 1100 ? 1.15 : w >= 600 ? 1.1 : 1; return base * ({ large: 1.2, xl: 1.45 }[$('dispSize').value] || 1); };
$('dispSize').addEventListener('change', () => { try { localStorage.setItem('tuner-dispsize', $('dispSize').value); } catch {} requestDraw(); });
try { const d = localStorage.getItem('tuner-dispsize'); if (d) $('dispSize').value = d; } catch {}
const chromeH = () => { const q = c => ($('tab-rec').querySelector(c) || {}).offsetHeight || 0; return q('.tport') + q('.rbar') + 52; };   // controls kept in full screen
let showDur = false; try { showDur = localStorage.getItem('tuner-showdur') === '1'; } catch {}
$('msBtn').setAttribute('aria-pressed', showDur);
$('msBtn').onclick = () => { showDur = !showDur; $('msBtn').setAttribute('aria-pressed', showDur); try { localStorage.setItem('tuner-showdur', showDur ? '1' : '0'); } catch {} requestDraw(); };
const FS = () => $('tab-rec').classList.contains('fs');
function setFS(on) {
  $('tab-rec').classList.toggle('fs', on); document.body.classList.toggle('fsrec', on);
  $('fsBtn').textContent = on ? '✕' : '⛶'; $('fsBtn').title = on ? 'Exit full screen (Esc)' : 'Full screen'; $('fsBtn').setAttribute('aria-pressed', on);
  try { if (on && !document.fullscreenElement) $('tab-rec').requestFullscreen?.().catch(() => {}); else if (!on && document.fullscreenElement) document.exitFullscreen(); } catch {}
  requestDraw(); setTimeout(requestDraw, 120);
}
$('fsBtn').onclick = () => setFS(!FS());
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && FS()) setFS(false); });
addEventListener('keydown', e => { if (e.key === 'Escape' && FS()) setFS(false); });
addEventListener('resize', () => { if (FS()) requestDraw(); });
function drawRoll() {
  drawReq = 0;
  if (tab !== 'rec' || !cv.clientWidth) return;
  if (view.mode === 'fall') drawFall(); else drawSheet();
}

// ----- view 1: the music sheet (time runs left → right) -----
function drawSheet() {
  const Wc = cv.clientWidth;
  const BG = '#0c0f15', INK = '#eef2fb', TXT = '#f1f4fb', MUT = '#c9d2e6';
  if (!view.pps) view.pps = Math.max(8, (Wc - GUT) / 8);
  const live = liveEvent(), all = live ? events.concat([live]) : events, len = recLen(), bpm = bpmVal();
  const vw = (Wc - GUT) / view.pps;
  if (view.follow && (recording || pb.playing)) view.vs = (recording ? len : pbPos()) - vw * 0.78;
  const vsMax = Math.max(0, len - vw * 0.2); view.vs = Math.max(0, Math.min(vsMax, view.vs));

  // staff layout from the range of notes (adds a bass staff / ledger room only when needed)
  let minD = 1e9, maxD = -1e9; for (const e of all) { const d = dia(e.midi); if (d < minD) minD = d; if (d > maxD) maxD = d; }
  const none = !all.length; let showT = none || maxD >= 35; const showB = none || minD <= 33; if (!showT && !showB) showT = true;
  const topLine = showT ? 45 : 33, botLine = showB ? 25 : 37;
  const dTop = Math.max(topLine, none ? 0 : maxD + 4), dBot = Math.min(botLine, none ? 99 : minD - 3);
  const K = uiK(), bandH = sp => { const st = sp / 2, staffH = (dTop - dBot) * st; return 14 + staffH + 14 + 26 + 6 + (bpm > 0 ? 44 : 26); };
  let sp = Math.round(Math.min(26, Math.max(12, Wc / 46)) * K / 1.1 * (FS() ? 1.15 : 1));
  const maxH = FS() ? innerHeight - chromeH() : Math.max(300, innerHeight * 0.62); while (sp > 11 && bandH(sp) > maxH) sp--;
  const st = sp / 2, padTop = 14, labBot = 14, laneH = 26, rulerH = bpm > 0 ? 44 : 26;
  const staffH = (dTop - dBot) * st, laneTop = padTop + staffH + labBot, rulerTop = laneTop + laneH + 6, H = rulerTop + rulerH;
  lay = { rulerTop };
  const Y = d => padTop + (dTop - d) * st, tx = t => GUT + (t - view.vs) * view.pps;
  sizeCanvas(Wc, H); g2.fillStyle = BG; g2.fillRect(0, 0, Wc, H);

  // time grid + ruler
  const step = niceStep(view.pps), tA = Math.max(0, Math.floor(view.vs / step) * step);
  g2.font = '600 13px system-ui,sans-serif'; g2.textAlign = 'left';
  for (let t = tA; t <= view.vs + vw + step; t += step) {
    const x = tx(t); if (x < GUT - 1 || x > Wc) continue;
    g2.strokeStyle = 'rgba(255,255,255,.18)'; g2.lineWidth = 1; g2.beginPath(); g2.moveTo(x, padTop - 6); g2.lineTo(x, laneTop + laneH); g2.stroke();
    g2.strokeStyle = MUT; g2.beginPath(); g2.moveTo(x, rulerTop); g2.lineTo(x, rulerTop + 5); g2.stroke();
    g2.fillStyle = MUT; g2.fillText(fmtTick(t, step), x + 3, rulerTop + 17);
  }
  g2.strokeStyle = 'rgba(255,255,255,.3)'; g2.beginPath(); g2.moveTo(GUT, rulerTop + 0.5); g2.lineTo(Wc, rulerTop + 0.5); g2.stroke();
  if (bpm > 0) {
    const beat = 60 / bpm, bar = beat * 4;
    for (let b = Math.floor(view.vs / beat); b <= (view.vs + vw) / beat + 1; b++) {
      const x = tx(b * beat), isBar = b % 4 === 0; if (x < GUT || x > Wc || (!isBar && beat * view.pps < 14)) continue;
      g2.strokeStyle = isBar ? 'rgba(160,185,255,.5)' : 'rgba(160,185,255,.14)'; g2.lineWidth = isBar ? 1.3 : 1;
      g2.beginPath(); g2.moveTo(x, padTop - 6); g2.lineTo(x, laneTop + laneH); g2.stroke();
      if (isBar && bar * view.pps >= 46) { g2.fillStyle = '#9db4ff'; g2.font = '700 12px system-ui,sans-serif'; g2.fillText('bar ' + (b / 4 + 1), x + 3, rulerTop + 36); }
    }
  }

  // staff lines (thin, quiet) + a bracket at the left
  const staff = bot => { g2.strokeStyle = 'rgba(207,214,230,.55)'; g2.lineWidth = 1; for (let k = 0; k < 5; k++) { const y = Math.round(Y(bot + 2 * k)) + 0.5; g2.beginPath(); g2.moveTo(2, y); g2.lineTo(Wc - 2, y); g2.stroke(); } };
  if (showT) staff(37); if (showB) staff(25);
  g2.strokeStyle = 'rgba(207,214,230,.55)'; g2.lineWidth = 1.2; g2.beginPath(); g2.moveTo(2.5, Y(topLine)); g2.lineTo(2.5, Y(botLine)); g2.stroke();

  // notes (clipped so they slide under the clef gutter)
  g2.save(); g2.beginPath(); g2.rect(GUT, 0, Wc - GUT, H); g2.clip();
  const occ = [], items = [];                        // occupied rectangles (noteheads, labels) and the notes to label
  g2.lineCap = 'round';
  for (let i = 0; i < all.length; i++) {
    const e = all[i], xs = tx(e.start), w = e.dur / 1000 * view.pps, d = dia(e.midi), y = Y(d), col = recColorOf(e), sel = i === recSel && !e.live;
    if (xs + w < GUT - 40 || xs > Wc + 40) continue;
    // ledger lines
    g2.strokeStyle = 'rgba(207,214,230,.7)'; g2.lineWidth = 1.2;
    const led = v => { const yy = Math.round(Y(v)) + 0.5; g2.beginPath(); g2.moveTo(xs - sp * 0.9, yy); g2.lineTo(xs + sp * 0.9, yy); g2.stroke(); };
    for (let v = topLine + 2; v <= d; v += 2) led(v);
    for (let v = botLine - 2; v >= d; v -= 2) led(v);
    if (showT && showB && d === 35) led(35);
    // duration bar (thin, translucent) with the pitch drift inside it
    const bh = sp * 0.42;
    if (w > 3) {
      rrect(xs, y - bh / 2, w, bh, bh / 2); g2.globalAlpha = 0.32; g2.fillStyle = col; g2.fill(); g2.globalAlpha = 1;
      if (e.pts && e.pts.length > 2 && w > 40) {
        g2.beginPath(); e.pts.forEach((p, k) => { const px = xs + p[0] / 1000 * view.pps, py = y - Math.max(-1.1, Math.min(1.1, p[1] / 50)) * sp * (e.vib ? 0.9 : 0.6); k ? g2.lineTo(px, py) : g2.moveTo(px, py); });
        g2.strokeStyle = 'rgba(255,255,255,.7)'; g2.lineWidth = 1.1; g2.stroke();
      }
    }
    // notehead (+ sharp)
    g2.save(); g2.translate(xs, y); g2.rotate(-0.35); g2.beginPath(); g2.ellipse(0, 0, sp * 0.62, sp * 0.44, 0, 0, 7); g2.restore();
    g2.fillStyle = col; g2.fill(); g2.lineWidth = sel || e.live ? 2 : 1; g2.strokeStyle = sel || e.live ? '#fff' : BG; g2.stroke();
    if (SHARPPC[((e.midi % 12) + 12) % 12]) { g2.font = `700 ${Math.round(sp * 1.3)}px system-ui,sans-serif`; g2.textAlign = 'right'; haloText('♯', xs - sp * 0.8, y + sp * 0.45, TXT, BG); }
    // labels are placed after the loop, when every notehead is known
    occ.push([xs - sp * 0.7, y - sp * 0.55, xs + sp * 0.7, y + sp * 0.55]);
    if (SHARPPC[((e.midi % 12) + 12) % 12]) occ.push([xs - sp * 1.5, y - sp * 0.4, xs - sp * 0.6, y + sp * 0.7]);
    items.push({ e, xs, y, sel });
    // volume lane
    const lh = Math.max(0.1, Math.min(1, ((e.lvl ?? -40) + 55) / 50)) * (laneH - 6);
    g2.globalAlpha = 0.75; g2.fillStyle = col; g2.fillRect(xs, laneTop + laneH - 2 - lh, Math.max(2, w), lh); g2.globalAlpha = 1;
  }
  // Labels. Note names first (selected note first), at the nearest free spot above the note;
  // then cents below it. A label is only drawn where it touches no notehead and no other label.
  const hit = r => occ.some(o => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]);
  const order = items.map((it, k) => k).sort((a, b) => (items[b].sel - items[a].sel) || (a - b));
  g2.textAlign = 'center';
  const fh1 = sp + 2, fh2 = sp * 0.92;
  const names = [];
  for (const k of order) {
    const it = items[k]; g2.font = `700 ${fh1}px system-ui,sans-serif`;
    const t = nm(it.e.note), tw = g2.measureText(t).width;
    for (let r = 0; r < 4; r++) {
      const by = it.y - sp * 0.85 - r * (fh1 * 0.95);
      const rc = [it.xs - tw / 2 - 2, by - fh1 * 0.8, it.xs + tw / 2 + 2, by + fh1 * 0.2];
      if (it.sel && r === 3 || !hit(rc)) { occ.push(rc); names.push([t, it.xs, by, fh1]); break; }
    }
  }
  const small = [];
  for (const k of order) {
    const it = items[k], e = it.e; g2.font = `600 ${fh2}px system-ui,sans-serif`;
    if (!it.sel && Math.round(e.cents) === 0 && !(bpm > 0)) continue;   // a perfect note needs no number; its green colour says it
    let t = fmtC(e.cents); if (bpm > 0) { const dn = durName(e.dur / 1000 * bpm / 60); if (dn) t += ' · ' + dn; }
    const tw = g2.measureText(t).width;
    for (let r = 0; r < 2; r++) {
      const by = it.y + sp * 1.55 + r * fh2 * 1.05;
      const rc = [it.xs - tw / 2 - 2, by - fh2 * 0.8, it.xs + tw / 2 + 2, by + fh2 * 0.2];
      if (it.sel && r === 1 || !hit(rc)) { occ.push(rc); small.push([t, it.xs, by, fh2, accColor(e)]); break; }
    }
  }
  for (const [t, x, by, fh] of names) { g2.font = `700 ${fh}px system-ui,sans-serif`; haloText(t, x, by, TXT, BG); }
  for (const [t, x, by, fh, c] of small) { g2.font = `600 ${fh}px system-ui,sans-serif`; haloText(t, x, by, c, BG); }
  g2.restore();

  // lane frame + left gutter (clefs)
  g2.strokeStyle = 'rgba(255,255,255,.18)'; g2.lineWidth = 1; g2.beginPath(); g2.moveTo(GUT, laneTop + laneH - 1.5); g2.lineTo(Wc, laneTop + laneH - 1.5); g2.stroke();
  g2.fillStyle = MUT; g2.font = '600 12px system-ui,sans-serif'; g2.textAlign = 'left'; g2.fillText('vol', 5, laneTop + laneH - 5);
  g2.fillStyle = 'rgba(207,214,230,.85)'; g2.textAlign = 'left';
  const cg = clefGlyphs(), FF = "'Segoe UI Symbol','Noto Music','Noto Sans Symbols 2','Apple Symbols',serif";
  if (showT) { if (cg) { g2.font = `${Math.round(sp * 3.1)}px ${FF}`; g2.fillText('\u{1D11E}', 5, Y(37) + 0.1 * sp); } else { g2.font = `700 ${sp * 2.4}px Georgia,serif`; g2.fillText('G', 8, Y(39) + sp * 0.8); } }
  if (showB) { if (cg) { g2.font = `${Math.round(sp * 2.5)}px ${FF}`; g2.fillText('\u{1D122}', 5, Y(31) + 0.5 * sp); } else { g2.font = `700 ${sp * 2.4}px Georgia,serif`; g2.fillText('F', 8, Y(29) + sp * 0.7); } }

  // playhead / live edge
  if (recording) { const x = tx(len); if (x >= GUT && x <= Wc) { g2.strokeStyle = '#ef4444'; g2.lineWidth = 2; g2.beginPath(); g2.moveTo(x, padTop - 6); g2.lineTo(x, rulerTop + 6); g2.stroke(); g2.fillStyle = '#ef4444'; g2.beginPath(); g2.arc(x, rulerTop + 9, 3.5, 0, 7); g2.fill(); } }
  else if (hasRec()) {
    const x = tx(pbPos());
    if (x >= GUT && x <= Wc) { g2.strokeStyle = '#22d3ee'; g2.lineWidth = 2; g2.beginPath(); g2.moveTo(x, padTop - 6); g2.lineTo(x, rulerTop); g2.stroke(); g2.fillStyle = '#22d3ee'; g2.beginPath(); g2.moveTo(x - 6, rulerTop); g2.lineTo(x + 6, rulerTop); g2.lineTo(x, rulerTop + 9); g2.fill(); }
  }
  syncCtl(view.vs, vsMax);
}

// ----- view 2: falling notes (one lane per note that was played; time runs top → bottom) -----
function drawFall() {
  const K = uiK(), Wc = cv.clientWidth, BG = '#0c0f15', TXT = '#f1f4fb', MUT = '#c9d2e6', hdr = Math.round(32 * K);
  const live = liveEvent(), all = live ? events.concat([live]) : events, len = recLen(), bpm = bpmVal();
  const H = FS() ? Math.max(200, innerHeight - chromeH()) : Math.round(Math.min(760, Math.max(320, Math.min(Wc * 0.9, innerHeight * 0.62)))) ;
  sizeCanvas(Wc, H); g2.fillStyle = BG; g2.fillRect(0, 0, Wc, H);
  const now = recording ? len : pbPos(), fps = view.fps;
  const nowY = hdr + (recording ? 20 : Math.round((H - hdr) * 0.4));       // while recording the newest notes sit at the top and drop away
  const Y = t => nowY - (t - now) * fps;                                    // later = higher up, earlier = lower
  // Only the lanes around the note being played are shown (default: that note and 4 either side), so the current notes are big and easy to read.
  // Zoom out shows more lanes, zoom in fewer. The window only moves when the active note nears its edge, so lanes do not jump about.
  const allUsed = [...new Set(all.map(e => e.midi))].sort((a, b) => a - b);
  const span = Math.round(view.spanF), W2 = Math.min(allUsed.length, 2 * span + 1);
  let actMidi = null, actStart = -1; for (const e of all) if (e.start <= now + 0.001 && e.start >= actStart) { actMidi = e.midi; actStart = e.start; }
  if (view.fallMid == null || !allUsed.length) view.fallMid = actMidi != null ? actMidi : allUsed[0];
  const idxNear = m => { let b = 0; allUsed.forEach((u, i) => { if (Math.abs(u - m) < Math.abs(allUsed[b] - m)) b = i; }); return b; };
  let lo = 0;
  if (allUsed.length) {
    lo = Math.max(0, Math.min(allUsed.length - W2, idxNear(view.fallMid) - span));
    if (actMidi != null && W2 < allUsed.length) {
      const ai = allUsed.indexOf(actMidi), nearEdge = (ai < lo + 1 && lo > 0) || (ai > lo + W2 - 2 && lo + W2 < allUsed.length);
      if (nearEdge || ai < lo || ai >= lo + W2) { view.fallMid = actMidi; lo = Math.max(0, Math.min(allUsed.length - W2, ai - span)); }
    }
  }
  const used = allUsed.slice(lo, lo + W2), n = Math.max(1, used.length), laneW = Wc / n;
  const laneOf = new Map(used.map((m, i) => [m, i]));
  lay = { rulerTop: 1e9, fall: { used, laneW, hdr, nowY, now, fps } };

  // lanes + time grid
  for (let i = 0; i < used.length; i++) {
    if (i % 2) { g2.fillStyle = 'rgba(255,255,255,.05)'; g2.fillRect(i * laneW, hdr, laneW, H - hdr); }
    if (i) { g2.fillStyle = 'rgba(255,255,255,.12)'; g2.fillRect(Math.round(i * laneW), hdr, 1, H - hdr); }
  }
  let step = 0.1; for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120]) { step = s; if (s * fps >= 46) break; }
  const tTop = now + (nowY - hdr) / fps, tBot = now - (H - nowY) / fps;
  g2.font = '600 12px system-ui,sans-serif'; g2.textAlign = 'left';
  for (let t = Math.max(0, Math.ceil(tBot / step) * step); t <= tTop; t += step) {
    const y = Math.round(Y(t)) + 0.5; if (y < hdr || y > H) continue;
    g2.fillStyle = 'rgba(255,255,255,.12)'; g2.fillRect(0, y, Wc, 1);
    g2.fillStyle = MUT; g2.fillText(fmtTick(t, step), 4, y - 3);
  }

  // notes
  g2.save(); g2.beginPath(); g2.rect(0, hdr, Wc, H - hdr); g2.clip();
  const bw = Math.min(laneW - 6, Math.round(110 * K)), act = new Set(); g2.textAlign = 'center';
  for (let i = 0; i < all.length; i++) {
    const e = all[i], lane = laneOf.get(e.midi), end = e.start + e.dur / 1000, yTop = Y(end), yBot = Y(e.start);
    if (lane == null || yBot < hdr - 4 || yTop > H + 4) continue;
    const h = Math.max(5, yBot - yTop), top = yBot - h, x = lane * laneW + (laneW - bw) / 2, past = end < now - 0.001;
    const isAct = e.start <= now && end >= now - 0.001, sel = i === recSel && !e.live, col = recColorOf(e);
    if (isAct) act.add(lane);
    g2.globalAlpha = past ? 0.5 : 1; rrect(x, top, bw, h, Math.min(7, h / 2)); g2.fillStyle = col; g2.fill();
    if (isAct || sel) { g2.lineWidth = 2; g2.strokeStyle = '#fff'; g2.stroke(); } else { g2.lineWidth = 1; g2.strokeStyle = 'rgba(255,255,255,.28)'; g2.stroke(); }
    if (e.vib && h > 22) {                                           // vibrato: a small wave down the bar (one note, not many)
      const amp = Math.min(bw * 0.28, 2 + e.vib.width / 7), per = Math.max(7, fps / e.vib.rate), y0 = Math.max(top + 3, hdr); g2.beginPath();
      for (let yy = y0; yy <= Math.min(top + h - 3, H); yy += 2) { const px = x + bw / 2 + Math.sin((yy - top) / per * 6.2832) * amp; yy === y0 ? g2.moveTo(px, yy) : g2.lineTo(px, yy); }
      g2.strokeStyle = 'rgba(255,255,255,.75)'; g2.lineWidth = 1.6; g2.stroke();
    }
    g2.globalAlpha = past ? 0.85 : 1;
    const fs = Math.max(Math.round(12 * K), Math.min(Math.round(22 * K), Math.round(bw * 0.3))), lab = (t, yy, f) => { g2.font = `700 ${f}px system-ui,sans-serif`; haloText(t, x + bw / 2, yy, '#ffffff', 'rgba(8,10,16,.85)'); };
    if (h >= 34 && showDur) { lab(nm(e.note), top + h / 2 + 1, fs); lab(durText(e, bpm), top + h / 2 + fs + 2, Math.max(11, fs - 2)); }
    else if (h >= 15) lab(nm(e.note), top + h / 2 + fs * 0.35, fs);
    else if (h >= 10) lab(nm(e.note), top + h / 2 + 3, 11);
    g2.globalAlpha = 1;
  }
  g2.restore();

  // lane header: the note names, lit while that note sounds
  g2.fillStyle = '#111620'; g2.fillRect(0, 0, Wc, hdr); g2.fillStyle = 'rgba(255,255,255,.08)'; g2.fillRect(0, hdr - 1, Wc, 1);
  const hf = Math.max(Math.round(12 * K), Math.min(Math.round(20 * K), Math.round(laneW * 0.34)));
  for (let i = 0; i < used.length; i++) {
    const lit = act.has(i), cx = i * laneW + laneW / 2, c = $('recColor').value === 'note' ? `hsl(${(((used[i] % 12) + 12) % 12) * 30},85%,62%)` : '#6c8dff';
    if (lit) { rrect(i * laneW + 3, 4, laneW - 6, hdr - 9, 7); g2.fillStyle = c; g2.fill(); }
    g2.font = `700 ${hf}px system-ui,sans-serif`; g2.fillStyle = lit ? '#05070b' : TXT; g2.fillText(nm(midiName(used[i])), cx, hdr / 2 + hf * 0.35, laneW - 4);
  }

  // the "now" line
  const ncol = recording ? '#ef4444' : '#22d3ee';
  g2.fillStyle = ncol; g2.fillRect(0, nowY - 1, Wc, 2);
  g2.beginPath(); g2.moveTo(0, nowY - 6); g2.lineTo(8, nowY); g2.lineTo(0, nowY + 6); g2.fill();
  syncCtl(now, len);
}

// ----- moving around the chart: drag, pinch, wheel, slider, buttons -----
function zoomBy(f, cx) {
  if (view.mode === 'fall') { view.fps = Math.max(25, Math.min(600, view.fps * f)); view.spanF = Math.max(2, Math.min(60, view.spanF / Math.pow(f, 1.2))); requestDraw(); return; }   // zoom out also shows more lanes
  const Wc = cv.clientWidth, c = cx == null ? GUT + (Wc - GUT) / 2 : cx, t = view.vs + (c - GUT) / view.pps;
  view.pps = Math.max(4, Math.min(700, view.pps * f)); view.vs = t - (c - GUT) / view.pps; requestDraw();
}
const ptrs = new Map();
cv.addEventListener('pointerdown', e => {
  const r = cv.getBoundingClientRect(), p = { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now(), moved: false }; p.x0 = p.x; p.y0 = p.y;
  ptrs.set(e.pointerId, p); try { cv.setPointerCapture(e.pointerId); } catch {}
});
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (ptrs.size === 2) {
    const o = [...ptrs.entries()].find(([id]) => id !== e.pointerId)[1], fl = view.mode === 'fall', d0 = Math.abs(fl ? p.y - o.y : p.x - o.x), d1 = Math.abs(fl ? y - o.y : x - o.x);
    if (d0 > 20 && d1 > 20) zoomBy(d1 / d0, (x + o.x) / 2);
    p.moved = o.moved = true;
  } else if (ptrs.size === 1 && view.mode === 'fall') {
    if (!recording && (Math.abs(y - p.y0) > 6 || p.moved)) { p.moved = true; if (pb.playing) pbStop(); pb.pos = Math.max(0, Math.min(recLen(), pb.pos + (y - p.y) / view.fps)); cv.classList.add('drag'); recUi(); requestDraw(); }
  } else if (ptrs.size === 1) {
    if (Math.abs(x - p.x0) > 6 || p.moved) { p.moved = true; view.follow = false; view.vs -= (x - p.x) / view.pps; cv.classList.add('drag'); requestDraw(); }
  }
  p.x = x; p.y = y;
});
function ptrEnd(e) {
  const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId); cv.classList.remove('drag');
  if (p && !p.moved && ptrs.size === 0 && e.type === 'pointerup' && performance.now() - p.t < 700) tapChart(p.x, p.y);
}
cv.addEventListener('pointerup', ptrEnd); cv.addEventListener('pointercancel', ptrEnd);
cv.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - cv.getBoundingClientRect().left); }
  else if (view.mode === 'fall') { if (recording) return; e.preventDefault(); if (pb.playing) pbStop(); pb.pos = Math.max(0, Math.min(recLen(), pb.pos - e.deltaY / view.fps)); recUi(); requestDraw(); }
  else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) { e.preventDefault(); view.follow = false; view.vs += (e.deltaX || e.deltaY) / view.pps; requestDraw(); }
}, { passive: false });
function tapChart(x, y) {
  const F = lay.fall;
  if (F && view.mode === 'fall') {
    if (y < F.hdr || !F.used.length) return;
    const midi = F.used[Math.min(F.used.length - 1, Math.floor(x / F.laneW))], t = F.now + (F.nowY - y) / F.fps; let bi = -1, bd = 1e9;
    events.forEach((e, i) => { if (e.midi !== midi) return; const d = t < e.start ? e.start - t : t > e.start + e.dur / 1000 ? t - e.start - e.dur / 1000 : 0; if (d * F.fps < 14 && d < bd) { bd = d; bi = i; } });
    selectNote(bi, true); return;
  }
  if (y >= lay.rulerTop - 4) { if (hasRec() && !recording) { view.follow = false; pbSeek(view.vs + (x - GUT) / view.pps); } return; }
  let bi = -1, bd = 1e9;
  events.forEach((e, i) => {
    const xs = GUT + (e.start - view.vs) * view.pps, xe = xs + e.dur / 1000 * view.pps;
    if (x >= xs - 12 && x <= xe + 12) { const d = Math.abs(x - Math.min(Math.max(x, xs), xe)) + Math.abs(x - xs) * 0.001; if (d < bd) { bd = d; bi = i; } }
  });
  selectNote(bi, true);
}
function selectNote(i, hear) {
  recSel = i;
  document.querySelectorAll('#rows tr.sel').forEach(r => r.classList.remove('sel'));
  const info = $('noteInfo');
  if (i < 0 || !events[i]) { recSel = -1; info.textContent = infoHint(); info.className = 'mut'; requestDraw(); return; }
  info.className = '';
  const e = events[i], row = document.querySelector(`#rows tr[data-i="${i}"]`); if (row) row.classList.add('sel');
  const verdict = Math.abs(e.cents) <= tol() ? 'in tune' : e.cents > 0 ? 'sharp' : 'flat', bpm = bpmVal(), dn = bpm > 0 ? durName(e.dur / 1000 * bpm / 60) : '';
  info.innerHTML = `<b>${nm(e.note)}</b> · ${e.hz.toFixed(1)} Hz · <span class="${centsCls(e.cents)}">${fmtC(e.cents)} (${verdict})</span> · at ${e.start.toFixed(2)} s · held ${(e.dur / 1000).toFixed(2)} s${dn ? ' (' + dn + ' note)' : ''} · volume ${Math.round(e.lvl)} dB`;
  if (!recording) { if (pb.playing) pbSeek(e.start); else { pb.pos = e.start; recUi(); if (hear) playTone(e.hz, Math.min(1.5, e.dur / 1000 + 0.15), 'triangle', 0.25); } }
  requestDraw();
}
$('rows').addEventListener('click', e => {
  const tr = e.target.closest('tr'); if (!tr) return; const i = +tr.dataset.i, ev = events[i]; if (!ev) return;
  view.follow = false; view.vs = ev.start - (cv.clientWidth - GUT) / view.pps / 2; selectNote(i, true);
});
$('rvStart').onclick = () => { view.follow = false; view.vs = 0; if (hasRec() && !recording) pbSeek(0); else requestDraw(); };
$('rvIn').onclick = () => zoomBy(1.5); $('rvOut').onclick = () => zoomBy(1 / 1.5);
$('rvFit').onclick = () => { if (view.mode === 'fall') { view.spanF = 60; if (hasRec()) { const A = cv.clientHeight - 32; view.fps = Math.max(25, Math.min(600, A / Math.max(1, recLen()))); pbSeek(recLen() * 0.6); } return; } view.follow = false; view.vs = 0; view.pps = Math.max(4, (cv.clientWidth - GUT - 24) / Math.max(2, recLen())); requestDraw(); };
$('rvLive').onclick = () => { view.follow = !view.follow; requestDraw(); };
$('rvPos').oninput = () => { if (view.mode === 'fall') { if (!recording) pbSeek(+$('rvPos').value / 1000 * recLen()); return; } const Wc = cv.clientWidth, vsMax = Math.max(0, recLen() - (Wc - GUT) / view.pps * 0.2); view.follow = false; view.vs = +$('rvPos').value / 1000 * vsMax; requestDraw(); };
window.addEventListener('resize', requestDraw);
const MODE_DESC = {
  auto: ['Listens to the room and the music, then picks the best mode by itself.', 'Switches live between Fast, Standard, Noisy room and Soft as the sound changes.'],
  fast: ['Follows rapid note changes, even notes as short as 30 ms.', 'Best for violin runs and quick melodies. Occasionally adds a stray note.'],
  normal: ['Balanced accuracy for music at an ordinary pace.', "The best starting point if you're unsure."],
  relaxed: ['Listens closely for faint or delicate notes.', 'Best in a silent room, since it will also pick up background sound.'],
  strict: ['Accepts only clear, confident notes and ignores everything else.', 'Best with fans, traffic or other people nearby. Very short notes may be skipped.'],
};
let autoShown = '';
function autoUi() { const k = autoM.mode + autoM.why; if (k === autoShown) return; autoShown = k; modeDesc(); }
function modeDesc() {
  const v = $('recMode').value, d = MODE_DESC[v] || MODE_DESC.fast;
  $('recModeDesc').innerHTML = v === 'auto' ? `Now using: <b>${REC_NAMES[autoM.mode] || autoM.mode}</b> (${autoM.why})` : `${d[0]} <i>${d[1]}</i>` + (v === 'fast' && +$('fmin').value < 80 ? '<br>Tip: for violin, choose the Violin range in Settings → Detection → Pitch range. It makes fast passages more accurate.' : '');
}
$('recMode').addEventListener('change', modeDesc); $('fmin').addEventListener('input', modeDesc); $('fmin').addEventListener('change', modeDesc); modeDesc();
function setView(m) {
  view.mode = m; $('tab-rec').dataset.view = m; cv.classList.toggle('fall', m === 'fall');
  for (const [id, k] of [['vwSheet', 'sheet'], ['vwFall', 'fall']]) { $(id).classList.toggle('on', m === k); $(id).setAttribute('aria-pressed', m === k); }
  if (recSel < 0) $('noteInfo').textContent = infoHint();
  try { localStorage.setItem('tuner-recview', m); } catch {}
  requestDraw();
}
$('vwSheet').onclick = () => setView('sheet'); $('vwFall').onclick = () => setView('fall');
try { if (localStorage.getItem('tuner-recview') === 'fall') setView('fall'); else $('noteInfo').textContent = infoHint(); } catch { $('noteInfo').textContent = infoHint(); }
['recColor', 'recBpm'].forEach(id => $(id).addEventListener('input', () => { renderLegend(); requestDraw(); }));
$('tol').addEventListener('input', () => { renderLegend(); updateStats(); requestDraw(); });
const RP_KEY = 'tuner-recprefs-v2', RP_IDS = ['recMode', 'recColor', 'recBpm'];   // only these three options are remembered, never any recording
try { const o = JSON.parse(localStorage.getItem(RP_KEY)); if (o) RP_IDS.forEach(id => { if (o[id] != null) $(id).value = o[id]; }); } catch {}
modeDesc(); engUi(); if (engine === 'det') prefetchBP();
RP_IDS.forEach(id => $(id).addEventListener('change', () => { const o = {}; RP_IDS.forEach(k => o[k] = $(k).value); try { localStorage.setItem(RP_KEY, JSON.stringify(o)); } catch {} }));

