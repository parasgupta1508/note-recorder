// Navigation safety net: loads the app in headless Edge/Chrome at phone (375 px) and desktop (1280 px) widths,
// visits every tab, and checks: no script errors, no horizontal page overflow, the tab bar is well formed,
// and each click shows exactly its own panel. Saves a screenshot of every tab to tests/_shots/before/ (git-ignored).
// Run: node tests/smoke-nav.js [outDir]        STRICT_ROLES=1 also fails when ARIA tab roles are missing.
// UI2 checks: five main tabs with ARIA roles, no global Start button, Scale drills / Free record / Lab reachable with the right tab lit, arrow keys walk every tab.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const root = path.join(__dirname, '..'), out = process.argv[2] || path.join(__dirname, '_shots', 'before');
const STRICT = process.env.STRICT_ROLES !== '0';   // ARIA tab roles are required since UI2 (STRICT_ROLES=0 only warns)
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
if (!exe) { console.log('No Edge/Chrome found - skipped'); process.exit(0); }
fs.mkdirSync(out, { recursive: true });

// Runs in the page for one tab: click it, report which panels show, and measure page width.
const PAGE_CHECK = `(async () => {
  if (!PROFILES.length) addPlayer('Student');   // a new device asks who is practising first (checked separately below)
  const btns = [...document.querySelectorAll('nav.tabs button[data-tab]')];
  const res = { tabs: btns.map(b => b.dataset.tab), items: [] };
  for (const b of btns) {
    b.click(); await new Promise(r => setTimeout(r, 400));
    const t = b.dataset.tab, panels = [...document.querySelectorAll('section.panel')];
    const shown = panels.filter(p => !p.classList.contains('hide')).map(p => p.id);
    const de = document.documentElement;
    res.items.push({ tab: t, shown, on: btns.filter(x => x.classList.contains('on')).map(x => x.dataset.tab),
      overflow: Math.max(de.scrollWidth, document.body.scrollWidth) - innerWidth });
  }
  const wait = ms => new Promise(r => setTimeout(r, ms)), shownNow = () => [...document.querySelectorAll('section.panel')].filter(p => !p.classList.contains('hide')).map(p => p.id);
  res.noStart = !document.getElementById('start') && !/start listening/i.test(document.querySelector('header').textContent);
  res.controls = btns.every(b => document.getElementById(b.getAttribute('aria-controls')));
  res.sub = [];
  for (const [k, parent] of [['scale', 'home'], ['rec', 'home'], ['lab', 'settings']]) { showTab(k); await wait(300); res.sub.push({ k, shown: shownNow(), lit: btns.filter(x => x.classList.contains('on')).map(x => x.dataset.tab), sel: btns.filter(x => x.getAttribute('aria-selected') === 'true').map(x => x.dataset.tab), parent }); }
  btns[0].click(); await wait(200); btns[0].focus(); res.kb = [btns[0].dataset.tab];
  for (let i = 1; i < btns.length; i++) { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await wait(200); res.kb.push(document.activeElement.dataset.tab + ':' + shownNow().join()); }
  btns[0].click();
  const nav = document.querySelector('nav.tabs');
  res.nav = { label: nav.getAttribute('aria-label'), allButtons: btns.every(b => b.tagName === 'BUTTON' && b.textContent.trim().length > 0),
    roles: nav.getAttribute('role') === 'tablist' && btns.every(b => b.getAttribute('role') === 'tab' && b.hasAttribute('aria-selected')) };
  return JSON.stringify(res);
})()`;

