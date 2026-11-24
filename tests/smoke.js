// (The live microphone cannot be tested in headless Edge, so listening must be checked by hand on a device.)
// Loads index.html in headless Edge/Chrome, clicks through the Recorder, and fails on any script error.
// Run: node tests/smoke.js
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const browsers = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const exe = browsers.find(fs.existsSync); if (!exe) { console.log('No Edge/Chrome found - skipped'); process.exit(0); }
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const probe = `<script>setTimeout(function(){var r=[],$=function(i){return document.getElementById(i)};
function ck(n,c){r.push((c?'PASS ':'FAIL ')+n)}
try{document.querySelector('[data-tab=rec],#tabRec,button[data-t=rec]')&&0;
var tabBtn=[].find.call(document.querySelectorAll('button,a,[role=tab]'),function(b){return /record/i.test(b.textContent)&&b.closest('nav,.tabs,header,.appbar,[role=tablist]')});
if(tabBtn)tabBtn.click(); ck('recorder tab opens',!$('tab-rec').classList.contains('hide'));
$('vwFall').click(); ck('Falling view',$('tab-rec').dataset.view==='fall'&&$('vwFall').classList.contains('on'));
$('vwSheet').click(); ck('Sheet view',$('tab-rec').dataset.view==='sheet');
$('fsBtn').click(); ck('full screen on',$('tab-rec').classList.contains('fs')&&getComputedStyle(document.querySelector('#tab-rec .rbar')).display!=='none'&&$('rec').offsetHeight>0&&getComputedStyle($('recMode').closest('.ropts')).display==='none'&&getComputedStyle(document.querySelector('#tab-rec .tport')).display!=='none');
var cv=$('roll');ck('full screen canvas is tall',cv.clientHeight>200);
$('fsBtn').click(); ck('full screen off',!$('tab-rec').classList.contains('fs'));
ck('ms toggle exists, off by default',!!$('msBtn')&&$('msBtn').getAttribute('aria-pressed')==='false'); ck('Auto has no helper text',!/picks the best mode/.test($('recModeDesc').textContent)); ck('Auto is default',$('recMode').value==='auto'); ck('no upload control',!$('recFile'));
}catch(e){ck('exception '+e.message,false)}

document.title='RESULT|'+r.join('|')},1500)</script>`;
const f = path.join(__dirname, '..', '_smoke.html'); fs.writeFileSync(f, src.replace('</body>', probe + '</body>'));   // next to index.html so the relative script paths work
const out = spawnSync(exe, ['--headless=new', '--disable-gpu', '--enable-logging=stderr', '--v=0',  '--window-size=420,900', '--virtual-time-budget=6000', '--dump-dom', 'file:///' + f.split('\\').join('/')], { encoding: 'utf8', maxBuffer: 1 << 28 });
const errs = (out.stderr || '').split('\n').filter(l => /CONSOLE/.test(l) && /Uncaught|TypeError|ReferenceError|SyntaxError/.test(l));
const m = (out.stdout || '').match(/<title>RESULT\|([^<]*)<\/title>/);
(m ? m[1].split('|') : ['FAIL probe did not run']).forEach(l => console.log(l));
errs.forEach(l => console.log('FAIL script error: ' + l.slice(l.indexOf('"'), l.indexOf('"', 40) + 1)));
try { fs.unlinkSync(f); } catch {}
process.exit(errs.length || !m || /FAIL/.test(m[1]) ? 1 : 0);
