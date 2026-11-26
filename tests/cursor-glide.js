// The staff cursor must glide, never jump: samples its position (in notes) on every animation frame in Hear scale and in Wait-for-note (target moved by hand every 0.7 s)
// and checks that no single frame moves it more than 0.35 of a note, and that it moves on most frames. Headless Edge/Chrome, no microphone.
// Run: node tests/cursor-glide.js
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
    $('scBpm').value = 90; $('scBpm').dispatchEvent(new Event('change')); $('scSpan').value = 1; $('scSpan').dispatchEvent(new Event('change'));
    const sample = (ms, each) => new Promise(res => { const xs = [], t = performance.now(); const tick = () => { const f = svPosF(); if (f != null) xs.push(f); if (each) each(performance.now() - t); if (performance.now() - t < ms) requestAnimationFrame(tick); else res(xs); }; tick(); });
    const stat = xs => { let mx = 0, mv = 0; for (let i = 1; i < xs.length; i++) { const d = Math.abs(xs[i] - xs[i - 1]); mx = Math.max(mx, d); if (d > 1e-4) mv++; } return { frames: xs.length, maxStep: +mx.toFixed(3), movingFrames: +(mv / Math.max(1, xs.length - 1)).toFixed(2), from: +xs[0].toFixed(2), to: +xs[xs.length - 1].toFixed(2) }; };
    const out = {};
    startDemo(); out.demo = stat(await sample(3000)); stopDemo(); await sleep(200);
    setMode('wait'); sc.running = true; sc.pos = 0; sc.plan = sc.plan || planNow(); let k = 0;
    out.wait = stat(await sample(3500, ms => { const want = Math.floor(ms / 700); if (want > k) { k = want; sc.pos = Math.min(k, sc.tl.length - 1); } })); sc.running = false;
    return out;
  })()`;
  const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true, timeout: 60000 }), v = r.result && r.result.value;
  if (!v) { console.log('FAIL no result', JSON.stringify(r.exceptionDetails || r.result)); return done(1); }
  let bad = 0; const ck = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) bad++; };
  for (const m of ['demo', 'wait']) { const x = v[m]; console.log(m, JSON.stringify(x)); ck(`${m}: the cursor never jumps (largest step ${x.maxStep} note per frame, limit 0.35)`, x.maxStep <= 0.35); ck(`${m}: it moves on most frames (${x.movingFrames})`, x.movingFrames >= 0.5); ck(`${m}: it advanced (${x.from} to ${x.to})`, x.to > x.from + 1); }
  done(bad ? 1 : 0);
});
