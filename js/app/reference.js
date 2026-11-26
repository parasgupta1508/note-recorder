// Reference sound for scale drills: "Hear scale" played from the timeline on a Web Audio lookahead scheduler, and the tonic drone.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// ----- Hear scale: one oscillator per bow, so a slur is really legato (no new attack inside a slur) -----
const REF = { timer: null, groups: [], gi: 0, ui: [], nodes: [], playing: false, onEnd: null };
function refGroups(tl) {                       // notes that share a bow, in order
  const gs = [];
  tl.forEach(n => { if (n.slurStart || !gs.length) gs.push([n]); else gs[gs.length - 1].push(n); });
  return gs;
}
function refSchedule(c, g, t0, A, vol) {       // t0: audio time of the scale's first beat
  const o = c.createOscillator(), lp = c.createBiquadFilter(), gn = c.createGain();
  o.type = 'triangle'; lp.type = 'lowpass'; lp.frequency.value = 3200;
  const s = t0 + g[0].startMs / 1000, last = g[g.length - 1], e = t0 + (last.startMs + last.durationMs) / 1000;
  o.frequency.setValueAtTime(noteToFreq(g[0].midi, A), s);
  g.slice(1).forEach(n => o.frequency.setTargetAtTime(noteToFreq(n.midi, A), t0 + n.startMs / 1000, 0.006));
  gn.gain.setValueAtTime(0.0001, s); gn.gain.linearRampToValueAtTime(vol, s + 0.02); gn.gain.setValueAtTime(vol, Math.max(s + 0.02, e - 0.05)); gn.gain.linearRampToValueAtTime(0.0001, e);
  o.connect(lp); lp.connect(gn); gn.connect(c.destination); o.start(s); o.stop(e + 0.05);
  REF.nodes.push(o); o.onended = () => { REF.nodes = REF.nodes.filter(x => x !== o); };
}
// tl: the timeline. opts: { delay (s, default 0.1), onNote(i), onEnd() }. The metronome (if on) is started by the caller with the same delay.
function refPlay(tl, opts = {}) {
  refStop(); if (!tl.length) return;
  const c = getCtx(), A = a4(), t0 = c.currentTime + (opts.delay == null ? 0.1 : opts.delay);
  REF.groups = refGroups(tl); REF.gi = 0; REF.playing = true; REF.onEnd = opts.onEnd || null;
  const pump = () => {
    while (REF.gi < REF.groups.length && t0 + REF.groups[REF.gi][0].startMs / 1000 < c.currentTime + 0.35) {
      const g = REF.groups[REF.gi++]; refSchedule(c, g, t0, A, 0.22);
      g.forEach(n => REF.ui.push(setTimeout(() => { if (REF.playing && opts.onNote) opts.onNote(n.index); }, Math.max(0, (t0 + n.startMs / 1000 - c.currentTime + (c.outputLatency > 0 && c.outputLatency < 0.5 ? c.outputLatency : 0)) * 1000))));
    }
  };
  pump(); REF.timer = setInterval(pump, 50);
  const end = (t0 - c.currentTime) * 1000 + timelineEndMs(tl);
  REF.ui.push(setTimeout(() => { const f = REF.onEnd; refStop(); if (f) f(); }, end + 60));
}
function refStop() {
  clearInterval(REF.timer); REF.timer = null; REF.ui.forEach(clearTimeout); REF.ui = [];
  REF.nodes.forEach(o => { try { o.stop(); } catch {} }); REF.nodes = []; REF.playing = false; REF.onEnd = null;
}

// ----- tonic drone: a quiet low tonic, off by default. The microphone can hear a loudspeaker, so headphones are best. -----
const DRONE = { on: false, nodes: [], gain: null, midi: null };
function droneMidiFor(startMidi) { return startMidi - 12 >= 36 ? startMidi - 12 : startMidi; }
function droneStopNodes() {
  const c = ctx; if (DRONE.gain && c) { try { DRONE.gain.gain.cancelScheduledValues(c.currentTime); DRONE.gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.05); } catch {} }
  const old = DRONE.nodes; DRONE.nodes = []; DRONE.gain = null;
  setTimeout(() => old.forEach(o => { try { o.stop(); } catch {} }), 300);
}
function droneSet(midi) {                      // start, or move to another tonic
  if (!DRONE.on) return;
  if (DRONE.midi === midi && DRONE.nodes.length) return;
  droneStopNodes(); DRONE.midi = midi;
  const c = getCtx(), g = c.createGain(), A = a4(), f = noteToFreq(midi, A);
  g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.linearRampToValueAtTime(0.07, c.currentTime + 0.4); g.connect(c.destination);
  [['sine', 1, 1], ['triangle', 2, 0.35], ['sine', 1.5, 0.25]].forEach(([type, mul, vol]) => {      // tonic, its octave, a soft fifth above
    const o = c.createOscillator(), v = c.createGain(); o.type = type; o.frequency.value = f * mul; v.gain.value = vol; o.connect(v); v.connect(g); o.start(); DRONE.nodes.push(o);
  });
  DRONE.gain = g;
}
function droneToggle(on) {
  DRONE.on = on == null ? !DRONE.on : on;
  $('drone').classList.toggle('on', DRONE.on); $('drone').setAttribute('aria-pressed', DRONE.on ? 'true' : 'false');
  if (DRONE.on) { droneSet(droneMidiFor(currentPlan().start)); setMsg('Drone on: use headphones so the microphone does not hear it'); } else { droneStopNodes(); DRONE.midi = null; }
}
