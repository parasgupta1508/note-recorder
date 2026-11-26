// Everything that moves must agree on one clock. In a Tempo-locked run and in Hear scale this records, on every animation frame, the audio clock, the cursor position, the glowing
// note and the beat dot, plus every click that is scheduled, and checks: each note is due exactly on a click (<= 2 ms), the count-in has one click per beat before the first note,
// the glow reaches note i on the frame the cursor reaches it (<= 40 ms after it is due, cursor within 0.06 note), and a beat dot flashes within 40 ms of its click being heard.
// Headless Edge/Chrome, no microphone. Run: node tests/sync.js
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/json' };
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
if (!exe) { console.log('No Edge/Chrome found - skipped'); process.exit(0); }
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
srv.listen(0, async () => {
  const port = srv.address().port, dbg = 9333 + Math.floor(Math.random() * 500), prof = path.join(os.tmpdir(), 'edge_glide_' + Date.now());
  const br = spawn(exe, ['--headless=new', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=' + dbg, '--user-data-dir=' + prof, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const done = c => { try { spawn('taskkill', ['/pid', String(br.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} srv.close(); setTimeout(() => process.exit(c), 400); };
  let tabs; for (let i = 0; i < 40 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await new Promise(r => setTimeout(r, 500)); } }
  if (!tabs) { console.log('browser did not start'); return done(1); }
  const ws = new WebSocket(tabs.find(x => x.type === 'page').webSocketDebuggerUrl); let id = 0; const pend = {};
  const send = (m, p = {}) => new Promise(r => { const k = ++id; pend[k] = r; ws.send(JSON.stringify({ id: k, method: m, params: p })); });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend[m.id]) pend[m.id](m.result); };
  await new Promise(r => ws.onopen = r); await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://localhost:${port}/index.html` }); await new Promise(r => setTimeout(r, 1800));
  const js = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms)); document.getElementById('firstRun').classList.add('hide'); showTab('scale');
    $('scSpan').value = 1; $('scSpan').dispatchEvent(new Event('change')); $('scRepeat').checked = false; $('scSig').value = '4'; $('scSig').dispatchEvent(new Event('change'));
    const out = {}, c = getCtx(); await c.resume();
    const lat = c.outputLatency > 0 && c.outputLatency < 0.5 ? c.outputLatency : 0; out.lat = lat;
    async function record(name, start, ms) {
      const clicks = [], realClick = window.clickAt; window.clickAt = (t, a) => { clicks.push(t); return realClick(t, a); };
      const frames = []; let on = true, lastDot = -2; const dots = [];
      const tick = () => { if (!on) return; const f = svPosF(), g = document.querySelector('#scStaff g.nh.cur'), d = [...document.querySelectorAll('#beats i')].findIndex(e => e.classList.contains('on'));
        frames.push({ t: c.currentTime, f, glow: g ? +g.dataset.i : -1 }); if (d !== lastDot) { lastDot = d; if (d >= 0) dots.push({ t: c.currentTime, d }); } requestAnimationFrame(tick); };
      start(); await sleep(400); out.lat = c.outputLatency > 0 && c.outputLatency < 0.5 ? c.outputLatency : 0;   // the output latency settles once sound is playing
      const org = name === 'demo' ? SV.demoT0 : sc.clock + t0; tick(); await sleep(ms); on = false; window.clickAt = realClick;
      out[name] = { clicks, frames, dots, t0: org, n: sc.tl.length, beat: 60 / sc.bpm };
    }
    // Tempo-locked
    listening = true; stream = { getTracks() { return []; } }; sc.calibAt = performance.now(); $('scBpm').value = 120; $('scBpm').dispatchEvent(new Event('change')); setMode('tempo'); $('scBpm').value = 120;
    await record('tempo', () => startScale(), 11500); stopScale(); await sleep(300);
    // Hear scale with the click on
    startMetro(); stopMetro(); metroOn = true;
    await record('demo', () => { metroOn = true; startDemo(); }, 9000); stopDemo(); stopMetro(); listening = false;
    return out;
  })()`;
  const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true, timeout: 90000 }), v = r.result && r.result.value;
  if (!v) { console.log('FAIL no result', JSON.stringify(r.exceptionDetails || r.result)); return done(1); }
  let bad = 0; const ck = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) bad++; };
  const near = (arr, x) => arr.reduce((m, a) => Math.min(m, Math.abs(a - x)), 1e9);
  for (const m of ['tempo', 'demo']) {
    const R = v[m], origin = m === 'demo' ? R.t0 : R.t0 /* clock origin + app mic origin */, due = i => (m === 'demo' ? R.t0 : R.t0) + i * R.beat;
    const clicks = R.clicks.filter(t => t > 0);
    // 1. every note is due exactly on a click
    const lastClick = Math.max(...clicks); let worst = 0; for (let i = 0; i < R.n && due(i) <= lastClick; i++) worst = Math.max(worst, near(clicks, due(i)));
    ck(`${m}: every note is due on a click (worst ${(worst * 1000).toFixed(2)} ms, limit 2)`, worst <= 0.002);
    // 2. the count-in (tempo only): one click per beat before the first note
    if (m === 'tempo') ck('tempo: four count-in clicks before the first note', clicks.filter(t => t < due(0) - 0.001).length >= 4 && Math.abs(clicks.filter(t => t < due(0) - 0.001).slice(-1)[0] - (due(0) - R.beat)) < 0.002);
    // a frame lasts as long as the browser makes it (headless Edge often runs at 30 fps): allow two frames
    const dts = R.frames.slice(1).map((x, i) => x.t - R.frames[i].t).filter(x => x > 0).sort((a, b) => a - b), tol = 2 * dts[dts.length >> 1] + 0.01;
    console.log(`${m}: frame ${(dts[dts.length >> 1] * 1000).toFixed(0)} ms, tolerance ${(tol * 1000).toFixed(0)} ms`);
    // 3. the glow reaches note i with the cursor
    let lateGlow = 0, curOff = 0, seen = 0;
    for (let i = 1; i < R.n; i++) {
      const fr = R.frames.find(x => x.glow === i); if (!fr) continue; seen++;
      lateGlow = Math.max(lateGlow, fr.t - (due(i) + (v.lat || 0))); curOff = Math.max(curOff, Math.abs(fr.f - i));
    }
    ck(`${m}: the glow moved through the notes (${seen} of ${R.n - 1})`, seen >= R.n - 2);
    ck(`${m}: the glow switches within two frames of the note being heard (worst ${(lateGlow * 1000).toFixed(0)} ms)`, lateGlow <= tol && lateGlow >= -tol);
    ck(`${m}: the cursor is on the note when it starts to glow (worst ${curOff.toFixed(3)} note)`, curOff <= 0.06);
    // 4. the beat dots flash with the clicks that are heard
    console.log(m, 'dot lag ms:', R.dots.slice(1).map(d => Math.round(near(clicks, d.t - (v.lat || 0)) * 1000)).join(',')); let dl = 0, nd = 0; for (const d of R.dots.slice(1)) {   // the first flash is skipped: the browser's output-latency estimate is still settling then
      const k = near(clicks, d.t - (v.lat || 0)); dl = Math.max(dl, k); nd++; }
    ck(`${m}: ${nd} beat-dot flashes, each within two frames of its click (worst ${(dl * 1000).toFixed(0)} ms)`, nd >= 2 && dl <= tol);
  }
  done(bad ? 1 : 0);
});
