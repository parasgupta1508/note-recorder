// Feeds the notes of real MusicXML scores (tests/samples/*.musicxml) through the tuner's pitch detector.
// Each distinct note is synthesised (violin-like tone, small known detune) and must be read back within the in-tune tolerance.
// node tests/tuner-musicxml.js
const fs = require('fs'), path = require('path');
const S = require('./lib/synth.js'), lib = require('./lib/load.js');
const dir = path.join(__dirname, 'samples'), TOL = 10; let fail = 0;
for (const f of fs.readdirSync(dir).filter(n => /\.musicxml$/.test(n))) {
  const piece = lib.pieceFromMusicXml(fs.readFileSync(path.join(dir, f), 'utf8'), { name: f, instrument: 'violin' });
  const midis = new Set(); piece.parts.forEach(p => p.notes.forEach(n => { if (n.midi >= 55 && n.midi <= 93) midis.add(n.midi); }));
  let tot = 0, ok = 0, worst = 0; const bad = [];
  for (const midi of midis) for (const det of [-6, 0, 6]) {
    const sr = 44100, b = S.mk(1, sr); S.setSeed(midi * 13 + det);
    S.violin(b, midi, 0, 1, { sr, detune: det, vib: 0, scoop: 0 }); S.noise(b, 0.002);
    const x = b.subarray(Math.floor(sr * 0.4), Math.floor(sr * 0.4) + 4096);
    const r = lib.getEngine('f0').frame(x, sr, 180, 1800); tot++;
    const c = r ? lib.centsBetween(r.freq, S.hz(midi + det / 100)) : NaN;
    // the tuner beeps when |cents from the target note| <= TOL, so the read-back must put a ±6c detune inside TOL
    const heard = r ? lib.centsBetween(r.freq, S.hz(midi)) : NaN;
    if (r && Math.abs(c) <= 3 && Math.abs(heard) <= TOL) ok++; else bad.push(`${midi}${det >= 0 ? '+' : ''}${det}: ${r ? c.toFixed(1) + 'c' : 'MISS'}`);
    if (r) worst = Math.max(worst, Math.abs(c));
  }
  const pass = ok === tot; if (!pass) fail++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${f}: "${piece.title}" ${piece.parts.length} part(s), ${midis.size} distinct notes, ${ok}/${tot} read within 3c (worst ${worst.toFixed(1)}c)`);
  bad.slice(0, 10).forEach(s => console.log('   ', s));
}
process.exit(fail ? 1 : 0);
