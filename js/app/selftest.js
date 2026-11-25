// Accuracy self-test with known pure tones.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// ----- accuracy self-test: known pure tones through the same detector (checks the software, not the microphone) -----
let stRun = 0;
$('selftest').onclick = async () => {
  const btn = $('selftest'); if (btn.disabled) return;
  btn.disabled = true; const label = btn.textContent, run = ++stRun, keepOpen = $('stDet') ? $('stDet').open : true;
  try {
    const sr = getCtx().sampleRate, N = 4096, fmin = +$('fmin').value, fmax = +$('fmax').value, conf = +$('conf').value, TR = 4;
    const tones = [['E2', 82.41], ['A2', 110], ['D3', 146.83], ['G3', 196], ['B3', 246.94], ['E4', 329.63], ['A4', 440], ['E5', 659.25], ['A5', 880], ['E6', 1318.5]].filter(t => t[1] >= fmin && t[1] <= fmax);
    if (!tones.length) { $('stOut').innerHTML = '<p class="warn-t">No test tones fall inside your pitch range.</p>'; return; }
    let seed = (Date.now() ^ Math.imul(run, 2654435761)) >>> 0;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    // one randomised trial: random phases and a random detune of up to ±50¢; returns error in cents, or null if not detected
    const trial = (f0, amp, noiseK, hum = 0, weak = false) => {
      const det = (rnd() - 0.5) * 100, f = f0 * Math.pow(2, det / 1200), p1 = rnd() * 6.283, p2 = rnd() * 6.283, p3 = rnd() * 6.283, b = new Float32Array(N);
      for (let i = 0; i < N; i++) { const t = i / sr; b[i] = amp * (weak ? 0.45 * Math.sin(6.283185 * f * t + p1) + Math.sin(12.56637 * f * t + p2) + 0.7 * Math.sin(18.849556 * f * t + p3) : Math.sin(6.283185 * f * t + p1) + 0.5 * Math.sin(12.56637 * f * t + p2) + 0.27 * Math.sin(18.849556 * f * t + p3)) + noiseK * (rnd() - 0.5) + hum * Math.sin(6.283185 * 60 * t); }
      const r = engineFor('f0', 'live').frame(b, sr, fmin, fmax); return r && r.clarity > conf ? centsBetween(r.freq, f) : null;
    };
    const conds = [['clean', 0.3, 0], ['noisy', 0.3, 0.084], ['quiet', 0.03, 0.0084], ['hum', 0.3, 0.02, 0.05], ['weak', 0.3, 0.02, 0, true]], lim = { clean: 2, noisy: 5, quiet: 5, hum: 5, weak: 5 };
    const rows = []; let bad = 0, soft = 0, total = 0;
    for (let ti = 0; ti < tones.length; ti++) {
      btn.textContent = `Testing ${ti + 1}/${tones.length}…`; await new Promise(r => setTimeout(r, 0));
      const cells = conds.map(([nm, amp, nk, hm, wk]) => {
        let worst = 0, miss = 0; for (let k = 0; k < TR; k++) { const e = trial(tones[ti][1], amp, nk, hm, wk); if (e == null) miss++; else worst = Math.max(worst, Math.abs(e)); }
        total++; if (miss || worst > 10) bad++; else if (worst > lim[nm]) soft++;
        return `<td class="${miss || worst > 10 ? 'bad-t' : worst <= lim[nm] ? 'ok-t' : 'warn-t'}">${miss ? miss + ' missed' : '±' + worst.toFixed(2) + '¢'}</td>`;
      });
      rows.push(`<tr><td><b>${tones[ti][0]}</b></td><td>${tones[ti][1].toFixed(1)} Hz</td>${cells.join('')}</tr>`);
    }
    const ok = bad === 0, head = bad ? `⚠ ${bad} of ${total} checks failed (missed or over 10¢ off)` : soft ? `✓ Passed — ${soft} reading(s) between 5¢ and 10¢ under noise (typical for very low notes)` : '✓ Passed';
    $('stOut').innerHTML = `<p class="${ok ? 'ok-t' : 'warn-t'}" style="margin:0 0 8px"><b>${head}</b> — run ${run}, ${new Date().toLocaleTimeString()}, ${sr} Hz sampling, ${TR} random trials per cell.</p>
      <details id="stDet"${keepOpen ? ' open' : ''}><summary>Results by tone (worst error)</summary><div class="scroll tbl"><table><tr><th>Tone</th><th>Frequency</th><th>Clean</th><th>Noisy</th><th>Quiet</th><th>Hum</th><th>Weak</th></tr>${rows.join('')}</table></div>
      <p class="hint2" style="margin:8px 0 0">Limits: clean ±2¢; noisy (about 20 dB signal-to-noise), quiet, 60 Hz mains hum and weak-fundamental tones (like a phone speaker or low guitar string) ±5¢. Each press uses new random phases, detunes and noise. This checks the software only; your microphone, room and instrument add their own error.</p></details>`;
  } finally { btn.disabled = false; btn.textContent = label; }
};

