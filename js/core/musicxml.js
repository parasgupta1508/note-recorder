// MusicXML reader (score-partwise, plain .musicxml/.xml and compressed .mxl). Pure logic: no DOM, no DOMParser, so Node tests load this same file.
// parseMusicXml(text) -> { title, parts: [{ id, name, notes: [{ midi, start (s), dur (ms), q (quarter notes from the start), bar }] }], bpm, timeSig }
// Reads sounding pitch (honours <transpose>), ties, chords, rests, backup/forward and tempo marks. Repeats are not expanded and grace notes are skipped.

// ---- a small XML reader: elements, attributes, text. Enough for MusicXML; no entities beyond the five basic ones.
function xmlParse(src) {
  const root = { name: '#root', attrs: {}, kids: [], text: '' }, stack = [root];
  const dec = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  src = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (m, t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g; let m;
  while ((m = re.exec(src))) {
    if (m[5] !== undefined) { stack[stack.length - 1].text += dec(m[5]); continue; }
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {}; String(m[3]).replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (a, k, v1, v2) => { attrs[k] = dec(v1 !== undefined ? v1 : v2); return ''; });
    const el = { name: m[2], attrs, kids: [], text: '' }; stack[stack.length - 1].kids.push(el); if (!m[4]) stack.push(el);
  }
  return root;
}
const xKids = (e, n) => e.kids.filter(k => k.name === n), xKid = (e, n) => e.kids.find(k => k.name === n), xText = (e, n) => { const k = xKid(e, n); return k ? k.text.trim() : ''; };

const XML_STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function parseMusicXml(text) {
  const doc = xmlParse(text), score = xKid(doc, 'score-partwise');
  if (!score) throw new Error(xKid(doc, 'score-timewise') ? 'This MusicXML is time-wise; export it as part-wise (the usual kind) and try again.' : 'This is not a MusicXML score.');
  const names = {}; const pl = xKid(score, 'part-list');
  if (pl) for (const sp of xKids(pl, 'score-part')) names[sp.attrs.id] = xText(sp, 'part-name') || xText(sp, 'part-abbreviation') || sp.attrs.id;
  const title = xText(xKid(score, 'work') || { kids: [] }, 'work-title') || xText(score, 'movement-title') || '';
  const tempoEv = []; let timeSig = null;                       // tempo marks as { q: quarter position, bpm }
  const raw = [];
  for (const part of xKids(score, 'part')) {
    let div = 1, cur = 0, transpose = 0, measureNo = 0; const notes = [], open = new Map();   // positions are in divisions
    let barStart = 0;
    for (const meas of xKids(part, 'measure')) {
      measureNo++; barStart = cur; let maxCur = cur, last = null; const bar = measureNo;
      for (const el of meas.kids) {
        if (el.name === 'attributes') {
          const d = xText(el, 'divisions'); if (d) div = Math.max(1, +d);
          const tr = xKid(el, 'transpose'); if (tr) transpose = (+xText(tr, 'chromatic') || 0) + 12 * (+xText(tr, 'octave-change') || 0);
          const ts = xKid(el, 'time'); if (ts && !timeSig) timeSig = [+xText(ts, 'beats') || 4, +xText(ts, 'beat-type') || 4];
        } else if (el.name === 'direction') {
          const snd = xKid(el, 'sound'); let bpm = snd && snd.attrs.tempo ? +snd.attrs.tempo : 0;
          if (!bpm) { const met = xKid(xKid(el, 'direction-type') || { kids: [] }, 'metronome'); if (met) { const pm = +xText(met, 'per-minute'), unit = xText(met, 'beat-unit'); if (pm) bpm = pm * ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[unit] || 1) * (xKid(met, 'beat-unit-dot') ? 1.5 : 1); } }
          if (bpm > 0) tempoEv.push({ q: cur / div, bpm });
        } else if (el.name === 'sound' && el.attrs.tempo) { tempoEv.push({ q: cur / div, bpm: +el.attrs.tempo }); }
        else if (el.name === 'backup') { cur -= +xText(el, 'duration') || 0; }
        else if (el.name === 'forward') { cur += +xText(el, 'duration') || 0; }
        else if (el.name === 'note') {
          if (xKid(el, 'grace')) continue;
          const dur = +xText(el, 'duration') || 0, isChord = !!xKid(el, 'chord'), at = isChord && last != null ? last : cur;
          const pitch = xKid(el, 'pitch');
          if (pitch && !xKid(el, 'rest')) {
            const alter = +xText(pitch, 'alter') || 0, midi = 12 * ((+xText(pitch, 'octave')) + 1) + XML_STEP[xText(pitch, 'step')] + alter + transpose;
            const ties = xKids(el, 'tie').map(t => t.attrs.type), key = midi, q = at / div;
            if (ties.includes('stop') && open.has(key)) { const n = open.get(key); n.q2 = q + dur / div; if (!ties.includes('start')) open.delete(key); }
            else { const n = { midi, q, q2: q + dur / div, bar }; notes.push(n); if (ties.includes('start')) open.set(key, n); }
          }
          if (!isChord) { last = cur; cur += dur; }
        }
        maxCur = Math.max(maxCur, cur);
      }
      cur = Math.max(cur, maxCur);
    }
    raw.push({ id: part.attrs.id, name: names[part.attrs.id] || part.attrs.id, notes });
  }
  // quarter positions -> seconds through the tempo map (first mark wins at the same position; default 120)
  tempoEv.sort((a, b) => a.q - b.q); const map = [{ q: 0, bpm: tempoEv.length && tempoEv[0].q === 0 ? tempoEv[0].bpm : 120 }];
  for (const t of tempoEv) if (t.q > 0 && t.bpm !== map[map.length - 1].bpm) map.push(t);
  const secs = q => { let s = 0, lq = 0, bpm = map[0].bpm; for (const t of map) { if (t.q > q) break; s += (t.q - lq) * 60 / bpm; lq = t.q; bpm = t.bpm; } return s + (q - lq) * 60 / bpm; };
  const parts = raw.map(p => ({ id: p.id, name: p.name, notes: p.notes.filter(n => n.midi >= 0 && n.midi <= 127).map(n => ({ midi: n.midi, start: secs(n.q), dur: (secs(n.q2) - secs(n.q)) * 1000, q: n.q, bar: n.bar })).sort((a, b) => a.start - b.start || a.midi - b.midi) })).filter(p => p.notes.length);
  if (!parts.length) throw new Error('No notes were found in this score.');
  return { title, parts, bpm: map[0].bpm, timeSig: timeSig || [4, 4] };
}

