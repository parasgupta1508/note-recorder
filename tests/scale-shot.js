// Screenshots of the four scale displays (Staff, Tab, Fingerboard, Piano roll) in headless Edge/Chrome, to look at after any display change.
// Run: node tests/scale-shot.js [outDir]   -> scale-<instrument>-<view>-<size>.png
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const root = path.join(__dirname, '..'), out = process.argv[2] || os.tmpdir();
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/json' };
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
if (!exe) { console.log('No Edge/Chrome found'); process.exit(0); }
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
srv.listen(0, async () => {
  const port = srv.address().port, dbg = 9333 + Math.floor(Math.random() * 500), prof = path.join(os.tmpdir(), 'edge_scshot_' + Date.now());
  const br = spawn(exe, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + dbg, '--user-data-dir=' + prof, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const done = code => { try { br.kill(); } catch {} srv.close(); setTimeout(() => process.exit(code), 300); };
  let tabs; for (let i = 0; i < 40 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await new Promise(r => setTimeout(r, 500)); } }
  if (!tabs) { console.log('browser did not start'); return done(1); }
  const ws = new WebSocket(tabs.find(x => x.type === 'page').webSocketDebuggerUrl); let id = 0; const pend = {};
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pend[n] = r; ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend[m.id]) pend[m.id](m.result); };
  await new Promise(r => ws.onopen = r); await send('Page.enable'); await send('Runtime.enable');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ev = async js => (await send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })).result;
  const jobs = [['violin', 'staff'], ['violin', 'tab'], ['violin', 'board'], ['violin', 'roll'], ['guitar', 'tab'], ['guitar', 'board'], ['chromatic', 'staff'], ['chromatic', 'board'], ['violin', 'staff', 3], ['guitar', 'staff'], ['violin', 'staff', 2, 'minor']];
  const sizes = [['laptop', 1366, 800, 1], ['tablet', 820, 1100, 1], ['phone', 390, 844, 2]];
  for (const [sn, w, h, dpr] of sizes) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: w < 600 });
    await send('Page.navigate', { url: `http://localhost:${port}/index.html` }); await wait(1500); await ev(`SV.showNeck = true`);   // the instrument under the staff is shown in these pictures
    for (const [inst, view, span, kind] of jobs) {
      await ev(`showTab('scale'); document.getElementById('firstRun').classList.add('hide'); (function(){var s=document.getElementById('scInst'); s.value='${inst}'; s.dispatchEvent(new Event('change')); var sp=document.getElementById('scSpan'); sp.value='${span || 1}'; sp.dispatchEvent(new Event('change')); var ty=document.getElementById('scType'); ty.value='${kind === 'minor' ? 'harmonicMinor' : 'major'}'; ty.dispatchEvent(new Event('change')); SV.view='${view}'; demoIdx=${view === 'roll' || view === 'tab' ? 5 : 3}; SV.key=''; svRender();})()`);
      await wait(700);
      const r = await ev(`(function(){var e=document.getElementById('scPlayer'); e.scrollIntoView(); var b=e.getBoundingClientRect(); return {x:b.x,y:b.y+scrollY,w:b.width,h:b.height};})()`);
      const b = r.value; if (!b) { console.log('no player for', inst, view); continue; }
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: 1 } });
      const f = path.join(out, `scale-${inst}-${view}${span ? '-' + span + 'oct' : ''}${kind ? '-' + kind : ''}-${sn}.png`); fs.writeFileSync(f, Buffer.from(shot.data, 'base64')); console.log(f);
    }
  }
  // VERSHOT: the version line under Settings
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `http://localhost:${port}/index.html` }); await wait(2500);
  await ev(`document.getElementById('firstRun').classList.add('hide'); showTab('settings'); window.scrollTo(0, 99999)`); await wait(1500);
  console.log('version line:', (await ev(`document.getElementById('appVer').textContent`)).value);
  fs.writeFileSync(path.join(out, 'settings-version.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  // Settings screens: grading (violin and guitar), engines
  const settingsShot = async (name, js, w, h) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 600 }); await send('Page.navigate', { url: `http://localhost:${port}/index.html` }); await wait(1500);
    await ev(`document.getElementById('firstRun').classList.add('hide'); showTab('settings'); ${js}; 1`); await wait(500);
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); };
  await settingsShot('settings-grading-violin-phone', `$('scInst').value='violin'; $('scInst').dispatchEvent(new Event('change')); setCur='grading'; renderSet()`, 400, 800);
  await settingsShot('settings-grading-guitar-phone', `$('scInst').value='guitar'; $('scInst').dispatchEvent(new Event('change')); setCur='grading'; renderSet()`, 400, 800);
  await settingsShot('settings-grading-violin-laptop', `$('scInst').value='violin'; $('scInst').dispatchEvent(new Event('change')); setCur='grading'; renderSet()`, 1100, 700);
  await settingsShot('settings-engines-phone', `setCur='engines'; renderSet()`, 400, 800);
  await settingsShot('settings-engines-laptop', `setCur='engines'; renderSet()`, 1100, 700);
  done(0);
});
