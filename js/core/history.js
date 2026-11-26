// Scale-run history: the compact record saved for every completed run, and the figures the Progress view shows (trend, personal best, day streak).
// Pure logic: no DOM and no storage, so it also runs in Node. Where the records are kept is decided in js/app/scale-history.js.

const HIST_VERSION = 1, HIST_MAX = 400;   // records kept per device; the oldest fall off

const histR = (x, d = 1) => x == null || !isFinite(x) ? null : Math.round(x * Math.pow(10, d)) / Math.pow(10, d);

// ev: result of evaluateRun. info: { t, player, inst, type, root, span, pos, bow, bpm, mode, label, pass }
function histRecord(ev, info) {
  const dir = o => ({ n: o.n, played: o.played, bias: histR(o.bias), abs: histR(o.abs), pitch: histR(o.pitch, 0) });
  return {
    v: HIST_VERSION, t: info.t, p: info.player || '', inst: info.inst, type: info.type, root: info.root, span: info.span, pos: info.pos || '', bow: info.bow || '',
    bpm: info.bpm, mode: info.mode, label: info.label || '', pass: info.pass || 1,
    total: ev.total, band: ev.band, pitch: histR(ev.pitch, 0), fluency: histR(ev.fluency, 0), tone: histR(ev.tone, 0), pulse: histR(ev.pulse, 0), continuity: histR(ev.continuity, 0),
    eng: ev.engine || '', off: ev.offset == null ? null : histR(ev.offset),
    lag: histR(ev.lagMs, 0), wrong: ev.wrongNotes, skipped: ev.skipped, retries: ev.retries, stalls: ev.stalls, slots: ev.slots, played: ev.played,
    up: dir(ev.up), down: dir(ev.down),
    notes: ev.notes.map(x => ({ n: x.name, m: x.midi, d: x.d === 'up' ? 'u' : 'd', k: x.played ? 1 : 0, c: histR(x.dev), s: histR(x.s), e: x.e == null ? null : Math.round(x.e) })),
  };
}

// Newest last. Keeps only the newest HIST_MAX.
const histAdd = (runs, rec) => { const a = runs.concat([rec]); return a.length > HIST_MAX ? a.slice(a.length - HIST_MAX) : a; };

// Runs of one player, optionally one instrument and one scale (type id). 'all' or '' means no filter. Sorted oldest first.
function histFilter(runs, f = {}) {
  return runs.filter(r => (!f.player || r.p === f.player) && (!f.inst || f.inst === 'all' || r.inst === f.inst) && (!f.type || f.type === 'all' || r.type === f.type)
    && (!f.scale || f.scale === 'all' || histScaleKey(r) === f.scale)).sort((a, b) => a.t - b.t);
}
// One scale as the person thinks of it: root, type and span ("G major · 1 oct"), the same for every instrument.
const histScaleKey = r => `${r.root}:${r.type}:${r.span}`;
const histTrend = runs => runs.map(r => ({ t: r.t, y: r.total, band: r.band }));

// The best run (the earliest one when two tie).
function histBest(runs) { let b = null; for (const r of runs) if (!b || r.total > b.total) b = r; return b; }
// Does this run beat everything before it? Needs at least one earlier run; ties do not count.
function histIsBest(prior, rec) { return prior.length > 0 && rec.total > Math.max(...prior.map(r => r.total)); }

// Consecutive calendar days (local time) with at least one run, counted back from today. A streak stays alive until the end of the next day.
function histDayStreak(runs, now = Date.now()) {
  const day = t => { const d = new Date(t); return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() / 86400000); };
  const days = new Set(runs.map(r => day(r.t))), today = day(now);
  let d = days.has(today) ? today : days.has(today - 1) ? today - 1 : null, n = 0;
  if (d == null) return 0;
  while (days.has(d)) { n++; d--; }
  return n;
}
