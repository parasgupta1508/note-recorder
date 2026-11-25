// Lab helper: a small local server (no npm packages) that the app's Lab page talks to.
//   YouTube link or audio file -> mp3 clip (yt-dlp + ffmpeg) -> reference MIDI from several open-source engines.
// Start:  node tools/lab/server.js        (first time: node tools/lab/setup.js)
// It listens on 127.0.0.1 only, accepts only the app's own origins, and never runs a shell: every program gets its arguments as a list.
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const core = require('./core.js');
const ROOT = __dirname, DATA = path.join(ROOT, 'data'), FULL = path.join(DATA, '_full'), PORT = +process.env.LAB_PORT || 8787;
const WIN = process.platform === 'win32', VENV_PY = path.join(ROOT, '.venv', WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python');
const ORIGINS = ['https://parasgupta1508.github.io', ...(process.env.LAB_ORIGINS ? process.env.LAB_ORIGINS.split(',') : [])];
const ENGINES = {
  basicpitch: { name: 'Basic Pitch (Spotify)', kind: 'many notes at once', needs: 'node' },
  mpm: { name: 'McLeod pitch (pitchy)', kind: 'one melody line', needs: 'node' },
  pyin: { name: 'pYIN (librosa)', kind: 'one melody line', needs: 'py' },
  crepe: { name: 'CREPE (torchcrepe)', kind: 'one melody line', needs: 'crepe' },
};
const STEMS = ['vocals', 'bass', 'other'];     // drums have no pitch
const MAX_MIN = 20, MAX_UPLOAD = 150 * 1024 * 1024;
fs.mkdirSync(FULL, { recursive: true });

// ---------- helpers ----------
const ID = /^[A-Za-z0-9_-]{1,80}$/, num = (v, d, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
function run(cmd, args, { onLine, cwd, timeout } = {}) {
  return new Promise((res, rej) => {
    let p; try { p = cp.spawn(cmd, args, { cwd, windowsHide: true }); } catch (e) { return rej(e); }
    let out = '', err = '', buf = ''; const t = timeout && setTimeout(() => { try { p.kill(); } catch {} }, timeout);
    const feed = d => { buf += d; let k; while ((k = buf.search(/\r|\n/)) >= 0) { const l = buf.slice(0, k); buf = buf.slice(k + 1); if (l && onLine) onLine(l); } };
    p.stdout.on('data', d => { out += d; feed(d); }); p.stderr.on('data', d => { err += d; feed(d); });
    p.on('error', e => { clearTimeout(t); rej(e); });
    p.on('close', code => { clearTimeout(t); code === 0 ? res(out) : rej(new Error((err.trim().split('\n').slice(-3).join(' ') || out.trim().split('\n').slice(-2).join(' ') || 'exit ' + code).slice(0, 400))); });
  });
}
const have = async (cmd, args) => { try { await run(cmd, args, { timeout: 15000 }); return true; } catch { return false; } };
let toolCache = null;
async function tools(force) {
  if (toolCache && !force) return toolCache;
  const py = fs.existsSync(VENV_PY) ? VENV_PY : null, t = { ffmpeg: await have('ffmpeg', ['-version']), python: !!py, ytdlp: false, node: fs.existsSync(path.join(ROOT, '..', 'node_modules', '@spotify')), mpm: fs.existsSync(path.join(ROOT, '..', 'node_modules', 'pitchy')), pyin: false, crepe: false, separate: false };
  if (py) { t.ytdlp = await have(py, ['-I', '-m', 'yt_dlp', '--version']); t.pyin = await have(py, ['-I', '-c', 'import librosa, scipy']); t.crepe = await have(py, ['-I', '-c', 'import torchcrepe']); t.separate = await have(py, ['-I', '-c', 'import torch, demucs.pretrained, demucs.apply']); }
  return (toolCache = t);
}
const engineReady = (t, e) => e === 'basicpitch' ? t.node && t.ffmpeg : e === 'mpm' ? t.mpm && t.ffmpeg : e === 'pyin' ? t.pyin && t.ffmpeg : t.crepe && t.ffmpeg;

// ---------- jobs ----------
const jobs = new Map();
function job(fn) {
  const id = crypto.randomBytes(6).toString('hex'), j = { id, status: 'running', log: [], progress: 0, result: null, error: null };
  jobs.set(id, j); if (jobs.size > 60) jobs.delete(jobs.keys().next().value);
  const say = m => { m = String(m).replace(/[[0-9;]*[A-Za-z]/g, ''); j.log.push(m); if (j.log.length > 40) j.log.shift(); };
  fn(say, p => { j.progress = p; }).then(r => { j.result = r; j.status = 'done'; j.progress = 1; }, e => { j.error = String(e && e.message || e); j.status = 'error'; });
  return j;
}

// ---------- audio: YouTube / upload -> clip ----------
async function makeClip(fullFile, vid, title, src, start, len, say) {
  const id = `${vid}_${Math.round(start)}_${Math.round(len)}`, dir = path.join(DATA, id); fs.mkdirSync(dir, { recursive: true });
  say('Cutting the clip with ffmpeg…');
  await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(start), '-t', String(len), '-i', fullFile, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '128k', path.join(dir, 'audio.mp3')]);
  const info = { id, vid, title, src, start, len, made: Date.now() }; fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify(info)); return info;
}
async function fetchYoutube(url, start, len, say) {
  const t = await tools(true); if (!t.ytdlp) throw new Error('yt-dlp is not installed. Run: node tools/lab/setup.js'); if (!t.ffmpeg) throw new Error('ffmpeg is not installed.');
  let u; try { u = new URL(url); } catch { throw new Error('That is not a web address.'); } if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) links are allowed.');
  const yt = a => run(VENV_PY, ['-I', '-m', 'yt_dlp', '--no-playlist', '--no-warnings', '--no-colors', '--js-runtimes', 'node', ...a, '--', u.href], { onLine: l => { if (/%|Destination|Extract/.test(l)) say(l.slice(0, 120)); } });
  say('Reading the video details…');
  const meta = JSON.parse(await yt(['--skip-download', '--dump-single-json'])), vid = String(meta.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!vid) throw new Error('Could not read the video id.'); if (meta.duration > MAX_MIN * 60) throw new Error(`That video is ${Math.round(meta.duration / 60)} minutes long. The limit is ${MAX_MIN}.`);
  const full = path.join(FULL, vid + '.mp3');
  if (!fs.existsSync(full)) { say('Downloading the audio…'); await yt(['-x', '--audio-format', 'mp3', '--audio-quality', '5', '-o', path.join(FULL, vid + '.%(ext)s')]); if (!fs.existsSync(full)) throw new Error('The download did not produce an mp3 file.'); } else say('Audio already downloaded, reusing it.');
  return makeClip(full, vid, String(meta.title || vid).slice(0, 120), u.href, start, Math.min(len, Math.max(1, (meta.duration || len) - start)), say);
}

