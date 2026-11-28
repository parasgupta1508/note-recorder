// Injected by tests/mic-loopback.js into index.html (--mode speaker). Runs the app's own Speaker test (js/app/speaker-test.js): the app plays a realistic performance through the
// speaker, listens with the real microphone, runs the real Scale drill on it and compares with the truth. Each take (the microphone recording and the truth) is posted to the harness.
(async () => {
  const Q = new URLSearchParams(location.search), post = (p, b) => fetch(p, { method: 'POST', body: b }).catch(() => {}), sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    await new Promise(r => (document.readyState === 'complete' ? r() : addEventListener('load', r))); await sleep(800);
    let list; const inflate = async u8 => { const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); };
    const loadPiece = async p => { const b = new Uint8Array(await (await fetch('/api/piece/' + encodeURIComponent(p.file))).arrayBuffer()); return (b[0] === 0x50 && b[1] === 0x4b) ? await mxlToXml(b, inflate) : new TextDecoder().decode(b); };
    if (Q.get('inst')) list = [{ name: `${Q.get('inst')} ${Q.get('level') || 'good'}`, inst: Q.get('inst'), level: Q.get('level') || 'good', vibrato: Q.get('vib') !== '0', bow: Q.get('bow') || 'separate', span: +Q.get('span') || 1, bpm: +Q.get('bpm') || 70, type: Q.get('type') || 'major', root: Q.get('root') == null ? 2 : +Q.get('root'), pos: Q.get('pos') || '', seed: +Q.get('seed') || 1, grader: Q.get('grader') || 'practical', synth: Q.get('synth') === '1' }];
    else if (Q.get('pieces')) { const ix = await (await fetch('/api/pieces')).json(), want = Q.get('piece'), only = Q.get('only') === 'extra'; list = [];
      const common = { bpm: +Q.get('bpm') || 0, maxSec: +Q.get('maxsec') || 75, level: Q.get('level') || 'good', vibrato: Q.get('vib') !== '0', grader: Q.get('grader') || 'practical' };
      for (const p of ix) { if (want && want !== 'true' && p.file.indexOf(want) < 0) continue; if (only && !p.auto) continue; if (!p.auto && p.inst === 'chromatic') continue;   // the focus is violin, guitar and ukulele
        if (p.auto) {   // a score that was added by hand: each instrument part on its own, with the instrument the app recognises it as
          const xml = await loadPiece(p), sum = summariseParts(parseMusicXml(xml));
          sum.forEach((s, i) => { const inst = ['violin', 'guitar', 'ukulele'].includes(s.key) ? s.key : null;
            if (!inst) { list.push({ name: `${p.title} - ${s.name}`, skip: `${s.name}: ignored for now (the focus is violin, guitar and ukulele)` }); return; }
            list.push(Object.assign({ name: `${p.title} - ${s.name}`, xml, part: i, inst }, common, { seed: 200 + i })); });
          continue; }
        list.push({ name: p.title, xml: await loadPiece(p), part: p.part || 0, inst: p.inst, from: p.bars && p.bars[0], to: p.bars && p.bars[1], bpm: +Q.get('bpm') || 0, maxSec: +Q.get('maxsec') || 75, level: Q.get('level') || 'good', vibrato: Q.get('vib') !== '0', grader: Q.get('grader') || 'strict' }); } }
    else list = Q.get('set') === 'quick' ? [ST_SET[1], ST_SET[5]] : ST_SET;
    if (Q.get('direct')) list = list.map(x => Object.assign({}, x, { direct: true }));
    const takes = [];
    const res = await stRunSet(list, {
      log: t => post('/api/log', t),
      onTake: async (r, i) => {
        const nm = `speaker-${i + 1}-${(r.scenario.inst || '')}-${r.scenario.level || ''}`.replace('chromatic', 'piano');
        if (r.wav) await post(`/api/wav?name=${nm}&sr=${r.sr}`, r.wav.slice(44));   // the harness writes the header itself
        const { wav, xml, ...rest } = r; takes.push(Object.assign(rest, { file: nm }));
        await post('/api/take?name=' + nm, JSON.stringify(Object.assign(rest, { file: nm })));
      },
    });
    await post('/api/result', JSON.stringify({ mode: 'speaker', count: res.length, files: takes.map(t => t.file) }));
  } catch (e) { await post('/api/result', JSON.stringify({ error: String(e && e.stack || e) })); }
})();
