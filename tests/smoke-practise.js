// The Practise button on the Pieces screen, in headless Edge: a generated scale opens the Scale drills set to that scale; a built-in MusicXML piece (Canon in D) opens Piece practice.
// Run: node tests/smoke-practise.js
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path');
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
if (!exe) { console.log('No Edge/Chrome found - skipped'); process.exit(0); }
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const probe = `<script>setTimeout(function(){var r=[],$=function(i){return document.getElementById(i)};
function ck(n,c){r.push((c?'PASS ':'FAIL ')+n)}
var shown=function(t){return !$('tab-'+t).classList.contains('hide')};
try{
  var g=generatorPieces('violin').find(function(p){return p.title==='A major, 2 octaves'});
  ck('the generated scale exists',!!g);
  showTab('pieces'); pcPractiseScale(g.id);
  ck('A major, 2 octaves opens the Scale drills',shown('scale')&&!shown('piece'));
  ck('instrument, root, type and span are set',$('scInst').value==='violin'&&$('scRoot').value==='9'&&$('scType').value==='major'&&$('scSpan').value==='2');
  var q=generatorPieces('piano').find(function(p){return p.generator.type==='arpMinor'&&p.generator.octaves===4});
  showTab('pieces'); pcPractiseScale(q.id);
  ck('a 4-octave piano arpeggio is kept to the drill limit',shown('scale')&&$('scInst').value==='chromatic'&&$('scType').value==='arpMinor'&&+$('scSpan').value===MAX_SPAN);
  ck('a piece that is not a scale is left alone',pcPractiseScale('no-such-id')===false);
}catch(e){ck('exception '+e.message,false)}
document.title='RESULT|'+r.join('|')},1500)</script>`;
const f = path.join(__dirname, '..', '_smoke-practise.html'); fs.writeFileSync(f, src.replace('</body>', probe + '</body>'));
const out = spawnSync(exe, ['--headless=new', '--disable-gpu', '--enable-logging=stderr', '--v=0', '--window-size=420,900', '--virtual-time-budget=6000', '--dump-dom', 'file:///' + f.split(path.sep).join('/')], { encoding: 'utf8', maxBuffer: 1 << 28 });
const errs = (out.stderr || '').split('\n').filter(l => /CONSOLE/.test(l) && /Uncaught|TypeError|ReferenceError|SyntaxError/.test(l));
const m = (out.stdout || '').match(/<title>RESULT\|([^<]*)<\/title>/);
(m ? m[1].split('|') : ['FAIL probe did not run']).forEach(l => console.log(l));
errs.forEach(l => console.log('FAIL script error: ' + l.slice(l.indexOf('"'), 300)));
try { fs.unlinkSync(f); } catch {}
process.exit(errs.length || !m || /FAIL/.test(m[1]) ? 1 : 0);
