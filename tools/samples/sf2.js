// A small SoundFont 2 reader (no dependencies): lists the samples of a .sf2 file and gives their 16-bit audio. Used by tools/samples/build.js to take the notes out of the grand piano bank.
//   const sf = readSf2(fs.readFileSync(file));  sf.samples -> [{ name, start, end, loopStart, loopEnd, rate, pitch (MIDI key it was recorded at), correction (cents), link, type }]
//   sf.pcm(sample) -> Float32Array (-1..1) of that sample.   type: 1 mono, 2 right, 4 left (stereo pairs are linked).
function readSf2(buf) {
  const u32 = o => buf.readUInt32LE(o), tag = o => buf.toString('latin1', o, o + 4);
  if (tag(0) !== 'RIFF' || tag(8) !== 'sfbk') throw new Error('not a SoundFont 2 file');
  let smpl = null, shdr = null;
  const walk = (start, end) => {
    for (let o = start; o + 8 <= end;) {
      const id = tag(o), size = u32(o + 4), body = o + 8;
      if (id === 'LIST') walk(body + 4, body + size);
      else if (id === 'smpl') smpl = { off: body, size };
      else if (id === 'shdr') shdr = { off: body, size };
      o = body + size + (size & 1);
    }
  };
  walk(12, buf.length);
  if (!smpl || !shdr) throw new Error('no sample data in this SoundFont');
  const samples = [];
  for (let o = shdr.off; o + 46 <= shdr.off + shdr.size; o += 46) {
    const name = buf.toString('latin1', o, o + 20).replace(/\0.*$/, '');
    if (name === 'EOS') break;
    samples.push({ name, start: u32(o + 20), end: u32(o + 24), loopStart: u32(o + 28), loopEnd: u32(o + 32), rate: u32(o + 36), pitch: buf[o + 40], correction: buf.readInt8(o + 41), link: buf.readUInt16LE(o + 42), type: buf.readUInt16LE(o + 44) });
  }
  const pcm = s => { const n = s.end - s.start, out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(smpl.off + (s.start + i) * 2) / 32768; return out; };
  return { samples, pcm };
}
module.exports = { readSf2 };
