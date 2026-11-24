// Tests the Detailed (Basic Pitch) path in headless Edge/Chrome over a local web server, with a synthetic recording.
// Run: node tests/smoke-detailed.js     (slow: loads TensorFlow.js; the microphone is not needed)
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.webmanifest': 'application/json' };
const browsers = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const exe = browsers.find(fs.existsSync); if (!exe) { console.log('No Edge/Chrome found - skipped'); process.exit(0); }
const HOOK = `window.__selftest = { async run(f32, rate) { newRecording(); cap.rate = rate; const i16 = new Int16Array(f32.length); for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767))); cap.chunks = [i16]; cap.n = i16.length; engine = 'det'; events = []; await analyseDetailed(); return { info: $('recInfo').textContent, live: liveEv && liveEv.length, det: detEv && detEv.map(e => [e.note, +e.start.toFixed(2), Math.round(e.dur)]) }; } };`;
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
srv.listen(0, () => {
  const port = srv.address().port, probe = `<script>(async()=>{try{
    const sr=16000,N=sr*6,x=new Float32Array(N),seq=[[69,0.3,1.4],[71,1.8,1.4],[73,3.3,1.4],[69,4.8,0.9]];
    for(const [m,t0,d] of seq){const f=440*Math.pow(2,(m-69)/12);for(let i=0;i<d*sr;i++){const t=i/sr,env=Math.min(1,t/0.03)*Math.min(1,(d-t)/0.05);let v=0;for(let h=1;h<=5;h++)v+=Math.sin(2*Math.PI*f*h*t)/h;x[Math.floor(t0*sr)+i]+=0.3*env*v}}
    const r=await window.__selftest.run(x,sr);document.title='RESULT|'+JSON.stringify(r)}catch(e){document.title='RESULT|ERR '+e.message}})()</script>`;
  fs.writeFileSync(path.join(root, '_probe.html'), fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('</body>', '<script>' + HOOK + '</script>' + probe + '</body>'));
  const { spawn } = require('child_process'), dbg = 9333 + Math.floor(Math.random() * 500), prof = path.join(require('os').tmpdir(), 'edge_det_' + Date.now());
  const br = spawn(exe, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + dbg, '--user-data-dir=' + prof, '--window-size=420,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const done = (code, msg) => { console.log(msg); try { br.kill(); } catch {} try { fs.unlinkSync(path.join(root, '_probe.html')); } catch {} srv.close(); setTimeout(() => process.exit(code), 300); };
  (async () => {
    let tabs; for (let i = 0; i < 40 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await new Promise(r => setTimeout(r, 500)); } }
    if (!tabs) return done(1, 'FAIL browser did not start');
    const ws = new WebSocket(tabs.find(x => x.type === 'page').webSocketDebuggerUrl); let id = 0; const pend = {}, errs = [];
    const send = (method, params = {}) => new Promise(r => { const n = ++id; pend[n] = r; ws.send(JSON.stringify({ id: n, method, params })); });
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend[m.id]) pend[m.id](m.result); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') if (!/already registered|Platform browser|WebGL is not supported|Initialization of backend/.test(m.params.args.map(a => a.value || a.description || '').join(' '))) console.log('  page warning:', m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 600)); if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
    await new Promise(r => ws.onopen = r); await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: `http://localhost:${port}/_probe.html` });
    const t0 = Date.now(); let res = null;
    while (Date.now() - t0 < 280000) { await new Promise(r => setTimeout(r, 1500)); const r = await send('Runtime.evaluate', { expression: 'document.title' }); const v = r && r.result && r.result.value; if (v && v.startsWith('RESULT|')) { res = v.slice(7); break; } }
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (!res) return done(1, 'FAIL no result after ' + secs + 's. Errors: ' + errs.join(' | ').slice(0, 400));
    let ok = !/^ERR/.test(res) && !errs.length;
    try { const o = JSON.parse(res); ok = ok && Array.isArray(o.det) && o.det.length >= 3; console.log('notes found:', JSON.stringify(o.det), '| ' + o.info); } catch { console.log(res); ok = false; }
    done(ok ? 0 : 1, (ok ? 'PASS' : 'FAIL') + ' Detailed analysis in the browser (' + secs + 's)' + (errs.length ? ' errors: ' + errs.join(' | ').slice(0, 300) : ''));
  })();
});
