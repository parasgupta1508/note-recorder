// Settings layout and backup / restore.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// ----- settings layout (List / Tabs / Classic) -----
const SG = [['instrument', 'Instrument'], ['tuning', 'Tuning'], ['mic', 'Microphone'], ['detect', 'Detection'], ['check', 'Accuracy check'], ['data', 'Backup & restore'], ['layout', 'Settings layout'], ['install', 'Install app'], ['dev', 'Developer'], ['reset', 'Reset']], LAY_KEY = 'tuner-setlayout';
let setLay = 'list', setCur = null; try { setLay = localStorage.getItem(LAY_KEY) || 'list'; } catch {}
if (!['list', 'tabs', 'classic'].includes(setLay)) setLay = 'list';
const setSum = k => ({
  instrument: () => profReady ? profName() : 'All instruments',
  tuning: () => `A4 ${$('a4').value} Hz · ±${$('tol').value}¢`,
  mic: () => `Noise gate ${(+$('gate').value).toFixed(3)} · Boost ${$('boost').value}×`,
  detect: () => { const h = [...document.querySelectorAll('#detSeg button.on')][0]; return `${h ? h.textContent : 'Custom'} · ${$('smooth').selectedOptions[0].textContent.split(' ')[0]} needle`; },
  check: () => 'Software test · Live check',
  data: () => 'Save or restore scores and history',
  layout: () => ({ list: 'List', tabs: 'Tabs', classic: 'Classic' })[setLay],
  install: () => 'Use like a normal app',
  dev: () => $('devOn').checked ? 'Developer tools on' : 'Off',
  reset: () => 'Back to recommended values',
}[k])();
function renderSet() {
  const T = $('tab-settings'); T.dataset.layout = setLay;
  if (setLay === 'tabs' && !setCur) setCur = 'instrument';
  if (setLay === 'classic') setCur = null;
  T.classList.toggle('home', setLay === 'list' && !setCur);
  document.querySelectorAll('.set-group[data-g]').forEach(g => g.classList.toggle('cur', g.dataset.g === setCur));
  $('setMenu').innerHTML = SG.map(([k, n]) => `<button class="set-row" data-g="${k}"><span><b>${n}</b><small>${setSum(k)}</small></span><i>›</i></button>`).join('');
  $('setTabs').innerHTML = SG.map(([k, n]) => `<button data-g="${k}" class="${k === setCur ? 'on' : ''}">${n.replace(' check', '').replace(' & reset', '')}</button>`).join('');
  $('setTitle').textContent = (SG.find(x => x[0] === setCur) || [0, ''])[1];
  document.querySelectorAll('#laySeg button').forEach(b => b.classList.toggle('on', b.dataset.l === setLay));
}
$('tab-settings').addEventListener('click', e => {
  const r = e.target.closest('#setMenu button, #setTabs button'); if (r) { setCur = r.dataset.g; renderSet(); scrollTo(0, 0); return; }
  if (e.target.closest('#setBack')) { setCur = null; renderSet(); scrollTo(0, 0); return; }
  const l = e.target.closest('#laySeg button'); if (l) { setLay = l.dataset.l; try { localStorage.setItem(LAY_KEY, setLay); } catch {} if (setLay === 'list') setCur = null; renderSet(); }
});
$('tab-settings').addEventListener('input', () => { if (setLay === 'list' && !setCur) renderSet(); });
const DEV_KEY = 'tuner-dev';
try { $('devOn').checked = localStorage.getItem(DEV_KEY) === '1'; } catch {}
const devUi = () => $('openLab').classList.toggle('hide', !$('devOn').checked);
$('devOn').onchange = () => { try { localStorage.setItem(DEV_KEY, $('devOn').checked ? '1' : '0'); } catch {} devUi(); renderSet(); };
$('openLab').onclick = () => showTab('lab');
devUi();
renderSet();

