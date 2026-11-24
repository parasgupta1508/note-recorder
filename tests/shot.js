// Renders the Recorder with sample notes in headless Edge/Chrome and saves screenshots (to look at the display).
// Run: node tests/shot.js [outDir]   -> fall-phone.png, fall-tablet.png, sheet-tablet.png, fall-full.png
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const root = path.join(__dirname, '..'), out = process.argv[2] || os.tmpdir();
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/json' };
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
if (!exe) { console.log('No Edge/Chrome found'); process.exit(0); }
const HOOK = `window.__t = { load(mode, full) {
  const N = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'], mk = (m, s, d, o = {}) => ({ midi: m, note: N[m % 12] + (Math.floor(m / 12) - 1), hz: 440 * Math.pow(2, (m - 69) / 12), cents: o.c || 0, start: s, dur: d, lvl: -20, pts: o.vib ? Array.from({ length: 40 }, (_, i) => [Math.round(i * d / 40), Math.round(22 * Math.sin(i / 40 * d / 1000 * 5.5 * 6.28))]) : [], vib: o.vib ? { rate: 5.5, width: 44 } : null });
  const seq = [[76,0,.5],[74,.5,.5],[72,1,.5],[71,1.5,.5],[72,2,1.6,{vib:1}],[74,3.7,.4],[76,4.1,.4],[79,4.5,.9,{vib:1}],[77,5.5,.5],[76,6,.5],[72,6.5,.5],[67,7,1.2,{c:18}],[60,8.4,.5],[64,8.9,.5],[69,9.4,.6]];
  newRecording(); events = []; for (const q of seq) addEvent(Object.assign(mk(q[0], q[1], q[2] * 1000, q[3] || {}), { start: q[1] })); recEnd = 10; recT0 = 0;
  setView(mode); pb.pos = 2.6; view.follow = false; view.vs = 0; view.pps = 70; if (full) setFS(true); requestDraw(); recUi();
} };`;
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
srv.listen(0, async () => {
  const port = srv.address().port;
  fs.writeFileSync(path.join(root, '_shot.html'), fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('</body>', '<script>' + HOOK + '</script></body>'));
  const dbg = 9333 + Math.floor(Math.random() * 500), prof = path.join(os.tmpdir(), 'edge_shot_' + Date.now());
  const br = spawn(exe, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + dbg, '--user-data-dir=' + prof, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const done = code => { try { br.kill(); } catch {} try { fs.unlinkSync(path.join(root, '_shot.html')); } catch {} srv.close(); setTimeout(() => process.exit(code), 300); };
  let tabs; for (let i = 0; i < 40 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await new Promise(r => setTimeout(r, 500)); } }
  if (!tabs) { console.log('browser did not start'); return done(1); }
  const ws = new WebSocket(tabs.find(x => x.type === 'page').webSocketDebuggerUrl); let id = 0; const pend = {};
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pend[n] = r; ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend[m.id]) pend[m.id](m.result); };
  await new Promise(r => ws.onopen = r); await send('Page.enable'); await send('Runtime.enable');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shot = async (name, w, h, mode, full) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 600 });
    await send('Page.navigate', { url: `http://localhost:${port}/_shot.html` }); await wait(1500);
    await send('Runtime.evaluate', { expression: `document.querySelector('[data-tab=rec],#tabRec') && 0; [...document.querySelectorAll('button,a,[role=tab]')].find(b => /record/i.test(b.textContent) && b.closest('nav,.tabs,header,.appbar,[role=tablist]')).click(); window.__t.load('${mode}', ${!!full})` });
    await wait(700);
    const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, name), Buffer.from(r.data, 'base64')); console.log('saved', path.join(out, name));
  };
  await shot('fall-phone.png', 390, 800, 'fall'); await shot('fall-tablet.png', 900, 1000, 'fall'); await shot('sheet-tablet.png', 900, 1000, 'sheet'); await shot('fall-full.png', 1000, 620, 'fall', true); await shot('sheet-pc.png', 1280, 900, 'sheet');
  done(0);
});
