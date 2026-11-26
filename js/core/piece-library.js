// The list of GitHub libraries (public repositories of MusicXML scores) the player has chosen for Piece practice, and the search and filter over their scores.
// Pure logic: no DOM, no network, no storage (the app saves the list), so Node tests load this same file. Uses github-library.js (ghParseUrl, ghSearch ...).
//
// A library: { id, owner, repo, ref, prefix, includeXml, inst, title, on }
//   inst: the instrument its scores are for ('any' when mixed). It is only a hint for the instrument filter: the real instrument is read from the score when it is opened.

const PL_INSTRUMENTS = [['chromatic', 'Piano'], ['violin', 'Violin'], ['guitar', 'Guitar'], ['ukulele', 'Ukulele']];   // what the filter and a library's hint offer (the drills' instruments)
const PL_MAX = 30, PL_VERSION = 2;   // PL_VERSION: bump when the suggested libraries change (plMigrate)   // libraries a player can keep

const plId = (o, r, ref, prefix) => `${o}/${r}` + (ref ? '@' + ref : '') + (prefix ? ':' + prefix : '');
const plTitle = (o, r, prefix) => (prefix ? `${r}/${prefix.split('/').pop()}` : `${o}/${r}`);

// The libraries offered the first time (and by "Restore suggested libraries").
function plDefaults() {
  const inst = { lieder: 'chromatic', quartets: 'violin', music21: 'any', asap: 'chromatic', musetrainer: 'any' };   // lieder: the piano part is the one to practise; quartets: the violin parts
  return GH_PRESETS.map(p => ({ id: plId(p.owner, p.repo, '', p.prefix), owner: p.owner, repo: p.repo, ref: '', prefix: p.prefix || '', includeXml: !!p.includeXml, inst: inst[p.id] || 'any', title: p.title, on: true }));
}
// What came out of storage -> a clean list (anything odd is dropped, never trusted).
function plNormalize(list) {
  const out = [], seen = new Set();
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r !== 'object' || !GH_OWNER.test(String(r.owner)) || !GH_REPO.test(String(r.repo))) continue;
    const ref = r.ref && GH_REF.test(String(r.ref)) ? String(r.ref) : '', prefix = r.prefix && ghSafePath(String(r.prefix)) ? String(r.prefix).replace(/\/+$/, '') : '', id = plId(r.owner, r.repo, ref, prefix);
    if (seen.has(id) || out.length >= PL_MAX) continue; seen.add(id);
    out.push({ id, owner: r.owner, repo: r.repo, ref, prefix, includeXml: !!r.includeXml, inst: PL_INSTRUMENTS.some(x => x[0] === r.inst) ? r.inst : 'any', title: String(r.title || plTitle(r.owner, r.repo, prefix)).slice(0, 60), on: r.on !== false });
  }
  return out;
}
// A pasted repository or folder link -> { list, added } or { error }. inst: the hint for the instrument filter.
function plAdd(list, text, inst) {
  const s = ghParseUrl(text);
  if (!s) return { error: 'Paste a GitHub repository or folder link, for example github.com/owner/repo (or just owner/repo).' };
  if (s.kind === 'file') return { error: 'That is a link to one file. Paste the repository or folder it is in; to open one score, use "Paste a link" in Piece practice.' };
  if (list.length >= PL_MAX) return { error: `You can keep up to ${PL_MAX} libraries.` };
  const id = plId(s.owner, s.repo, s.ref, s.kind === 'dir' ? s.path : '');
  if (list.some(r => r.id === id)) return { error: 'That library is already in the list.' };
  const added = { id, owner: s.owner, repo: s.repo, ref: s.ref, prefix: s.kind === 'dir' ? s.path : '', includeXml: s.kind === 'dir', inst: PL_INSTRUMENTS.some(x => x[0] === inst) ? inst : 'any', title: plTitle(s.owner, s.repo, s.kind === 'dir' ? s.path : ''), on: true };
  return { list: list.concat([added]), added };
}

// A list saved by an older version -> brought up to date without losing what the player added. Version 2: the MuseScore test-file library is gone (test fixtures, not music)
// and the clean libraries are added, once. Libraries the player removed on purpose stay removed after that (the version is then saved).
function plMigrate(list, fromVersion) {
  if (fromVersion >= PL_VERSION) return list;
  const out = list.filter(r => !(r.owner === 'musescore' && r.repo === 'musescore'));
  for (const d of plDefaults()) if (!out.some(r => r.id === d.id)) out.push(d);
  return plNormalize(out);
}

// Which instrument does this score look like it is for? From words in its path; otherwise the library's hint; otherwise '' (not stated).
const PL_WORDS = [['violin', /\b(violins?|violino|violon|fiddle)\b/i], ['ukulele', /\b(ukulele|ukelele)\b/i], ['guitar', /\b(guitars?|guitarra|chitarra|gitarre)\b/i], ['chromatic', /\b(pianos?|pianoforte|klavier|keyboard|harpsichord)\b/i]];
function plGuess(text, hint) {
  const t = String(text).replace(/_/g, ' ');
  for (const [k, re] of PL_WORDS) if (re.test(t)) return k;
  return hint && hint !== 'any' ? hint : '';
}
// Library + its file list -> entries for the list on screen.
const plEntries = (lib, files) => files.map(f => ({ ...f, libId: lib.id, lib: lib.title, inst: plGuess(f.path, lib.inst) }));
// Entries -> the ones to show. q: search words (every word must be in the name, folder or library); inst: 'all' | 'unknown' | an instrument key; lib: 'all' | a library id.
function plFilter(entries, o = {}) {
  let r = entries;
  if (o.lib && o.lib !== 'all') r = r.filter(e => e.libId === o.lib);
  if (o.inst && o.inst !== 'all') r = r.filter(e => o.inst === 'unknown' ? !e.inst : e.inst === o.inst);
  const w = String(o.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (w.length) r = r.filter(e => { const t = (e.path + ' ' + e.label + ' ' + e.lib).toLowerCase().replace(/_/g, ' '); return w.every(x => t.includes(x)); });
  return r;
}
// How many entries each instrument filter would show (with the search and library already applied), for the numbers on the filter buttons.
function plCounts(entries, o = {}) {
  const base = plFilter(entries, { q: o.q, lib: o.lib }), c = { all: base.length, unknown: 0 };
  for (const [k] of PL_INSTRUMENTS) c[k] = 0;
  for (const e of base) if (e.inst) c[e.inst]++; else c.unknown++;
  return c;
}
