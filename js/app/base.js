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
let tab = 'scale';
const TAB_PARENT = { lab: 'settings' };   // screens reached from another tab keep that tab lit
const NO_MIC_TABS = ['pieces', 'analysis'];                  // the microphone is switched off when you go to one of these
function showTab(k) {
  tab = k; const lit = TAB_PARENT[k] || k;
  document.querySelectorAll('nav.tabs button').forEach(x => { const on = x.dataset.tab === lit; x.classList.toggle('on', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); x.tabIndex = on ? 0 : -1; });
  for (const t of ['pieces', 'piece', 'tuner', 'scale', 'analysis', 'rec', 'lab', 'settings']) $('tab-' + t).classList.toggle('hide', t !== tab);
  if (tab !== 'piece' && typeof peLeave === 'function') peLeave();   // Piece practice stops when another screen opens
  if (tab === 'piece' && typeof ppEnter === 'function') ppEnter();
  if (tab !== 'scale') { stopDemo(); stopMetro(); finalizeHold(); if (DRONE.on) droneToggle(false); if (sc.running) { sc.running = false; $('scStart').textContent = 'Start practice'; $('scMsg').textContent = 'Paused — press Start practice'; renderScale(); } }
  if (tab === 'analysis') renderAnalysis();
  if (tab === 'settings') renderSet();
  if (tab === 'lab' && typeof labShow === 'function') labShow();
  if (tab !== 'rec') pbStop(); else { recUi(); requestDraw(); }
  if (tab === 'tuner') { drawTMeter(); ensureMic().then(() => { if (tab === 'tuner') startAutoCalib(); }); }                     // the Tuner has no start button: opening it starts the microphone
  else if (NO_MIC_TABS.includes(tab)) { if (listening && !recording) stopListening(); $('status').textContent = ''; }
  scrollTo(0, 0);
}
document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$('mainTabs').addEventListener('keydown', e => {                              // arrow keys, Home and End move between tabs
  const b = [...document.querySelectorAll('nav.tabs button')], i = b.indexOf(document.activeElement); if (i < 0) return;
  const j = { ArrowRight: (i + 1) % b.length, ArrowLeft: (i + b.length - 1) % b.length, Home: 0, End: b.length - 1 }[e.key]; if (j == null) return;
  e.preventDefault(); b[j].focus(); showTab(b[j].dataset.tab);
});
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) showTab(g.dataset.go); });

