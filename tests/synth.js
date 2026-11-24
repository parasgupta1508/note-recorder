// Realistic-ish synthetic string instruments with KNOWN true pitch, for accuracy tests.
// violin: bowed sawtooth-like spectrum + body formants + bow noise + vibrato + scoop
// guitar: plucked, inharmonic partials, per-partial decay, weak fundamental on the low strings, pick noise
// ukulele: nylon, short decay, few partials, body resonance
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const setSeed = s => { seed = s; };
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / 0.7; };
const hz = (midi, a4 = 440) => a4 * Math.pow(2, (midi - 69) / 12);

// o: { sr, detune (cents), vib (cents peak), vibHz, scoop (cents below, first 80ms), amp, bow (noise level) }
function violin(buf, midi, t0, dur, o = {}) {
  const sr = o.sr, f0 = hz(midi + (o.detune || 0) / 100, o.a4), amp = o.amp ?? 0.3, vib = o.vib ?? 18, vh = o.vibHz ?? 5.5 + rnd() * 1;
  const s0 = Math.floor(t0 * sr), n = Math.floor(dur * sr), nh = Math.max(3, Math.min(30, Math.floor(sr * 0.45 / f0)));
  const att = o.attack ?? 0.05, rel = o.rel ?? 0.05, scoop = o.scoop ?? 0, vdelay = Math.min(0.25, dur * 0.3);
  const ph0 = rnd() * 6.28; let ph = ph0, lp = 0;
  const amps = []; for (let h = 1; h <= nh; h++) { const f = f0 * h; let a = 1 / Math.pow(h, 0.95); a *= 1 + 1.6 * Math.exp(-Math.pow((f - 450) / 160, 2)) + 1.2 * Math.exp(-Math.pow((f - 2800) / 700, 2)); amps.push(a); }
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / sr;
    const vdepth = vib * Math.min(1, Math.max(0, (t - vdelay) / 0.2));
    const cents = vdepth * Math.sin(2 * Math.PI * vh * t) - scoop * Math.exp(-t / 0.05);
    ph += 2 * Math.PI * f0 * Math.pow(2, cents / 1200) / sr;
    const env = Math.min(1, t / att) * Math.min(1, (dur - t) / rel) * (1 + 0.12 * Math.sin(2 * Math.PI * (vh * 0.7) * t));
    let v = 0; for (let h = 0; h < nh; h++) v += amps[h] * Math.sin(ph * (h + 1) + h * 0.7);
    lp += 0.25 * ((rnd() * 2 - 1) - lp);              // bow hiss (low-passed noise)
    buf[s0 + i] += amp * env * (v * 0.35 + (o.bow ?? 0.5) * lp * 0.5);
  }
}
function guitar(buf, midi, t0, dur, o = {}) {
  const sr = o.sr, f0 = hz(midi + (o.detune || 0) / 100, o.a4), amp = o.amp ?? 0.35, B = o.B ?? (midi < 52 ? 1.5e-4 : 6e-5);
  const s0 = Math.floor(t0 * sr), n = Math.floor(dur * sr), nh = Math.max(3, Math.min(24, Math.floor(sr * 0.45 / f0)));
  const pos = 0.12 + rnd() * 0.1, T = o.T60 ?? (midi < 52 ? 3.2 : midi < 64 ? 2.4 : 1.6), weak = f0 < 140 ? 0.25 : f0 < 200 ? 0.6 : 1;
  const parts = [];
  for (let h = 1; h <= nh; h++) {
    const f = f0 * h * Math.sqrt(1 + B * h * h); if (f > sr * 0.45) break;
    let a = Math.abs(Math.sin(Math.PI * h * pos)) / Math.pow(h, 1.05) * (h === 1 ? weak : 1);
    if (f0 < 200) a *= 1 + 1.5 * Math.exp(-Math.pow((f - 280) / 120, 2));      // body / mic boost around 2nd-4th partial
    parts.push({ f, a, k: 6.9 / (T / (1 + 0.45 * (h - 1))), ph: rnd() * 6.28 });
  }
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / sr, mute = Math.min(1, Math.max(0, (dur - t) / 0.03));
    let v = 0; for (const p of parts) v += p.a * Math.exp(-p.k * t) * Math.sin(2 * Math.PI * p.f * t + p.ph);
    const pick = t < 0.012 ? (rnd() * 2 - 1) * (1 - t / 0.012) * 0.6 : 0;
    const bt = o.beat ? 1 - (o.beatDepth ?? 0.7) * 0.5 * (1 - Math.cos(2 * Math.PI * o.beat * t)) : 1;
    buf[s0 + i] += amp * mute * Math.min(1, t / 0.002) * (v * bt + pick);
  }
}
function ukulele(buf, midi, t0, dur, o = {}) {
  const sr = o.sr, f0 = hz(midi + (o.detune || 0) / 100, o.a4), amp = o.amp ?? 0.35, B = 3e-5;
  const s0 = Math.floor(t0 * sr), n = Math.floor(dur * sr), nh = Math.max(3, Math.min(12, Math.floor(sr * 0.45 / f0)));
  const pos = 0.15 + rnd() * 0.1, T = o.T60 ?? 1.1, parts = [];
  for (let h = 1; h <= nh; h++) {
    const f = f0 * h * Math.sqrt(1 + B * h * h); if (f > sr * 0.45) break;
    let a = Math.abs(Math.sin(Math.PI * h * pos)) / Math.pow(h, 1.5); a *= 1 + 1.3 * Math.exp(-Math.pow((f - 420) / 140, 2));
    parts.push({ f, a, k: 6.9 / (T / (1 + 0.7 * (h - 1))), ph: rnd() * 6.28 });
  }
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / sr, mute = Math.min(1, Math.max(0, (dur - t) / 0.03));
    let v = 0; for (const p of parts) v += p.a * Math.exp(-p.k * t) * Math.sin(2 * Math.PI * p.f * t + p.ph);
    const pick = t < 0.008 ? (rnd() * 2 - 1) * (1 - t / 0.008) * 0.35 : 0;
    buf[s0 + i] += amp * mute * Math.min(1, t / 0.0015) * (v + pick);
  }
}

