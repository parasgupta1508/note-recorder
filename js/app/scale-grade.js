// Scale-drill grading choice and its per-instrument settings.
//   Practical | Strict: the two side-by-side buttons on the Scale drills screen (js/core/engines/scorer-practical.js and scorer-strict.js).
//   Settings > Scale drill grading: in-tune tolerance, offset forgiveness and just / Pythagorean intonation, kept per instrument and applied to Practical.
// Part of the app: scripts in js/app share one scope, in the order index.html lists them.
const GRADE_KEY = 'tuner-scgrade', GSET_KEY = 'tuner-scgradeset-v1';
let gradeModeV = 'practical'; try { const v = localStorage.getItem(GRADE_KEY); if (v === 'strict' || v === 'practical') gradeModeV = v; } catch {}
const gradeMode = () => gradeModeV;
// Bowed strings (violin) have no frets, so they get the just / Pythagorean allowance and a looser default; piano, guitar and ukulele are equal-tempered.
const gradeDefaults = inst => { const bowed = !!ruleFor(inst).bowing; return { tolerance: bowed ? 12 : 10, drift: 70, expressive: bowed ? 1 : 0 }; };
const gradeStore = () => { try { return JSON.parse(localStorage.getItem(GSET_KEY)) || {}; } catch { return {}; } };
function gradeSettings(inst) { const o = Object.assign(gradeDefaults(inst), gradeStore()[inst] || {}); if (!ruleFor(inst).bowing) o.expressive = 0; return o; }
function setGradeSetting(inst, k, v) { const all = gradeStore(); all[inst] = Object.assign(all[inst] || {}, { [k]: v }); try { localStorage.setItem(GSET_KEY, JSON.stringify(all)); } catch {} }

function setGradeMode(m, quiet) {
  if (m !== 'strict' && m !== 'practical') return;
  if (!quiet && typeof sc !== 'undefined' && sc.running) { if (typeof setMsg === 'function') setMsg('Change the grading before you start a run.', 'warn'); return; }
  gradeModeV = m; try { localStorage.setItem(GRADE_KEY, m); } catch {}
  document.querySelectorAll('#scGrade button').forEach(b => { const on = b.dataset.g === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  renderGradeSettings(); if (typeof renderSet === 'function') renderSet();
}
document.querySelectorAll('#scGrade button').forEach(b => b.onclick = () => setGradeMode(b.dataset.g));

// ----- Settings > Scale drill grading -----
(function fillInst() { const s = $('sgInst'); if (s) PRACTICE_INSTRUMENTS.forEach(([k, n]) => s.add(new Option(n, k))); })();
function renderGradeSettings() {
  const s = $('sgInst'); if (!s) return;
  const inst = $('scInst').value, g = gradeSettings(inst), bowed = !!ruleFor(inst).bowing, strict = gradeMode() === 'strict', name = (PRACTICE_INSTRUMENTS.find(x => x[0] === inst) || [0, inst])[1];
  s.value = inst; $('sgTol').value = g.tolerance; $('sgTolV').textContent = g.tolerance; $('sgDrift').value = g.drift; $('sgDriftV').textContent = g.drift; $('sgExpr').checked = !!g.expressive;
  // each control is on only when it can apply: all three are for Practical, and just / Pythagorean intonation only exists on bowed strings
  $('sgTol').disabled = $('sgDrift').disabled = strict; $('sgExpr').disabled = strict || !bowed; $('sgReset').disabled = strict;
  $('sgNote').textContent = strict ? 'Strict grading is selected, so these are off. Switch to Practical on the Scale drills screen to use them.'
    : bowed ? `${name}: bowed strings have no frets, so players may use just or Pythagorean pitches (thirds a little low, the leading tone a little high). Turn this off to be marked against equal temperament only.`
    : `${name} is equal-tempered, so the just / Pythagorean option does not apply and is off.`;
}
if ($('sgInst')) {
  $('sgInst').onchange = () => { $('scInst').value = $('sgInst').value; $('scInst').dispatchEvent(new Event('change', { bubbles: true })); renderGradeSettings(); };
  $('sgTol').oninput = () => { setGradeSetting($('scInst').value, 'tolerance', +$('sgTol').value); renderGradeSettings(); };
  $('sgDrift').oninput = () => { setGradeSetting($('scInst').value, 'drift', +$('sgDrift').value); renderGradeSettings(); };
  $('sgExpr').onchange = () => { setGradeSetting($('scInst').value, 'expressive', $('sgExpr').checked ? 1 : 0); renderGradeSettings(); };
  $('sgReset').onclick = () => { const all = gradeStore(); delete all[$('scInst').value]; try { localStorage.setItem(GSET_KEY, JSON.stringify(all)); } catch {} renderGradeSettings(); };
  $('scInst').addEventListener('change', renderGradeSettings);
}
setGradeMode(gradeModeV, true);