// ---------- engines ----------
async function separate(id, say, prog) {                          // Demucs: full mix -> vocals / bass / other / drums, saved as 22,050 Hz mono WAVs
  const dir = path.join(DATA, id), stems = path.join(dir, 'stems');
  if (fs.existsSync(path.join(stems, 'stem_vocals.wav'))) return;
  const t = await tools(true); if (!t.separate) throw new Error('Instrument separation is not installed. Run: node tools/lab/setup.js --separate');
  const wav = path.join(dir, 'work44.wav');
  if (!fs.existsSync(wav)) await run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(dir, 'audio.mp3'), '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', wav]);
  say('Separating the instruments with Demucs (about 3x slower than real time)…');
  await run(VENV_PY, ['-I', path.join(ROOT, 'engines', 'separate.py'), wav, stems], { onLine: l => { const m = /^PROGRESS ([\d.]+)/.exec(l); if (m) prog(+m[1] * 0.5); } });
}
async function runEngine(id, engine, stem, say, prog) {
  const t = await tools(true); if (!engineReady(t, engine)) throw new Error(`${ENGINES[engine].name} is not installed. Run: node tools/lab/setup.js${engine === 'crepe' ? ' --crepe' : ''}`);
  const dir = path.join(DATA, id), key = engine + (stem ? '.' + stem : ''), out = path.join(dir, key + '.json'); let wav = path.join(dir, 'work.wav');
  if (stem) { await separate(id, say, prog); wav = path.join(dir, 'stems', `stem_${stem}.wav`); }
  else if (!fs.existsSync(wav)) { say('Converting to 22,050 Hz mono…'); await run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(dir, 'audio.mp3'), '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', wav]); }
  say(`Running ${ENGINES[engine].name}${stem ? ' on the ' + stem + ' part' : ''}…`);
  const base = stem ? 0.5 : 0, onLine = l => { const m = /^PROGRESS ([\d.]+)/.exec(l); if (m) prog(base + +m[1] * (1 - base)); };
  if (engine === 'basicpitch' || engine === 'mpm') await run(process.execPath, [path.join(ROOT, 'engines', engine === 'mpm' ? 'mpm.js' : 'basicpitch.js'), wav, out], { onLine });
  else await run(VENV_PY, ['-I', path.join(ROOT, 'engines', 'f0engine.py'), '--method', engine, wav, out], { onLine });
  const r = JSON.parse(fs.readFileSync(out, 'utf8')); fs.writeFileSync(path.join(dir, key + '.mid'), core.writeMidi(r.notes, { name: key }));
  return { engine: key, count: r.notes.length, took: r.took };
}

