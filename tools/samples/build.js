// Builds the instrument sample banks in data/samples/ from the original recordings (all CC0 / public domain). Not part of the app: run it by hand when a bank changes.
//   node tools/samples/build.js <folder with the downloaded sources> [violin|guitar|ukulele|piano]
// The folder holds (each in its own sub-folder, extracted as downloaded; nothing in it is ever run):
//   vsco/    the .wav files of "Strings/Solo Violin/Arco Vib" from https://github.com/sgossner/VSCO-2-CE   (CC0 1.0, Versilian / Sam Gossner)
//   guitar/  FreePats Spanish Classical Guitar, SFZ+FLAC, the 'samples' folder                           (CC0 1.0, Roberto Garcia, https://freepats.zenvoid.org/Guitar/acoustic-guitar.html)
//   uke/     FreePats Ukulele, SFZ+FLAC, the 'samples' folder                                            (CC0 1.0, https://freepats.zenvoid.org/GuitarFamily/ukulele.html)
//   ydp/     FreePats YDP Grand Piano, SF2 (the .sf2 file in it)                                          (CC BY 3.0: Zenph Studios Yamaha Disklavier Pro Piano Multisamples for OLPC, edited by Roberto Garcia for FreePats; credit required)
//   piano/   (older) FreePats Upright Piano KW (small), SFZ+FLAC, the 'samples' folder: used only when there is no ydp/ folder
// For every sample it: cuts it to a length the app can use, makes it mono 44.1 kHz, fades its tail, stores it as a small MP3, and MEASURES the pitch it really has (with the app's own
// yin(), js/core/pitch.js) so the sampler can play it in tune: some of the original packs ship small tuning corrections (an SFZ "tune=-5") and the names are only nominal.
// It also measures the level (so notes of different samples sound equally loud) and, for the violin, the vibrato the player really made (rate and depth).
// ffmpeg is called with an argument list (never a shell). Output: data/samples/<inst>/<NAME>.mp3 and data/samples/<inst>/index.json.
const fs = require('fs'), path = require('path'), vm = require('vm'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..', '..'), src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.log('usage: node tools/samples/build.js <folder with vsco/ guitar/ uke/ piano/>'); process.exit(1); }
const ctx = vm.createContext({ Math, console });
for (const f of ['js/core/pitch.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const yin = (b, sr, lo, hi) => vm.runInContext('yin', ctx)(b, sr, lo, hi);
const SR = 44100, hz = m => 440 * Math.pow(2, (m - 69) / 12), cents = (a, b) => 1200 * Math.log2(a / b);
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const midiOf = n => { const m = /^([A-G]#?)(-?\d)/.exec(n); return m ? 12 * (+m[2] + 1) + NOTE[m[1]] : null; };
const find = (dir, re) => { const out = []; (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (re.test(e.name)) out.push(p); } })(dir); return out; };
const ff = args => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error('ffmpeg: ' + String(r.stderr).slice(0, 300)); return r.stdout; };
const decode = (file, sec) => { const b = ff(['-i', file, '-t', String(sec), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']); return new Float32Array(b.buffer, b.byteOffset, b.length >> 2).slice(); };
// The time the sound clearly starts (the same rule as smOnset in js/core/sampler.js): the first moment the level passes 8% of the loudest point of the first 1.5 s.
const onsetOf = x => { const n = Math.min(x.length, Math.floor(SR * 1.5)); let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(x[i])); for (let i = 0; i < n; i++) if (Math.abs(x[i]) > 0.08 * pk) return i / SR; return 0; };
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const rms = x => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / (x.length || 1)); };

// Pitch the sample really has: yin over windows of the steady part (from 0.25 s to the end of the measured span), median in cents against the nominal equal-tempered pitch of its key.
// Returns { cents, vib: { hz, depth } } (vib from the 10 ms pitch track, for bowed samples).
function measure(x, midi, from, to) {
  const f0 = hz(midi), lo = f0 * 0.7, hi = f0 * 1.45, win = 4096, track = [];
  for (let o = Math.floor(from * SR); o + win <= Math.min(x.length, Math.floor(to * SR)); o += 441) { const r = yin(x.subarray(o, o + win), SR, lo, hi); if (r && r.clarity > 0.9) track.push({ t: (o + win / 2) / SR, c: cents(r.freq, f0) }); }
  if (track.length < 8) return null;
  const c = track.map(q => q.c), m = med(c), dev = c.map(v => v - m);
  // Vibrato: detrend the pitch track (10 ms steps), then find the strongest repeat between 3 and 9 Hz by autocorrelation; depth is the peak swing of a sine with the same spread.
  const n = dev.length, mean = dev.reduce((x, y) => x + y, 0) / n, d0 = dev.map((v, i) => v - mean);
  let sx = 0, sy = 0, sxy = 0, sxx = 0; d0.forEach((v, i) => { sx += i; sy += v; sxy += i * v; sxx += i * i; }); const k = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), d1 = d0.map((v, i) => v - k * (i - (n - 1) / 2));
  let best = 0, lagBest = 0; for (let lag = 11; lag <= 33 && lag < n / 2; lag++) { let r = 0, e = 0; for (let i = 0; i + lag < n; i++) { r += d1[i] * d1[i + lag]; e += d1[i] * d1[i]; } const c1 = e ? r / e : 0; if (c1 > best) { best = c1; lagBest = lag; } }
  const sd = Math.sqrt(d1.reduce((x, y) => x + y * y, 0) / n), vibHz = lagBest ? 100 / lagBest : 0, depth = best > 0.2 ? sd * Math.SQRT2 : sd * Math.SQRT2 * Math.max(0, best);
  return { cents: +m.toFixed(2), vib: { hz: +((depth >= 4 && vibHz) || 5.5).toFixed(2), depth: +depth.toFixed(1) } };   // a swing under 4 cents is too small to give a reliable rate
}

// The grand piano comes as one SoundFont file: its samples (one per three semitones, several velocities) are written out as WAV files first, the loudest velocity of each key.
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], noteName = m => NAMES[m % 12] + (Math.floor(m / 12) - 1);
function extractGrand(srcDir) {
  const d = path.join(srcDir, 'ydp'); if (!fs.existsSync(d)) return null;
  const sf2 = find(d, /\.sf2$/i)[0]; if (!sf2) return null;
  const out = path.join(d, '_wav'); fs.mkdirSync(out, { recursive: true }); for (const f of fs.readdirSync(out)) fs.unlinkSync(path.join(out, f));
  const { readSf2 } = require('./sf2.js'), sf = readSf2(fs.readFileSync(sf2)), best = new Map();
  for (const s of sf.samples) { const v = +((/v(\d+)$/.exec(s.name) || [])[1] || 0), b = best.get(s.pitch); if (!b || v > b.v) best.set(s.pitch, { s, v }); }
  for (const [key, { s }] of best) {
    const x = sf.pcm(s), h = Buffer.alloc(44), n = x.length, pcm = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), i * 2);
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(s.rate, 24); h.writeUInt32LE(s.rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync(path.join(out, noteName(key) + '.wav'), Buffer.concat([h, pcm]));
  }
  return out;
}
const GRAND = extractGrand(src);
const BANKS = {
  violin: { dir: 'vsco', re: /\.wav$/i, parse: f => { const m = /_([A-G]#?\d)_([fp])\.wav$/i.exec(f); return m && { midi: midiOf(m[1]), layer: m[2].toLowerCase(), name: m[1] + '_' + m[2].toLowerCase() }; }, keep: 5.0, fade: 0.35, measureTo: 4.2, region: [0.3, 1.5], vibrato: true,
    license: 'CC0 1.0', credit: 'VSCO 2 Community Edition (Versilian Studios / Sam Gossner), Solo Violin, Arco Vib', url: 'https://github.com/sgossner/VSCO-2-CE', kind: 'bowed' },
  guitar: { dir: 'guitar', re: /\.flac$/i, parse: f => { const m = /^([A-G]#?\d)\.flac$/.exec(path.basename(f)); return m && { midi: midiOf(m[1]), name: m[1] }; }, keep: 3.2, fade: 0.4, measureTo: 1.6, vibrato: false,
    license: 'CC0 1.0', credit: 'FreePats Spanish Classical Guitar (Roberto Garcia)', url: 'https://freepats.zenvoid.org/Guitar/acoustic-guitar.html', kind: 'plucked' },
  ukulele: { dir: 'uke', re: /\.flac$/i, parse: f => { const m = /^([A-G]#?\d)\.flac$/.exec(path.basename(f)); return m && { midi: midiOf(m[1]), name: m[1] }; }, keep: 2.2, fade: 0.3, measureTo: 1.2, vibrato: false,
    license: 'CC0 1.0', credit: 'FreePats Ukulele', url: 'https://freepats.zenvoid.org/GuitarFamily/ukulele.html', kind: 'plucked' },
  piano: GRAND ? { dir: 'ydp/_wav', re: /\.wav$/i, parse: f => { const m = /^([A-G]#?\d)\.wav$/.exec(path.basename(f)); return m && { midi: midiOf(m[1]), name: m[1] }; }, keep: 4.5, fade: 0.6, measureTo: 2.4, vibrato: false,
    license: 'CC BY 3.0', credit: 'YDP Grand Piano: Zenph Studios Yamaha Disklavier Pro Piano Multisamples for OLPC (CC BY 3.0), edited by Roberto Garcia for FreePats', url: 'https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html', kind: 'struck' }
    : { dir: 'piano', re: /\.flac$/i, parse: f => { const m = /^([A-G]#?\d)vH\.flac$/.exec(path.basename(f)); return m && { midi: midiOf(m[1]), name: m[1] }; }, keep: 4.0, fade: 0.5, measureTo: 2.4, vibrato: false,
    license: 'CC0 1.0', credit: 'FreePats Upright Piano KW (small)', url: 'https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html', kind: 'struck' },
};

for (const [inst, B] of Object.entries(BANKS)) {
  if (process.argv[3] && process.argv[3] !== inst) continue;   // node tools/samples/build.js <folder> piano: only that bank
  const dir = path.join(src, B.dir); if (!fs.existsSync(dir)) { console.log('skip ' + inst + ': no ' + B.dir + '/ folder'); continue; }
  const out = path.join(root, 'data', 'samples', inst); fs.mkdirSync(out, { recursive: true }); for (const f of fs.readdirSync(out)) fs.unlinkSync(path.join(out, f));
  const files = [], skipped = [];
  for (const f of find(dir, B.re).sort()) {
    const p = B.parse(f); if (!p || p.midi == null) continue;
    const x = decode(f, B.keep), on = onsetOf(x);
    // The pitch a note of ordinary length has: a bowed note drifts over its 5 seconds, so the violin is measured over the stretch just after its start (onset + 0.3 s to onset + 1.5 s), the part a typical note uses.
    const m = B.region ? measure(x, p.midi, on + B.region[0], Math.min(on + B.region[1], x.length / SR)) : measure(x, p.midi, 0.3, Math.min(B.measureTo, x.length / SR));
    if (!m) { skipped.push(path.basename(f)); continue; }
    const steady = x.subarray(Math.floor(0.3 * SR), Math.min(x.length, Math.floor(B.measureTo * SR))), mp3 = p.name.replace('#', 's') + '.mp3';   // 's' for sharp: a '#' in a file name starts a URL fragment and the file could not be fetched
    let pk = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; }
    ff(['-i', f, '-t', String(B.keep), '-ac', '1', '-ar', String(SR), '-af', `afade=t=out:st=${Math.max(0, B.keep - B.fade)}:d=${B.fade}`, '-c:a', 'libmp3lame', '-b:a', '80k', path.join(out, mp3)]);
    files.push({ midi: p.midi, layer: p.layer || null, file: mp3, cents: m.cents, rms: +rms(steady).toFixed(5), peak: +pk.toFixed(4), vib: B.vibrato ? m.vib : null, dur: +(Math.min(B.keep, x.length / SR)).toFixed(2) });
  }
  files.sort((a, b) => a.midi - b.midi || String(a.layer).localeCompare(String(b.layer)));
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ inst, kind: B.kind, license: B.license, credit: B.credit, url: B.url, sr: SR, files }, null, 1));
  const bytes = fs.readdirSync(out).reduce((s, f) => s + fs.statSync(path.join(out, f)).size, 0);
  console.log(`${inst}: ${files.length} samples, ${(bytes / 1024).toFixed(0)} KB, MIDI ${files[0].midi}-${files[files.length - 1].midi}, tuning offsets ${Math.min(...files.map(f => f.cents)).toFixed(1)}..${Math.max(...files.map(f => f.cents)).toFixed(1)} cents${skipped.length ? ', skipped (no clear pitch): ' + skipped.join(' ') : ''}`);
}