// ---- .mxl is a zip. zipEntries lists the files; the caller inflates them (DecompressionStream in the browser, zlib in Node).
function zipEntries(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), u16 = p => d[p] | (d[p + 1] << 8), u32 = p => (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24)) >>> 0;
  let e = d.length - 22; while (e >= 0 && u32(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('This is not a compressed MusicXML (.mxl) file.');
  const n = u16(e + 10), out = []; let p = u32(e + 16);
  for (let i = 0; i < n && u32(p) === 0x02014b50; i++) {
    const method = u16(p + 10), csize = u32(p + 20), nl = u16(p + 28), xl = u16(p + 30), cl = u16(p + 32), off = u32(p + 42), name = String.fromCharCode(...d.subarray(p + 46, p + 46 + nl));
    const lnl = u16(off + 26), lxl = u16(off + 28), start = off + 30 + lnl + lxl;
    out.push({ name, method, data: d.subarray(start, start + csize) }); p += 46 + nl + xl + cl;
  }
  return out;
}
// bytes of an .mxl -> MusicXML text. inflate(Uint8Array) -> Uint8Array | Promise (raw deflate).
async function mxlToXml(bytes, inflate) {
  const files = zipEntries(bytes), dec = async f => { const b = f.method === 0 ? f.data : await inflate(f.data); return new TextDecoder('utf-8').decode(b); };
  const cont = files.find(f => /(^|\/)META-INF\/container\.xml$/i.test(f.name)); let root = null;
  if (cont) { const m = /full-path\s*=\s*"([^"]+)"/.exec(await dec(cont)); if (m) root = files.find(f => f.name === m[1]); }
  root = root || files.find(f => /\.(musicxml|xml)$/i.test(f.name) && !/META-INF/i.test(f.name));
  if (!root) throw new Error('No score was found inside this .mxl file.');
  return dec(root);
}
