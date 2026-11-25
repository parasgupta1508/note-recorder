// Which engines the app uses right now. Reads Settings' "engines" value (defaults to everything on "auto" = today's behaviour)
// and hands out the engine objects. Screens call engineFor(); they never name yin, Segmenter or Basic Pitch.
const ENGINES_KEY = 'engines.v1';
let engSet = defaultEngineSettings(); try { const o = JSON.parse(localStorage.getItem(ENGINES_KEY)); if (o && o.default) engSet = Object.assign(defaultEngineSettings(), o); } catch {}
const _engCache = {};
function setEngineSettings(s) { engSet = s; for (const k in _engCache) delete _engCache[k]; try { localStorage.setItem(ENGINES_KEY, JSON.stringify(s)); } catch {} }
// role: 'f0' | 'segmenter' | 'transcriber' ...; mode: 'live' | 'offline'. Cached per instrument, so the 60-per-second tuner loop pays nothing.
function engineFor(role, mode) {
  const inst = typeof prof !== 'undefined' && prof ? prof.k : null, key = role + '|' + mode + '|' + inst;
  return _engCache[key] || (_engCache[key] = getEngine(role, inst, mode, engSet));
}
const currentEngineSnapshot = () => engineSnapshot(engSet, typeof prof !== 'undefined' && prof ? prof.k : null);
