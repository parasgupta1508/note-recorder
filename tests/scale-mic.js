// Scale drills with the REAL microphone: the scale is played out loud through the speaker (a harmonic tone on a separate audio context), the app listens with the device
// microphone, grades the pass, and the screen is saved as a picture. Needs a person at the PC (sound is played aloud; raise the volume first) and headed Edge/Chrome;
// --use-fake-ui-for-media-stream only auto-accepts the permission prompt, the microphone is the real one.
// Run: node tests/scale-mic.js [outDir] [--n 5]      -> scale-mic-<n>-<instrument>.png and a printed table
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const root = path.join(__dirname, '..'), args = process.argv.slice(2), out = args.find(a => !a.startsWith('--') && isNaN(a)) || os.tmpdir(), N = +(args[args.indexOf('--n') + 1] || 5) || 5;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/json' };
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
if (!exe) { console.log('No Edge/Chrome found'); process.exit(0); }
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); r.end(d); } }); });

// The scenarios: different instruments, random roots and scale types, three in Wait-for-note and two in Tempo-locked.
const INST = ['violin', 'guitar', 'ukulele', 'chromatic', 'violin'], MODES = ['wait', 'wait', 'wait', 'tempo', 'tempo'], TYPES = ['major', 'naturalMinor', 'harmonicMinor', 'melodicMinor', 'dorian', 'mixolydian'];
const only = args.indexOf('--only') >= 0 ? args[args.indexOf('--only') + 1].split(',').map(x => x.split(':')) : null;   // e.g. --only chromatic:tempo,violin:wait
const pickRand = a => a[Math.floor(Math.random() * a.length)];

// Runs inside the page for one scenario and returns the result.
const SCENARIO = `async (cfg) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms)), hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const pick = (id, v) => { const e = $(id); e.value = v; e.dispatchEvent(new Event('change')); };
  document.getElementById('firstRun').classList.add('hide'); showTab('scale');
  pick('scInst', cfg.inst); pick('scRoot', cfg.root); pick('scSpan', 1); const has = [...$('scType').options].some(o => o.value === cfg.type); pick('scType', has ? cfg.type : 'major');
  $('scBpm').value = cfg.bpm; $('scBpm').dispatchEvent(new Event('change')); $('scRepeat').checked = false; $('scRepeat').dispatchEvent(new Event('change'));
  document.querySelector('#scMode button[data-mode="' + cfg.mode + '"]').click();
  if (!window.__pc) { window.__pc = new AudioContext(); } const pc = window.__pc; await pc.resume();
  let cur = null;
  const tone = (midi, dur) => {   // a bowed-ish tone: the first 8 harmonics, 1/n
    const re = new Float32Array(9), im = new Float32Array(9); for (let n = 1; n < 9; n++) im[n] = 1 / n;
    const o = pc.createOscillator(), g = pc.createGain(), t0 = pc.currentTime + 0.02; o.setPeriodicWave(pc.createPeriodicWave(re, im)); o.frequency.value = hz(midi);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.55, t0 + 0.04); g.gain.setValueAtTime(0.55, t0 + dur - 0.06); g.gain.linearRampToValueAtTime(0, t0 + dur); o.connect(g); g.connect(pc.destination); o.start(t0); o.stop(t0 + dur + 0.05);
    return { stop: () => { try { g.gain.cancelScheduledValues(pc.currentTime); g.gain.setValueAtTime(g.gain.value, pc.currentTime); g.gain.linearRampToValueAtTime(0, pc.currentTime + 0.05); } catch (e) {} } };
  };
  const names = sc.tl.map(n => n.noteName), n = sc.tl.length; let beat = 60000 / sc.bpm;
  $('scStart').click(); const t00 = Date.now(); while (!sc.running && Date.now() - t00 < 8000) await sleep(50);
  beat = 60000 / sc.bpm;   // the tempo is applied when the run starts, so read it only now (reading it earlier played the first run at the old BPM)
  if (Math.abs(sc.bpm - cfg.bpm) > 0.5) throw new Error('app tempo ' + sc.bpm + ' is not the requested ' + cfg.bpm);
  const info = { scale: scaleLabel(), notes: n, first: names[0], last: names[n - 1] };
  if (cfg.mode === 'wait') {
    await sleep(2200);   // the microphone calibrates on a quiet room first
    const start = Date.now();
    while (sc.running && sc.pos < n && Date.now() - start < 90000) {
      const idx = sc.pos, t1 = Date.now(), tn = tone(sc.tl[idx].midi, 3.2);
      while (sc.running && sc.pos === idx && Date.now() - t1 < 3200) await sleep(10);
      (info.waitLag = info.waitLag || []).push(Date.now() - t1);   // ms from the note starting to the target moving on
      tn.stop(); await sleep(260);
    }
  } else {
    let last = -1; const start = Date.now(); info.clock0 = null; info.t0 = t0; info.listenAtStart = null;
    while (sc.running && Date.now() - start < 90000) {
      if (sc.clock != null && ctx) { if (info.clock0 == null) { info.clock0 = sc.clock; info.ctxAtClock = ctx.currentTime; } const f = Math.floor(((ctx.currentTime - t0 - sc.clock) * 1000) / beat); if (f > last) { last = f; if (f >= 0 && f < n) tone(sc.tl[f].midi, Math.max(0.25, beat / 1000 * 0.85)); if (f >= n) break; } }
      await sleep(10);
    }
  }
  const w = Date.now(); while (!sc.lastRun && Date.now() - w < 9000) await sleep(100);
  await sleep(600);
  if (sc.running) $('scStop').click();
  const L = sc.lastRun, r = L && L.rec;
  info.waitLag && (info.waitLagMedian = info.waitLag.slice().sort((a, b) => a - b)[info.waitLag.length >> 1]);
  info.gate = $('gate').value; info.boost = $('boost').value;
  info.att = (sc.attempts || []).slice(0, 15).map(a => [a.index, a.grade, a.time_s, a.timing_ms]); info.baseLat = ctx && ctx.baseLatency; info.outLat = ctx && ctx.outputLatency;
  return Object.assign(info, { mode: cfg.mode, bpm: cfg.bpm, played: sc.pos, result: r ? { total: r.total, band: r.band, pitch: Math.round(r.pitch), fluency: Math.round(r.fluency), tone: Math.round(r.tone), skipped: r.skipped, wrong: r.wrong, up: r.up && r.up.bias == null ? null : r.up && +r.up.bias.toFixed(1), down: r.down && r.down.bias == null ? null : r.down && +r.down.bias.toFixed(1) } : null, resultShown: !$('scResult').hidden });
}`;

