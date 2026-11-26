// Pieces: what the Add-a-piece screen produces and the library stores. Pure logic: no DOM.
//   Piece = { id, title, instrument, source: 'midi' | 'musicxml', exact: true, bpm, timeSig: [n, d], parts: [{ id, name, notes: [{ midi, start (s), dur (ms), ... }] }], part: index of the chosen part, created }
// Exact sources (MIDI, MusicXML) need no engine and no Draft step: the notes are the score.

// What did the person give us? Never asked of them: it is detected from the name, the type and the first bytes.
// input: { name, type, link }, head: first bytes (Uint8Array) or null.  ->  { kind, label, exact, needs, accept }
function detectInput(input, head) {
  const name = String(input.name || '').toLowerCase(), type = String(input.type || '').toLowerCase(), ext = (/\.([a-z0-9]+)$/.exec(name) || [])[1] || '';
  const h = head ? Array.from(head.subarray ? head.subarray(0, 8) : head.slice(0, 8)) : [], ascii = String.fromCharCode(...h);
  if (input.link) {
    const l = String(input.link).trim();
    if (/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(l)) return { kind: 'youtube', label: 'YouTube link', exact: false, needs: 'helper', note: 'will be a Draft; needs the helper on your computer' };
    return { kind: 'link', label: 'link', exact: false, needs: 'helper', unsupported: true, note: 'only YouTube links are supported for now' };
  }
  if (ascii.startsWith('MThd') || ext === 'mid' || ext === 'midi' || type === 'audio/midi' || type === 'audio/x-midi') return { kind: 'midi', label: 'MIDI', exact: true, needs: null, note: 'exact notes' };
  if (ext === 'mxl' || (ascii.startsWith('PK') && /musicxml|vnd\.recordare/.test(type))) return { kind: 'mxl', label: 'MusicXML (compressed)', exact: true, needs: null, note: 'exact notes' };
  if (ext === 'musicxml' || (ext === 'xml' && !type.startsWith('audio'))) return { kind: 'musicxml', label: 'MusicXML', exact: true, needs: null, note: 'exact notes' };
  if (ascii.startsWith('%PDF') || ext === 'pdf' || type === 'application/pdf') return { kind: 'pdf', label: 'PDF', exact: false, needs: 'helper', note: 'will be a Draft (experimental); needs the helper' };
  if (type.startsWith('video/') || ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'].includes(ext)) return { kind: 'video', label: 'video', exact: false, needs: null, note: 'the audio track will be used and the result will be a Draft' };
  if (type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus', 'aif', 'aiff', 'wma'].includes(ext)) return { kind: 'audio', label: 'audio', exact: false, needs: null, note: 'will be a Draft' };
  return { kind: 'unknown', label: 'unknown file', exact: false, needs: null, unsupported: true, note: 'not a type this app can read yet' };
}

// Pitch range each supported instrument plays (MIDI note numbers). The violin starts at G3.
const PIECE_INSTRUMENTS = { violin: [55, 100], guitar: [40, 88], ukulele: [60, 84], piano: [21, 108] };

// Which part is probably the one this instrument plays: most notes inside its range; the violin prefers the higher part, other ties go to the larger part.
function suggestPart(instrument, parts) {
  const r = PIECE_INSTRUMENTS[instrument] || PIECE_INSTRUMENTS.piano; let best = 0, bs = -1;
  parts.forEach((p, i) => {
    if (!p.notes.length) return;
    const inside = p.notes.filter(n => n.midi >= r[0] && n.midi <= r[1]).length / p.notes.length, mean = p.notes.reduce((a, n) => a + n.midi, 0) / p.notes.length;
    const score = inside * 1000 + (instrument === 'violin' ? mean : 0) + p.notes.length / 1e4;
    if (score > bs) { bs = score; best = i; }
  });
  return best;
}

const pieceId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cleanTitle = (t, fallback) => String(t || fallback || 'Untitled').replace(/\.(mid|midi|musicxml|xml|mxl)$/i, '').replace(/[_]+/g, ' ').replace(/[<>&"]/g, '').trim().slice(0, 80) || 'Untitled';

// MIDI bytes -> piece. One part per track and channel that has notes; named from the track name.
function pieceFromMidi(bytes, o = {}) {
  const m = parseMidi(bytes); if (!m.notes.length) throw new Error('This MIDI file has no notes.');
  const groups = new Map();
  for (const n of m.notes) { const k = n.trk + ':' + n.ch; if (!groups.has(k)) groups.set(k, { trk: n.trk, ch: n.ch, notes: [] }); groups.get(k).notes.push({ midi: n.midi, start: n.start, dur: n.dur, vel: n.vel }); }
  const parts = [...groups.values()].sort((a, b) => a.trk - b.trk || a.ch - b.ch).map((g, i) => ({ id: 'part' + (i + 1), name: (m.names[g.trk] || '') || 'Part ' + (i + 1), notes: g.notes }));
  const inst = o.instrument || 'violin';
  return { id: pieceId(), title: cleanTitle(o.title || o.name, 'MIDI piece'), instrument: inst, source: 'midi', exact: true, bpm: m.bpm, timeSig: m.timeSig || [4, 4], parts, part: suggestPart(inst, parts), created: Date.now() };
}
// MusicXML text -> piece.
function pieceFromMusicXml(text, o = {}) {
  const x = parseMusicXml(text), inst = o.instrument || 'violin';
  return { id: pieceId(), title: cleanTitle(x.title || o.title || o.name, 'MusicXML piece'), instrument: inst, source: 'musicxml', exact: true, bpm: x.bpm, timeSig: x.timeSig, key: x.key, parts: x.parts.map(p => ({ id: p.id, name: p.name, inst: p.inst, program: p.program, staves: p.staves, bars: p.bars, notes: p.notes })), part: suggestPart(inst, x.parts), created: Date.now() };
}
// What the library keeps small and what the player sees.
const pieceNotes = p => (p.parts[p.part] || p.parts[0]).notes;
const pieceSeconds = p => { const n = pieceNotes(p); return n.length ? Math.max(...n.map(x => x.start + x.dur / 1000)) : 0; };
