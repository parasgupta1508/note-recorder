// End-to-end test of the Lab page in headless Edge/Chrome, with its own helper server: upload a synthetic violin clip, make MIDI (McLeod engine),
// compare with the app's Live detector, tune, and check the page recorded what it learned. node tests/smoke-lab.js   (needs ffmpeg and tools/node_modules; about 20 s)
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const S = require('./lib/synth.js'), root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
if (!exe) { console.log('No Edge/Chrome found - skipped'); process.exit(0); }
if (cp.spawnSync('ffmpeg', ['-version']).status !== 0) { console.log('ffmpeg not found - skipped'); process.exit(0); }
const SR = 44100; S.setSeed(11); const b = S.mk(14, SR); let t = 0.4, m = 64;
for (const step of [0, 2, 2, -4, 5, -2, 0, 3, -5, 2, 4, -3, 2, 0, -2, 4, 2, -2, 3, -3, 2, 2]) { m += step; S.INST.violin(b, m, t, 0.42, { sr: SR, vib: 12, attack: 0.04, rel: 0.04, detune: 0 }); t += 0.5; }
S.noise(b, 0.003);
const wav = Buffer.alloc(44 + b.length * 2); wav.write('RIFF', 0); wav.writeUInt32LE(36 + b.length * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(b.length * 2, 40);
for (let i = 0; i < b.length; i++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, b[i])) * 32767), 44 + i * 2);
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); if (u === '/__t.wav') { r.writeHead(200, { 'Content-Type': 'audio/wav' }); return r.end(wav); } fs.readFile(path.join(root, u.replace(/^\/$/, '/index.html')), (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': types[path.extname(u)] || 'application/octet-stream' }); r.end(d); } }); });
srv.listen(0, async () => {
  const port = srv.address().port, hp = 20000 + Math.floor(Math.random() * 9000), dbg = 9333 + Math.floor(Math.random() * 500), prof = path.join(os.tmpdir(), 'edge_lab_' + Date.now());
  const helper = cp.spawn(process.execPath, [path.join(root, 'tools', 'lab', 'server.js')], { env: { ...process.env, LAB_PORT: String(hp) }, stdio: 'ignore' });
  const br = cp.spawn(exe, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + dbg, '--user-data-dir=' + prof, '--window-size=420,1000', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
  const done = () => { try { br.kill(); } catch {} try { helper.kill(); } catch {} srv.close(); try { const d = path.join(root, 'tools', 'lab', 'data'); for (const n of fs.readdirSync(d)) { try { if (JSON.parse(fs.readFileSync(path.join(d, n, 'info.json'), 'utf8')).title === 'synthetic violin.wav') fs.rmSync(path.join(d, n), { recursive: true, force: true }); } catch {} } for (const f of fs.readdirSync(path.join(d, '_full'))) if (f.startsWith('up')) fs.rmSync(path.join(d, '_full', f), { force: true }); } catch {} setTimeout(() => process.exit(fail ? 1 : 0), 300); };
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${hp}/api/status`)).ok) break; } catch { await new Promise(r => setTimeout(r, 250)); } }   // wait for the helper
  let tabs; for (let i = 0; i < 40 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await new Promise(r => setTimeout(r, 500)); } }
  if (!tabs) { ok(false, 'browser started'); return done(); }
  const ws = new WebSocket(tabs.find(x => x.type === 'page').webSocketDebuggerUrl); let id = 0; const pend = {}, errs = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend[m.id]) pend[m.id](m.result); if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pend[n] = r; ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await new Promise(r => setTimeout(r, 400)); } ok(false, 'timed out waiting for ' + what); return false; };
  await new Promise(r => ws.onopen = r); await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: `http://localhost:${port}/index.html` });
  try {
    await until("document.readyState==='complete' && typeof labConnect==='function'", 15000, 'page'); ok(!errs.length, 'page loads without script errors ' + errs.join('|').slice(0, 200));
    await ev("showTab('lab'); 1");
    await until("$('labState').textContent!=='checking…'", 8000, 'first connect attempt'); await ev("$('labUrl').value='http://localhost:" + hp + "'; 1"); await ev("labConnect()");
    ok(await ev("LAB.ok"), 'connects to the helper'); ok(await ev("!$('tab-lab').classList.contains('hide')"), 'Lab tab opens');
    ok(await ev("$('labEngPick').querySelectorAll('input').length>=3"), 'engine list is shown');
    await ev("$('labEngPick').querySelectorAll('input').forEach(i => i.checked = i.value==='mpm'); fetch('/__t.wav').then(r => r.blob()).then(b => labFileChosen(new File([b], 'synthetic violin.wav'))); 1");
    ok(await until("LAB.cur && LAB.cur.id && !LAB.busy", 60000, 'clip upload'), 'audio file is cut into a clip by the helper');
    ok(await ev("LAB.cur.dur > 13 && LAB.cur.dur < 15.5"), 'clip is decoded in the page (' + await ev("LAB.cur.dur.toFixed(1)") + ' s)');
    await ev("labMake(); 1"); ok(await until("LAB.cur.refs.mpm && !LAB.busy", 60000, 'MIDI'), 'reference MIDI is made by the helper (' + await ev("LAB.cur.refs.mpm ? LAB.cur.refs.mpm.length : 0") + ' notes)');
    await ev("$('labApp').value='live'; labRun(); 1"); await until("LAB.last && !LAB.busy", 60000, 'comparison');
    const f1 = await ev("LAB.last && LAB.last.cmp.f1"); ok(f1 >= 0.8, `app agrees with the reference on a clean violin clip (F1 ${f1 && f1.toFixed(2)})`);
    ok(await ev("!$('labRoll').classList.contains('hide') && $('labCv').width > 100"), 'note chart is drawn'); ok(await ev("$('labRes').textContent.includes('Agreement')"), 'result tiles are shown');
    ok(await ev("!$('labDl').disabled"), 'app notes can be downloaded as MIDI');
    await ev("labTune(); 1"); await until("LAB.last && LAB.last.tune && !LAB.busy", 120000, 'tuning'); ok(await ev("LAB.last.tune && LAB.last.tune.length===15"), 'tuning tried 15 Live settings');
    ok(await ev("LAB.store.hist.length>=16"), 'comparisons are remembered'); ok(await ev("$('labHist').textContent.includes('Avg F1')"), '"What it has learned" table is filled');
    await ev("document.querySelector('#labRes [data-use]').click(); 1"); ok(await ev("$('recMode').value===LAB.last.tune[0].mode"), '"Use" applies the best settings to the Recorder');
    await ev("(async()=>{const o=$('labLib'); 1})()"); await ev("labLoadLib()"); ok(await ev("LAB.lib.length>=1 && LAB.lib[0].engines.includes('mpm')"), 'clip and MIDI are saved in the helper library');
    if (process.env.SEP) {                                                      // optional (slow): separate the instruments first, then find notes in one part
      ok(await ev("LAB.status.tools.separate"), 'Demucs separation is installed');
      await ev("$('labStem').value='other'; labMake(); 1"); ok(await until("LAB.cur.refs['mpm.other'] && !LAB.busy", 300000, 'separation + MIDI'), 'notes from the separated "other" part (' + await ev("LAB.cur.refs['mpm.other'] ? LAB.cur.refs['mpm.other'].length : 0") + ' notes)');
      ok(await ev("[...$('labRef').options].some(o => o.value === 'mpm.other' && o.textContent.includes('other'))"), 'separated part is listed as a reference');
    }
    ok(!errs.length, 'no script errors during the run ' + errs.join('|').slice(0, 300));
    if (process.env.SHOT) { await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 2300, deviceScaleFactor: 1, mobile: true }); await new Promise(r => setTimeout(r, 500)); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(process.env.SHOT, Buffer.from(r.data, 'base64')); console.log('screenshot ->', process.env.SHOT); }
  } catch (e) { ok(false, 'test crashed: ' + e.message); }
  done();
});
