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
      const sr = 16000, rate = e.caps.sampleRate || sr, melody = mk(rate), run = x => e.run({ x, sr: rate, fmin: 180, fmax: 2400 });
      const s = run(new Float32Array(rate * 2)); ok(validateList('frame', s).length === 0 && s.every(f => !f.hz), `${tag}: silence gives no voiced frames`);
      const t0 = Date.now(), m = run(melody), ms = Date.now() - t0, v = m.filter(f => f.hz);
      ok(validateList('frame', m).length === 0, `${tag}: output frames match the schema`);
      ok(same(m, run(melody)), `${tag}: deterministic`);
      ok(v.length > 0 && v.every(f => f.hz >= 180 && f.hz <= 2400), `${tag}: stays inside the requested range`);
      const a = v.filter(f => f.t > 0.5 && f.t < 1.1), c = v.filter(f => f.t > 1.5 && f.t < 2.1);
      ok(a.length > 5 && a.every(f => Math.abs(cents(f.hz, 440)) < 20) && c.length > 5 && c.every(f => Math.abs(cents(f.hz, 523.25)) < 20), `${tag}: sustained A4 and C5 within 20 cents`);
      const perMin = ms / (melody.length / rate) * 60; ok(perMin < 60000, `${tag}: time budget (${Math.round(perMin)} ms per minute of audio, limit 60000)`);
      if (e.caps.live) { const r = e.frame(tone(440, 1, sr).subarray(0, 4096), sr, 180, 2400); ok(r && Math.abs(cents(r.freq, 440)) < 20 && r.clarity > 0.8, `${tag}: live frame() reads A4`); }
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
