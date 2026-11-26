// Browsing public GitHub repositories for MusicXML scores. Pure logic: no DOM and no network (the app does the fetching), so Node tests load this same file.
//
// Nothing is stored: the app reads the file list from api.github.com and the chosen score from raw.githubusercontent.com into memory, and the score
// is parsed there. Only these two hosts are ever used, and every part of a path is checked before it goes into a URL.

const GH_MAX_BYTES = 25 * 1024 * 1024;                  // a score larger than this is not fetched
const GH_MUSIC_EXT = ['mxl', 'musicxml'];                // always offered; '.xml' only when asked for (most .xml files in a repository are not music)
const GH_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, GH_REPO = /^[A-Za-z0-9._-]{1,100}$/, GH_REF = /^[A-Za-z0-9._\/-]{1,100}$/;

// Catalogues worth offering first. prefix: only files under this folder are listed. includeXml: also list plain .xml files.
const GH_PRESETS = [
  { id: 'lieder', owner: 'OpenScore', repo: 'Lieder', title: 'OpenScore Lieder', note: 'About 1,460 art songs for voice and piano, by Schubert, Schumann, Brahms and others. Public domain (CC0). Choose the piano part, or the voice.', prefix: 'scores', includeXml: false },
  { id: 'quartets', owner: 'OpenScore', repo: 'StringQuartets', title: 'OpenScore string quartets', note: 'About 200 quartets by Haydn, Mozart, Beethoven, Dvořák and others. Public domain (CC0). Choose the violin or cello part.', prefix: 'scores', includeXml: false },
  { id: 'music21', owner: 'cuthbertLab', repo: 'music21', title: 'music21 corpus', note: 'Over 600 scores: Bach chorales and cantatas, Beethoven, Mozart, Haydn, Schumann, early music (BSD-licensed project).', prefix: 'music21/corpus', includeXml: true },
  { id: 'asap', owner: 'fosfrancesco', repo: 'asap-dataset', title: 'ASAP piano scores', note: 'Piano works by Bach, Beethoven, Chopin, Schubert and others (MusicXML, from the ASAP research dataset).', prefix: '', includeXml: false },
  { id: 'musetrainer', owner: 'musetrainer', repo: 'library', title: 'MuseTrainer library', note: 'Popular and classical pieces as compressed MusicXML (.mxl). The repository states no licence: check a score before sharing it.', prefix: '', includeXml: false },
];

const ghSafePath = p => typeof p === 'string' && p.length > 0 && p.length < 400 && !p.split('/').some(s => s === '..' || s === '.' || s === '') && !/[\\\0]/.test(p);   // # and ? are fine in a repository's file name: they are encoded in the URL
const ghExt = path => { const m = /\.([A-Za-z0-9]+)$/.exec(path); return m ? m[1].toLowerCase() : ''; };

// Text pasted into the "paste a link" box -> { owner, repo, ref, path, kind: 'repo' | 'dir' | 'file' } or null.
// Understands owner/repo, github.com/owner/repo, .../tree/<ref>/<folder>, .../blob/<ref>/<file>, and raw.githubusercontent.com/owner/repo/<ref>/<file>.
// A branch name that contains a slash is not understood (the first part is taken as the branch).
function ghParseUrl(text) {
  let s = String(text || '').trim(); if (!s) return null;
  let parts;
  const short = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(s);
  if (short) parts = [short[1], short[2]];
  else {
    const m = /^(?:https?:\/\/)?(?:www\.)?(github\.com|raw\.githubusercontent\.com)\/([^?#]*)/i.exec(s);   // a hand-written parser: this file also runs in Node, where there is no URL class in the test sandbox
    if (!m) return null;
    const segs = m[2].split('/').filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch { return x; } });
    parts = m[1].toLowerCase() === 'github.com' ? segs : segs.length >= 4 ? [segs[0], segs[1], 'raw', ...segs.slice(2)] : segs;
  }
  if (parts.length < 2) return null;
  const owner = parts[0], repo = parts[1].replace(/\.git$/, '');
  if (!GH_OWNER.test(owner) || !GH_REPO.test(repo) || repo === '.' || repo === '..') return null;
  const out = { owner, repo, ref: '', path: '', kind: 'repo' };
  if (parts.length > 2) {
    const mode = parts[2];
    if (!['tree', 'blob', 'raw'].includes(mode) || parts.length < 4) return null;
    const ref = parts[3], rest = parts.slice(4).join('/');
    if (!GH_REF.test(ref)) return null;
    out.ref = ref; out.path = rest;
    if (rest && !ghSafePath(rest)) return null;
    out.kind = mode === 'tree' ? (rest ? 'dir' : 'repo') : 'file';
    if (out.kind === 'file' && !rest) return null;
  }
  return out;
}

