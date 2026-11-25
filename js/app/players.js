// Players: who is practising. Names are typed in the app and stored only on this device; none are in the code.
// The store (PROFILES, PCOLOR, savePlayers) is in practice.js, switchPlayer in analysis.js. Part of the app: shared scope, load order as in index.html.

function renderPlayers() {
  const sel = $('profile');
  sel.innerHTML = PROFILES.map(n => `<option>${n}</option>`).join('');   // names are limited to letters, digits, space . ' _ - (validName), so they are safe to put in markup
  sel.disabled = !PROFILES.length; if (PROFILES.length) sel.value = profile;
  $('plList').innerHTML = PROFILES.length
    ? PROFILES.map(n => `<div class="pl-row"><i style="background:${PCOLOR[n]}"></i><b>${n}</b><button type="button" class="sec" data-rm="${n}" aria-label="Remove ${n}">Remove</button></div>`).join('')
    : '<p class="mut">No players yet.</p>';
  if (typeof renderSet === 'function') renderSet();
}
// Returns '' when added, otherwise a message for the person.
function addPlayer(raw) {
  const n = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!validName(n)) return 'Use 1 to 24 letters, numbers or spaces.';
  if (PROFILES.some(p => p.toLowerCase() === n.toLowerCase())) return 'That name is already used.';
  addPlayerRecord(n); savePlayers(); switchPlayer(n); renderPlayers(); $('firstRun').classList.add('hide'); return '';
}
function removePlayer(n) {
  if (!PROFILES.includes(n)) return;
  if (!confirm(`Remove ${n} and delete their saved scores from this device? A backup file can bring them back.`)) return;
  try { localStorage.removeItem(ckey(n)); localStorage.removeItem(pkey(n)); } catch {}
  PROFILES.splice(PROFILES.indexOf(n), 1); delete PCOLOR[n]; savePlayers();
  if (profile === n) switchPlayer(PROFILES[0] || '');
  renderPlayers(); if (!PROFILES.length) openFirstRun();
}
function openFirstRun() { $('firstRun').classList.remove('hide'); $('frMsg').textContent = ''; $('frName').value = ''; setTimeout(() => $('frName').focus(), 0); }

$('plList').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) removePlayer(b.dataset.rm); });
$('plForm').addEventListener('submit', e => { e.preventDefault(); const m = addPlayer($('plName').value); $('plMsg').textContent = m; if (!m) $('plName').value = ''; });
$('frForm').addEventListener('submit', e => { e.preventDefault(); const m = addPlayer($('frName').value); $('frMsg').textContent = m; if (!m) $('firstRun').classList.add('hide'); });

renderPlayers();
if (!PROFILES.length) openFirstRun();   // a brand-new device: ask who is practising before anything else