// ---------- library ----------
function library() {
  return fs.readdirSync(DATA, { withFileTypes: true }).filter(d => d.isDirectory() && ID.test(d.name)).map(d => {
    try { const info = JSON.parse(fs.readFileSync(path.join(DATA, d.name, 'info.json'), 'utf8')); return { ...info, engines: fs.readdirSync(path.join(DATA, d.name)).map(f => /^((?:basicpitch|mpm|pyin|crepe)(?:\.(?:vocals|bass|other))?)\.json$/.exec(f)).filter(Boolean).map(m => m[1]) }; } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.made - a.made);
}

// ---------- http ----------
function originOk(o) { return !o || ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o); }
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
function readBody(req, limit) { return new Promise((res, rej) => { const c = []; let n = 0; req.on('data', d => { n += d.length; if (n > limit) { rej(new Error('Too large')); req.destroy(); } else c.push(d); }); req.on('end', () => res(Buffer.concat(c))); req.on('error', rej); }); }
const json = async req => { const b = await readBody(req, 1e6); try { return b.length ? JSON.parse(b) : {}; } catch { throw new Error('Bad JSON'); } };

http.createServer(async (req, res) => {
  const origin = req.headers.origin, host = (req.headers.host || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1'].includes(host) || !originOk(origin)) return send(res, 403, { error: 'Not allowed' });
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Private-Network', 'true'); res.setHeader('Access-Control-Allow-Headers', 'content-type,x-filename'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const u = new URL(req.url, 'http://x'), p = u.pathname.split('/').filter(Boolean);
  try {
    if (p[0] !== 'api') return send(res, 404, { error: 'Not found' });
    if (req.method === 'GET' && p[1] === 'status') { const t = await tools(u.searchParams.has('fresh')); return send(res, 200, { ok: true, tools: t, engines: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, { ...v, ready: !!engineReady(t, k) }])), maxMinutes: MAX_MIN, stems: STEMS }); }
    if (req.method === 'GET' && p[1] === 'library') return send(res, 200, { items: library() });
    if (req.method === 'GET' && p[1] === 'job' && ID.test(p[2] || '') && jobs.has(p[2])) { const j = jobs.get(p[2]); return send(res, 200, { status: j.status, progress: j.progress, log: j.log.slice(-6), result: j.result, error: j.error }); }
    if (req.method === 'POST' && p[1] === 'fetch') { const b = await json(req); return send(res, 200, { job: job(say => fetchYoutube(String(b.url || ''), num(b.start, 0, 0, MAX_MIN * 60), num(b.len, 60, 5, 300), say)).id }); }
    if (req.method === 'POST' && p[1] === 'upload') {
      const body = await readBody(req, MAX_UPLOAD), name = String(req.headers['x-filename'] || 'audio').slice(-80), start = num(u.searchParams.get('start'), 0, 0, 7200), len = num(u.searchParams.get('len'), 60, 5, 300);
      const vid = 'up' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 10), full = path.join(FULL, vid + '.bin');
      return send(res, 200, { job: job(async say => { if (!(await tools(true)).ffmpeg) throw new Error('ffmpeg is not installed.'); fs.writeFileSync(full, body); return makeClip(full, vid, name, 'upload', start, len, say); }).id });
    }
    if (req.method === 'POST' && p[1] === 'midi') { const b = await json(req); const stem = b.stem ? String(b.stem) : ''; if (stem && !STEMS.includes(stem)) throw new Error('Unknown part.'); if (!ID.test(b.id || '') || !ENGINES[b.engine] || !fs.existsSync(path.join(DATA, b.id, 'audio.mp3'))) throw new Error('Unknown clip or engine.'); return send(res, 200, { job: job((say, prog) => runEngine(b.id, b.engine, stem, say, prog)).id }); }
    if (req.method === 'GET' && p[1] === 'item' && ID.test(p[2] || '')) {
      const f = { 'audio.mp3': 'audio/mpeg', 'notes': 'application/json' }, dir = path.join(DATA, p[2]);
      if (p[3] === 'audio') return fs.existsSync(path.join(dir, 'audio.mp3')) ? send(res, 200, fs.readFileSync(path.join(dir, 'audio.mp3')), 'audio/mpeg') : send(res, 404, { error: 'No audio' });
      const m = /^(basicpitch|mpm|pyin|crepe)(?:\.(?:vocals|bass|other))?\.(json|mid)$/.exec(p[3] || ''); if (m && fs.existsSync(path.join(dir, p[3]))) return send(res, 200, fs.readFileSync(path.join(dir, p[3])), m[2] === 'mid' ? 'audio/midi' : 'application/json');
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) { send(res, 400, { error: String(e && e.message || e) }); }
}).listen(PORT, '127.0.0.1', () => console.log(`Lab helper ready on http://localhost:${PORT}  (leave this window open; press Ctrl+C to stop)`));
