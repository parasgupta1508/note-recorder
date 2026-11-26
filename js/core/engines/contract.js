// The engine contract check, shared by tests/engine-contract.js (Node) and the Settings > Engines "Test this engine" button (browser).
// engineContract(engine) -> [{ ok, msg }]. Pure and synchronous; engines that need the browser model or the helper are only checked for their descriptor.
function engineContract(e) {
  const out = [], ok = (c, m) => out.push({ ok: !!c, msg: m }), tag = `${e.role}/${e.id}`, same = (a, b) => JSON.stringify(a) === JSON.stringify(b), cents = (a, b) => 1200 * Math.log2(a / b);
  const tone = (f, s, r) => { const n = r * s, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.4 * Math.sin(2 * Math.PI * f * i / r) + 0.15 * Math.sin(4 * Math.PI * f * i / r) + 0.08 * Math.sin(6 * Math.PI * f * i / r); return x; };
  const mk = r => { const a = tone(440, 1, r), b = tone(523.25, 1, r), x = new Float32Array(a.length + b.length + r / 2); x.set(a, r / 4); x.set(b, r / 4 + a.length); return x; };   // A4 then C5
  ok(typeof e.id === 'string' && typeof e.label === 'string' && typeof e.version === 'string' && e.caps && typeof e.caps === 'object' && e.params && typeof e.params === 'object' && typeof e.run === 'function', `${tag}: descriptor complete`);
  ok(typeof e.caps.needsHelper === 'boolean' && typeof e.caps.license === 'string', `${tag}: declares needsHelper and licence`);
  if (e.caps.needsHelper) return out.concat({ ok: true, skip: true, msg: `${tag}: needs the Lab helper (not run here)` });
  try {
    if (e.role === 'f0') {
      if (e.caps.needsRuntime) {                                       // the model runner is attached by the host; engineContractAsync runs the full check when it is
        ok(typeof e.run === 'function' && e.caps.sampleRate > 0, `${tag}: runs on audio at a fixed sample rate`);
        out.push({ ok: true, skip: true, msg: `${tag}: needs its model runner (engineContractAsync runs it where one is attached)` });
      } else { const sr = 16000, rate = e.caps.sampleRate || sr, melody = mk(rate), run = x => e.run({ x, sr: rate, fmin: 180, fmax: 2400 }), t0 = Date.now(), s = run(new Float32Array(rate * 2)), m = run(melody); f0Assert(e, tag, ok, cents, s, m, run(melody), Date.now() - t0, 2 + 2 * melody.length / rate, tone); }
    } else if (e.role === 'segmenter') {
      const sr = 44100, opts = { m: REC_MODES.fast, fmin: 180, fmax: 2400, conf: 0.85, a4: 440 }, run = x => e.run({ x, sr }, opts);   // mic audio is 44.1/48 kHz; the classic listener is not tuned for 16 kHz
      const melody = mk(sr);
      ok(run(new Float32Array(sr * 2)).length === 0, `${tag}: silence gives no notes`);
      const t0 = Date.now(), n = run(melody), ms = Date.now() - t0;
      ok(validateList('note', n).length === 0, `${tag}: output notes match the schema`);
      ok(same(n, run(melody)), `${tag}: deterministic`);
      ok(n.length === 2 && n[0].midi === 69 && n[1].midi === 72, `${tag}: A4 then C5 found, nothing extra (${n.map(x => x.midi).join(',')})`);
      const perMin = ms / (melody.length / sr) * 60; ok(perMin < 60000, `${tag}: time budget (${Math.round(perMin)} ms per minute of audio, limit 60000)`);
      ok(typeof e.create === 'function' && typeof e.gate === 'function', `${tag}: live parts present (create, gate)`);
    } else if (e.role === 'scorer') {
      // a grader: same shape as evaluateRun, deterministic, a perfect run scores high, a bad one low, silence/empty gives null, dev() is the identity at 0 cents
      const mk = (cf, e2, n = 15) => Array.from({ length: n }, (_, i) => { const c = typeof cf === 'function' ? cf(i) : cf; return { index: i, pass: 1, name: 'N' + i, midi: 60 + i, d: i < 8 ? 'up' : 'down', k: 'h', c, m: c, a: Math.abs(c) <= 10 ? 1 : 0.2, s: 4, e: e2, sp: 2, wrong: 0, rt: 0 }; });   // a function gives each note its own cents
      const opts = { beatMs: 750, mode: 'tempo', wobbleCap: 40 }, good = e.evaluate(mk(1, 10), opts), bad = e.evaluate(mk(i => (i % 2 ? 45 : -45), 400), opts), again = e.evaluate(mk(1, 10), opts);
      ok(e.evaluate([], opts) === null, `${tag}: an empty run gives no result`);
      ok(good && typeof good.total === 'number' && good.total >= 95 && good.band === 'Distinction', `${tag}: a clean run scores 95 or more (${good && good.total})`);
      ok(bad && bad.total <= good.total - 30, `${tag}: a badly out-of-tune run (notes 45 cents either side) scores at least 30 points below a clean one (${bad && bad.total})`);
      ok(JSON.stringify(good) === JSON.stringify(again), `${tag}: deterministic`);
      ok(good && ['total', 'band', 'pitch', 'fluency', 'tone', 'up', 'down', 'notes'].every(k => k in good), `${tag}: result has the fields the history and the charts read`);
      ok(typeof e.dev === 'function' && Math.abs(e.dev(0, { midi: 62, root: 0, fretless: true })) < 1e-9 && typeof e.shift === 'function' && typeof e.tol === 'function', `${tag}: dev, shift and tol are present and dev(0) = 0`);
    } else if (e.role === 'transcriber') {
      if (e.caps.needsBrowser) {
        ok(typeof e.postprocess === 'function', `${tag}: has postprocess`);
        const o = e.postprocess([], new Float32Array(16000), 16000, { a4: 440, poly: false, lo: 180, hi: 2400 }); ok(Array.isArray(o) && o.length === 0, `${tag}: no model notes in, no notes out`);
        out.push({ ok: true, skip: true, msg: `${tag}: the model runner needs the browser (tests/smoke-detailed.js and detailed-strings.js cover it)` });
      }
    }
  } catch (err) { ok(false, `${tag}: threw ${err && err.message}`); }
  return out;
}

