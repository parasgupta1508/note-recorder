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

// --- per engine ---
const sr = 16000, tone = (f, s, r = sr) => { const n = r * s, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.4 * Math.sin(2 * Math.PI * f * i / r) + 0.15 * Math.sin(4 * Math.PI * f * i / r) + 0.08 * Math.sin(6 * Math.PI * f * i / r); return x; };
const mk = r => { const a = tone(440, 1, r), b = tone(523.25, 1, r), x = new Float32Array(a.length + b.length + r / 2); x.set(a, r / 4); x.set(b, r / 4 + a.length); return x; };   // A4 then C5
const silence = new Float32Array(sr * 2), melody = mk(sr);
const cents = (a, b) => 1200 * Math.log2(a / b);
for (const e of lib.listEngines()) {
  const tag = `${e.role}/${e.id}`;
  ok(typeof e.id === 'string' && typeof e.label === 'string' && typeof e.version === 'string' && e.caps && typeof e.caps === 'object' && e.params && typeof e.params === 'object' && typeof e.run === 'function', `${tag}: descriptor complete`);
  ok(typeof e.caps.needsHelper === 'boolean' && typeof e.caps.license === 'string', `${tag}: declares needsHelper and licence`);
  if (e.caps.needsHelper) { console.log(`SKIP ${tag}: needs the Lab helper (not run here)`); continue; }
  if (e.role === 'f0') {
    const rate = e.caps.sampleRate || sr, run = x => e.run({ x, sr: rate, fmin: 180, fmax: 2400 });
    const s = run(silence); ok(lib.validateList('frame', s).length === 0 && s.every(f => !f.hz), `${tag}: silence gives no voiced frames`);
    const m = run(melody), v = m.filter(f => f.hz), t0 = Date.now(); run(melody);
    ok(lib.validateList('frame', m).length === 0, `${tag}: output frames match the schema`);
    ok(same(m, run(melody)), `${tag}: deterministic`);
    ok(v.length > 0 && v.every(f => f.hz >= 180 && f.hz <= 2400), `${tag}: stays inside the requested range`);
    const a = v.filter(f => f.t > 0.5 && f.t < 1.1), c = v.filter(f => f.t > 1.5 && f.t < 2.1);
    ok(a.length > 5 && a.every(f => Math.abs(cents(f.hz, 440)) < 20) && c.length > 5 && c.every(f => Math.abs(cents(f.hz, 523.25)) < 20), `${tag}: sustained A4 and C5 within 20 cents`);
    const perMin = (Date.now() - t0) / (melody.length / rate) * 60; ok(perMin < 60000, `${tag}: time budget (${Math.round(perMin)} ms per minute of audio, limit 60000)`);
    if (e.caps.live) { const r = e.frame(tone(440, 1).subarray(0, 4096), sr, 180, 2400); ok(r && Math.abs(cents(r.freq, 440)) < 20 && r.clarity > 0.8, `${tag}: live frame() reads A4`); }
  } else if (e.role === 'segmenter') {
    const sr = 44100, opts = { m: lib.REC_MODES.fast, fmin: 180, fmax: 2400, conf: 0.85, a4: 440 }, run = x => e.run({ x, sr }, opts);   // mic audio is 44.1/48 kHz; the classic listener is not tuned for 16 kHz
    const melody = mk(sr), silence = new Float32Array(sr * 2), n = run(melody), t0 = Date.now(); run(melody);
    ok(run(silence).length === 0, `${tag}: silence gives no notes`);
    ok(lib.validateList('note', n).length === 0, `${tag}: output notes match the schema`);
    ok(same(n, run(melody)), `${tag}: deterministic`);
    ok(n.length === 2 && n[0].midi === 69 && n[1].midi === 72, `${tag}: A4 then C5 found, nothing extra (${n.map(x => x.midi).join(',')})`);
    const perMin = (Date.now() - t0) / (melody.length / sr) * 60; ok(perMin < 60000, `${tag}: time budget (${Math.round(perMin)} ms per minute of audio, limit 60000)`);
    ok(typeof e.create === 'function' && typeof e.gate === 'function', `${tag}: live parts present (create, gate)`);
  } else if (e.role === 'transcriber') {
    if (e.caps.needsBrowser) {
      ok(typeof e.postprocess === 'function', `${tag}: has postprocess`);
      const out = e.postprocess([], silence, sr, { a4: 440, poly: false, lo: 180, hi: 2400 }); ok(Array.isArray(out) && out.length === 0, `${tag}: no model notes in, no notes out`);
      console.log(`SKIP ${tag}: model runner needs the browser (tests/smoke-detailed.js and detailed-strings.js cover it)`);
    } else { const out = e.run(silence, {}); ok(Array.isArray(out) ? out.length === 0 : true, `${tag}: silence gives no notes`); }
  }
}
console.log(fail ? `\n${fail} FAILED` : '\nall engine contracts pass');
process.exit(fail ? 1 : 0);
