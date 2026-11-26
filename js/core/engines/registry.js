// Engine registry: the one place that knows which algorithms exist. Screens, tests and Settings ask it; they never name an implementation.
// Pure logic. An engine file calls registerEngine({ id, role, label, version, caps, params, run, ... }) and nothing else changes.
// Roles: f0, segmenter, transcriber, separator, omr, aligner, scorer, verifier  (see docs/ui-and-engines-plan.md section 4).
//
// What "auto" means: today's behaviour. It stays pinned to AUTO_ENGINES until the owner approves a change (Phase A decision memo).
const ENGINE_ROLES = ['f0', 'segmenter', 'transcriber', 'separator', 'omr', 'aligner', 'scorer', 'verifier'];
const AUTO_ENGINES = { f0: 'yin', segmenter: 'classic', transcriber: 'basicpitch', scorer: 'practical' };   // scorer: the scale-drill grader (owner approved Practical as the default; Strict stays a choice)
const _engines = [];
function registerEngine(d) {
  if (!d || !d.id || !ENGINE_ROLES.includes(d.role)) throw new Error('registerEngine: needs an id and a known role');
  const at = _engines.findIndex(e => e.role === d.role && e.id === d.id), e = Object.assign({ version: '1', caps: {}, params: {}, label: d.id }, d);
  if (at >= 0) _engines[at] = e; else _engines.push(e);   // registering the same id again replaces it (the helper refreshes its list)
  return e;
}
function unregisterEngine(role, id) { const at = _engines.findIndex(e => e.role === role && e.id === id); if (at >= 0) _engines.splice(at, 1); }
const listEngines = role => _engines.filter(e => !role || e.role === role);
// Default settings object (what Settings stores under "engines"). 'auto' follows AUTO_ENGINES.
const defaultEngineSettings = () => ({ default: { f0: 'auto', segmenter: 'auto', transcriber: 'auto', scorer: 'auto', separator: 'none' }, perInstrument: {}, params: {} });
// Which engine id a role uses for this instrument, after 'auto' is resolved. Returns null for 'none'.
// A choice can be for one mode only: the key 'segmenter:offline' beats 'segmenter'.
function resolveEngineId(role, settings, instrument, mode) {
  const s = settings || defaultEngineSettings(), per = (s.perInstrument && instrument && s.perInstrument[instrument]) || {}, keys = mode ? [role + ':' + mode, role] : [role];
  let id = keys.map(k => per[k]).find(Boolean) || keys.map(k => s.default && s.default[k]).find(Boolean) || 'auto';
  if (id === 'auto') id = AUTO_ENGINES[role] || 'none';
  return id === 'none' ? null : id;
}
// getEngine(role, instrument, mode, settings): the engine to use. mode is 'live' or 'offline' (a non-live engine is skipped for live use).
// If the chosen engine is unknown, failed its check or cannot do the mode, falls back to today's engine, so a bad setting never breaks the app.
function getEngine(role, instrument, mode, settings) {
  const fit = e => e && !e.contractFail && !e.caps.clipInput && (!mode || e.caps[mode] !== false);   // an engine that failed its contract check, or that works on a saved clip (helper) rather than audio, is never picked
  const want = resolveEngineId(role, settings, instrument, mode), by = id => _engines.find(e => e.role === role && e.id === id);
  if (want && fit(by(want))) return by(want);
  const auto = by(AUTO_ENGINES[role]); return fit(auto) ? auto : null;
}
// resolve(settings, instrument): { role: engine } for every role that has an engine (offline mode, used for Settings and Take snapshots).
function resolveEngines(settings, instrument) {
  const out = {}; for (const r of ENGINE_ROLES) { const e = getEngine(r, instrument, null, settings); if (e) out[r] = e; } return out;
}
// What a saved Take stores so it can be re-scored or compared later.
function engineSnapshot(settings, instrument) {
  const out = {}, res = resolveEngines(settings, instrument), pv = (settings && settings.params) || {};
  for (const r of Object.keys(res)) out[r] = { id: res[r].id, version: res[r].version, params: Object.assign({}, pv[r + '.' + res[r].id]) };
  return out;
}
// An engine by exact id (used by the Lab and by tests that compare engines side by side). null if unknown.
const findEngine = (role, id) => _engines.find(e => e.role === role && e.id === id) || null;
// Adds members to an already registered engine (the app attaches the browser-only part, e.g. the model runner, to a core descriptor).
function extendEngine(role, id, extra) { const e = findEngine(role, id); if (!e) throw new Error('extendEngine: no such engine ' + role + '/' + id); return Object.assign(e, extra); }
