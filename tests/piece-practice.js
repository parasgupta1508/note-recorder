// Piece practice, the pure parts: instrument detection from <part-list>, one melodic line, the scale-style timeline, bars, backing events, GitHub URLs and file lists.
// node tests/piece-practice.js
const lib = require('./lib/load.js'), F = require('./lib/fixtures.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---- a small score (written here, no copyrighted music): D major, 4/4, quarter = 100
const score = F.etudeXml;

const px = lib.parseMusicXml(score());
const v = px.parts[0];

// ---- the parser keeps what the scan needs
ok(px.key.fifths === 2 && !px.key.minor, 'parse: key signature (2 sharps)');
ok(v.inst === 'Violin' && v.program === 41, 'parse: instrument name and General MIDI program come from the score-part');
ok(v.bars.length === 4 && v.bars.join() === '0,4,8,12', 'parse: where every measure starts, in quarter notes');
ok(v.notes[1].name === 'F#5' && v.notes[4].name === 'Bb5' && v.notes[0].name === 'D5', 'parse: notes keep their written spelling (F#5, Bb5)');
ok(v.notes.every(n => near(n.dq, n.dur / 1000 / (60 / 100))) && near(v.notes[5].dq, 2), 'parse: note length in quarter notes (dq)');
ok(px.parts[2].staves === 2 && px.parts[0].staves === 1, 'parse: staves per part (a grand staff is 2)');

// ---- Case A / B: the part list
const sum = lib.summariseParts(px);
ok(sum.length === 5 && sum[0].key === 'violin' && sum[0].exact && sum[0].label === 'Violin', 'parts: violin found by its instrument name');
ok(sum[1].key === 'guitar' && sum[1].label === 'Guitar', 'parts: "Acoustic Guitar" is a guitar');
ok(sum[2].key === 'chromatic' && sum[2].label === 'Piano' && sum[2].polyphonic, 'parts: piano, and it has chords or two staves');
ok(sum[3].key === 'chromatic' && !sum[3].exact && sum[3].label === 'Cello', 'parts: a cello is named as a cello but scored with the piano rule (not an exact match)');
ok(sum[4].key === 'guitar' && sum[4].exact, 'parts: an unnamed part is found by its MIDI program (26 = guitar)');
ok(lib.detectPartInstrument({ name: 'Bass Guitar' }).key !== 'guitar', 'parts: a bass guitar is not a guitar');
ok(lib.detectPartInstrument({ name: 'Violin I' }).key === 'violin' && lib.detectPartInstrument({ name: 'Ukulele' }).key === 'ukulele', 'parts: "Violin I", "Ukulele"');
ok(lib.detectPartInstrument({ name: 'Mystery' }).exact === false, 'parts: an unknown instrument is not claimed');

// ---- the timeline
const t = lib.timelineFromPart(v, { bpm: 100, flats: false, timeSig: px.timeSig });
ok(t.tl.length === 8 && t.fromBar === 1 && t.toBar === 4, 'timeline: every note of the part, all four bars');
ok(t.tl.map(n => n.noteName).join() === 'D5,F#5,A5,A5,Bb5,A5,G5,D5', 'timeline: names are the spelling in the score');
ok(near(t.tl[1].startMs, 600) && near(t.tl[4].startMs, 5 * 600) && near(t.tl[4].beat, 5), 'timeline: starts follow the beat (a rest leaves a gap: Bb5 is the 6th beat, at 5 beats in)');
ok(t.tl[4].startMs === 3000 && t.tl[4].bar === 2 && t.tl[0].bar === 1, 'timeline: each note knows its bar');
ok(t.tl.every((n, i) => n.index === i && n.direction === 'up' && n.slurStart === true), 'timeline: the fields the scale engine reads');
ok(near(t.tl[5].dq, 2) && t.tl[5].durationMs < t.tl[5].dq * 600 && t.tl[5].durationMs > 0.9 * 2 * 600, 'timeline: a half note lasts two beats (a little shorter, so notes do not run together)');
ok(t.beats === 16, 'timeline: loop length is the four bars (16 beats)');
const t2 = lib.timelineFromPart(v, { bpm: 50, fromBar: 3, toBar: 4, timeSig: px.timeSig });
ok(t2.tl.length === 2 && near(t2.tl[0].startMs, 0) && near(t2.tl[1].startMs, 4 * 1200) && t2.beats === 8 && t2.fromBar === 3, 'timeline: a range of bars starts at its first bar line, at its own tempo');
const t3 = lib.timelineFromPart(v, { bpm: 100, fromBar: 2, toBar: 2, timeSig: px.timeSig });
ok(near(t3.tl[0].startMs, 600) && t3.tl[0].noteName === 'Bb5', 'timeline: a rest at the start of the range is kept (the first note is one beat in)');
const t4 = lib.timelineFromPart(v, { bpm: 100, shift: -12, timeSig: px.timeSig });
ok(t4.tl[0].midi === v.notes[0].midi - 12 && t4.tl[0].noteName === 'D4' && t4.tl[1].noteName === 'F#4', 'timeline: an octave shift moves the notes and keeps their spelling');
const t5 = lib.timelineFromPart(v, { bpm: 100, range: [55, 70], timeSig: px.timeSig });
ok(t5.outside === 8 && t5.warnings.some(w => /outside/.test(w)), 'timeline: notes outside the instrument range are counted and warned about');
ok(lib.timelineFromPart(v, { bpm: 100, fromBar: 9, toBar: 9 }).fromBar === 4, 'timeline: a bar number past the end is clamped');

// ---- chords and inner voices become one line
const piano = px.parts[2], top = lib.timelineFromPart(piano, { bpm: 100, timeSig: px.timeSig }), bot = lib.timelineFromPart(piano, { bpm: 100, line: 'bottom', timeSig: px.timeSig });
ok(top.tl.map(n => n.noteName).join() === 'G4,B4,C5,G3' && top.dropped === 1, 'line: a chord is played as its top note (E3+G3 -> G3), and the dropped note is counted');
ok(bot.tl.map(n => n.noteName).join() === 'G4,B4,C5,E3', 'line: or as its bottom note');
const inner = [{ midi: 72, q: 0, dq: 1, bar: 1 }, { midi: 72, q: 1, dq: 3, bar: 1 }, { midi: 48, q: 0, dq: 4, bar: 1 }, { midi: 50, q: 2, dq: 2, bar: 1 }];   // a melody over a held bass note and a lower inner note
ok(lib.monoLine(inner, 'top').map(n => n.midi).join() === '72,72', 'line: a bass note that starts under a sounding melody note is not part of the top line');
const over = lib.monoLine([{ midi: 60, q: 0, dq: 4, bar: 1 }, { midi: 62, q: 2, dq: 2, bar: 1 }], 'top');
ok(over.length === 2 && near(over[0].dq, 2), 'line: a held note is cut where the next note starts');

// ---- octave fit, key, bars
ok(lib.fitOctaveShift([40, 44, 47], [55, 103]) === 24 && lib.fitOctaveShift([60, 64], [55, 103]) === 0 && lib.fitOctaveShift([100, 105], [55, 103]) === -12, 'fit: shifts a part by octaves into the instrument range, and leaves a part that fits');
const k = lib.keyInfo(px.key), kf = lib.keyInfo({ fifths: -3, minor: true });
ok(k.pc === 2 && !k.flats && k.label === 'D major' && kf.pc === 3 && kf.flats && kf.label === 'C minor', 'key: tonic of the matching major key (for the notation) and a readable name');
ok(lib.ppSigBeats([6, 8]) === 3 && lib.ppSigBeats([4, 4]) === 4 && lib.ppSigBeats([2, 2]) === 4 && lib.ppSigBeats([2, 4]) === 2 && lib.ppSigBeats([3, 4]) === 3 && lib.ppSigBeats([12, 8]) === 4, 'sig: the count-in length is 2, 3 or 4 quarter-note beats');
const long = { notes: Array.from({ length: 1000 }, (_, i) => ({ midi: 60 + (i % 5), q: i, dq: 1, bar: 1 + Math.floor(i / 4) })), bars: Array.from({ length: 250 }, (_, i) => i * 4) };
const dr = lib.ppDefaultRange(long, 'top', 400);
ok(dr.last === 250 && dr.from === 1 && dr.to === 100, 'range: a long part starts with the first bars that hold up to 400 notes');
ok(lib.timelineFromPart(long, { bpm: 100, timeSig: [4, 4] }).tl.length === 400 && lib.timelineFromPart(long, { bpm: 100 }).warnings.some(w => /first 400/.test(w)), 'timeline: at most 400 notes, with a warning');

// ---- notation geometry for a piece (the Scale drills' own geometry is reused, not changed)
const sig = lib.visKeySig(k.pc, 'major', k.flats);
ok(sig.kind === 'sharp' && sig.n === 2, 'notation: a piece in D major gets two sharps');
const lay = lib.pwLayout(t.tl, { sig, left: 50, spacing: 54 });
ok(lay[0].bars.length === 3, 'notation: bar lines come from each note\'s bar (4 bars -> 3 lines), not from counting notes');

// ---- time: beats and positions
const sc8 = lib.buildTimeline({ start: 60, type: 'major', span: 1, bpm: 80 });
ok([-1, 0, 2.5, 7, 9.25].every(b => near(lib.pwPosOf(sc8, b), b)) && [-1, 0, 2.5, 7].every(f => near(lib.pwBeatOf(sc8, f), f)), 'time: for a scale the position and the beat are the same number');
ok(near(lib.pwPosOf(t.tl, -2), -2) && near(lib.pwPosOf(t.tl, 0.5), 0.5) && near(lib.pwPosOf(t.tl, 4), 3.5) && near(lib.pwPosOf(t.tl, 4.5), 3.75) && near(lib.pwPosOf(t.tl, 100), 7 + (100 - 12)), 'time: the position moves between two notes in proportion to the beats between them (beat 4 is half way from the 4th note, on beat 3, to the 5th, on beat 5)');
ok([0.2, 1.7, 3.25, 4.9, 6].every(f => near(lib.pwPosOf(t.tl, lib.pwBeatOf(t.tl, f)), f, 1e-9)), 'time: position -> beat -> position gives the same place');

// ---- backing
const back = lib.backingEvents(px.parts, 0, { bpm: 100, shift: 0, startQ: t.startQ, endQ: t.endQ });
ok(back.length === px.parts.slice(1).reduce((s, p) => s + p.notes.length, 0) && back[0].startMs === 0 && back.every((e, i) => i === 0 || e.startMs >= back[i - 1].startMs), 'backing: every note of the other parts, in time order');
ok(lib.backingEvents(px.parts, 0, { bpm: 100, startQ: 4, endQ: 8 }).every(e => e.startMs >= 0 && e.startMs < 4 * 600) && lib.backingEvents(px.parts, 0, { bpm: 100, startQ: 4, endQ: 8 }).length === 2, 'backing: only the bars being practised, starting at 0');
ok(lib.backingEvents(px.parts, 0, { bpm: 100, startQ: 0, endQ: 16, only: [1] }).length === 1, 'backing: the player can pick which parts');

// ---- identity
ok(lib.ppSourceId('Etude', 'Violin', 1, 4) === lib.ppSourceId('Etude', 'Violin', 1, 4) && lib.ppSourceId('Etude', 'Violin', 1, 4) !== lib.ppSourceId('Etude', 'Violin', 1, 8) && /^pc[0-9a-z]+$/.test(lib.ppSourceId('a', 'b', 1, 2)), 'id: stable per piece, part and bars');

// ---- GitHub
const P = lib.ghParseUrl;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(eq(P('musetrainer/library'), { owner: 'musetrainer', repo: 'library', ref: '', path: '', kind: 'repo' }), 'github: owner/repo');
ok(eq(P('https://github.com/fosfrancesco/asap-dataset'), { owner: 'fosfrancesco', repo: 'asap-dataset', ref: '', path: '', kind: 'repo' }) && P('https://github.com/a/b.git').repo === 'b', 'github: a repository link');
ok(eq(P('https://github.com/musescore/musescore/tree/master/src/importexport'), { owner: 'musescore', repo: 'musescore', ref: 'master', path: 'src/importexport', kind: 'dir' }), 'github: a folder link');
ok(eq(P('https://github.com/musetrainer/library/blob/main/scores/Arabesque.mxl'), { owner: 'musetrainer', repo: 'library', ref: 'main', path: 'scores/Arabesque.mxl', kind: 'file' }), 'github: a file link');
ok(eq(P('https://raw.githubusercontent.com/musetrainer/library/main/scores/A%20B.mxl'), { owner: 'musetrainer', repo: 'library', ref: 'main', path: 'scores/A B.mxl', kind: 'file' }), 'github: a raw link');
ok(['', 'hello', 'https://evil.example/a/b', 'https://github.com/a', 'https://github.com/a/b/tree/main/../x', 'https://github.com/a/b/issues/3', 'ftp://github.com/a/b', 'https://github.com/-bad/b', 'https://github.com/a/b/blob/main'].every(x => P(x) === null), 'github: anything else is refused (other hosts, other pages, "..")');
ok(lib.ghTreeUrl({ owner: 'a', repo: 'b', ref: '' }) === 'https://api.github.com/repos/a/b/git/trees/HEAD?recursive=1' && lib.ghTreeUrl({ owner: 'a', repo: 'b', ref: 'main' }).includes('/trees/main?'), 'github: the tree URL');
ok(lib.ghRawUrl({ owner: 'a', repo: 'b', ref: 'main' }, 'scores/A B#1.mxl') === 'https://raw.githubusercontent.com/a/b/main/scores/A%20B%231.mxl', 'github: the raw URL encodes every part of the path');
ok((() => { try { lib.ghRawUrl({ owner: 'a', repo: 'b' }, '../x'); return false; } catch { return true; } })() && (() => { try { lib.ghRawUrl({ owner: 'a/b', repo: 'c' }, 'x.mxl'); return false; } catch { return true; } })(), 'github: a path with ".." or an owner with a slash is refused');
const tree = { truncated: false, tree: [
  { type: 'blob', path: 'scores/Arabesque_L._66.mxl', size: 33000 }, { type: 'blob', path: 'scores/Ave_Maria.mxl', size: 11000 }, { type: 'tree', path: 'scores' }, { type: 'blob', path: 'README.md', size: 10 },
  { type: 'blob', path: 'Bach/Fugue/bwv_846/xml_score.musicxml', size: 300000 }, { type: 'blob', path: 'Bach/Fugue/bwv_848/xml_score.musicxml', size: 600000 }, { type: 'blob', path: 'Bach/Fugue/bwv_846/midi_score.mid', size: 5 },
  { type: 'blob', path: 'cfg/shortcuts.xml', size: 20 }, { type: 'blob', path: 'big/huge.mxl', size: 50e6 }, { type: 'blob', path: 'a/../b.mxl', size: 1 }] };
const lst = lib.ghMusicFiles(tree);
ok(lst.files.map(f => f.path).join() === 'Bach/Fugue/bwv_846/xml_score.musicxml,Bach/Fugue/bwv_848/xml_score.musicxml,scores/Arabesque_L._66.mxl,scores/Ave_Maria.mxl' && lst.skipped === 1, 'github: only .mxl and .musicxml are listed; folders, other files, a path with ".." and a file over 25 MB are not');
ok(lib.ghMusicFiles(tree, { includeXml: true }).files.some(f => f.path === 'cfg/shortcuts.xml') && lib.ghMusicFiles(tree, { prefix: 'scores' }).files.length === 2, 'github: .xml and a folder prefix are options');
ok(lst.files[0].label === 'Bach · Fugue · bwv 846' && lst.files[2].label === 'Arabesque L. 66', 'github: a generic file name takes its label from the folders');
ok(lib.ghSearch(lst.files, 'fugue 848').length === 1 && lib.ghSearch(lst.files, 'ave maria').length === 1 && lib.ghSearch(lst.files, '').length === 4, 'github: search needs every word');
const top2 = lib.ghList(lst.files, ''), col = lib.ghCollapse(lst.files, 'Bach');
ok(top2.dirs.map(d => d.name).join() === 'Bach,scores' && top2.dirs[0].count === 2 && col.dir === 'Bach/Fugue' && col.dirs.length === 2, 'github: folders can be browsed, and a folder with one sub-folder is skipped over');
ok(/60 requests/.test(lib.ghExplain(403, '0', '1700000000')) && /public/.test(lib.ghExplain(404)) && /internet/.test(lib.ghExplain(0)), 'github: errors say what to do');
ok(lib.GH_PRESETS.length === 3 && lib.GH_PRESETS.every(p => lib.ghParseUrl(`${p.owner}/${p.repo}`)), 'github: the three suggested catalogues are valid');


// ---- the libraries the player chooses, and the search over their scores
const defs = lib.plDefaults();
ok(defs.length === 3 && defs.every(d => d.on && d.id && lib.ghParseUrl(d.owner + '/' + d.repo)) && defs[1].inst === 'chromatic', 'libraries: three suggested ones, ASAP marked as piano');
ok(lib.plNormalize([{ owner: 'a', repo: 'b' }, { owner: 'a', repo: 'b' }, { owner: '../x', repo: 'b' }, null, { owner: 'c', repo: 'd', inst: 'tuba', on: false, prefix: 'x/../y' }]).map(r => r.id + ':' + r.inst + ':' + r.on).join() === 'a/b:any:true,c/d:any:false', 'libraries: stored data is cleaned (duplicates, bad names, unknown instrument, a path with ".." dropped)');
const a1 = lib.plAdd(defs, 'https://github.com/foo/bar-scores', 'violin');
ok(a1.added && a1.added.id === 'foo/bar-scores' && a1.added.inst === 'violin' && a1.list.length === 4 && !a1.added.includeXml, 'libraries: a repository link is added with its instrument');
const a2 = lib.plAdd(a1.list, 'https://github.com/foo/bar-scores/tree/main/violin/easy', 'any');
ok(a2.added && a2.added.prefix === 'violin/easy' && a2.added.ref === 'main' && a2.added.includeXml, 'libraries: a folder link is added as its own library (with .xml files)');
ok(lib.plAdd(a1.list, 'foo/bar-scores').error && lib.plAdd(a1.list, 'nonsense').error && lib.plAdd(a1.list, 'https://github.com/a/b/blob/main/x.mxl').error, 'libraries: a duplicate, a non-link and a single file are refused with a reason');
ok(lib.plGuess('Bach/Violin_Partita.mxl', '') === 'violin' && lib.plGuess('x/Solo Piano Arrg.mxl', 'any') === 'chromatic' && lib.plGuess('Etude.mxl', 'any') === '' && lib.plGuess('Etude.mxl', 'guitar') === 'guitar' && lib.plGuess('Bass Guitar.mxl', '') === 'guitar', 'libraries: the instrument is guessed from words in the name, else the library own setting');
const ents = [].concat(lib.plEntries({ id: 'L1', title: 'Lib One', inst: 'chromatic' }, [{ path: 'a/Moonlight_Sonata.mxl', label: 'Moonlight Sonata', size: 5 }, { path: 'a/Violin_Romance.mxl', label: 'Violin Romance', size: 5 }]), lib.plEntries({ id: 'L2', title: 'Lib Two', inst: 'any' }, [{ path: 'b/Canon.mxl', label: 'Canon', size: 5 }, { path: 'b/Guitar_Study.mxl', label: 'Guitar Study', size: 5 }]));
ok(ents.map(e => e.inst).join() === 'chromatic,violin,,guitar', 'search: every entry gets an instrument (or none)');
ok(lib.plFilter(ents, { q: 'sonata' }).length === 1 && lib.plFilter(ents, { q: 'lib two' }).length === 2 && lib.plFilter(ents, { q: 'study guitar' }).length === 1, 'search: every word must match (name, folder or library)');
ok(lib.plFilter(ents, { inst: 'violin' }).length === 1 && lib.plFilter(ents, { inst: 'unknown' }).length === 1 && lib.plFilter(ents, { lib: 'L2' }).length === 2 && lib.plFilter(ents, { inst: 'chromatic', lib: 'L2' }).length === 0, 'filter: by instrument, by "not stated", by library, and together');
const cn = lib.plCounts(ents, {}); ok(cn.all === 4 && cn.chromatic === 1 && cn.violin === 1 && cn.guitar === 1 && cn.unknown === 1 && lib.plCounts(ents, { q: 'lib two' }).chromatic === 0, 'filter: the numbers on the filter buttons follow the search');

console.log(fail ? `\n${fail} FAILED` : '\nall piece practice checks pass'); process.exit(fail ? 1 : 0);
