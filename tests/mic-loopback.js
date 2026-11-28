// REAL-SOUND TEST: speaker -> air -> microphone -> the app's pitch detection. Needs a person at the PC (the notes are audible), a working speaker and microphone.
//   node tests/mic-loopback.js                      loopback: plays notes from the MusicXML scores in tests/samples through the speaker, reads them back with the microphone (detector only)
//   node tests/mic-loopback.js --mode app           same, but through the REAL tuner screen: checks the note shown, how far off it says it is, and that the in-tune beep fires
//   node tests/mic-loopback.js --mode listen --sec 10   records the microphone for 10 s while YOU play/sing/whistle, prints the notes heard (any real-sound check)
//   node tests/mic-loopback.js --mode speaker       the app's own Speaker test: realistic violin / guitar / ukulele performances (vibrato, slurs, plucks, mistakes) are played through the speaker, heard by the REAL microphone,
//                                                   run through the real Scale drill, and compared with the known truth. --direct (no speaker: the sound goes straight into the app, silent) --pieces [--piece <file part>] (real scores from tests/_pieces, fetch them with node tools/fetch-test-pieces.js) --set quick (2 takes) | all (7 takes, default) | --inst violin --level weak --vib 0 --bow slur4 --span 2 --bpm 80 --seed 5
//                                                   --gold  also saves each take as a gold clip (tests/audio/gold/*.wav + .truth.json, git-ignored) for tests/gold.js
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
const TAKES = []; let finish; const done = new Promise(r => (finish = r)); fs.mkdirSync(path.join(__dirname, '_mic'), { recursive: true });
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), body = [];
  req.on('data', d => body.push(d)); req.on('end', () => {
    const buf = Buffer.concat(body);
    if (u.pathname === '/api/core') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(core)); }
    if (u.pathname === '/api/result') { res.end('ok'); return finish(JSON.parse(buf.toString())); }
    if (u.pathname === '/api/wav') { saveWav(u.searchParams.get('name'), buf, +u.searchParams.get('sr') || 48000); return res.end('ok'); }
    if (u.pathname === '/api/pieces') { const d = path.join(root, 'tests', '_pieces'), ix = fs.existsSync(path.join(d, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')) : [], known = new Set(ix.map(p => p.file));
      // any score you drop in tests/_pieces/ (.mxl, .musicxml, .xml) that is not listed is run too, every instrument part on its own (the page reads the parts)
      const extra = fs.existsSync(d) ? fs.readdirSync(d).filter(f => /\.(mxl|musicxml|xml)$/i.test(f) && !known.has(f)).map(f => ({ file: f, auto: true, title: f.replace(/\.(mxl|musicxml|xml)$/i, '').replace(/[-_]+/g, ' ') })) : [];
      res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(ix.concat(extra))); }
    if (u.pathname.startsWith('/api/piece/')) { const f = path.join(root, 'tests', '_pieces', path.basename(decodeURIComponent(u.pathname.slice(11)))); if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); } return res.end(fs.readFileSync(f)); }
    if (u.pathname === '/api/log') { if (MODE === 'speaker') console.log('  ' + buf.toString()); return res.end('ok'); }
    if (u.pathname === '/api/take') { const t = JSON.parse(buf.toString()); TAKES.push(t); fs.writeFileSync(path.join(__dirname, '_mic', u.searchParams.get('name') + '.take.json'), JSON.stringify(t)); return res.end('ok'); }
    let p = path.join(root, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)); if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end('no'); }
    let data = fs.readFileSync(p);
    if (u.pathname === '/index.html' && u.searchParams.get('probe')) data = Buffer.from(data.toString().replace('</body>', `<script src="/tests/mic/${u.searchParams.get('probe') === 'speaker' ? 'speaker' : 'app'}-probe.js"></script></body>`));
    res.setHeader('content-type', types[path.extname(p)] || 'application/octet-stream'); res.setHeader('cache-control', 'no-store'); res.end(data);
  });
});
function saveWav(name, buf, sr0) {   // 32-bit float mono WAV; sample rate is added by the caller's note in the log (read it from the result)
  const sr = sr0 || 48000, n = buf.length / 4, h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + buf.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(32, 34); h.write('data', 36); h.writeUInt32LE(buf.length, 40);
  fs.writeFileSync(path.join(__dirname, '_mic', name + '.wav'), Buffer.concat([h, buf]));
}

srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port, prof = fs.mkdtempSync(path.join(os.tmpdir(), 'mic-test-'));
  const SP = ['inst', 'level', 'vib', 'bow', 'span', 'bpm', 'seed', 'root', 'type', 'grader', 'set', 'direct', 'pos', 'synth', 'pieces', 'piece', 'bpm', 'maxsec', 'only'].filter(k => arg(k, null) != null).map(k => `${k}=${encodeURIComponent(arg(k))}`).join('&');
  const q = MODE === 'speaker' ? `/index.html?probe=speaker&${SP}` : MODE === 'app' ? `/index.html?probe=app&notes=${all.join(',')}` : `/tests/mic/loopback.html?mode=${MODE}&notes=${all.join(',')}&sec=${arg('sec', 8)}&lo=${arg('lo', 70)}&hi=${arg('hi', 2000)}`;
  if (MODE === 'speaker') console.log('The app will play realistic instrument sound through the speaker and listen with the microphone. This is audible and takes a few minutes. Raise the speaker volume, use the speaker (not headphones) and keep the room quiet.');
  else if (MODE !== 'listen') console.log(`Playing ${all.length} notes through the speaker (${all.map(nameOf).join(' ')}) - this is audible, about ${Math.ceil(all.length * (MODE === 'app' ? 2.6 : 1.7) + 4)} s.`);
  else console.log(`Listening for ${arg('sec', 8)} s - make some sound once the browser opens.`);
  const br = spawn(exe, ['--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion', '--window-size=560,360', 'http://127.0.0.1:' + port + q], { stdio: 'ignore' });
  const to = setTimeout(() => finish({ error: 'timed out (no result from the browser)' }), (MODE === 'speaker' ? (arg('pieces', false) ? 3000 : 900) : 90) * 1000);
  const r = await done; clearTimeout(to);
  if (!arg('keep', false)) { spawnSync('taskkill', ['/PID', String(br.pid), '/T', '/F'], { stdio: 'ignore' }); }
  srv.close(); let fail = 0; const say = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fail++; };
  if (r.error) { console.log('FAIL ' + r.error); process.exit(1); }
  if (r.mode === 'speaker') {
    const f1 = (x, d = 1) => x == null ? '-' : x.toFixed(d); let quiet = false, hiddenRun = false;
    for (const t of TAKES) {
      if (t.skipped) { console.log(`SKIP ${t.name}: ${t.note}`); continue; }
      if (t.error) { console.log(`${t.tooQuiet ? 'TOO QUIET' : t.hidden ? 'HIDDEN' : 'FAIL'} ${t.name}: ${t.error}`); if (t.tooQuiet) quiet = true; else if (t.hidden) hiddenRun = true; else fail++; continue; }
      const p = t.pitch, d = t.detection, g = t.grade, tm = t.timing;
      console.log(`${t.ok ? 'PASS' : 'FAIL'} ${t.name}  [${t.sound || '?'}]`);
      console.log(`     found ${d.found}/${d.played} played notes${d.playedLong != null && d.playedLong !== d.played ? ' (' + d.foundLong + '/' + d.playedLong + ' of 100 ms or more)' : ''} | pitch error median ${f1(p.medAbs)}c  p95 ${f1(p.p95Abs)}c  bias ${f1(p.bias)}c  (${p.within5}/${p.n} within 5c) | wrong notes: ${d.wrongFlagged}/${d.wrongTruth} flagged, ${d.falseWrong} false | skipped: ${d.skippedTruth}`);
      console.log(`     onset lag ${f1(tm.latencyMs, 0)} ms, spread ${f1(tm.spreadMs, 0)} ms | score from sound ${g.measured ? g.measured.total + ' ' + g.measured.band : 'n/a'}  deserved ${g.reference.total} ${g.reference.band}  (pitch ${g.measured ? f1(g.measured.pitch, 0) : '-'}/${f1(g.reference.pitch, 0)}  fluency ${g.measured ? f1(g.measured.fluency, 0) : '-'}/${f1(g.reference.fluency, 0)}  tone ${g.measured ? f1(g.measured.tone, 0) : '-'}/${f1(g.reference.tone, 0)})`);
      if (t.calibration) { const k = t.calibration; console.log(`     timing check: ${k.hwMs == null ? 'skipped (' + (k.why || 'not run') + ')' : 'this setup adds ' + Math.round(k.hwMs) + ' ms (total ' + Math.round(k.totalMs) + ' ms, notes heard ' + (k.lags || []).filter(x => typeof x === 'number').length + '/' + (k.lags || []).length + ')'}`); }
      if (t.feedback) {
        const f = t.feedback, c = f.check || {};
        console.log(`     feedback shown: spots to fix ${f.spots.length ? f.spots.map(s => (s.bar ? 'bar ' + s.bar + ' ' : '') + s.name + (s.d ? (s.d === 'up' ? '↑' : '↓') : '') + ' (' + s.text + ')').join('; ') : 'none'}${f.offset != null && Math.abs(f.offset) >= 8 ? ' | overall ' + (f.offset > 0 ? 'sharp' : 'flat') + ' ' + Math.abs(f.offset).toFixed(0) + 'c' : ''}`);
        for (const l of f.focus) console.log('     improve: ' + l);
        console.log(`     really worst: ${(c.worst || []).map(w => (w.bar ? 'bar ' + w.bar + ' ' : '') + w.note + ' ' + w.cents).join(', ') || 'nothing clearly out'} | named ${c.recall == null ? '-' : Math.round(c.recall * c.worst.length) + '/' + c.worst.length} | wrongly accused ${c.falseSpots} | sharp/flat wrong ${c.signWrong}`);
      }
      for (const c of t.checks.filter(x => !x.ok)) console.log('     problem: ' + c.msg);
      if (!t.finished && t.debug) console.log('     debug: ' + JSON.stringify(t.debug));
      if (!t.ok) fail++;
      if (process.argv.includes('--gold')) {   // a gold clip: the recording and the notes as played (tests/gold.js reads this format)
        const dir = path.join(root, 'tests', 'audio', 'gold'); fs.mkdirSync(dir, { recursive: true }); const nm = 'speaker-' + t.file.replace(/^speaker-\d+-/, '') + '-' + (t.scenario.seed || 1);
        fs.copyFileSync(path.join(__dirname, '_mic', t.file + '.wav'), path.join(dir, nm + '.wav'));
        fs.writeFileSync(path.join(dir, nm + '.truth.json'), JSON.stringify({ instrument: t.scenario.inst, a4: 440, device: 'speaker-to-microphone', player: 'synthetic ' + t.scenario.level,
          notes: t.truth.filter(x => x.kind !== 'skipped').map(x => ({ midi: x.playedMidi, start: +(t.beatInWavS + x.startMs / 1000).toFixed(3), dur: Math.round(x.endMs - x.startMs), cents: x.cents })) }, null, 1));
      }
    }
    if (quiet || hiddenRun) { console.log(quiet ? 'INCONCLUSIVE: the microphone barely heard the speaker. Raise the volume and run again.' : 'INCONCLUSIVE: the browser window was hidden. Keep it visible (do not minimise or cover it) and the screen awake, and run again.'); process.exit(2); }
    const ran = TAKES.filter(x => !x.skipped).length; console.log(fail ? `${fail} of ${ran} takes FAILED` : `all ${ran} takes passed` + (ran < TAKES.length ? ` (${TAKES.length - ran} skipped)` : '')); console.log('recordings and truth: tests/_mic/speaker-*.wav, *.take.json' + (process.argv.includes('--gold') ? '; gold clips: tests/audio/gold/' : '')); process.exit(fail ? 1 : 0);
  }
  if (r.mode === 'listen') {
    const v = r.frames.filter(f => f.hz); console.log(`mic: ${r.mic}  ${r.sr} Hz  ${v.length}/${r.frames.length} frames had a clear pitch`);
    let last = null, since = 0; const out = []; for (const f of r.frames) { const m = f.hz ? Math.round(69 + 12 * Math.log2(f.hz / 440)) : null; if (m !== last) { if (last != null) out.push(`${nameOf(last)} ${since.toFixed(1)}-${f.t.toFixed(1)}s`); last = m; since = f.t; } }
    if (last != null) out.push(`${nameOf(last)} from ${since.toFixed(1)}s`); console.log(out.length ? 'notes heard: ' + out.join(', ') : 'no clear pitch heard'); console.log('recording: tests/_mic/listen.wav'); process.exit(0);
  }
  if (r.mode === 'loopback') {
    console.log(`mic: ${r.mic}  ${r.sr} Hz  room noise ${r.noise.toExponential(2)}`); console.log('note   truth Hz   heard Hz   real(speaker->mic)   synthesised   level');
    for (const x of r.rows) { const truth = 440 * Math.pow(2, (x.midi - 69) / 12); console.log(`${String(nameOf(x.midi)).padEnd(6)} ${truth.toFixed(1).padStart(8)} ${x.realHz == null ? '    -    ' : x.realHz.toFixed(1).padStart(10)}   ${(x.realCents == null ? 'MISS' : (x.realCents >= 0 ? '+' : '') + x.realCents + 'c').padStart(12)}   ${(x.synthCents == null ? 'MISS' : (x.synthCents >= 0 ? '+' : '') + x.synthCents + 'c').padStart(12)}   ${x.level}`); }
    console.log('every engine on the same recorded sound (cents off, MISS = nothing clear heard):'); for (const x of r.rows) console.log('  ' + String(nameOf(x.midi)).padEnd(5) + Object.entries(x.engines || {}).map(([k, v]) => k + ' ' + (v == null ? 'MISS' : (v >= 0 ? '+' : '') + v + 'c')).join('   '));
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
