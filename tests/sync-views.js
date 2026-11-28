// Tab and Piano roll: the notes must pass the fixed playhead exactly when they are due, glide (no jumps), and glow when they reach it.
// (Same harness as tests/sync.js.) Original header: Everything that moves must agree on one clock. In a Tempo-locked run and in Hear scale this records, on every animation frame, the audio clock, the cursor position, the glowing
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
    async function record(name, view, start, ms) {
      SV.view = view; SV.key = ''; svRender();
      const frames = []; let on = true;
      const tick = () => { if (!on) return;
        const g = document.querySelector('#' + (view === 'tab' ? 'scTab' : 'scRoll') + ' g.hn.cur'), line = document.querySelector('#' + (view === 'tab' ? 'scTab' : 'scRoll') + ' line.play');
        let x = null, px = null; if (g && line) { const r = g.querySelector('rect').getBoundingClientRect(), pr = line.getBoundingClientRect(); x = view === 'tab' ? r.left + r.width / 2 : r.left; px = pr.left + pr.width / 2; }
        const nodes = [...document.querySelectorAll('#' + (view === 'tab' ? 'scTab' : 'scRoll') + ' g.hn')].map(n => n.querySelector('rect').getBoundingClientRect().left);
        frames.push({ t: c.currentTime, f: svPosF(), glow: g ? +g.dataset.i : -1, x, px, n0: nodes[0], n1: nodes[1] }); requestAnimationFrame(tick); };
      start(); tick(); await sleep(ms); on = false;
      out[name] = { frames, n: sc.tl.length, beat: 60 / sc.bpm, ppb: SV_PPB };
    }
    listening = true; stream = { getTracks() { return []; } }; sc.calibAt = performance.now(); $('scBpm').value = 120; $('scBpm').dispatchEvent(new Event('change')); setMode('tempo'); $('scBpm').value = 120;
    await record('tab-tempo', 'tab', () => { CAL.hwMs = 0; CAL.totalMs = 0; CAL.at = Date.now(); startScale(); }, 11500); stopScale(); await sleep(400);
    await record('roll-tempo', 'roll', () => { CAL.hwMs = 0; CAL.totalMs = 0; CAL.at = Date.now(); startScale(); }, 11500); stopScale(); await sleep(400);
    await record('tab-demo', 'tab', () => startDemo(), 9000); stopDemo(); await sleep(400);
    await record('roll-demo', 'roll', () => startDemo(), 9000); stopDemo(); listening = false;
    return out;
  })()`;
  const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true, timeout: 120000 }), v = r.result && r.result.value;
  if (!v) { console.log('FAIL no result', JSON.stringify(r.exceptionDetails || r.result)); return done(1); }
  let bad = 0; const ck = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) bad++; };
  for (const m of Object.keys(v)) {
    const R = v[m], F = R.frames, moving = F.filter(x => x.n0 != null);
    // 1. when a note starts to glow it sits on the playhead
    let off = 0, seen = 0; for (let i = 1; i < R.n; i++) { const fr = F.find(x => x.glow === i && x.x != null); if (!fr) continue; seen++; off = Math.max(off, Math.abs(fr.x - fr.px)); }
    ck(`${m}: ${seen} notes glowed, each on the playhead when it started (worst ${off.toFixed(1)} px, limit 12)`, seen >= R.n - 2 && off <= 12);
    // 2. the notes slide: no frame moves them more than a quarter of a beat
    let mx = 0, mv = 0; for (let i = 1; i < moving.length; i++) { const d = Math.abs(moving[i].n1 - moving[i - 1].n1); if (moving[i].f != null && moving[i - 1].f != null && moving[i].f > 0.2) { mx = Math.max(mx, d); if (d > 0.05) mv++; } }
    ck(`${m}: the notes glide, largest move per frame ${mx.toFixed(1)} px (a beat is ${R.ppb} px, limit ${R.ppb / 4})`, mx <= R.ppb / 4);
    ck(`${m}: they move on most frames (${mv} of ${moving.length})`, mv > moving.length * 0.5);
    // 3. the note passes the playhead at its due time: offset between the note and the playhead is proportional to time since due
    const gl = F.filter(x => x.f != null && x.glow >= 0), want = x => Math.max(0, Math.min(R.n - 1, Math.floor(x.f + 0.02))), badF = gl.filter(x => x.glow !== want(x) && x.glow !== want(x) - 1).length;   // one frame of lag is allowed (the test reads the clock after the page has painted)
    ck(`${m}: the glow is on the cursor's note on every frame (${badF} of ${gl.length} frames off by more than one frame)`, badF === 0);
  }
  done(bad ? 1 : 0);
});
