// Shared shapes every engine produces and every screen consumes. Pure logic.
// An engine may add fields; a consumer must never require one that is not listed here.
//   Frame (role f0):  { t: seconds, hz: number | 0 when unvoiced, conf: 0..1 }
//   Note  (role segmenter / transcriber): { midi: integer, start: seconds, dur: ms, hz?, cents?, lvl?, pts?, vib?, note? }
//   (dur is in milliseconds, as the Segmenter has always produced it.)
const SCHEMA = {
  frame: { t: 'number', hz: 'number', conf: 'number' },
  note: { midi: 'number', start: 'number', dur: 'number' },
};
function schemaProblems(kind, item) {
  const spec = SCHEMA[kind], bad = [];
  if (!item || typeof item !== 'object') return [kind + ' is not an object'];
  for (const k of Object.keys(spec)) if (typeof item[k] !== spec[k] || !isFinite(item[k])) bad.push(kind + '.' + k + ' must be a finite ' + spec[k]);
  return bad;
}
// Returns a list of problems (empty = fine) for an array of frames or notes.
function validateList(kind, list) {
  if (!Array.isArray(list)) return [kind + ' list is not an array'];
  const bad = []; for (let i = 0; i < list.length && bad.length < 5; i++) for (const p of schemaProblems(kind, list[i])) bad.push('#' + i + ' ' + p);
  return bad;
}
