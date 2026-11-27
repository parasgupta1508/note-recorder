// Injected by tests/mic-loopback.js into index.html (--mode speaker). Runs the app's own Speaker test (js/app/speaker-test.js): the app plays a realistic performance through the
// speaker, listens with the real microphone, runs the real Scale drill on it and compares with the truth. Each take (the microphone recording and the truth) is posted to the harness.
(async () => {
  const Q = new URLSearchParams(location.search), post = (p, b) => fetch(p, { method: 'POST', body: b }).catch(() => {}), sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    await new Promise(r => (document.readyState === 'complete' ? r() : addEventListener('load', r))); await sleep(800);
    let list;
    if (Q.get('inst')) list = [{ name: `${Q.get('inst')} ${Q.get('level') || 'good'}`, inst: Q.get('inst'), level: Q.get('level') || 'good', vibrato: Q.get('vib') !== '0', bow: Q.get('bow') || 'separate', span: +Q.get('span') || 1, bpm: +Q.get('bpm') || 70, type: Q.get('type') || 'major', root: Q.get('root') == null ? 2 : +Q.get('root'), pos: Q.get('pos') || '', seed: +Q.get('seed') || 1, grader: Q.get('grader') || 'strict', synth: Q.get('synth') === '1' }];
    else list = Q.get('set') === 'quick' ? [ST_SET[1], ST_SET[5]] : ST_SET;
    if (Q.get('direct')) list = list.map(x => Object.assign({}, x, { direct: true }));
    const takes = [];
    const res = await stRunSet(list, {
      log: t => post('/api/log', t),
      onTake: async (r, i) => {
        const nm = `speaker-${i + 1}-${(r.scenario.inst || '')}-${r.scenario.level || ''}`.replace('chromatic', 'piano');
        if (r.wav) await post(`/api/wav?name=${nm}&sr=${r.sr}`, r.wav.slice(44));   // the harness writes the header itself
        const { wav, ...rest } = r; takes.push(Object.assign(rest, { file: nm }));
        await post('/api/take?name=' + nm, JSON.stringify(Object.assign(rest, { file: nm })));
      },
    });
    await post('/api/result', JSON.stringify({ mode: 'speaker', count: res.length, files: takes.map(t => t.file) }));
  } catch (e) { await post('/api/result', JSON.stringify({ error: String(e && e.stack || e) })); }
})();