const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
srv.listen(0, async () => {
  const port = srv.address().port, dbg = 9333 + Math.floor(Math.random() * 500), prof = path.join(os.tmpdir(), 'edge_nav_' + Date.now());
  const br = spawn(exe, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + dbg, '--user-data-dir=' + prof, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let bad = 0; const say = (ok, msg, warn) => { if (!ok && !warn) bad++; console.log((ok ? 'PASS ' : warn ? 'WARN ' : 'FAIL ') + msg); };
  const done = code => { try { br.kill(); } catch {} srv.close(); setTimeout(() => process.exit(code), 300); };
  let tabs; for (let i = 0; i < 40 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await new Promise(r => setTimeout(r, 500)); } }
  if (!tabs) { console.log('FAIL browser did not start'); return done(1); }
  const ws = new WebSocket(tabs.find(x => x.type === 'page').webSocketDebuggerUrl); let id = 0; const pend = {}, errs = [];
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pend[n] = r; ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend[m.id]) pend[m.id](m.result);
    else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errs.push((d.exception && d.exception.description || d.text || 'error').split('\n')[0]); } };
  await new Promise(r => ws.onopen = r); await send('Page.enable'); await send('Runtime.enable');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (const [label, w, h] of [['phone', 375, 800], ['tablet', 820, 1100], ['desktop', 1280, 900]]) {
    errs.length = 0;
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await send('Page.navigate', { url: `http://localhost:${port}/index.html` }); await wait(1500);
    const r = await send('Runtime.evaluate', { expression: PAGE_CHECK, awaitPromise: true, returnByValue: true });
    if (!r || !r.result || typeof r.result.value !== 'string') { say(false, `${label}: page check did not run ${JSON.stringify(r && r.exceptionDetails && r.exceptionDetails.text)}`); continue; }
    const res = JSON.parse(r.result.value);
    say(res.tabs.length > 0, `${label}: ${res.tabs.length} tabs found (${res.tabs.join(', ')})`);
    say(!!res.nav.label && res.nav.allButtons, `${label}: tab bar is a labelled nav of text buttons`);
    say(res.nav.roles, `${label}: ARIA tab roles (tablist/tab/aria-selected) present`, !STRICT);
    say(res.noStart, `${label}: no global Start listening button`);
    say(res.controls, `${label}: every tab points at an existing panel (aria-controls)`);
    for (const sb of res.sub) say(sb.shown.length === 1 && sb.shown[0] === 'tab-' + sb.k && sb.lit.join() === sb.parent && sb.sel.join() === sb.parent, `${label}: "${sb.k}" is reachable and keeps "${sb.parent}" lit`);
    say(res.kb.length === res.tabs.length && res.kb.slice(1).every((x, i) => x === res.tabs[i + 1] + ':tab-' + res.tabs[i + 1]), `${label}: arrow keys reach every tab (${res.kb.join(' > ')})`);
    for (const it of res.items) {
      say(it.shown.length === 1 && it.shown[0] === 'tab-' + it.tab && it.on.length === 1 && it.on[0] === it.tab, `${label}: "${it.tab}" shows only its own panel and is the only active tab`);
      say(it.overflow <= 0, `${label}: "${it.tab}" has no horizontal overflow${it.overflow > 0 ? ' (' + it.overflow + ' px too wide)' : ''}`);
      await send('Runtime.evaluate', { expression: `document.querySelector('nav.tabs button[data-tab=${it.tab}]').click()` }); await wait(400);
      const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${label}-${it.tab}.png`), Buffer.from(s.data, 'base64'));
    }
    // screens reached from Practice / Settings: screenshots, overflow, and the declutter rules
    const evl = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r && r.result && r.result.value; };
    for (const k of ['scale', 'rec', 'lab']) {
      await evl(`showTab('${k}')`); await wait(500);
      const ov = await evl('Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth');
      say(ov <= 0, `${label}: "${k}" has no horizontal overflow${ov > 0 ? ' (' + ov + ' px too wide)' : ''}`);
      const sh = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, `${label}-${k}.png`), Buffer.from(sh.data, 'base64'));
    }
    await evl("showTab('tuner')"); await wait(400);
    say(await evl("[...document.querySelectorAll('#instChips .chip')].map(b => b.textContent).join() === 'Violin,Guitar,Ukulele,Piano'"), `${label}: Tuner offers Violin, Guitar, Ukulele, Piano`);
    say(await evl("[...document.querySelectorAll('#instChips .chip')].every(b => b.getBoundingClientRect().right <= innerWidth && b.getBoundingClientRect().height >= 40)"), `${label}: Tuner chips fit the screen and are at least 40 px tall`);
    say(await evl("const b = document.getElementById('chromBtn'), was = inst; b.click(); const flipped = (inst === 'chromatic') !== (was === 'chromatic') && b.getAttribute('aria-pressed') === String(inst === 'chromatic'); b.click(); flipped && (inst === 'chromatic') === (was === 'chromatic')"), `${label}: the Chromatic switch flips and flips back`);
    await evl("showTab('rec')"); await wait(300);
    say(await evl("!document.getElementById('rec').disabled"), `${label}: the Record button is usable before the microphone is on`);
    say(await evl("const m = document.getElementById('recMore'); !m.open && m.contains(document.getElementById('recMode')) && !m.contains(document.getElementById('engSeg')) && document.getElementById('engSeg').textContent.includes('Careful')"), `${label}: Free record hides the extra controls under More options and shows Instant / Careful`);
    say(errs.length === 0, `${label}: no script errors${errs.length ? ' - ' + errs.join(' | ') : ''}`);
  }
  // players: a brand-new device asks who is practising; scores saved under the old names are found again; names with markup are refused
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r && r.exceptionDetails) console.log('  (page expression threw: ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split(String.fromCharCode(10))[0] + ')'); return r && r.result && r.result.value; };
  errs.length = 0; await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://localhost:${port}/index.html` }); await wait(800); await ev('localStorage.clear()');
  await send('Page.navigate', { url: `http://localhost:${port}/index.html` }); await wait(1200);
  say(await ev("!$('firstRun').classList.contains('hide') && PROFILES.length === 0"), 'players: a new device asks "Who is practising?"');
  say(await ev("$('frName').value = '<b>x</b>'; $('frForm').requestSubmit(); !$('firstRun').classList.contains('hide') && PROFILES.length === 0 && $('frMsg').textContent.length > 0"), 'players: a name with markup is refused');
  say(await ev("$('frName').value = 'Ada'; $('frForm').requestSubmit(); $('firstRun').classList.contains('hide') && PROFILES.join() === 'Ada' && $('profile').value === 'Ada' && JSON.parse(localStorage.getItem('tuner-players'))[0].name === 'Ada'"), 'players: a name is added, selected and saved');
  say(await ev("addPlayer('ada') !== '' && addPlayer('Bo') === '' && PROFILES.join() === 'Ada,Bo' && profile === 'Bo'"), 'players: duplicate refused (any case), a second player can be added');
  await ev("addEv(60, { k: 'h', c: 3, a: 0.9, s: 2 }, true); switchPlayer('Ada'); addEv(62, { k: 'h', c: 1, a: 0.8, s: 2 }, true); 1");
  await ev("localStorage.removeItem('tuner-players'); localStorage.setItem('tuner-profile', 'Ada'); 1");   // what a device from before this update looks like: scores under the names, no player list
  await send('Page.navigate', { url: `http://localhost:${port}/index.html` }); await wait(1200);
  say(await ev("PROFILES.join() === 'Ada,Bo' && profile === 'Ada' && !!cardAll[62] && $('firstRun').classList.contains('hide')"), 'players: scores saved before the update are found again by name, nothing is lost');
  await ev("showTab('analysis'); document.querySelector('#anMode button[data-m=cmp]').click(); 1"); await wait(300);
  say(await ev("document.querySelector('#anBody').textContent.includes('Ada') && document.querySelector('#anBody').textContent.includes('Bo')"), 'players: Compare shows both players');
  say(errs.length === 0, 'players: no script errors' + (errs.length ? ' - ' + errs.join(' | ') : ''));
  // engines: Settings > Engines is generated from the registry; a stub engine proves the choice reaches the Tuner and Recorder paths, and a failing engine cannot be picked
  errs.length = 0;
  await ev(`registerEngine({ id: 'stub-f0', role: 'f0', label: 'Stub pitch', version: '1', caps: { live: true, offline: true, needsHelper: false, license: 'test' }, params: { gain: { type: 'range', min: 0, max: 10, step: 1, default: 5, label: 'Gain' } }, calls: 0, frame() { this.calls++; return null; }, run() { return []; } });
    registerEngine({ id: 'stub-seg', role: 'segmenter', label: 'Stub notes', version: '1', caps: { live: true, offline: true, needsHelper: false, license: 'test' }, params: {}, create() { const g = new Segmenter(() => {}); g.__stub = true; return g; }, gate: recPitchCore, run() { return []; } });
    registerEngine({ id: 'bad-f0', role: 'f0', label: 'Broken pitch', version: '1', caps: { live: true, offline: true, needsHelper: false, license: 'test' }, params: {}, frame() { return null; }, run() { return [{ nope: 1 }]; } });
    showTab('settings'); renderEngines(); 1`);
  say(await ev("[...document.querySelectorAll('#engBody select')].every(s => s.options[0].value === 'auto') && !!document.querySelector('#engBody option[value=stub-f0]') && !document.querySelector('#engBody option[value=lab-mpm]')"), 'engines: Settings lists every registered engine per job (clip-only helper engines left out)');
  say(await ev("engineFor('f0','live').id === 'yin' && engineFor('segmenter','live').id === 'classic' && engineSummary() === 'Auto (built in)'"), "engines: Auto keeps today's engines");
  say(await ev("const s = document.querySelector('#engBody select[data-row=\"0\"]'); s.value = 'stub-f0'; s.dispatchEvent(new Event('change', { bubbles: true })); engineFor('f0','live').id === 'stub-f0' && engSet.default['f0:live'] === 'stub-f0'"), 'engines: choosing a pitch engine changes what the Tuner uses');
  say(await ev("(async () => { const tn = new Float32Array(44100 * 2); for (let i = 11025; i < 55125; i++) tn[i] = 0.4 * Math.sin(2 * Math.PI * 440 * i / 44100); const st = findEngine('f0', 'stub-f0'); st.calls = 0; await engineFor('segmenter','offline').run({ x: tn, sr: 44100 }, { ...engineOpts(), m: REC_MODES.fast, fmin: 180, fmax: 2400, conf: 0.85, a4: 440 }); return st.calls > 10; })()"), 'engines: the choice also reaches file analysis (the Recorder and Lab path)');
  say(await ev("const s2 = document.querySelector('#engBody select[data-row=\"1\"]'); s2.value = 'stub-seg'; s2.dispatchEvent(new Event('change', { bubbles: true })); seg.__stub === true"), "engines: choosing a note engine changes the Recorder's live segmenter");
  say(await ev("const r = document.querySelector('#engBody input[type=range][data-p=\"0|gain\"]'); r.value = '8'; r.dispatchEvent(new Event('input', { bubbles: true })); engineParam(findEngine('f0','stub-f0'), 'gain') === 8"), 'engines: parameters are generated from the engine and stored');
  await ev("document.querySelector('#engBody select[data-row=\"0\"]').value = 'bad-f0'; setEngineSettings({ ...engSet, default: { ...engSet.default, 'f0:live': 'bad-f0' } }); renderEngines(); document.querySelector('#engBody [data-test=\"0\"]').click(); 1"); await wait(400);
  say(await ev("findEngine('f0','bad-f0').contractFail === true && engineFor('f0','live').id === 'yin' && document.querySelector('#engBody option[value=bad-f0]').disabled"), 'engines: an engine that fails its check is not used and cannot be selected');
  await ev("document.querySelector('#engBody [data-reset=\"1\"]').click(); 1");
  say(await ev("document.querySelector('#engBody [data-test=\"1\"]') && (document.querySelector('#engBody [data-test=\"1\"]').click(), true)") && (await wait(600), await ev("/Passed all/.test(document.getElementById('engRes1').textContent)")), 'engines: Test this engine passes for a good engine');
  say(errs.length === 0, 'engines: no script errors' + (errs.length ? ' - ' + errs.join(' | ') : ''));
  console.log('screenshots in ' + out);
  done(bad ? 1 : 0);
});