// The two URLs the app fetches. ref defaults to HEAD (the repository's default branch).
const ghTreeUrl = s => `https://api.github.com/repos/${s.owner}/${s.repo}/git/trees/${encodeURIComponent(s.ref || 'HEAD')}?recursive=1`;
function ghRawUrl(s, path) {
  if (!GH_OWNER.test(s.owner) || !GH_REPO.test(s.repo) || !ghSafePath(path)) throw new Error('That is not a file this app can open.');
  return `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${encodeURIComponent(s.ref || 'HEAD')}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

// A name a person can read: the file name, or for a generic name (ASAP calls every score xml_score.musicxml) the folders it sits in.
const GH_GENERIC = /^(xml[_ -]?score|score|musicxml|music|main|piece|export|(lc|sq)\d+)$/i;
function ghLabel(path) {
  const segs = path.split('/'), base = segs[segs.length - 1].replace(/\.(mxl|musicxml|xml)$/i, '');
  const clean = x => x.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return GH_GENERIC.test(base) && segs.length > 1 ? segs.slice(0, -1).filter(x => x !== '_' && x !== 'scores').slice(-3).map(clean).join(' · ') : clean(base);
}

// The git tree JSON -> { files: [{ path, name, label, dir, ext, size }], truncated, skipped (too large) }.
// opts: { prefix, includeXml, maxBytes }
function ghMusicFiles(tree, opts = {}) {
  const prefix = opts.prefix ? opts.prefix.replace(/\/+$/, '') + '/' : '', max = opts.maxBytes || GH_MAX_BYTES, exts = opts.includeXml ? [...GH_MUSIC_EXT, 'xml'] : GH_MUSIC_EXT;
  const files = []; let skipped = 0;
  for (const e of (tree && Array.isArray(tree.tree) ? tree.tree : [])) {
    if (!e || e.type !== 'blob' || typeof e.path !== 'string' || !e.path.startsWith(prefix) || !ghSafePath(e.path)) continue;
    const ext = ghExt(e.path); if (!exts.includes(ext)) continue;
    if (e.size > max) { skipped++; continue; }
    const segs = e.path.split('/');
    files.push({ path: e.path, name: segs[segs.length - 1], label: ghLabel(e.path), dir: segs.slice(0, -1).join('/'), ext, size: e.size || 0 });
  }
  files.sort((a, b) => a.dir.localeCompare(b.dir) || a.label.localeCompare(b.label, undefined, { numeric: true }));
  return { files, truncated: !!(tree && tree.truncated), skipped };
}
// Every word of the search must be in the path or the label (case does not matter).
function ghSearch(files, query) {
  const w = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return w.length ? files.filter(f => { const t = (f.path + ' ' + f.label).toLowerCase().replace(/_/g, ' '); return w.every(x => t.includes(x)); }) : files;
}
// One folder level: { dirs: [{ name, path, count }], files } for the folder `dir` ('' = the top).
function ghList(files, dir) {
  const base = dir ? dir + '/' : '', dirs = new Map(), here = [];
  for (const f of files) {
    if (!f.path.startsWith(base)) continue;
    const rest = f.path.slice(base.length), i = rest.indexOf('/');
    if (i < 0) here.push(f); else { const n = rest.slice(0, i); dirs.set(n, (dirs.get(n) || 0) + 1); }
  }
  return { dirs: [...dirs].map(([name, count]) => ({ name, path: base + name, count })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), files: here };
}
// A folder with a single sub-folder and nothing else is skipped over (Bach/ -> Bach/Fugue/ ...), so the list does not start with a row of one.
function ghCollapse(files, dir) {
  let l = ghList(files, dir); while (!l.files.length && l.dirs.length === 1) { dir = l.dirs[0].path; l = ghList(files, dir); }
  return { dir, ...l };
}

// What went wrong, in words a player can act on. status: HTTP status; remaining/reset: the X-RateLimit headers (strings or null).
function ghExplain(status, remaining, reset) {
  if (status === 404) return 'GitHub could not find that: check the spelling, and that the repository is public.';
  if (status === 403 || status === 429) {
    const when = reset && Number.isFinite(+reset) ? ` Try again after ${new Date(+reset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '';
    return (remaining === '0' || status === 429 ? 'GitHub is limiting how often this app may look (a free allowance of 60 requests an hour per network).' : 'GitHub refused the request.') + when;
  }
  if (status === 0) return 'Could not reach GitHub: check the internet connection.';
  return `GitHub answered with an error (${status}).`;
}