// Assertions for an f0 engine's output on silence (s), a two-note melody (m, m2 = a second run) and the time the runs took. Shared by the sync and the async check.
function f0Assert(e, tag, ok, cents, s, m, m2, ms, sec, tone) {
  const v = m.filter(f => f.hz), same = (a, b) => JSON.stringify(a) === JSON.stringify(b), rate = e.caps.sampleRate || 16000;
  ok(validateList('frame', s).length === 0 && s.every(f => !f.hz), `${tag}: silence gives no voiced frames`);
  ok(validateList('frame', m).length === 0, `${tag}: output frames match the schema`);
  ok(same(m, m2), `${tag}: deterministic`);
  ok(v.length > 0 && v.every(f => f.hz >= 180 && f.hz <= 2400), `${tag}: stays inside the requested range`);
  const a = v.filter(f => f.t > 0.5 && f.t < 1.1), c = v.filter(f => f.t > 1.5 && f.t < 2.1);
  ok(a.length > 5 && a.every(f => Math.abs(cents(f.hz, 440)) < 20) && c.length > 5 && c.every(f => Math.abs(cents(f.hz, 523.25)) < 20), `${tag}: sustained A4 and C5 within 20 cents`);
  const perMin = ms / sec * 60; ok(perMin < 60000, `${tag}: time budget (${Math.round(perMin)} ms per minute of audio, limit 60000)`);
}
// Same as engineContract, but awaits an f0 engine that needs a model runner (swiftf0). Returns the same [{ ok, msg }] list; other engines are checked as before.
async function engineContractAsync(e) {
  if (!(e.role === 'f0' && e.caps.needsRuntime)) return engineContract(e);
  const out = engineContract(e).filter(r => !r.skip), ok = (c, m) => out.push({ ok: !!c, msg: m }), tag = `${e.role}/${e.id}`, cents = (a, b) => 1200 * Math.log2(a / b);
  if (typeof e.infer !== 'function') return out.concat({ ok: true, skip: true, msg: `${tag}: no model runner attached here` });
  const tone = (f, s, r) => { const n = r * s, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.4 * Math.sin(2 * Math.PI * f * i / r) + 0.15 * Math.sin(4 * Math.PI * f * i / r) + 0.08 * Math.sin(6 * Math.PI * f * i / r); return x; };
  const rate = e.caps.sampleRate, a = tone(440, 1, rate), b = tone(523.25, 1, rate), melody = new Float32Array(a.length + b.length + rate / 2); melody.set(a, rate / 4); melody.set(b, rate / 4 + a.length);
  try { const run = x => e.run({ x, sr: rate, fmin: 180, fmax: 2400 }), s = await run(new Float32Array(rate * 2)), t0 = Date.now(), m = await run(melody), m2 = await run(melody); f0Assert(e, tag, ok, cents, s, m, m2, Date.now() - t0, 2 + 2 * melody.length / rate, tone); }
  catch (err) { ok(false, `${tag}: threw ${err && err.message}`); }
  return out;
}
