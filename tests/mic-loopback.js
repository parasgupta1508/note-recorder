// REAL-SOUND TEST: speaker -> air -> microphone -> the app's pitch detection. Needs a person at the PC (the notes are audible), a working speaker and microphone.
//   node tests/mic-loopback.js                      loopback: plays notes from the MusicXML scores in tests/samples through the speaker, reads them back with the microphone (detector only)
//   node tests/mic-loopback.js --mode app           same, but through the REAL tuner screen: checks the note shown, how far off it says it is, and that the in-tune beep fires
//   node tests/mic-loopback.js --mode listen --sec 10   records the microphone for 10 s while YOU play/sing/whistle, prints the notes heard (any real-sound check)
// Options: --score <file.musicxml> (default: every file in tests/samples)  --max <n> notes (default 10, spread over the score's range)  --lo/--hi Hz (listen)  --keep (leave the browser open)
// Why headed Edge: headless browsers cannot use the microphone. --use-fake-ui-for-media-stream only auto-accepts the permission prompt; the device used is the real default microphone.
// Recordings are saved to tests/_mic/*.wav (git-ignored) so a failing run can be listened to and re-analysed.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn, spawnSync } = require('child_process');
const root = path.join(__dirname, '..'), lib = require('./lib/load.js');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const MODE = arg('mode', 'loopback'), MAXN = +arg('max', 10), LOOPBACK_TOL = 10;   // cents: the same ±10¢ the tuner calls "in tune"
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
if (!exe) { console.log('No Edge/Chrome found - skipped'); process.exit(0); }

// ---- the notes to play: distinct violin-range notes of the scores, spread evenly
const sdir = path.join(__dirname, 'samples'), files = arg('score', null) && arg('score', null) !== true ? [arg('score')] : fs.readdirSync(sdir).filter(n => /\.musicxml$/.test(n)).map(n => path.join(sdir, n));
const set = new Set(); for (const f of files) lib.pieceFromMusicXml(fs.readFileSync(f, 'utf8'), { name: path.basename(f), instrument: 'violin' }).parts.forEach(p => p.notes.forEach(n => { if (n.midi >= 55 && n.midi <= 93) set.add(n.midi); }));
let all = [...set].sort((a, b) => a - b); if (all.length > MAXN) all = Array.from({ length: MAXN }, (_, i) => all[Math.round(i * (all.length - 1) / (MAXN - 1))]);
const nameOf = m => lib.midiName ? lib.midiName(m) : m;

// ---- tiny local server (localhost counts as a secure context, so the microphone is allowed)
const core = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/src="(js\/core\/[^"]+)"/g)].map(m => m[1]);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
let finish; const done = new Promise(r => (finish = r)); fs.mkdirSync(path.join(__dirname, '_mic'), { recursive: true });
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), body = [];
  req.on('data', d => body.push(d)); req.on('end', () => {
    const buf = Buffer.concat(body);
    if (u.pathname === '/api/core') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(core)); }
    if (u.pathname === '/api/result') { res.end('ok'); return finish(JSON.parse(buf.toString())); }
    if (u.pathname === '/api/wav') { saveWav(u.searchParams.get('name'), buf); return res.end('ok'); }
    let p = path.join(root, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)); if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end('no'); }
    let data = fs.readFileSync(p);
    if (u.pathname === '/index.html' && u.searchParams.get('probe')) data = Buffer.from(data.toString().replace('</body>', '<script src="/tests/mic/app-probe.js"></script></body>'));
    res.setHeader('content-type', types[path.extname(p)] || 'application/octet-stream'); res.setHeader('cache-control', 'no-store'); res.end(data);
  });
});
function saveWav(name, buf) {   // 32-bit float mono WAV; sample rate is added by the caller's note in the log (read it from the result)
  const sr = 48000, n = buf.length / 4, h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + buf.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(32, 34); h.write('data', 36); h.writeUInt32LE(buf.length, 40);
  fs.writeFileSync(path.join(__dirname, '_mic', name + '.wav'), Buffer.concat([h, buf]));
}

srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port, prof = fs.mkdtempSync(path.join(os.tmpdir(), 'mic-test-'));
  const q = MODE === 'app' ? `/index.html?probe=app&notes=${all.join(',')}` : `/tests/mic/loopback.html?mode=${MODE}&notes=${all.join(',')}&sec=${arg('sec', 8)}&lo=${arg('lo', 70)}&hi=${arg('hi', 2000)}`;
  if (MODE !== 'listen') console.log(`Playing ${all.length} notes through the speaker (${all.map(nameOf).join(' ')}) - this is audible, about ${Math.ceil(all.length * (MODE === 'app' ? 2.6 : 1.7) + 4)} s.`);
  else console.log(`Listening for ${arg('sec', 8)} s - make some sound once the browser opens.`);
  const br = spawn(exe, ['--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--window-size=560,360', 'http://127.0.0.1:' + port + q], { stdio: 'ignore' });
  const to = setTimeout(() => finish({ error: 'timed out after 90 s (no result from the browser)' }), 90000);
  const r = await done; clearTimeout(to);
  if (!arg('keep', false)) { spawnSync('taskkill', ['/PID', String(br.pid), '/T', '/F'], { stdio: 'ignore' }); }
  srv.close(); let fail = 0; const say = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fail++; };
  if (r.error) { console.log('FAIL ' + r.error); process.exit(1); }
  if (r.mode === 'listen') {
    const v = r.frames.filter(f => f.hz); console.log(`mic: ${r.mic}  ${r.sr} Hz  ${v.length}/${r.frames.length} frames had a clear pitch`);
    let last = null, since = 0; const out = []; for (const f of r.frames) { const m = f.hz ? Math.round(69 + 12 * Math.log2(f.hz / 440)) : null; if (m !== last) { if (last != null) out.push(`${nameOf(last)} ${since.toFixed(1)}-${f.t.toFixed(1)}s`); last = m; since = f.t; } }
    if (last != null) out.push(`${nameOf(last)} from ${since.toFixed(1)}s`); console.log(out.length ? 'notes heard: ' + out.join(', ') : 'no clear pitch heard'); console.log('recording: tests/_mic/listen.wav'); process.exit(0);
  }
  if (r.mode === 'loopback') {
    console.log(`mic: ${r.mic}  ${r.sr} Hz  room noise ${r.noise.toExponential(2)}`); console.log('note   truth Hz   heard Hz   real(speaker->mic)   synthesised   level');
    for (const x of r.rows) { const truth = 440 * Math.pow(2, (x.midi - 69) / 12); console.log(`${String(nameOf(x.midi)).padEnd(6)} ${truth.toFixed(1).padStart(8)} ${x.realHz == null ? '    -    ' : x.realHz.toFixed(1).padStart(10)}   ${(x.realCents == null ? 'MISS' : (x.realCents >= 0 ? '+' : '') + x.realCents + 'c').padStart(12)}   ${(x.synthCents == null ? 'MISS' : (x.synthCents >= 0 ? '+' : '') + x.synthCents + 'c').padStart(12)}   ${x.level}`); }
    const snr = r.rows.map(x => x.level / r.noise).sort((a, b) => a - b)[r.rows.length >> 1], quiet = snr < 4;
    console.log('note level vs room noise: ' + snr.toFixed(1) + 'x' + (quiet ? '  <-- TOO QUIET: raise the speaker volume or quiet the room. MISS rows are then the room, not the detector.' : ''));
    const ok = r.rows.filter(x => x.realCents != null && Math.abs(x.realCents) <= LOOPBACK_TOL), octave = r.rows.filter(x => x.realCents != null && Math.abs(x.realCents) > 300);
    if (quiet) { console.log('INCONCLUSIVE: the microphone barely heard the speaker, so this run proves nothing about the detector. Raise the volume and run again.'); process.exit(2); }
    say(ok.length / r.rows.length >= 0.85, `speaker->mic: ${ok.length}/${r.rows.length} notes read within ±${LOOPBACK_TOL}c (needs 85%)`);
    say(octave.length === 0, `no octave/wrong-note errors (${octave.length} found)`);
    say(r.rows.every(x => x.synthCents != null && Math.abs(x.synthCents) <= 3), 'synthesised control tones read within 3c (the detector itself is fine)');
  }
  if (r.mode === 'app') {
    if (r.cal0) console.log('auto-calibration: gate ' + r.cal0.gate + ' boost ' + r.cal0.boost + '  ->  after first note: gate ' + r.cal1.gate + ' boost ' + r.cal1.boost);
    console.log('note   shown  right-note  final offset   in-tune beep'); for (const x of r.rows) console.log(`${String(nameOf(x.midi)).padEnd(6)} ${String(x.shown).padStart(5)} ${String(x.rightNote).padStart(10)} ${(x.finalDisp == null ? '-' : (x.finalDisp >= 0 ? '+' : '') + x.finalDisp + 'c').padStart(13)}   ${x.beeped ? 'beeped' : 'no beep'}`);
    if (process.argv.includes('--debug')) console.log(JSON.stringify(r.rows.map(x => x.sample)));
    const good = r.rows.filter(x => x.rightNote >= 3 && x.finalDisp != null && Math.abs(x.finalDisp) <= LOOPBACK_TOL);
    say(good.length / r.rows.length >= 0.85, `real tuner shows the right note, in tune (±${LOOPBACK_TOL}c): ${good.length}/${r.rows.length} (needs 85%)`);
    say(good.every(x => x.beeped), `the in-tune beep fires for every note that is shown in tune (${good.filter(x => x.beeped).length}/${good.length})`);
  }
  console.log('recordings: tests/_mic/'); process.exit(fail ? 1 : 0);
});
