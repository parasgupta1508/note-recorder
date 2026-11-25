// Small original test pieces, built in code (no copyrighted scores, no binary files in the repo).
// const F = require('./lib/fixtures.js'); F.midi() -> Uint8Array (.mid, two tracks); F.musicXml() -> string; F.mxl() -> Uint8Array (.mxl zip)
const zlib = require('zlib');

// Two-track MIDI, 480 ticks per beat, 90 bpm, 3/4. Track "Violin": G4 A4 B4 | C5 (long). Track "Piano": C3 E3 G3 as a chord.
function midi() {
  const vlq = v => { const b = [v & 127]; while ((v >>= 7) > 0) b.unshift((v & 127) | 128); return b; };
  const track = (name, ch, notes, meta) => {
    const ev = []; for (const n of notes) ev.push({ t: n.tick, d: [0x90 | ch, n.midi, 80], o: 1 }, { t: n.tick + n.dur, d: [0x80 | ch, n.midi, 0], o: 0 });
    ev.sort((a, b) => a.t - b.t || a.o - b.o);
    const nm = Array.from(name).map(c => c.charCodeAt(0)), body = [0, 0xff, 0x03, nm.length, ...nm, ...(meta || [])]; let last = 0;
    for (const e of ev) { body.push(...vlq(e.t - last), ...e.d); last = e.t; }
    body.push(0, 0xff, 0x2f, 0);
    const u32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body];
  };
  const us = Math.round(6e7 / 90), meta = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0, 0xff, 0x58, 4, 3, 2, 24, 8];
  const v = track('Violin', 0, [{ midi: 67, tick: 0, dur: 480 }, { midi: 69, tick: 480, dur: 480 }, { midi: 71, tick: 960, dur: 480 }, { midi: 72, tick: 1440, dur: 1440 }], meta);
  const p = track('Piano', 1, [{ midi: 48, tick: 0, dur: 1440 }, { midi: 52, tick: 0, dur: 1440 }, { midi: 55, tick: 0, dur: 1440 }]);
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 1, 0xe0, ...v, ...p]);
}

// MusicXML, 4/4, 90 bpm, divisions 2. Violin: G4 A4 B4 C5 | E5 D5 C5(half, tied) | C5(half, tied) rest.  Piano: C3+E3+G3 whole | rest | C3 whole.
function musicXml() {
  const n = (step, oct, dur, type, extra = '') => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration><type>${type}</type>${extra}</note>`;
  const rest = (dur, type) => `<note><rest/><duration>${dur}</duration><type>${type}</type></note>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1"><work><work-title>Test Tune</work-title></work>
<part-list><score-part id="P1"><part-name>Violin</part-name></score-part><score-part id="P2"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction placement="above"><direction-type><words>Allegro</words></direction-type><sound tempo="90"/></direction>${n('G', 4, 2, 'quarter')}${n('A', 4, 2, 'quarter')}${n('B', 4, 2, 'quarter')}${n('C', 5, 2, 'quarter')}</measure>
<measure number="2">${n('E', 5, 2, 'quarter')}${n('D', 5, 2, 'quarter')}${n('C', 5, 4, 'half', '<tie type="start"/>')}</measure>
<measure number="3">${n('C', 5, 4, 'half', '<tie type="stop"/>')}${rest(4, 'half')}</measure>
</part>
<part id="P2">
<measure number="1"><attributes><divisions>2</divisions></attributes>${n('C', 3, 8, 'whole')}<note><chord/><pitch><step>E</step><octave>3</octave></pitch><duration>8</duration><type>whole</type></note><note><chord/><pitch><step>G</step><octave>3</octave></pitch><duration>8</duration><type>whole</type></note></measure>
<measure number="2">${rest(8, 'whole')}</measure>
<measure number="3">${n('C', 3, 8, 'whole')}</measure>
</part></score-partwise>`;
}

// Zip with META-INF/container.xml and the score, entries deflated like a real .mxl.
function mxl() {
  const crc = b => { let c, t = [], r = 0xffffffff; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const files = [['META-INF/container.xml', Buffer.from('<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>')], ['score.xml', Buffer.from(musicXml())]];
  const u16 = v => [v & 255, (v >> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const out = [], central = []; let off = 0;
  for (const [name, raw] of files) {
    const comp = zlib.deflateRawSync(raw), nm = Buffer.from(name), c = crc(raw);
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(c), ...u32(comp.length), ...u32(raw.length), ...u16(nm.length), ...u16(0), ...nm, ...comp];
    central.push([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(c), ...u32(comp.length), ...u32(raw.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...nm]);
    out.push(...local); off += local.length;
  }
  const cd = central.flat();
  return Uint8Array.from([...out, ...cd, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cd.length), ...u32(off), ...u16(0)]);
}
module.exports = { midi, musicXml, mxl };
