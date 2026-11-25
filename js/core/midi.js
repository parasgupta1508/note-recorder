// Standard MIDI file reader and writer. Pure logic: no DOM, so Node tests and the Lab helper server load this same file.
// Note shape is the app's own: { midi, start (seconds), dur (milliseconds), vel (1-127, optional) }.

// notes -> Uint8Array holding a format-0 .mid file (120 bpm, 480 ticks per beat, so 1 tick = 1/960 s).
function writeMidi(notes, opts = {}) {
  const TPS = 960, ch = (opts.channel || 0) & 15, ev = [];
  for (const n of notes) {
    const on = Math.max(0, Math.round(n.start * TPS)), off = Math.max(on + 1, Math.round((n.start + n.dur / 1000) * TPS)), m = Math.max(0, Math.min(127, Math.round(n.midi))), v = Math.max(1, Math.min(127, Math.round(n.vel || 80)));
    ev.push({ t: on, o: 1, d: [0x90 | ch, m, v] }, { t: off, o: 0, d: [0x80 | ch, m, 0] });
  }
  ev.sort((a, b) => a.t - b.t || a.o - b.o);                      // at the same tick a note ends before the next one starts
  const body = [];
  const vlq = v => { const b = [v & 127]; while ((v >>= 7) > 0) b.unshift((v & 127) | 128); return b; };
  const name = Array.from(String(opts.name || 'notes')).map(c => c.charCodeAt(0) & 127);
  body.push(0, 0xff, 0x03, ...vlq(name.length), ...name, 0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20);   // track name, tempo 500000 us/beat
  let last = 0;
  for (const e of ev) { body.push(...vlq(e.t - last), ...e.d); last = e.t; }
  body.push(0, 0xff, 0x2f, 0);
  const u32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body]);
}

// bytes (Uint8Array / ArrayBuffer) -> { notes sorted by start, seconds, tracks }. Handles tempo changes, running status, several tracks. Drum channel (10) is skipped.
function parseMidi(input) {
  const d = input instanceof Uint8Array ? input : new Uint8Array(input);
  let p = 0;
  const u16 = () => (d[p++] << 8) | d[p++], u32 = () => ((d[p++] << 24) | (d[p++] << 16) | (d[p++] << 8) | d[p++]) >>> 0;
  const tag = () => String.fromCharCode(d[p++], d[p++], d[p++], d[p++]);
  if (d.length < 14 || tag() !== 'MThd') throw new Error('Not a MIDI file');
  const hl = u32(); u16(); const nTr = u16(), div = u16(); p = 8 + hl;
  if (div & 0x8000) throw new Error('SMPTE time MIDI is not supported');
  const tempos = [{ tick: 0, us: 500000 }], raw = [], names = [];
  let timeSig = null;                                              // first time signature [beats, beat unit]
  for (let t = 0; t < nTr && p + 8 <= d.length; t++) {
    if (tag() !== 'MTrk') throw new Error('Bad MIDI track'); const len = u32(), end = Math.min(d.length, p + len); let tick = 0, run = 0;
    const vl = () => { let v = 0, b; do { b = d[p++]; v = (v << 7) | (b & 127); } while (b & 128 && p < end); return v; };
    while (p < end) {
      tick += vl(); let s = d[p];
      if (s === 0xff) { p++; const ty = d[p++], l = vl(); if (ty === 0x51 && l === 3) tempos.push({ tick, us: (d[p] << 16) | (d[p + 1] << 8) | d[p + 2] });
        else if (ty === 0x03 && !names[t]) names[t] = String.fromCharCode(...d.subarray(p, p + l)).replace(/[^ -~]/g, '').trim();
        else if (ty === 0x58 && l >= 2 && !timeSig) timeSig = [d[p], 1 << d[p + 1]];
        p += l; continue; }
      if (s === 0xf0 || s === 0xf7) { p++; p += vl(); continue; }
      if (s & 128) { run = s; p++; } else if (!run) throw new Error('Bad MIDI data'); s = run;
      const hi = s & 0xf0, c = s & 15;
      if (hi === 0xc0 || hi === 0xd0) { p++; continue; }
      const a = d[p++], b = d[p++];
      if (c === 9) continue;                                      // drums
      if (hi === 0x90 && b > 0) raw.push({ tick, c, m: a, v: b, on: true, trk: t });
      else if (hi === 0x80 || hi === 0x90) raw.push({ tick, c, m: a, on: false, trk: t });
    }
    p = end;
  }
  tempos.sort((a, b) => a.tick - b.tick);
  const secs = tick => { let s = 0, lt = 0, us = 500000; for (const e of tempos) { if (e.tick > tick) break; s += (e.tick - lt) * us / div / 1e6; lt = e.tick; us = e.us; } return s + (tick - lt) * us / div / 1e6; };
  raw.sort((a, b) => a.tick - b.tick || (a.on ? 1 : 0) - (b.on ? 1 : 0));
  const open = new Map(), notes = [];
  for (const e of raw) {
    const k = e.trk + ':' + e.c + ':' + e.m;
    if (e.on) { if (!open.has(k)) open.set(k, []); open.get(k).push(e); }
    else { const q = open.get(k); if (q && q.length) { const o = q.shift(); notes.push({ midi: o.m, start: secs(o.tick), dur: (secs(e.tick) - secs(o.tick)) * 1000, vel: o.v, trk: o.trk, ch: o.c }); } }
  }
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return { notes, seconds: notes.length ? Math.max(...notes.map(n => n.start + n.dur / 1000)) : 0, tracks: nTr, names, timeSig, bpm: Math.round(6e7 / tempos[tempos.length > 1 ? 1 : 0].us * 10) / 10 };
}
