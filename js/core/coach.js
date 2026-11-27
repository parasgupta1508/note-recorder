// "Teacher coach": plain rules that read the run just played next to the player's earlier runs and say what is going well and what to work on.
// Pure logic: no DOM, so it also runs in Node (tests load this same file). Every sentence comes from a named rule, so a rule can be tuned or tested alone.
//
// coachReview(cur, prior, opts) -> { headline, strengths: [text], focus: [text] }
//   cur    a history record (js/core/history.js) of the run just finished
//   prior  that player's earlier records, oldest first (the current run is not in it)
//   opts   { best: true when cur beat every earlier run, now }

const COACH_RECENT = 9, COACH_MIN_RUNS = 3, COACH_BIAS = 10;   // earlier runs looked at; runs a note must go wrong in before it is called recurring; cents that count as sharp or flat
const COACH_NEXT_BOW = { separate: 'slur2', slur2: 'slur4', slur4: 'slur8' }, COACH_BOW_NAME = { slur2: 'two notes to a bow', slur4: 'four notes to a bow', slur8: 'eight notes to a bow' };

const coachNote = n => String(n).replace('#', '♯').replace(/^([A-G])b/, '$1♭');
const coachSigned = c => `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(0)}¢`;
const coachAvg = a => { const v = a.filter(x => typeof x === 'number'); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
// The overall lean of one run: the mean of its two directions.
const coachBias = r => coachAvg([r.up && r.up.bias, r.down && r.down.bias]);
// The instrument's own words for fixing a sharp or a flat note.
const coachFix = (inst, sharp) => sharp ? (inst === 'violin' ? 'place the finger a little lower' : /guitar|ukulele/.test(inst) ? 'press closer behind the fret and ease the pressure' : 'aim a little lower')
  : (inst === 'violin' ? 'place the finger a little higher' : /guitar|ukulele/.test(inst) ? 'check the finger is just behind the fret' : 'aim a little higher');

// Notes that went sharp or flat in at least COACH_MIN_RUNS of the recent runs, worst first: [{ name, sharp, runs, of, avg }]
function coachRecurringNotes(runs, cur) {
  // A scale is judged by pitch (the same note anywhere in it is the same note); a piece by place (the same pitch in another bar is another note), and only runs of the same length are compared.
  const place = cur && cur.type === 'piece', len = cur && cur.notes ? cur.notes.length : 0;
  const per = runs.map(r => { const m = {}; if (place && r.notes.length !== len) return m; r.notes.forEach((x, i) => { if (x.k && typeof x.c === 'number') { const key = place ? i : x.m; (m[key] = m[key] || { n: place && x.b ? `${x.n} in bar ${x.b}` : x.n, v: [] }).v.push(x.c); } }); return m; });
  const out = [];
  for (const m in per[per.length - 1] || {}) {
    const mine = coachAvg(per[per.length - 1][m].v); if (Math.abs(mine) < COACH_BIAS) continue;
    const sharp = mine > 0, vals = per.map(p => p[m] ? coachAvg(p[m].v) : null).filter(v => v != null), bad = vals.filter(v => sharp ? v >= COACH_BIAS : v <= -COACH_BIAS);
    if (bad.length >= COACH_MIN_RUNS) out.push({ name: per[per.length - 1][m].n, sharp, runs: bad.length, of: vals.length, avg: coachAvg(bad) });
  }
  return out.sort((a, b) => b.runs - a.runs || Math.abs(b.avg) - Math.abs(a.avg));
}

function coachReview(cur, prior, opts = {}) {
  const strengths = [], focus = [];
  const same = prior.filter(r => r.inst === cur.inst).slice(-COACH_RECENT), sameScale = same.filter(r => r.root === cur.root && r.type === cur.type && r.span === cur.span);
  const base = (sameScale.length >= 2 ? sameScale : same).slice(-5);   // what "usual" means: earlier runs of this scale, or failing that of this instrument
  const baseAvg = k => coachAvg(base.map(r => r[k]));
  const part = { pitch: 'intonation', fluency: 'fluency and pulse', tone: 'tone and steadiness' };

  // ---- strengths
  if (opts.best) strengths.push(`New personal best for this scale: ${cur.total} points.`);
  else if (base.length) { const d = cur.total - baseAvg('total'); if (d >= 3) strengths.push(`Your score is ${d.toFixed(0)} points above your last ${base.length} run${base.length > 1 ? 's' : ''}.`); }
  if (base.length) for (const k of ['pitch', 'fluency', 'tone']) { const d = cur[k] - baseAvg(k); if (d >= 5) strengths.push(`Your ${part[k]} improved by ${d.toFixed(0)} points on your recent runs.`); }
  if (cur.mode !== 'wait' && cur.pulse != null && cur.pulse >= 85 && Math.abs(cur.lag || 0) < 80) strengths.push(`Steady pulse: your notes land evenly on the click (${cur.pulse.toFixed(0)}%).`);
  if (cur.wrong === 0 && cur.skipped === 0 && cur.retries === 0) strengths.push('Every note was played, with no wrong notes, no skips and no restarts.');
  const ub = cur.up.bias, db = cur.down.bias;
  if (ub != null && db != null && Math.abs(ub) < 8 && Math.abs(db) < 8 && Math.abs(ub - db) < 6) strengths.push('Going up and coming down were equally well centred.');
  // the register that is most secure: the notes sorted by pitch and cut into thirds
  const played = cur.notes.filter(x => x.k && typeof x.c === 'number'), midis = cur.notes.map(x => x.m);
  if (played.length >= 9) {
    const lo = Math.min(...midis), hi = Math.max(...midis), cut = (hi - lo) / 3, third = x => x.m < lo + cut ? 0 : x.m < lo + 2 * cut ? 1 : 2, name = ['lower', 'middle', 'upper'];
    const reg = [0, 1, 2].map(g => { const v = played.filter(x => third(x) === g).map(x => Math.abs(x.c)); return v.length >= 3 ? coachAvg(v) : null; });
    const ok = reg.map((v, g) => v == null ? null : g).filter(g => g != null), best = ok.sort((a, b) => reg[a] - reg[b])[0];
    if (best != null && reg[best] <= 8 && ok.some(g => g !== best && reg[g] - reg[best] >= 6)) strengths.push(`Your ${name[best]} notes are the most secure (about ${reg[best].toFixed(0)}¢ from centre on average).`);
  }
  if (!strengths.length) {
    const top = ['pitch', 'fluency', 'tone'].sort((a, b) => cur[b] - cur[a])[0];
    strengths.push(cur[top] >= 70 ? `${part[top][0].toUpperCase() + part[top].slice(1)} is your strongest area (${cur[top].toFixed(0)}).` : 'You finished the run. Repeat it and the trends below will start to show.');
  }

  // ---- what to improve
  const recent = same.concat([cur]);
  const rec = coachRecurringNotes(recent, cur).slice(0, 2);
  for (const r of rec) focus.push(`${coachNote(r.name)} was ${r.sharp ? 'sharp' : 'flat'} in ${r.runs} of your last ${r.of} runs (about ${coachSigned(r.avg)}): ${coachFix(cur.inst, r.sharp)}.`);
  if (ub != null && db != null) {   // going down compared with going up
    const diff = db - ub, past = same.map(r => r.up.bias != null && r.down.bias != null ? r.down.bias - r.up.bias : null).filter(v => v != null), again = past.filter(v => Math.sign(v) === Math.sign(diff) && Math.abs(v) >= 6).length;
    if (Math.abs(diff) >= 8 && (again >= 2 || Math.abs(diff) >= 15)) focus.push(`Coming down you are ${Math.abs(diff).toFixed(0)}¢ ${diff > 0 ? 'sharper' : 'flatter'} than going up${again >= 2 ? `, as in ${again} of your last ${past.length} runs` : ''}: listen again at the turn at the top and match the pitch on the way down.`);
  }
  const lean = coachBias(cur), leans = same.map(coachBias).filter(v => v != null);
  if (lean != null && Math.abs(lean) >= 7 && leans.filter(v => Math.sign(v) === Math.sign(lean) && Math.abs(v) >= 7).length >= COACH_MIN_RUNS - 1 && !rec.length) focus.push(`You tend to play ${lean > 0 ? 'sharp' : 'flat'} overall (${coachSigned(lean)} on average): check your tuning, then ${coachFix(cur.inst, lean > 0)}.`);
  if (cur.mode !== 'wait' && cur.pulse != null) {
    if (cur.lag != null && cur.lag >= 70) focus.push(`You are about ${cur.lag.toFixed(0)} ms behind the click on average: think of the note before the beat so it lands on it.`);
    else if (cur.lag != null && cur.lag <= -70) focus.push(`You are about ${Math.abs(cur.lag).toFixed(0)} ms ahead of the click: wait for the beat before you play.`);
    else if (cur.pulse < 70) focus.push(`The pulse is uneven (${cur.pulse.toFixed(0)}%): practise at a slower tempo with the click until every note lands on a beat.`);
  }
  const lost = cur.skipped + cur.retries + cur.stalls;
  if (lost >= 2) focus.push(`${cur.skipped ? cur.skipped + ' note' + (cur.skipped > 1 ? 's were' : ' was') + ' skipped' : 'You stopped and restarted'}${cur.retries ? ', ' + cur.retries + ' note' + (cur.retries > 1 ? 's' : '') + ' retried' : ''}: keep going through a slip so the scale flows, and slow down if you keep losing your place.`);
  if (cur.wrong >= 2) focus.push(`${cur.wrong} wrong notes were heard: check the key signature and say the note names before you play.`);
  if (cur.tone < 70) focus.push(cur.inst === 'violin' ? 'The pitch wobbles within the notes: use a slower, steadier bow and keep the finger pressure even.' : /guitar|ukulele/.test(cur.inst) ? 'The pitch wobbles within the notes: press evenly and do not bend the string sideways.' : 'The pitch drifts within the notes: hold each one steady for its full length.');

  // ---- is it time to move on?
  const atBpm = sameScale.filter(r => r.bpm === cur.bpm && r.mode === cur.mode).slice(-2);
  if (cur.total >= 87 && atBpm.length >= 2 && atBpm.every(r => r.total >= 80)) {
    const nb = COACH_NEXT_BOW[cur.bow];
    focus.push(`This scale is secure at ${cur.bpm} BPM (three good runs in a row): ${cur.mode === 'wait' ? 'try Tempo-locked' : `raise the tempo to ${cur.bpm + 8}`}${nb && cur.inst === 'violin' ? `, or try ${COACH_BOW_NAME[nb]}` : ''}.`);
  } else if (cur.total < 60) focus.push(`Slow down to about ${Math.max(40, cur.bpm - 12)} BPM until ${cur.pitch < 70 ? 'your intonation score is above 75' : 'the notes land evenly on the click'}.`);
  else if (cur.pitch >= 80 && cur.fluency < 65 && cur.mode !== 'wait') focus.push('The pitch is good but the rhythm is not ready yet: stay at this tempo and work with the click before speeding up.');

  if (!prior.length) focus.push('This run is your baseline. Play it again and the coach will compare your sessions.');
  if (!focus.length) focus.push('Nothing urgent. Repeat the scale at the same tempo to make it automatic.');
  return { headline: `${cur.band} · ${cur.total}/100`, strengths: strengths.slice(0, 4), focus: focus.slice(0, 4) };
}
