// Piece practice end to end in headless Edge: a MusicXML score opened through the real screen, the instrument scan (one instrument: locked badge; several: a part list),
// the same displays, Tempo-locked and Wait modes with synthetic pitch frames (no microphone), the result and history, the bar range, and back to scales.
// Run: node tests/smoke-piece.js
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path'), F = require('./lib/fixtures.js');
const browsers = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const exe = browsers.find(fs.existsSync); if (!exe) { console.log('No Edge/Chrome found - skipped'); process.exit(0); }
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const multi = JSON.stringify(F.etudeXml()), solo = JSON.stringify(F.etudeXml({ solo: true }));
const probe = `<script>setTimeout(function(){var r=[],$=function(i){return document.getElementById(i)};
function ck(n,c){r.push((c?'PASS ':'FAIL ')+n)}
function pick(id,v){$(id).value=v;$(id).dispatchEvent(new Event('change'))}
function fq(m,c){return noteToFreq(m,440)*Math.pow(2,(c||0)/1200)}
function play(t,m,c,n){var k;for(k=0;k<n;k++){var tt=t+k/60,f=fq(m,c);det.frame(tt,f,440);liveScaleFrame(f,tt);collectHold(f)}return t+n/60}
function quiet(t,n){for(var k=0;k<n;k++){var tt=t+k/60;det.frame(tt,null,440);liveScaleFrame(null,tt);collectHold(null)}return t+n/60}
var open=function(x,name){ppOpenBytes(new TextEncoder().encode(x),name||'etude.musicxml','file')};
try{
showTab('scale'); setGradeMode('strict', true);
ck('Scales is the starting mode and the piece panel is hidden',!PP.on&&$('ppPanel').hidden&&!$('scRoot').closest('label').hidden);
document.querySelector('#ppMode button[data-m=piece]').click();
ck('Pieces mode: the source picker shows (drop zone, GitHub browser, link box); Root, Scale and Span are hidden',PP.on&&!$('ppPanel').hidden&&!$('ppSource').hidden&&!!$('ppDrop')&&!!$('ppBrowse')&&!!$('ppUrl')&&getComputedStyle($('scRoot').closest('label')).display==='none');
ck('the file picker takes .musicxml, .xml and .mxl',/\\.musicxml/.test($('ppFile').accept)&&/\\.xml/.test($('ppFile').accept)&&/\\.mxl/.test($('ppFile').accept));
ck('Scale type list does not list "piece"',!$('scType').querySelector('option[value=piece]'));

// ---- Case B: several instruments
open(${multi});
ck('several parts: the list of available parts is shown and no part is chosen yet',PP.sum.length===5&&PP.idx===-1&&!$('ppParts').hidden&&$('ppParts').querySelectorAll('button').length===5&&$('scPlayer').classList.contains('pp-pick'));
ck('the part list names the instrument it found',/P1: Violin/.test($('ppParts').textContent)&&/Guitar/.test($('ppParts').textContent)&&/Cello[^]*piano scoring/.test($('ppParts').textContent));
ck('nothing is practised before a part is chosen',!ppActive()&&planNow().type!=='piece');
$('ppParts').querySelector('button[data-i="0"]').click();
ck('choosing the violin part loads it: instrument, badge, plan',ppActive()&&$('scInst').value==='violin'&&!$('scInst').disabled&&/Playing: Violin/.test($('ppBadge').textContent)&&sc.plan.type==='piece'&&sc.tl.length===8&&!$('scPlayer').classList.contains('pp-pick'));
ck('tempo and beats come from the score',+$('scBpm').value===100&&$('scSig').value==='4'&&sc.bpm===100);
ck('default display is the Staff with the instrument under it',SV.view==='staff'&&SV.showNeck&&!$('scStaff').hidden&&!$('scNeck').hidden);
ck('the staff has the key signature (2 sharps), bar lines from the score, and an accidental only for the Bb (the F# is in the key)',$('scStaff').querySelectorAll('.ks').length===2&&$('scStaff').querySelectorAll('line.bar').length===3&&$('scStaff').querySelectorAll('.acc').length===1);
ck('half and whole notes are open heads (3 of 8: A half, G whole, D whole)',$('scStaff').querySelectorAll('.nh .hole').length===3&&$('scStaff').querySelectorAll('.nh').length===8);
ck('the title shows the piece, not a scale',$('scVisTitle').textContent==='Etude'&&$('scDemo').textContent==='▶ Hear piece'&&$('scRandom').hidden);
document.querySelector('#scView button[data-v=tab]').click(); ck('Tab view for the piece: one box per note',!$('scTab').hidden&&$('scTab').querySelectorAll('g.hn').length===8);
var hw1=$('scTab').querySelector('#svHw g.hn[data-i="4"] rect'); ck('Tab places notes by beat, not by number: the 5th note (after a rest) is on beat 5',hw1&&Math.abs(+hw1.getAttribute('x')+15-5*72)<1);
document.querySelector('#scView button[data-v=roll]').click(); ck('Piano roll for the piece, note widths follow the lengths (half note is twice a quarter)',$('scRoll').querySelectorAll('g.hn').length===8&&(function(){var w=function(i){return +$('scRoll').querySelector('g.hn[data-i="'+i+'"] rect').getAttribute('width')};return w(5)>1.8*w(4)})());
document.querySelector('#scView button[data-v=board]').click(); ck('Fingerboard view works for the piece',!$('scNeck').hidden&&$('scNeck').querySelectorAll('circle.dot').length>0);
document.querySelector('#scView button[data-v=staff]').click();
ck('violin hand position per note (a piece moves the hand)',Array.isArray(sc.plan.posList)&&sc.plan.posList.length===8);

// ---- Wait mode through the real engine: a pause between notes, the repeated A needs it
pick('scBpm',100); setMode('wait'); resetPractice(); sc.running=true; $('scRepeat').checked=false; var t=0,i;
for(i=0;i<8;i++){ t=play(t,sc.seq[i],i%2?3:-2,20); ck('wait: note '+(i+1)+' ('+sc.tl[i].noteName+') advanced',sc.pos===i+1||(i===7&&!sc.running)); t=quiet(t,12) }
t=quiet(t,120);
ck('wait: the run finished and a result was made for this piece',!sc.running&&sc.slots.length===8&&sc.slots.every(function(s){return s.k==='h'}));
// a repeat note held on without a pause does not advance
resetPractice(); sc.running=true; t=play(0,sc.seq[0],0,20); t=quiet(t,12); t=play(t,sc.seq[1],0,20); t=quiet(t,12); t=play(t,sc.seq[2],0,20); ck('wait: A5 first time advanced',sc.pos===3); t=play(t,sc.seq[2],0,40); ck('wait: the same A5 held on does NOT pass the next A5',sc.pos===3&&sc.needGap===true); t=quiet(t,12); t=play(t,sc.seq[3],0,20); ck('wait: after a pause the second A5 counts',sc.pos===4);
stopScale();

// ---- Tempo-locked: 100 BPM; the Bb (note 5) is skipped, G (note 7) is 150 ms late
setMode('tempo'); resetPractice(); sc.running=true; sc.clock=0; $('scRepeat').checked=false; t=0;
for(i=0;i<8;i++){ var due=sc.tl[i].startMs/1000+(i===6?0.15:0); if(due>t) t=quiet(t,Math.round((due-t)*60)); if(i===4) continue; t=play(t,sc.seq[i],i===1?25:2,18) }
t=quiet(t,60+Math.round(9.6*60));
ck('tempo: run finished',!sc.running&&sc.slots.length>=8);
var s=sc.slots.filter(function(x){return x.pass===1});
ck('tempo: 8 positions scored, the Bb skipped',s.length===8&&s[4].k==='s'&&s.filter(function(x){return x.k==='h'}).length===7);
ck('tempo: the sharp F# reads about +25 cents',s[1].k==='h'&&Math.abs(s[1].c-25)<5);
ck('tempo: the late G reads about 150 ms late, the others are on time',typeof s[6].e==='number'&&Math.abs(s[6].e-150)<60&&Math.abs(s[0].e)<80);
ck('tempo: the retry rule does not swallow A B A (skipping Bb then playing the next A is the 6th note, not a retry of the 3rd)',s[5].k==='h'&&s[3].k==='h'&&s[3].e!==null);

// ---- the result and history are the scale drills' own
sc.lastRun=null; setMode('wait'); resetPractice(); sc.running=true; t=0; for(i=0;i<8;i++){ t=play(t,sc.seq[i],1,20); t=quiet(t,12) } t=quiet(t,120);
setTimeout(function(){ try{
var run=sc.lastRun; ck('result: a Trinity-style run record for the piece',!!run&&run.rec.type==='piece'&&/^Etude · Violin/.test(run.rec.label)&&run.rec.total>=80&&/^pc/.test(run.rec.sid));
ck('result: the Result button is on for the finished run',!$('scResBtn').disabled);
ck('history: a piece is told apart from a scale',histScaleKey(run.rec)==='piece:'+run.rec.sid);

// ---- a range of bars
setMode('tempo'); resetPractice(); $('ppFrom').value=3; $('ppTo').value=4; $('ppFrom').dispatchEvent(new Event('change'));
ck('bars 3-4: 2 notes, the first at 0 ms, the second 4 beats later, loop length 8 beats',sc.plan.tl.length===2&&sc.tl[0].startMs===0&&Math.abs(sc.tl[1].startMs-2400)<1&&sc.plan.beats===8&&/bars 3–4/.test(sc.plan.label));
pick('ppOct','12'); ck('octave: up an octave moves the notes and keeps the spelling',sc.tl[0].midi===91&&sc.tl[0].noteName==='G6');
pick('ppOct','auto'); $('ppFrom').value=1; $('ppTo').value=4; $('ppFrom').dispatchEvent(new Event('change'));

// ---- the accompaniment (the other parts)
ck('accompaniment: offered when there are other parts, off by default',!$('ppBackW').hidden&&!PP.backing);
PP.backing=true; var ev=ppBackingEvents(); ck('accompaniment: the other four parts become '+ev.length+' timed notes',ev.length===8&&ev[0].startMs===0);
PP.backing=false;

// ---- a file with one instrument: locked badge, loaded at once
open(${solo},'solo.musicxml');
ck('one instrument: loaded at once, instrument set and locked, badge says so',ppActive()&&PP.sum.length===1&&$('scInst').value==='violin'&&$('scInst').disabled&&/Detected instrument: Violin Solo/.test($('ppBadge').textContent)&&$('ppParts').hidden);
ck('one instrument: the violin scoring applies (vibrato allowance and hold time of the violin rule)',ruleFor($('scInst').value).wobble===40&&ruleFor($('scInst').value).fingering==='bowed');
ck('one instrument: no accompaniment to offer',$('ppBackW').hidden);

// ---- not MusicXML
ppOpenBytes(new TextEncoder().encode('<html></html>'),'x.xml','file').then(function(ok){
  ck('a file that is not MusicXML is refused with a reason',ok===false&&/not a MusicXML/.test($('ppMsg').textContent));
  ppOpenBytes(new Uint8Array([0x4d,0x54,0x68,0x64,0,0,0,6]),'x.mid','file').then(function(){
    ck('a MIDI file is refused with a reason',/MIDI/.test($('ppMsg').textContent));
    // ---- back to scales
    document.querySelector('#ppMode button[data-m=scale]').click();
    ck('back to Scales: instrument unlocked, Root/Scale/Span back, a scale plan, panel hidden',!PP.on&&!$('scInst').disabled&&$('ppPanel').hidden&&planNow().type!=='piece'&&$('scDemo').textContent==='▶ Hear scale'&&getComputedStyle($('scRoot').closest('label')).display!=='none');
    pick('scRoot',7); pick('scType','major'); ck('and a scale still builds as before',sc.tl.length===15&&sc.tl[0].noteName==='G3');
    document.title='RESULT|'+r.join('|');
  });
});
}catch(e){ck('exception '+e.message+' '+(e.stack||'').split('\\n')[1],false);document.title='RESULT|'+r.join('|')}
},2500);
}catch(e){ck('exception '+e.message+' '+(e.stack||'').split('\\n')[1],false);document.title='RESULT|'+r.join('|')}
},1500)</script>`;
const f = path.join(__dirname, '..', '_smoke-piece.html'); fs.writeFileSync(f, src.replace('</body>', probe + '</body>'));
const out = spawnSync(exe, ['--headless=new', '--disable-gpu', '--enable-logging=stderr', '--v=0', '--window-size=420,900', '--virtual-time-budget=12000', '--autoplay-policy=no-user-gesture-required', '--dump-dom', 'file:///' + f.split('\\').join('/')], { encoding: 'utf8', maxBuffer: 1 << 28 });
const errs = (out.stderr || '').split('\n').filter(l => /CONSOLE/.test(l) && /Uncaught|TypeError|ReferenceError|SyntaxError/.test(l));
const m = (out.stdout || '').match(/<title>RESULT\|([^<]*)<\/title>/);
(m ? m[1].split('|') : ['FAIL probe did not run']).forEach(l => console.log(l));
errs.forEach(l => console.log('FAIL script error: ' + l.slice(l.indexOf('"'), 300)));
try { fs.unlinkSync(f); } catch {}
process.exit(errs.length || !m || /FAIL/.test(m[1]) ? 1 : 0);
