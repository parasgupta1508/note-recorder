// Runs the detector over a real clip (tests/audio/*.f32 = mono float32 @44100, made with ffmpeg) and prints stats. Not committed (audio is ignored).
const fs = require('fs'), path = require('path');
const lib = require('./lib/load.js');
const file = process.argv[2] || 'taegukgi.f32', b = fs.readFileSync(path.join(__dirname, 'audio', file)), x = new Float32Array(b.buffer, b.byteOffset, b.length >> 2);
const modes = (process.argv[3] || 'auto,fast,normal,strict').split(','), lo = +(process.argv[4] || 190), hi = +(process.argv[5] || 2600);
for (const mode of modes) {
  const t = Date.now(), n = lib.analyseSamples(x, 44100, { m: lib.REC_MODES[mode === 'auto' ? 'fast' : mode], auto: mode === 'auto', fmin: lo, fmax: hi, conf: 0.85, a4: 440 });
  const d = n.map(e => e.dur), short = d.filter(v => v < 80).length, med = d.sort((a, b) => a - b)[d.length >> 1];
  const midis = n.map(e => e.midi), jumps = n.slice(1).filter((e, i) => Math.abs(e.midi - n[i].midi) >= 12).length;
  console.log(`${mode.padEnd(7)} notes ${String(n.length).padStart(4)}  <80ms ${String(short).padStart(3)}  median ${Math.round(med)}ms  range ${lib.midiName(Math.min(...midis))}-${lib.midiName(Math.max(...midis))}  octave-jumps ${jumps}  (${Date.now() - t}ms)`);
  if (process.argv[6] === mode) console.log(n.map(e => `${e.start.toFixed(1)}s ${e.note} ${Math.round(e.dur)}`).join('\n'));
}