// ----- backup / restore (versioned) -----
const VER_KEY = 'tuner-data-version', APP_ID = 'tuner-scale-trainer';
const dataVer = () => { try { return parseInt(localStorage.getItem(VER_KEY)) || 0; } catch { return 0; } };
const bkMsg = (t, cls) => { $('bkMsg').textContent = t; $('bkMsg').className = 'hint2 ' + (cls || ''); };
function updBackupInfo() { $('verInfo').textContent = `Data version on this device: v${dataVer()}`; }
async function doBackup(share) {
  const v = dataVer() + 1, profiles = {};
  PROFILES.forEach(p => profiles[p] = { scorecard: profEvents(p), passes: profPasses(p) });
  const text = JSON.stringify({ app: APP_ID, format: 1, version: v, created: new Date().toISOString(), profiles });
  const name = `tuner-backup-v${v}-${stamp().slice(0, 10)}.json`;
  let shared = false;
  if (share && typeof File === 'function' && navigator.canShare) {
    const file = new File([text], name, { type: 'text/plain' });   // plain-text type is accepted by more share targets (WhatsApp, email apps)
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `Tuner backup v${v}`, text: `Tuner & Scale Trainer backup, version ${v}` }); shared = true; }
      catch (e) { if (e && e.name === 'AbortError') { bkMsg('Sharing cancelled — nothing changed.'); return; } }
    }
  }
  if (!shared) download(name, text, 'application/json');
  try { localStorage.setItem(VER_KEY, String(v)); } catch {}
  updBackupInfo(); bkMsg(shared ? `Backup v${v} shared.` : `Backup v${v} saved to this device's downloads as ${name}.`, 'ok-t');
}
$('bkShare').onclick = () => doBackup(true);
$('bkDl').onclick = () => doBackup(false);
$('bkImp').onclick = () => $('impFile').click();
const cleanEv = o => {
  const out = {};
  for (const k of Object.keys(o || {})) {
    const m = +k; if (!Number.isInteger(m) || m < 0 || m > 127 || !Array.isArray(o[k])) continue;
    out[m] = o[k].filter(e => e && ['h', 's', 'w'].includes(e.k)).slice(-CARD_MAX).map(e => {
      const r = { k: e.k, t: +e.t || 0 }; if (typeof e.sl === 'string') r.sl = e.sl.slice(0, 60);
      if (typeof e.i === 'string') r.i = e.i.slice(0, 20);
      if (e.k === 'h') { r.c = +e.c || 0; r.a = clamp01(+e.a || 0); r.s = e.s == null ? null : Math.max(0, +e.s || 0); }
      return r;
    });
  }
  return out;
};
const cleanPass = a => (Array.isArray(a) ? a : []).slice(-300).map(x => ({ t: +x.t || 0, pct: Math.max(0, Math.min(100, +x.pct || 0)), s: String((x && x.s) || '').slice(0, 60) }));
$('impFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    if (f.size > 20e6) throw new Error('the file is too large');
    let b; try { b = JSON.parse(await f.text()); } catch { throw new Error('the file is not readable JSON'); }
    if (!b || b.app !== APP_ID || !Number.isInteger(b.version) || b.version < 1 || !b.profiles || typeof b.profiles !== 'object') throw new Error('this is not a Tuner & Scale Trainer backup');
    const cur = dataVer();
    if (b.version <= cur) { bkMsg(`Not imported: this backup is v${b.version} and this device is already at v${cur}. Only a higher version can be imported.`, 'bad-t'); return; }
    const found = PROFILES.filter(p => b.profiles[p]);
    if (!found.length) throw new Error('it contains no profile data for ' + PROFILES.join(' or '));
    const cleaned = {}; found.forEach(p => cleaned[p] = { sc: cleanEv(b.profiles[p].scorecard), ps: cleanPass(b.profiles[p].passes) });
    const sum = found.map(p => `${p}: ${Object.values(cleaned[p].sc).reduce((s, a) => s + a.length, 0)} plays, ${cleaned[p].ps.length} passes`).join('\n');
    if (!confirm(`Import backup v${b.version}${b.created ? ' from ' + String(b.created).slice(0, 10) : ''}?\nThis REPLACES the data for ${found.join(' and ')} on this device (now v${cur}).\n\n${sum}`)) { bkMsg('Import cancelled.'); return; }
    found.forEach(p => { lsSet(ckey(p), cleaned[p].sc); lsSet(pkey(p), cleaned[p].ps); });
    try { localStorage.setItem(VER_KEY, String(b.version)); } catch {}
    cardAll = lsGet(ckey(profile), {}); passAll = lsGet(pkey(profile), []); cardSess = {};
    updBackupInfo(); renderCard(); renderAnalysis(); bkMsg(`Imported backup v${b.version}.`, 'ok-t');
  } catch (err) { bkMsg('Could not import: ' + err.message, 'bad-t'); }
};
updBackupInfo();

