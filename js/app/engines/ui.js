// Settings > Engines: generated from the registry, so adding an engine file adds a choice here with no screen code.
// One row per job. "Auto" keeps today's engines. Each row shows what the chosen engine can do, its parameters, a Test button
// (the same contract check the test suite runs) and Reset. An engine that fails its check is greyed out and can no longer be picked.
// Part of the app: shared scope, loaded after settings-ui.js.

const ENG_ROWS = [['f0', 'live', 'Tuner algorithm'], ['f0', 'scale', 'Scale drills: pitch algorithm'], ['scorer', 'live', 'Scale drills: grading'], ['segmenter', 'live', 'Recorder algorithm (live)'], ['segmenter', 'offline', 'Recorded file algorithm'], ['transcriber', 'offline', 'Detailed analysis algorithm (slower)']];
const engKey = (role, mode) => role === 'transcriber' ? role : role + ':' + mode;
const engEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const engWhyNot = e => e.contractFail ? 'failed its check' : e.caps.needsHelper && !(typeof LAB !== 'undefined' && LAB.ok) ? 'helper not running' : '';
const engCurrent = (role, mode) => engSet.default[engKey(role, mode)] || 'auto';
function engineSummary() { return ENG_ROWS.every(([r, m]) => engCurrent(r, m) === 'auto') ? 'Auto (built in)' : 'Custom choice'; }
function engSave(mutator) { const s = JSON.parse(JSON.stringify(engSet)); s.params = s.params || {}; mutator(s); setEngineSettings(s); if (typeof rebuildSegmenter === 'function') rebuildSegmenter(); renderEngines(); if (typeof renderSet === 'function') renderSet(); }

function renderEngines() {
  const box = $('engBody'); if (!box) return;
  box.innerHTML = ENG_ROWS.map(([role, mode, title], i) => {
    const dev = !!($('devOn') && $('devOn').checked), cands = listEngines(role).filter(e => !e.caps.clipInput && e.caps[mode === 'scale' ? 'live' : mode] !== false && (mode !== 'scale' || e.frame) && (!e.caps.dev || dev || engCurrent(role, mode) === e.id)), cur = engCurrent(role, mode), eff = engineFor(role, mode);
    const auto = getEngine(role, prof.k, mode, { default: {} });
    const opts = [`<option value="auto"${cur === 'auto' ? ' selected' : ''}>Auto (${engEsc(auto ? auto.label.split(/ [+(]/)[0] : 'none')})</option>`].concat(cands.map(e => { const why = engWhyNot(e); return `<option value="${engEsc(e.id)}"${cur === e.id ? ' selected' : ''}${why ? ' disabled' : ''}>${engEsc(e.label)}${why ? ' (' + why + ')' : ''}</option>`; })).join('');
    const pv = (engSet.params || {})[role + '.' + (eff && eff.id)] || {};
    const params = eff ? Object.keys(eff.params || {}).map(k => { const p = eff.params[k], v = pv[k] != null ? pv[k] : p.default;
      return p.type === 'switch' ? `<label class="field eng-p"><span>${engEsc(p.label || k)}</span><input type="checkbox" data-p="${i}|${engEsc(k)}"${v ? ' checked' : ''}></label>`
        : `<label class="field eng-p"><span>${engEsc(p.label || k)}: <b>${engEsc(v)}</b></span><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${engEsc(v)}" data-p="${i}|${engEsc(k)}"></label>`; }).join('') : '';
    return `<div class="eng-row"><div class="eng-head"><b>${engEsc(title)}</b><select data-row="${i}" aria-label="${engEsc(title)}">${opts}</select></div>${params}
      <div class="eng-act"><button type="button" class="sec" data-test="${i}">Test</button>${cur !== 'auto' || Object.keys(pv).length ? `<button type="button" class="sec" data-reset="${i}">Reset</button>` : ''}<span class="hint2" id="engRes${i}" role="status"></span></div></div>`;
  }).join('');
}
$('engBody').addEventListener('change', e => {
  const sel = e.target.closest('select[data-row]'); if (sel) { const [role, mode] = ENG_ROWS[+sel.dataset.row]; engSave(s => { s.default[engKey(role, mode)] = sel.value; }); return; }
  const c = e.target.closest('input[type=checkbox][data-p]'); if (c) engParam(c.dataset.p, c.checked);
});
$('engBody').addEventListener('input', e => { const r = e.target.closest('input[type=range][data-p]'); if (r) { engParam(r.dataset.p, +r.value, true); const b = r.parentNode.querySelector('b'); if (b) b.textContent = r.value; } });
function engParam(ref, v, quiet) {
  const [i, name] = ref.split('|'), [role, mode] = ENG_ROWS[+i], eff = engineFor(role, mode); if (!eff) return;
  const s = JSON.parse(JSON.stringify(engSet)); s.params = s.params || {}; (s.params[role + '.' + eff.id] = s.params[role + '.' + eff.id] || {})[name] = v;
  setEngineSettings(s); if (!quiet) renderEngines();
}
$('engBody').addEventListener('click', e => {
  const t = e.target.closest('[data-test]'), r = e.target.closest('[data-reset]');
  if (r) { const [role, mode] = ENG_ROWS[+r.dataset.reset], eff = engineFor(role, mode); engSave(s => { delete s.default[engKey(role, mode)]; if (eff) delete s.params[role + '.' + eff.id]; }); return; }
  if (!t) return;
  const i = +t.dataset.test, [role, mode] = ENG_ROWS[i], eff = engineFor(role, mode), out = $('engRes' + i); if (!eff) { out.textContent = 'No engine for this job.'; return; }
  out.textContent = 'Testing ' + eff.label + '…';
  setTimeout(() => {                                       // let the "Testing" text show before the check keeps the page busy for a moment
    const res = engineContract(eff), bad = res.filter(x => !x.ok), n = res.filter(x => !x.skip).length;
    eff.contractFail = bad.length > 0;
    out.className = 'hint2 ' + (bad.length ? 'bad-t' : 'ok-t');
    out.textContent = bad.length ? `Failed ${bad.length} of ${n} checks: ${bad.map(x => x.msg).join('; ')}. It will not be used.` : `Passed all ${n} checks${res.some(x => x.skip) ? ' (the rest need the browser model or helper)' : ''}.`;
    if (bad.length) { setEngineSettings(engSet); if (typeof rebuildSegmenter === 'function') rebuildSegmenter(); const msg = out.textContent; renderEngines(); $('engRes' + i).textContent = msg; $('engRes' + i).className = 'hint2 bad-t'; }
  }, 30);
});
$('engCompare').onclick = () => showTab('lab');
renderEngines();
