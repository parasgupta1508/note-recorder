// The library model: packs -> category tree, search, generated scales, transposition and range, bar grid. node tests/library.js
const lib = require('./lib/load.js'), F = require('./lib/fixtures.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const names = n => [...n.folders.values()].map(x => x.name);

// ---- pack import: the fixture folder Violin/Mozart/Volume 1/*.mid
const paths = ['Violin/Mozart/Volume 1/01 Minuet.mid', 'Violin/Mozart/Volume 1/02_Allegro.mid', 'Violin/Mozart/Volume 2/Rondo.mid', 'Violin/Bach/Partita/Gigue.musicxml', 'Violin/Etudes/Kreutzer 2.mxl',
  'Guitar/Songs/Tune.mid', 'Violin/readme.txt', 'Violin/Mozart/.DS_Store', '__MACOSX/Violin/Mozart/Volume 1/._01 Minuet.mid', 'Violin/Mozart/cover.jpg'];
const r = lib.parsePackPaths(paths, 'violin');
ok(r.items.length === 6, `pack: six playable files found, junk ignored (${r.items.length})`);
ok(r.skipped.length === 1 && /cover\.jpg/.test(r.skipped[0]), 'pack: an unreadable file type is reported as skipped (a .txt, dot-file or __MACOSX entry is silently ignored)');
const first = r.items[0]; ok(first.instrument === 'violin' && first.categoryPath.join('/') === 'Mozart/Volume 1' && first.title === '01 Minuet', 'pack: instrument and categories come from the folders, title from the file name');
ok(r.items.find(i => i.title === 'Tune').instrument === 'guitar', 'pack: a Guitar folder sets the instrument');
const wrapped = lib.parsePackPaths(['MyPack/Violin/Mozart/Volume 1/a.mid'], 'piano').items[0];
ok(wrapped.instrument === 'violin' && wrapped.categoryPath.join('/') === 'Mozart/Volume 1', "pack: the pack's own top folder is dropped");
const plain = lib.parsePackPaths(['Mozart/Volume 1/a.mid', 'loose.mid'], 'ukulele').items;
ok(plain[0].instrument === 'ukulele' && plain[0].categoryPath.join('/') === 'Mozart/Volume 1' && plain[1].categoryPath.join() === 'My imports', 'pack: with no instrument folder the chosen instrument is used; loose files go to My imports');

const pieces = r.items.map((i, k) => ({ id: 'x' + k, title: i.title, instrument: i.instrument, categoryPath: i.categoryPath, builtin: false, verified: true, favourite: k === 0 }));
const tree = lib.buildTree(pieces, 'violin');
ok(names(tree).sort().join() === 'Bach,Etudes,Mozart' && tree.count === 5, 'tree: Violin has the categories Bach, Etudes, Mozart (the guitar piece is not in it)');
const moz = lib.treeAt(tree, ['Mozart']); ok(names(moz).join() === 'Volume 1,Volume 2' && moz.count === 3, 'tree: Mozart holds Volume 1 and Volume 2');
ok(lib.listNode(lib.treeAt(tree, ['Mozart', 'Volume 1'])).pieces.map(p => p.title).join() === '01 Minuet,02 Allegro', 'tree: pieces in a collection in natural order');
ok(lib.listNode(lib.buildTree([{ id: 1, title: 'a', instrument: 'violin', categoryPath: ['Vol 10'] }, { id: 2, title: 'b', instrument: 'violin', categoryPath: ['Vol 2'] }], 'violin')).folders.map(f => f.name).join() === 'Vol 2,Vol 10', 'tree: "Vol 2" sorts before "Vol 10"');
ok(lib.treeAt(tree, ['Nope']) === null, 'tree: an unknown path is null');

// ---- search and filters
ok(lib.searchPieces(pieces, 'mozart minuet').length === 1 && lib.searchPieces(pieces, 'rondo volume 2').length === 1 && lib.searchPieces(pieces, 'zzz').length === 0 && lib.searchPieces(lib.generatorPieces('violin'), 'c maj').every(p => /^C(#)? major/.test(p.title) || /^C/.test(p.title)) && lib.searchPieces(pieces, 'moz min').length === 1 && lib.searchPieces(pieces, 'ozart').length === 0, 'search: every word typed must start a word of the title or category path (("c" does not match "Scales"))');
ok(lib.searchPieces(pieces, '', { favourite: true }).length === 1 && lib.searchPieces(pieces, '', { builtin: true }).length === 0 && lib.searchPieces(pieces, '', { mine: true }).length === 6, 'search: Favourites / Built-in / Mine filters');

// ---- generated scales
for (const inst of ['violin', 'guitar', 'piano', 'ukulele']) {
  const g = lib.generatorPieces(inst), rg = { violin: [55, 100], guitar: [40, 88], piano: [60, 108], ukulele: [60, 84] }[inst];
  ok(g.length > 20 && g.every(p => p.generator && p.builtin && p.categoryPath[0] === 'Scales and arpeggios'), `generator: ${inst}: ${g.length} generated pieces under Scales and arpeggios`);
  const bad = g.filter(p => { const m = lib.materialize(p), n = m.parts[0].notes; return !n.length || n.some(x => x.midi < rg[0] || x.midi > rg[1]) || lib.validateList('note', n).length; });
  ok(bad.length === 0, `generator: ${inst}: every generated scale is playable notes inside the instrument's range`);
}
const cmaj = lib.materialize(lib.generatorPieces('violin').find(p => p.title === 'C major, 1 octave'));
ok(cmaj.parts[0].notes.map(n => n.midi).join() === '60,62,64,65,67,69,71,72,71,69,67,65,64,62,60', 'generator: C major, 1 octave goes up and back down (starting on the first C above G3)');
const arp = lib.materialize(lib.generatorPieces('violin').find(p => p.title === 'A minor arpeggio, 2 octaves'));
ok(arp.parts[0].notes.slice(0, 4).map(n => n.midi).join() === '57,60,64,69', 'generator: A minor arpeggio, 2 octaves starts A3 C4 E4 A4');
ok(lib.materialize(lib.generatorPieces('piano').find(p => p.title === 'C major, 1 octave')).parts.length === 2, 'generator: piano scales have a right and a left hand');
const gp = lib.materialize(lib.generatorPieces('violin')[0]); ok(lib.barGrid(gp).bars >= 1 && lib.pieceNotes(gp).length > 4, 'generator: a generated piece works with the same piece helpers as an imported one');

// ---- transposition and range
const lowNotes = [{ midi: 48, start: 0, dur: 500 }, { midi: 50, start: 1, dur: 500 }, { midi: 52, start: 2, dur: 500 }];
ok(lib.rangeCheck(lowNotes, 'violin').outside === 3 && lib.rangeCheck(lowNotes, 'violin').below === 3, 'range: notes below G3 are counted for the violin');
ok(lib.bestOctaveShift(lowNotes, 'violin') === 12 && lib.rangeCheck(lib.transposeNotes(lowNotes, 12), 'violin').outside === 0, 'range: the best octave shift puts the notes in range');
ok(lib.bestOctaveShift(lowNotes, 'piano') === 0 && lib.transposeNotes(lowNotes, 2)[0].midi === 50, 'range: a fitting piece is left alone; transposing moves every note');

// ---- bar grid from a MIDI piece (90 bpm, 3/4)
const mp = lib.pieceFromMidi(F.midi(), { name: 'g.mid' }), g = lib.barGrid(mp);
ok(Math.abs(g.barSec - 3 * 60 / 90) < 0.01 && g.bars === 2 && g.timeSig.join('/') === '3/4', `grid: one 3/4 bar at 90 bpm is 2 s, the fixture has ${g.bars} bars`);
const b2 = lib.notesInBars(mp.parts[0].notes, g, 2, 2);
ok(b2.length === 1 && b2[0].midi === 72 && Math.abs(b2[0].start) < 0.01, "grid: bars 2 to 2 gives that bar's notes, moved to start at 0");
ok(lib.notesInBars(mp.parts[0].notes, g, 1, 2).length === 4, 'grid: bars 1 to 2 gives all four notes');
console.log(fail ? `\n${fail} FAILED` : '\nall library checks pass'); process.exit(fail ? 1 : 0);
