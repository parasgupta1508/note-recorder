// Importers for exact sources (MIDI, MusicXML, .mxl) and the input detector. node tests/piece-import.js
const zlib = require('zlib'), lib = require('./lib/load.js'), F = require('./lib/fixtures.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const near = (a, b, e = 1) => Math.abs(a - b) <= e;
(async () => {
  // ---- detection (what arrives is classified; the player never picks a type)
  const d = (name, type, head, link) => lib.detectInput({ name, type, link }, head && Buffer.from(head));
  ok(d('a.mid', '', 'MThd').kind === 'midi' && d('a.mid', '', 'MThd').exact, 'detect: MIDI is exact');
  ok(d('x.bin', '', 'MThd\0\0').kind === 'midi', 'detect: MIDI by its first bytes, whatever the name');
  ok(d('a.musicxml', '').kind === 'musicxml' && d('a.xml', 'text/xml').kind === 'musicxml', 'detect: MusicXML (.musicxml and .xml)');
  ok(d('a.mxl', '').kind === 'mxl' && d('a.mxl', '').exact, 'detect: compressed MusicXML');
  ok(d('a.pdf', 'application/pdf').kind === 'pdf' && !d('a.pdf', '').exact && d('a.pdf', '').needs === 'helper', 'detect: PDF is a Draft and needs the helper');
  ok(d('a.mp3', 'audio/mpeg').kind === 'audio' && d('a.mp4', 'video/mp4').kind === 'video' && d('a.m4a', '').kind === 'audio', 'detect: audio and video');
  ok(d('', '', null, 'https://youtu.be/abc').kind === 'youtube' && d('', '', null, 'https://www.youtube.com/watch?v=x').needs === 'helper', 'detect: YouTube link needs the helper');
  ok(d('', '', null, 'https://example.com/x').unsupported === true, 'detect: other links are not offered');
  ok(d('a.docx', '').unsupported === true, 'detect: an unknown file is refused with a reason');

  // ---- MIDI
  const m = lib.pieceFromMidi(F.midi(), { name: 'test_tune.mid', instrument: 'violin' });
  ok(m.source === 'midi' && m.exact && m.parts.length === 2, 'midi: two parts (one per track)');
  ok(m.parts[0].name === 'Violin' && m.parts[1].name === 'Piano', 'midi: parts are named from the track names');
  ok(m.parts[0].notes.map(n => n.midi).join() === '67,69,71,72', 'midi: violin notes G4 A4 B4 C5');
  ok(near(m.bpm, 90, 0.2) && m.timeSig.join('/') === '3/4', 'midi: tempo 90 and 3/4 read');
  ok(near(m.parts[0].notes[1].start, 60 / 90, 0.001) && near(m.parts[0].notes[3].dur, 3 * 60 / 90 * 1000, 2), 'midi: note times follow the tempo');
  ok(m.parts[1].notes.map(n => n.midi).join() === '48,52,55', 'midi: piano chord kept');
  ok(m.part === 0 && lib.pieceFromMidi(F.midi(), { instrument: 'ukulele' }).part === 0, 'midi: the part that fits the instrument is suggested (the low piano chord is outside the ukulele range)');
  ok(m.title === 'test tune', 'midi: title comes from the file name');

  // ---- MusicXML
  const x = lib.pieceFromMusicXml(F.musicXml(), { name: 'x.musicxml', instrument: 'violin' });
  ok(x.title === 'Test Tune' && x.source === 'musicxml' && x.exact, 'musicxml: title from the score');
  ok(x.parts.map(p => p.name).join() === 'Violin,Piano' && near(x.bpm, 90, 0.01) && x.timeSig.join('/') === '4/4', 'musicxml: parts, tempo and time signature');
  const v = x.parts[0].notes;
  ok(v.map(n => n.midi).join() === '67,69,71,72,76,74,72', 'musicxml: violin notes (the tied C5 is one note)');
  ok(near(v[1].start, 60 / 90, 0.001) && near(v[4].start, 4 * 60 / 90, 0.001), 'musicxml: starts follow the tempo');
  ok(near(v[6].dur, 4 * 60 / 90 * 1000, 2) && v[6].bar === 2, 'musicxml: the tie joins two half notes across the bar line (4 beats)');
  ok(v.every(n => typeof n.bar === 'number' && typeof n.q === 'number') && v[4].bar === 2, 'musicxml: every note knows its bar and beat');
  const p = x.parts[1].notes;
  ok(p.slice(0, 3).map(n => n.midi).join() === '48,52,55' && p.slice(0, 3).every(n => n.start === 0 && near(n.dur, 4 * 60 / 90 * 1000, 2)) && p[3].midi === 48 && near(p[3].start, 8 * 60 / 90, 0.001), 'musicxml: chord shares one start; rest bar skipped');
  ok(x.part === 0 && lib.pieceFromMusicXml(F.musicXml(), { instrument: 'piano' }).part === 1 || lib.pieceFromMusicXml(F.musicXml(), { instrument: 'piano' }).part === 0, 'musicxml: a part is suggested');
  ok(lib.validateList('note', x.parts[0].notes).length === 0, 'musicxml: notes match the shared note schema');

  // ---- .mxl (zip)
  const mx = await lib.mxlToXml(F.mxl(), b => zlib.inflateRawSync(Buffer.from(b)));
  const px = lib.pieceFromMusicXml(mx, { name: 'z.mxl' });
  ok(px.parts[0].notes.map(n => n.midi).join() === v.map(n => n.midi).join(), 'mxl: the zipped score gives the same notes as the plain one');

  // ---- refusals say why
  const bad = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };
  ok(bad(() => lib.pieceFromMusicXml('<html></html>'), /not a MusicXML/), 'refuses a file that is not MusicXML, with a reason');
  ok(bad(() => lib.pieceFromMusicXml('<score-timewise></score-timewise>'), /part-wise/), 'refuses time-wise MusicXML, with a reason');
  ok(bad(() => lib.pieceFromMidi(new Uint8Array([1, 2, 3, 4])), /Not a MIDI/), 'refuses a file that is not MIDI, with a reason');
  ok(bad(() => lib.zipEntries(new Uint8Array(40)), /\.mxl/), 'refuses a file that is not a zip, with a reason');
  console.log(fail ? `\n${fail} FAILED` : '\nall piece import checks pass'); process.exit(fail ? 1 : 0);
})();
