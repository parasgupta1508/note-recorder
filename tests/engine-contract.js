// Contract test for the engine registry (js/core/engines/). node tests/engine-contract.js
// Every engine registered by the pure core files must pass; nothing may be added to the registry without passing this.
// Engines that need the browser (Basic Pitch model) or the Lab helper are checked for their descriptor and, where there is one, the part that runs without them.
const lib = require('./lib/load.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- registry behaviour ---
ok(lib.AUTO_ENGINES.f0 === 'yin' && lib.AUTO_ENGINES.segmenter === 'classic' && lib.AUTO_ENGINES.transcriber === 'basicpitch', 'auto = today\'s engines (yin, classic, basicpitch)');
ok(lib.getEngine('f0').id === 'yin' && lib.getEngine('segmenter').id === 'classic' && lib.getEngine('transcriber').id === 'basicpitch', 'getEngine with no settings resolves "auto"');
ok(lib.getEngine('separator') === null, 'separator is off by default');
const bogus = { default: { f0: 'does-not-exist' } };
ok(lib.getEngine('f0', 'violin', 'live', bogus).id === 'yin', 'an unknown engine id falls back to the default engine');
lib.registerEngine({ id: 'stub-offline', role: 'f0', caps: { live: false, offline: true }, run: () => [] });
ok(lib.getEngine('f0', null, 'live', { default: { f0: 'stub-offline' } }).id === 'yin', 'an offline-only engine is not used for live listening');
ok(lib.getEngine('f0', null, 'offline', { default: { f0: 'stub-offline' } }).id === 'stub-offline', '...but is used offline when chosen');
ok(lib.getEngine('f0', 'violin', 'offline', { default: { f0: 'yin' }, perInstrument: { violin: { f0: 'stub-offline' } } }).id === 'stub-offline', 'perInstrument overrides the default');
lib.unregisterEngine('f0', 'stub-offline');
const snap = lib.engineSnapshot(null, 'violin');
ok(snap.f0 && snap.f0.id === 'yin' && snap.segmenter.id === 'classic' && snap.transcriber.version, 'engineSnapshot lists id and version for each role');
ok(lib.validateList('note', [{ midi: 69, start: 0, dur: 100 }]).length === 0 && lib.validateList('note', [{ midi: 'a' }]).length > 0, 'schema accepts a note and rejects a bad one');

// --- per engine (the same check the Settings > Engines Test button runs) ---
for (const e of lib.listEngines()) for (const r of lib.engineContract(e)) { if (r.skip) console.log('SKIP ' + r.msg); else ok(r.ok, r.msg); }
console.log(fail ? `\n${fail} FAILED` : '\nall engine contracts pass');
process.exit(fail ? 1 : 0);