srv.listen(0, async () => {
  const port = srv.address().port, dbg = 9333 + Math.floor(Math.random() * 500), prof = path.join(os.tmpdir(), 'edge_scmic_' + Date.now());
  const br = spawn(exe, ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=' + dbg, '--user-data-dir=' + prof, '--no-first-run', '--window-size=1100,950', 'about:blank'], { stdio: 'ignore' });
  const done = code => { try { spawn('taskkill', ['/pid', String(br.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} srv.close(); setTimeout(() => process.exit(code), 500); };
  let tabs; for (let i = 0; i < 40 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await new Promise(r => setTimeout(r, 500)); } }
  if (!tabs) { console.log('browser did not start'); return done(1); }
  const ws = new WebSocket(tabs.find(x => x.type === 'page').webSocketDebuggerUrl); let id = 0; const pend = {};
  const send = (method, params = {}) => new Promise(r => { const k = ++id; pend[k] = r; ws.send(JSON.stringify({ id: k, method, params })); });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend[m.id]) pend[m.id](m.result); };
  await new Promise(r => ws.onopen = r); await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://localhost:${port}/index.html` }); await new Promise(r => setTimeout(r, 2000));
  console.log('Playing scales aloud and listening with the real microphone. Keep the room quiet.\n');
  const rows = []; let fail = 0;
  for (let k = 0; k < (only ? only.length : N); k++) {
    const inst = only ? only[k][0] : INST[k % INST.length], mode = only ? only[k][1] : MODES[k % MODES.length], cfg = { inst, mode, root: Math.floor(Math.random() * 12), type: pickRand(TYPES), bpm: mode === 'tempo' ? 60 : 80 };
    const res = await send('Runtime.evaluate', { expression: `(${SCENARIO})(${JSON.stringify(cfg)})`, awaitPromise: true, returnByValue: true, timeout: 150000 });
    const v = res && res.result && res.result.value;
    if (!v) { console.log(`#${k + 1} ${cfg.inst}: FAIL ${JSON.stringify(res && (res.exceptionDetails || res.result))}`); fail++; continue; }
    await send('Runtime.evaluate', { expression: `document.getElementById('scPlayer').scrollIntoView()` }); await new Promise(r => setTimeout(r, 400));
    const b = (await send('Runtime.evaluate', { expression: `(function(){var b=document.getElementById('scPlayer').getBoundingClientRect();return {x:b.x,y:b.y+scrollY,w:b.width,h:b.height}})()`, returnByValue: true })).result.value;
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: 1 } });
    const f = path.join(out, `scale-mic-${k + 1}-${cfg.inst}.png`); fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
    const r = v.result; rows.push({ dbg: { gate: v.gate, boost: v.boost, waitLag: v.waitLag, clock0: v.clock0, t0: v.t0, ctxAtClock: v.ctxAtClock, att: v.att, baseLat: v.baseLat, outLat: v.outLat }, k: k + 1, inst: cfg.inst, scale: v.scale, mode: v.mode, notes: v.notes, played: v.played, ...(r || {}), shown: v.resultShown, file: f });
    console.log(`#${k + 1} ${cfg.inst.padEnd(9)} ${String(v.scale).padEnd(32)} ${v.mode.padEnd(5)} reached note ${v.played}/${v.notes}  ` + (r ? `score ${r.total} (${r.band})  pitch ${r.pitch}  fluency ${r.fluency}  tone ${r.tone}  skipped ${r.skipped}  wrong ${r.wrong}  bias up ${r.up}c down ${r.down}c  result card ${v.resultShown ? 'shown' : 'NOT shown'}` : 'NO RESULT'));
    await send('Runtime.evaluate', { expression: 'resetPractice && resetPractice()' }); await new Promise(r => setTimeout(r, 1500));
  }
  fs.writeFileSync(path.join(out, 'scale-mic-results.json'), JSON.stringify(rows, null, 2));
  done(fail ? 1 : 0);
});
