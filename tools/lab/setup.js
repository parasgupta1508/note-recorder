// One-time setup for the Lab helper. node tools/lab/setup.js [--crepe]
//   - checks ffmpeg and Node
//   - installs Basic Pitch for Node (tools/node_modules) if missing
//   - makes a private Python environment (tools/lab/.venv) with yt-dlp, numpy, scipy, librosa (pYIN)
//   - with --crepe also installs torch + torchcrepe (large download, about 200 MB, optional)
//   - with --separate also installs torch + Demucs (splits a song into vocals / bass / other; about 300 MB plus an 80 MB model on first use)
// Safe to run again: it only adds what is missing.
const cp = require('child_process'), fs = require('fs'), path = require('path');
const ROOT = __dirname, TOOLS = path.join(ROOT, '..'), WIN = process.platform === 'win32', VENV = path.join(ROOT, '.venv'), PY = path.join(VENV, WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python');
const step = m => console.log('\n== ' + m), run = (c, a, o = {}) => cp.spawnSync(c, a, { stdio: 'inherit', shell: false, ...o }).status === 0;
let bad = 0;

step('ffmpeg');
if (cp.spawnSync('ffmpeg', ['-version']).status === 0) console.log('found'); else { console.log('NOT FOUND. Install it (Windows: winget install Gyan.FFmpeg) and open a new terminal.'); bad++; }

step('Basic Pitch for Node');
if (fs.existsSync(path.join(TOOLS, 'node_modules', '@spotify'))) console.log('already installed');
else if (!run(WIN ? 'npm.cmd' : 'npm', ['install'], { cwd: TOOLS, shell: WIN })) { console.log('npm install failed'); bad++; }

step('Python environment');
if (!fs.existsSync(PY)) { const sys = ['python', 'python3', 'py'].find(c => cp.spawnSync(c, ['--version']).status === 0); if (!sys || !run(sys, ['-m', 'venv', VENV])) { console.log('Could not create the Python environment. Install Python 3 first.'); process.exit(1); } }
const sep = process.argv.includes('--separate'), pkgs = ['yt-dlp', 'numpy', 'scipy', 'librosa'].concat(process.argv.includes('--crepe') ? ['torch', 'torchcrepe'] : [], sep ? ['torch', 'torchaudio', 'einops', 'julius', 'openunmix', 'pyyaml', 'tqdm'] : []);
if (!run(PY, ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', ...pkgs])) { console.log('pip install failed'); bad++; }
if (sep && !run(PY, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-deps', 'demucs'])) { console.log('demucs install failed'); bad++; }   // --no-deps: its optional dependency sphn needs a compiler

step('Check');
const ok = (n, a) => { const r = cp.spawnSync(PY, ['-I', ...a]).status === 0; console.log((r ? 'ok      ' : 'MISSING ') + n); return r; };
ok('yt-dlp (YouTube to mp3)', ['-m', 'yt_dlp', '--version']); ok('pYIN (librosa)', ['-c', 'import librosa, scipy']); const c = cp.spawnSync(PY, ['-I', '-c', 'import torchcrepe']).status === 0; console.log((c ? 'ok      ' : 'skipped ') + 'CREPE (torchcrepe, optional: setup.js --crepe)'); const d = cp.spawnSync(PY, ['-I', '-c', 'import torch, demucs.pretrained, demucs.apply']).status === 0; console.log((d ? 'ok      ' : 'skipped ') + 'Demucs separation (optional: setup.js --separate)');
console.log(bad ? '\nFinished with problems (see above).' : '\nDone. Start the helper with:  node tools/lab/server.js');
process.exit(bad ? 1 : 0);
