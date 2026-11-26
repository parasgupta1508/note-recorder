// Exports, wiring and start-up calls. Must load last.
// Part of the app. Scripts in js/app load in the order listed in index.html and share one scope.

// ----- export / wiring -----
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
$('csv').onclick = () => download(`notes-${stamp()}.csv`, ['index,note,midi,avg_hz,avg_cents,start_s,duration_ms,level_db',
  ...events.map((e, i) => [i + 1, e.note, e.midi, e.hz.toFixed(3), e.cents.toFixed(2), e.start.toFixed(3), e.dur.toFixed(0), e.lvl].join(','))].join('\n'), 'text/csv');
$('json').onclick = () => download(`notes-${stamp()}.json`, JSON.stringify(events.map(({ pts, ...r }) => r), null, 2), 'application/json');
$('clear').onclick = clearRec;
$('rec').onclick = async () => { if (!recording && !listening) { await ensureMic(); if (!listening) return; } setRecording(!recording); };   // Record starts the microphone itself
$('micChip').onclick = async () => { if (listening) stopListening(); else await ensureMic(); };

function applyTol() {
  const T = tol();
  drawTMeter();
  
  // Gradient for the deviation bar (Red -> Yellow -> Green -> Yellow -> Red)
  // 1 cent = 0.5% of the bar width.
  const g = T * 0.5;          // Green zone half-width %
  const w = 25;               // Warning zone half-width % (so total yellow area is 25% - 5% = 20% wide)
  
  // Format: linear-gradient(direction, color1 start%, color1 end%, color2 start%, etc)
  $('devBar').style.background = `linear-gradient(90deg, 
    var(--bad) 0%, var(--bad) ${50 - w - 4}%, 
    var(--warn) ${50 - w}%, var(--warn) ${50 - g - 1}%, 
    var(--ok) ${50 - g}%, var(--ok) ${50 + g}%, 
    var(--warn) ${50 + g + 1}%, var(--warn) ${50 + w}%, 
    var(--bad) ${50 + w + 4}%, var(--bad) 100%)`;
}

$('tol').oninput = () => { applyTol(); };
$('a4').onchange = () => { resetTuner(); renderScale(); applyTol(); };

loadPrefs(); applyLimits(); buildInstChips(); resetTuner(); resetPractice(); renderCard(); renderScale(); renderAnalysis(); renderLegend(); recUi(); applyTol(); drawTMeter(); $('scOpts').open = innerWidth >= 720;
try { const o = JSON.parse(localStorage.getItem(SET_KEY)); if (o) applySettings(o); } catch {}
