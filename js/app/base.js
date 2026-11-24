// Shared helpers, audio context, tone player, tabs.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

const $ = id => document.getElementById(id);
const a4 = () => +$('a4').value || 440, tol = () => +$('tol').value || 10;
let ctx, analyser, stream, srcNode, hpNode, rafId, buf, listening = false, t0 = 0;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

let toneNode = null;
function stopTone() { if (toneNode) { try { toneNode.stop(); } catch {} toneNode = null; } }
async function playTone(hz, dur = 1.2, type = 'triangle', vol = 0.25) {
  const c = getCtx();
  if (c.state === 'suspended') await c.resume();
  stopTone();
  const o = c.createOscillator(), g = c.createGain(), now = c.currentTime;
  toneNode = o; o.onended = () => { if (toneNode === o) toneNode = null; };
  o.type = type; o.frequency.value = hz;
  g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(vol, now + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g); g.connect(c.destination); o.start(now); o.stop(now + dur + 0.05);
}

// ----- tabs -----
let tab = 'tuner';
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  for (const t of ['tuner', 'scale', 'analysis', 'rec', 'settings']) $('tab-' + t).classList.toggle('hide', t !== tab);
  if (tab !== 'scale') { stopDemo(); stopMetro(); finalizeHold(); if (sc.running) { sc.running = false; $('scStart').textContent = 'Start practice'; $('scMsg').textContent = 'Paused — press Start practice'; renderScale(); } }
  if (tab === 'analysis') renderAnalysis();
  if (tab === 'settings') renderSet();
  if (tab !== 'rec') pbStop(); else { recUi(); requestDraw(); }
  if (tab === 'tuner') drawTMeter();
});

