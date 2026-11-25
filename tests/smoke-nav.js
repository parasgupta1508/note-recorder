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
  for (const [label, w, h] of [['phone', 375, 800], ['desktop', 1280, 900]]) {
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
    say(errs.length === 0, `${label}: no script errors${errs.length ? ' - ' + errs.join(' | ') : ''}`);
  }
  console.log('screenshots in ' + out);
  done(bad ? 1 : 0);
});
