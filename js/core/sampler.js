// Instrument sampler: plays any note by re-pitching the nearest real recording (data/samples/<inst>/, built by tools/samples/build.js, all CC0).
// Pure logic: no DOM, no Web Audio, so it runs in Node tests and renders into plain Float32Array buffers. The browser side (js/app/sampler.js) loads the files and plays them live.
//
//   A bank: { inst, kind: 'bowed'|'plucked'|'struck', sr, notes: [{ midi, layer: 'f'|'p'|null, cents, rms, peak, vib: { hz, depth } | null, dur, data: Float32Array, onset }] }
//     cents  how far the recording's own pitch is from the equal-tempered pitch of its key (measured when the bank was built, with yin()), so it can be played exactly in tune
//     onset  seconds into the recording where the sound clearly starts (found by smOnset), so a note can be placed so that its audible start is on the beat
//   smPick(bank, midi, layer)          the recording to play for a note
//   smPlan(bank, o)                    how to play one note: the recording, the playback rate, the gain, where to start, the loop
//   smVoice(bank)                      a function (out, sr, o, rnd) that mixes one note into a buffer: the voice perf-synth.js can use instead of its own synthesis
//   smVibOf(bank)                      (midi, vel) -> the vibrato the recording has, for the truth of a performance
// o: { midi, cents (the player's deviation from equal temperament), t0 (seconds), dur, amp, vel (1 = normal; below 1 plays the softer layer), legato, release, a4 }

const SM_TARGET = 0.1;             // the level a bowed note is brought to (rms); plucked and struck notes are set by their peak

// The time the sound clearly starts: the first moment the level passes 8% of the loudest point of the first 1.5 seconds.
function smOnset(data, sr) {
  const n = Math.min(data.length, Math.floor(sr * 1.5)); let pk = 0; for (let i = 0; i < n; i++) { const a = Math.abs(data[i]); if (a > pk) pk = a; }
  const th = 0.08 * pk; for (let i = 0; i < n; i++) if (Math.abs(data[i]) > th) return i / sr;
  return 0;
}
// bank files: the index.json 'files' entries, each with its decoded samples as `data` (and `sr`)
function smMakeBank(index, decoded) {
  return { inst: index.inst, kind: index.kind, sr: index.sr, license: index.license, credit: index.credit,
    notes: index.files.map((f, i) => ({ midi: f.midi, layer: f.layer, cents: f.cents, rms: f.rms, peak: f.peak, vib: f.vib, dur: f.dur, data: decoded[i].data, sr: decoded[i].sr || index.sr, onset: smOnset(decoded[i].data, decoded[i].sr || index.sr) })) };
}
function smPick(bank, midi, layer) {
  let pool = bank.notes; if (layer) { const l = pool.filter(n => n.layer === layer); if (l.length) pool = l; }
  let best = null; for (const n of pool) if (!best || Math.abs(n.midi - midi) < Math.abs(best.midi - midi) || (Math.abs(n.midi - midi) === Math.abs(best.midi - midi) && n.midi < best.midi)) best = n;   // nearest key; on a tie the lower one (shifted up, it sounds less thin)
  return best;
}
const smLayer = vel => (vel != null && vel < 0.95 ? 'p' : 'f');

function smPlan(bank, o) {
  const layer = bank.notes.some(n => n.layer) ? smLayer(o.vel) : null, s = smPick(bank, o.midi, layer);
  const tune = 12 * Math.log2((o.a4 || 440) / 440);            // a different A4 moves every note
  const semis = (o.midi - s.midi) + ((o.cents || 0) - s.cents) / 100 + tune, rate = Math.pow(2, semis / 12) * (s.sr / (o.sr || s.sr));   // samples of the recording per output sample
  const level = bank.kind === 'bowed' ? SM_TARGET / Math.max(1e-6, s.rms) : 0.5 / Math.max(1e-6, s.peak);
  const gain = (o.amp == null ? 0.3 : o.amp) / 0.3 * level * (layer === 'p' ? 0.5 : 1);   // the soft layer is half as loud (the recordings are normalised, so the dynamic is put back)
  // where the recording is read from: a new note starts at the recording's start; a note slurred from the one before skips the bow's attack
  const from = o.legato && bank.kind === 'bowed' ? Math.min(s.onset + 0.22, s.dur * 0.5) : 0;
  const loop = bank.kind === 'bowed' ? { a: Math.max(s.onset + 0.6, s.dur - 0.45 - 1.4), b: s.dur - 0.45 } : null;
  return { s, rate, gain, from, loop, semis };
}

// Mix one note into out (Float32Array at sr). The note's audible start is at o.t0: the recording is placed so that its own onset lands there.
function smRender(bank, out, sr, o) {
  const P = smPlan(bank, Object.assign({ sr }, o)), s = P.s, d = s.data, sr0 = s.sr, step = P.rate;   // step: recording samples per output sample
  const lead = P.from ? 0 : s.onset, startOut = Math.round(o.t0 * sr - lead * sr0 / step);   // output index where reading begins (the recording's lead-in comes first)
  const rel = Math.max(0.01, o.release == null ? 0.05 : o.release), end = Math.round((o.t0 + o.dur) * sr), relN = Math.max(1, Math.round(rel * sr)), atk = P.from ? Math.round(0.015 * sr) : 0;
  let pos = P.from * sr0; const xf = 0.04 * sr0, span = P.loop ? (P.loop.b - P.loop.a) * sr0 : 0;
  const at = i => { const k = Math.floor(i), f = i - k; if (k < 1 || k + 2 >= d.length) return k >= 0 && k < d.length ? d[k] : 0; const a = d[k - 1], b = d[k], c = d[k + 1], e = d[k + 2]; return b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - e + f * (3 * (b - c) + e - a))); };   // Catmull-Rom
  for (let i = startOut; i < out.length; i++) {
    if (i < 0) { pos += step; continue; }
    if (i > end + relN) break;
    let v;
    if (P.loop && pos >= P.loop.b * sr0 - xf) {                  // loop the steady part of a bowed note, blending the end into its start
      const w = Math.min(1, (pos - (P.loop.b * sr0 - xf)) / xf); v = (1 - w) * at(pos) + w * at(pos - span);
      if (pos >= P.loop.b * sr0) pos -= span;
    } else { if (pos >= d.length - 3) break; v = at(pos); }
    let g = P.gain; if (i > end) g *= 1 - (i - end) / relN; if (atk && i - startOut < atk) g *= (i - startOut) / atk;
    out[i] += v * g; pos += step;
  }
}
function smVoice(bank) {
  const plucked = bank.kind !== 'bowed';
  return (out, sr, o) => { smRender(bank, out, sr, Object.assign({}, o, { release: plucked ? Math.max(o.release || 0, 0.12) : o.release })); return true; };
}
function smVibOf(bank) {
  return (midi, vel) => { const P = smPlan(bank, { midi, vel }); return P.s.vib ? { hz: P.s.vib.hz * P.rate, depth: P.s.vib.depth } : null; };
}
