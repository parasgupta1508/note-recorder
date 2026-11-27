// Instrument sounds in the browser: loads the recordings (data/samples/<inst>/, CC0, see data/samples/README.txt) and plays a note by re-pitching the nearest one
// (the choice and the maths are in js/core/sampler.js). Used by Hear scale, Hear piece, the piece accompaniment and the Pieces "Listen" button, and by the speaker test, so the
// sound a learner hears is a violin, a guitar, a ukulele or a piano and not a beep. Where a bank is not loaded yet (first use, or offline before it was ever fetched) the callers
// keep their old oscillator sound, so nothing is ever silent.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

const SMP = { banks: {}, loading: {}, failed: {} };
// The instrument the drills know (practiceInstrument: violin, guitar, ukulele, chromatic = piano) -> the recordings that go with it.
const smpKey = preset => { const k = typeof preset === 'string' ? preset : ''; return k === 'chromatic' || k === 'piano' ? 'piano' : /^ukulele/.test(k) ? 'ukulele' : ['violin', 'guitar'].includes(k) ? k : /^(viola|cello)$/.test(k) ? 'violin' : /^(mandolin|bass)$/.test(k) ? 'guitar' : null; };
const smpBank = inst => SMP.banks[inst] || null;
// Fetches and decodes one bank. Resolves to the bank, or null when it cannot be had (offline and never fetched). Safe to call again: it loads once.
function smpLoad(inst) {
  if (!inst) return Promise.resolve(null);
  if (SMP.banks[inst]) return Promise.resolve(SMP.banks[inst]);
  if (SMP.loading[inst]) return SMP.loading[inst];
  SMP.loading[inst] = (async () => {
    try {
      const base = 'data/samples/' + inst + '/', res = await fetch(base + 'index.json'); if (!res.ok) throw new Error('no index');
      const index = await res.json(), c = getCtx(), decoded = await Promise.all(index.files.map(async f => {
        const r = await fetch(base + f.file); if (!r.ok) throw new Error(f.file);
        const ab = await c.decodeAudioData(await r.arrayBuffer());   // the browser decodes at the context's own rate: that rate is what the bank records for each note
        return { data: ab.getChannelData(0), sr: ab.sampleRate, ab };
      }));
      const bank = smMakeBank(index, decoded); bank.notes.forEach((n, i) => { n.ab = decoded[i].ab; });
      SMP.banks[inst] = bank; return bank;
    } catch (e) { SMP.failed[inst] = String(e && e.message || e); return null; }
    finally { delete SMP.loading[inst]; }
  })();
  return SMP.loading[inst];
}
// Get the bank for an instrument ready in the background (called when the player picks an instrument or opens a screen that plays notes).
function smpPreload(preset) { const k = smpKey(preset); if (k && !SMP.banks[k] && !SMP.loading[k] && !SMP.failed[k]) smpLoad(k); }

// Play one note: audible start at `at` (audio clock), `dur` seconds long. o: { vol (1 = normal), vel (below 0.95 plays the soft layer), legato (slurred from the note before) }.
// Returns the AudioBufferSourceNode (so a caller can stop it), or null when the bank is not ready.
function smpPlay(c, preset, midi, at, dur, o = {}) {
  const bank = SMP.banks[smpKey(preset)]; if (!bank) return null;
  const P = smPlan(bank, { midi, cents: 0, a4: a4(), amp: 0.3, vel: o.vel, legato: !!o.legato }), s = P.s, pr = Math.pow(2, P.semis / 12), now = c.currentTime;
  const src = c.createBufferSource(), gn = c.createGain(); src.buffer = s.ab; src.playbackRate.value = pr;
  const lead = P.from ? 0 : s.onset / pr;                      // the recording's own lead-in: begin early so the sound itself starts on `at`
  let st = at - lead, off = P.from; if (st < now) { off += (now - st) * pr; st = now; }
  const rel = bank.kind === 'bowed' ? 0.05 : 0.14, end = at + dur, vol = (o.vol == null ? 1 : o.vol) * P.gain * 0.9, atk = P.from ? 0.015 : 0.004, top = Math.max(st + atk, 0);
  const need = (dur + lead) * pr + off;                        // how much of the recording the note uses; a bowed note longer than that loops its steady part
  if (P.loop && need > s.dur - 0.45) { src.loop = true; src.loopStart = P.loop.a; src.loopEnd = P.loop.b; }
  gn.gain.setValueAtTime(0.0001, st); gn.gain.linearRampToValueAtTime(vol, top); gn.gain.setValueAtTime(vol, Math.max(top, end)); gn.gain.linearRampToValueAtTime(0.0001, Math.max(top, end) + rel);
  src.connect(gn); gn.connect(c.destination); src.start(st, Math.min(off, s.ab.duration - 0.05)); src.stop(Math.max(top, end) + rel + 0.03);
  src.onended = () => { try { gn.disconnect(); } catch {} };
  return src;
}