// ---- real-world degradations ----
function highpass(buf, sr, fc, Q = 0.707) { // RBJ biquad, 2nd order
  const w = 2 * Math.PI * fc / sr, al = Math.sin(w) / (2 * Q), c = Math.cos(w), b0 = (1 + c) / 2, b1 = -(1 + c), b2 = b0, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) { const x = buf[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; buf[i] = y; }
}
function reverb(buf, sr, rt60, wet) { // Schroeder: 4 combs + 2 allpass
  const dl = [0.0297, 0.0371, 0.0411, 0.0437].map(t => Math.floor(t * sr)), g = dl.map(d => Math.pow(10, -3 * d / sr / rt60));
  const out = new Float32Array(buf.length), lines = dl.map(d => new Float32Array(d)), pos = dl.map(() => 0);
  for (let i = 0; i < buf.length; i++) { let y = 0; for (let k = 0; k < 4; k++) { const v = lines[k][pos[k]]; y += v; lines[k][pos[k]] = buf[i] + v * g[k]; if (++pos[k] >= dl[k]) pos[k] = 0; } out[i] = y * 0.25; }
  for (const d of [Math.floor(0.005 * sr), Math.floor(0.0017 * sr)]) { const ln = new Float32Array(d); let p = 0; for (let i = 0; i < out.length; i++) { const v = ln[p], x = out[i] + 0.5 * v; ln[p] = x; out[i] = v - 0.5 * x; if (++p >= d) p = 0; } }
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i] * (1 - wet) + out[i] * wet * 2;
}
function hum(buf, sr, amp, f = 50) { for (let i = 0; i < buf.length; i++) buf[i] += amp * (Math.sin(2 * Math.PI * f * i / sr) + 0.5 * Math.sin(4 * Math.PI * f * i / sr) + 0.3 * Math.sin(6 * Math.PI * f * i / sr)); }
function chatter(buf, sr, amp) { // speech-like: bursts of harmonic sound with moving pitch + noise, no steady pitch
  let t = 0; while (t < buf.length / sr - 0.3) { const d = 0.08 + rnd() * 0.2, f0 = 110 + rnd() * 140, s0 = Math.floor(t * sr), n = Math.floor(d * sr); let ph = 0;
    for (let i = 0; i < n && s0 + i < buf.length; i++) { const x = i / n; ph += 2 * Math.PI * f0 * (1 + 0.25 * Math.sin(x * 5)) / sr; let v = 0; for (let h = 1; h < 10; h++) v += Math.sin(ph * h) / h; buf[s0 + i] += amp * Math.sin(Math.PI * x) * (v * 0.5 + (rnd() * 2 - 1) * 0.5); }
    t += d + rnd() * 0.25; }
}
function sat(buf, k) { for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * k) / Math.tanh(k); }
function scale(buf, g) { for (let i = 0; i < buf.length; i++) buf[i] *= g; }
const noise = (buf, amp) => { for (let i = 0; i < buf.length; i++) buf[i] += amp * (rnd() * 2 - 1); };
const mk = (sec, sr) => new Float32Array(Math.ceil(sec * sr));
module.exports = { highpass, reverb, hum, chatter, sat, scale, violin, guitar, ukulele, noise, mk, hz, rnd, gauss, setSeed, INST: { violin, guitar, ukulele } };
