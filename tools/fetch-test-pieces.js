// Downloads real, public-domain scores for the speaker test's "pieces" scenarios into tests/_pieces/ (git-ignored: scores are never committed).
//   node tools/fetch-test-pieces.js
// The scores come from the music21 corpus (https://github.com/cuthbertLab/music21/tree/master/music21/corpus), whose files are transcriptions of public-domain works.
// Each is kept under its own name; tests/_pieces/index.json says which instrument and part to practise it on.
const fs = require('fs'), path = require('path'), https = require('https');
const dir = path.join(__dirname, '..', 'tests', '_pieces'); fs.mkdirSync(dir, { recursive: true });
const BASE = 'https://raw.githubusercontent.com/cuthbertLab/music21/master/music21/corpus/';
// inst: the instrument the player practises it on (violin, guitar, ukulele, chromatic = piano); part: the part to play (0 = the first); bars: [from, to] (optional, to keep a run to about a minute)
const PIECES = [
  { file: 'corelli_op3_no1_grave.xml',      src: 'corelli/opus3no1/1grave.xml',               inst: 'violin',   part: 0, title: 'Corelli, Trio Sonata Op. 3 No. 1, Grave' },
  { file: 'mozart_k155_mvt1.mxl',           src: 'mozart/k155/movement1.mxl',                 inst: 'violin',   part: 0, bars: [1, 40], title: 'Mozart, String Quartet K. 155, I (violin I)' },
  { file: 'haydn_op1no1_mvt2.mxl',          src: 'haydn/opus1no1/movement2.mxl',              inst: 'violin',   part: 0, title: 'Haydn, String Quartet Op. 1 No. 1, II (violin I)' },
  { file: 'beethoven_op18no1_mvt1.mxl',     src: 'beethoven/opus18no1/movement1.mxl',         inst: 'violin',   part: 0, bars: [1, 60], title: 'Beethoven, String Quartet Op. 18 No. 1, I (violin I)' },
  { file: 'handel_lascia_chio_pianga.mxl',  src: 'handel/rinaldo/Lascia_chio_pianga.mxl',     inst: 'violin',   part: 0, title: "Handel, Lascia ch'io pianga" },
  { file: 'aloha_oe.mxl',                   src: 'liliuokalani/aloha_oe.mxl',                 inst: 'ukulele',  part: 0, title: 'Liliuokalani, Aloha Oe (melody)' },
  { file: 'foster_brown_hair.mxl',          src: 'leadSheet/fosterBrownHair.mxl',             inst: 'guitar',   part: 0, title: 'Foster, Jeanie with the Light Brown Hair (melody)' },
  { file: 'joplin_maple_leaf_rag.mxl',      src: 'joplin/maple_leaf_rag.mxl',                 inst: 'chromatic', part: 0, bars: [1, 32], title: 'Joplin, Maple Leaf Rag (right hand)' },
  { file: 'bach_bwv846_prelude.mxl',        src: 'bach/bwv846.mxl',                           inst: 'chromatic', part: 0, bars: [1, 35], title: 'Bach, Prelude in C (BWV 846)' },
  { file: 'schumann_dichterliebe_2.xml',    src: 'schumann_robert/dichterliebe_no2.xml',      inst: 'chromatic', part: 0, title: 'Schumann, Dichterliebe No. 2 (piano)' },
];
const get = u => new Promise((ok, no) => https.get(u, r => { if (r.statusCode !== 200) { r.resume(); return no(new Error(u + ' -> ' + r.statusCode)); } const b = []; r.on('data', d => b.push(d)); r.on('end', () => ok(Buffer.concat(b))); }).on('error', no));
(async () => {
  const done = [];
  for (const p of PIECES) {
    try { const b = await get(BASE + p.src); fs.writeFileSync(path.join(dir, p.file), b); done.push(p); console.log('ok   ' + p.file + '  ' + (b.length / 1024).toFixed(0) + ' KB'); }
    catch (e) { console.log('FAIL ' + p.file + ': ' + e.message); }
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(done, null, 1));
  console.log(done.length + ' of ' + PIECES.length + ' pieces in tests/_pieces/');
})();
