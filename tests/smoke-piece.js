// Piece practice end to end in headless Edge: its own main-menu screen, a MusicXML score opened through the real screen, the instrument scan (one instrument: locked badge; several: a part
// list), the four displays, Tempo-locked and Wait modes with synthetic pitch frames (no microphone), the result and its history, the bar range, and the proof that the Scale drills are untouched.
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
// feed one note: n frames at pitch f from time t (60 frames a second); the microphone loop hands each frame to pieceFrame
function play(t,m,c,n){for(var k=0;k<n;k++){pieceFrame(fq(m,c),t+k/60)}return t+n/60}
function quiet(t,n){for(var k=0;k<n;k++){pieceFrame(0,t+k/60)}return t+n/60}
var open=function(x,name){ppOpenBytes(new TextEncoder().encode(x),name||'etude.musicxml','file')};
try{
// ---- the Scale drills, before anything: their state, to compare at the end
showTab('scale'); var scaleRuns=RUNS.length, scalePlan=JSON.stringify(sc.tl.map(function(n){return n.midi})), scaleHtml=$('tab-scale').innerHTML.length;
setGradeMode('strict', true);

// ---- the new main-menu item
var nav=$('nav-piece'); ck('main menu: "Piece practice" is a new item, next to Practice',!!nav&&/Piece practice/.test(nav.textContent)&&nav.nextElementSibling===$('nav-pieces')&&nav.previousElementSibling===$('nav-home'));
nav.click(); ck('opening it shows its own screen and hides the Scale drills',tab==='piece'&&!$('tab-piece').classList.contains('hide')&&$('tab-scale').classList.contains('hide')&&nav.classList.contains('on'));
ck('it is not inside the Scale drills screen',!$('tab-scale').contains($('tab-piece'))&&!$('tab-piece').contains($('tab-scale')));
ck('before a piece is chosen: the library view (search, instrument filter, from this device, link box) and no player',!$('pzLib').hidden&&$('pzPlayer').hidden&&!!$('pzLibSearch')&&!!$('pzLibInst')&&!!$('ppPick')&&!!$('ppUrl')&&!!$('pzLibSettings'));
// the library list, search and filter (the lists are put in memory here: the test does not go to GitHub)
PLS=[{id:'t/one',owner:'t',repo:'one',ref:'',prefix:'',includeXml:false,inst:'any',title:'Test library',on:true},{id:'t/two',owner:'t',repo:'two',ref:'',prefix:'',includeXml:false,inst:'chromatic',title:'Piano library',on:true},{id:'t/off',owner:'t',repo:'off',ref:'',prefix:'',includeXml:false,inst:'any',title:'Switched off',on:false}];
PLC['t/one']={state:'ok',files:[{path:'x/Violin_Romance.mxl',name:'Violin_Romance.mxl',label:'Violin Romance',dir:'x',ext:'mxl',size:2048},{path:'x/Canon.mxl',name:'Canon.mxl',label:'Canon',dir:'x',ext:'mxl',size:1024}]};
PLC['t/two']={state:'ok',files:[{path:'y/Moonlight_Sonata.mxl',name:'Moonlight_Sonata.mxl',label:'Moonlight Sonata',dir:'y',ext:'mxl',size:4096}]};
PLC['t/off']={state:'ok',files:[{path:'z/Hidden.mxl',name:'Hidden.mxl',label:'Hidden',dir:'z',ext:'mxl',size:1}]};
plRender();
ck('library: every piece of the libraries that are on (3), none of the one that is off',$('pzLibList').querySelectorAll('button.pp-file').length===3&&!/Hidden/.test($('pzLibList').textContent)&&/3 pieces/.test($('pzLibCount').textContent));
ck('library: instrument filter buttons with counts (All 3, Piano 1, Violin 1, Not stated 1)',/All\\s*3/.test($('pzLibInst').textContent)&&/Piano\\s*1/.test($('pzLibInst').textContent)&&/Violin\\s*1/.test($('pzLibInst').textContent)&&/Not stated\\s*1/.test($('pzLibInst').textContent)&&!/Guitar/.test($('pzLibInst').textContent));
$('pzLibInst').querySelector('button[data-i=violin]').click(); ck('library: the Violin filter shows only the violin piece',$('pzLibList').querySelectorAll('button.pp-file').length===1&&/Violin Romance/.test($('pzLibList').textContent));
$('pzLibInst').querySelector('button[data-i=all]').click(); $('pzLibSearch').value='sonata'; $('pzLibSearch').dispatchEvent(new Event('input')); ck('library: search finds a piece by its name',$('pzLibList').querySelectorAll('button.pp-file').length===1&&/Moonlight/.test($('pzLibList').textContent));
$('pzLibSearch').value='zzz'; $('pzLibSearch').dispatchEvent(new Event('input')); ck('library: no match says so',$('pzLibList').querySelectorAll('button.pp-file').length===0&&/No piece matches/.test($('pzLibStatus').textContent));
$('pzLibSearch').value=''; $('pzLibSearch').dispatchEvent(new Event('input')); pick('pzLibRepo','t/two'); ck('library: the library menu limits the list',$('pzLibList').querySelectorAll('button.pp-file').length===1); pick('pzLibRepo','all');
// Settings > Piece libraries
$('plAddUrl').value='https://github.com/foo/bar-scores'; pick('plAddInst','violin'); $('plAddForm').dispatchEvent(new Event('submit',{cancelable:true}));
ck('settings: a library is added with its instrument and saved on this device',PLS.length===4&&PLS[3].id==='foo/bar-scores'&&PLS[3].inst==='violin'&&JSON.parse(localStorage.getItem(PL_KEY)).some(function(x){return x.id==='foo/bar-scores'})&&$('plRepos').querySelectorAll('.pl-repo').length===4);
$('plAddUrl').value='nonsense'; $('plAddForm').dispatchEvent(new Event('submit',{cancelable:true})); ck('settings: a bad link is refused with a reason',/Paste a GitHub/.test($('plAddMsg').textContent)&&PLS.length===4);
$('plRepos').querySelector('input[data-on="t/one"]').click(); ck('settings: switching a library off removes its pieces from the list',PLS[0].on===false&&$('pzLibList').querySelectorAll('button.pp-file').length===1);
$('plRepos').querySelector('button[data-rm="foo/bar-scores"]').click(); ck('settings: a library is removed',PLS.length===3&&!JSON.parse(localStorage.getItem(PL_KEY)).some(function(x){return x.id==='foo/bar-scores'}));
ck('settings: the group is in the Settings menu',!!document.querySelector('.set-group[data-g=piecelibs]')&&/Piece libraries/.test($('setMenu').textContent));
PLS[0].on=true; plSave(); plRender();
ck('the file picker takes .musicxml, .xml and .mxl',/\\.musicxml/.test($('ppFile').accept)&&/\\.xml/.test($('ppFile').accept)&&/\\.mxl/.test($('ppFile').accept));
ck('the instrument list is the drills\\' four',[].map.call($('pzInst').options,function(o){return o.value}).join()==='violin,guitar,chromatic,ukulele');

// ---- Case B: several instruments
open(${multi});
ck('several parts: the list of available parts is shown and no part is chosen yet',PP.sum.length===5&&PP.idx===-1&&!$('ppParts').hidden&&$('ppParts').querySelectorAll('button').length===5&&$('pzPlayer').classList.contains('pp-pick'));
ck('the part list names the instrument it found',/P1: Violin/.test($('ppParts').textContent)&&/Guitar/.test($('ppParts').textContent)&&/Cello[^]*piano scoring/.test($('ppParts').textContent));
ck('nothing can be started before a part is chosen',!ppActive()&&$('pzStart').disabled&&$('pzDemo').disabled);
$('ppParts').querySelector('button[data-i="0"]').click();
ck('choosing the violin part loads it: instrument, badge, notes',ppActive()&&$('pzInst').value==='violin'&&!$('pzInst').disabled&&/Playing: Violin/.test($('ppBadge').textContent)&&PE.tl.length===8&&!$('pzPlayer').classList.contains('pp-pick')&&!$('pzStart').disabled);
ck('tempo and beats come from the score',+$('pzBpm').value===100&&$('pzSig').value==='4'&&PE.bpm===100);
ck('violin controls: bowing and position',!$('pzBowWrap').hidden&&!$('pzPosWrap').hidden&&$('pzBow').options.length===4&&$('pzPos').options.length===5);
ck('default display is the Staff with the instrument under it',PW.view==='staff'&&PW.showNeck&&!$('pzStaff').hidden&&!$('pzNeck').hidden);
ck('the staff has the key signature (2 sharps), bar lines from the score, an accidental only for the Bb (the F# is in the key)',$('pzStaff').querySelectorAll('.ks').length===2&&$('pzStaff').querySelectorAll('line.bar').length===3&&$('pzStaff').querySelectorAll('.acc').length===1);
ck('half and whole notes are open heads (3 of 8: A half, G whole, D whole)',$('pzStaff').querySelectorAll('.nh .hole').length===3&&$('pzStaff').querySelectorAll('.nh').length===8);
ck('the title shows the piece',$('pzVisTitle').textContent==='Etude'&&$('pzDemo').textContent==='▶ Hear piece');
document.querySelector('#pzView button[data-v=tab]').click(); ck('Tab view: one box per note',!$('pzTab').hidden&&$('pzTab').querySelectorAll('g.hn').length===8);
var hw1=$('pzTab').querySelector('#pwHw g.hn[data-i="4"] rect'); ck('Tab places notes by beat, not by number: the 5th note (after a rest) is 5 beats in',hw1&&Math.abs(+hw1.getAttribute('x')+15-5*72)<1);
document.querySelector('#pzView button[data-v=roll]').click(); ck('Piano roll: note widths follow the lengths (half note is twice a quarter)',$('pzRoll').querySelectorAll('g.hn').length===8&&(function(){var w=function(i){return +$('pzRoll').querySelector('g.hn[data-i="'+i+'"] rect').getAttribute('width')};return w(5)>1.8*w(4)})());
document.querySelector('#pzView button[data-v=board]').click(); ck('Fingerboard view',!$('pzNeck').hidden&&$('pzNeck').querySelectorAll('circle.dot').length>0&&!!$('pwRead'));
document.querySelector('#pzView button[data-v=staff]').click();
ck('no element id is shared with another screen (the Scale drills elements and SVG ids are not reused)',(function(){var mine={},bad=0;[].forEach.call($('tab-piece').querySelectorAll('[id]'),function(e){mine[e.id]=1});[].forEach.call($('pzLib').querySelectorAll('[id]'),function(e){mine[e.id]=1});[].forEach.call(document.querySelectorAll('[id]'),function(e){if(mine[e.id]&&!$('tab-piece').contains(e)&&!$('pzLib').contains(e))bad++});return bad===0})());
ck('violin hand position per note',Array.isArray(PE.plan.posList)&&PE.plan.posList.length===8);

// ---- the engraved staff (Verovio loads as a module, which a file:// page cannot do: here it must fail politely and the simple staff must come back)
ck('engraved: a button next to the instrument button, off by default',!!$('pzEngBtn')&&!PW.eng&&$('pzEngBox').hidden);
$('pzEngBtn').click(); ck('engraved: switching it on shows the engraved box and hides the simple staff',PW.eng&&!$('pzEngBox').hidden&&$('pzStaff').hidden&&$('pzEngBtn').getAttribute('aria-pressed')==='true');
$('pzEngBtn').click(); ck('engraved: switching it off brings the simple staff back with its notes',!PW.eng&&$('pzEngBox').hidden&&!$('pzStaff').hidden&&$('pzStaff').querySelectorAll('.nh').length===8);

// ---- Wait mode through the engine: a pause between notes, the repeated A needs it
peSetMode('wait'); pick('pzBpm',100); $('pzRepeat').checked=false; peReset(); PE.running=true; var t=0,i;
for(i=0;i<8;i++){ t=play(t,PE.seq[i],i%2?3:-2,20); ck('wait: note '+(i+1)+' ('+PE.tl[i].noteName+') advanced',PE.pos===i+1||(i===7&&!PE.running)); t=quiet(t,12) }
t=quiet(t,120);
ck('wait: the run finished with every note played',!PE.running&&PE.slots.length===8&&PE.slots.every(function(s){return s.k==='h'}));
peReset(); PE.running=true; t=play(0,PE.seq[0],0,20); t=quiet(t,12); t=play(t,PE.seq[1],0,20); t=quiet(t,12); t=play(t,PE.seq[2],0,20); ck('wait: the first A5 advanced',PE.pos===3); t=play(t,PE.seq[2],0,40); ck('wait: the same A5 held on does NOT pass the next A5',PE.pos===3&&PE.needGap===true); t=quiet(t,12); t=play(t,PE.seq[3],0,20); ck('wait: after a pause the second A5 counts',PE.pos===4);
peStop();

// ---- Tempo-locked: 100 BPM; the Bb (note 5) is skipped, G (note 7) is 150 ms late
peSetMode('tempo'); peReset(); PE.running=true; PE.clock=0; $('pzRepeat').checked=false; t=0;
for(i=0;i<8;i++){ var due=PE.tl[i].startMs/1000+(i===6?0.15:0); if(due>t) t=quiet(t,Math.round((due-t)*60)); if(i===4) continue; t=play(t,PE.seq[i],i===1?25:2,18) }
t=quiet(t,60);
ck('tempo: run finished',!PE.running&&PE.slots.length>=8);
var s=PE.slots.filter(function(x){return x.pass===1});
ck('tempo: 8 positions scored, the Bb skipped',s.length===8&&s[4].k==='s'&&s.filter(function(x){return x.k==='h'}).length===7);
ck('tempo: the sharp F# reads about +25 cents',s[1].k==='h'&&Math.abs(s[1].c-25)<5);
ck('tempo: the late G reads about 150 ms late, the others are on time',typeof s[6].e==='number'&&Math.abs(s[6].e-150)<60&&Math.abs(s[0].e)<80);
ck('tempo: skipping the Bb and playing the next A is the 6th note, not a retry of the 3rd (A B A)',s[5].k==='h'&&s[3].k==='h'&&s[3].e!==null);

// ---- the result is a Trinity-style report, kept per piece
PE.lastRun=null; peSetMode('wait'); peReset(); PE.running=true; t=0; for(i=0;i<8;i++){ t=play(t,PE.seq[i],1,20); t=quiet(t,12) } t=quiet(t,120);
setTimeout(function(){ try{
var run=PE.lastRun; ck('result: a run record for this piece',!!run&&run.rec.type==='piece'&&/^Etude · Violin/.test(run.rec.label)&&run.rec.total>=80&&/^pc/.test(run.rec.sid));
ck('result: the card has the score, the band, the three marks and the coach',!$('pzResult').hidden&&/Distinction|Merit/.test($('pzResult').textContent)&&$('pzResult').querySelectorAll('.rb').length===3&&/What to improve/.test($('pzResult').textContent));
ck('result: the Result button is on',!$('pzResBtn').disabled);
ck('history: the run is kept on this device under its own key, with no per-note list',(function(){var a=peRuns();return a.length>=1&&a[a.length-1].sid===run.rec.sid&&a[a.length-1].notes.length===0})());

// ---- a range of bars
peSetMode('tempo'); peReset(); $('ppFrom').value=3; $('ppTo').value=4; $('ppFrom').dispatchEvent(new Event('change'));
ck('bars 3-4: 2 notes, the first at 0 ms, the second 4 beats later, loop length 8 beats',PE.tl.length===2&&PE.tl[0].startMs===0&&Math.abs(PE.tl[1].startMs-2400)<1&&PE.plan.beats===8&&/bars 3–4/.test(PE.plan.label));
pick('ppOct','12'); ck('octave: up an octave moves the notes and keeps the spelling',PE.tl[0].midi===91&&PE.tl[0].noteName==='G6');
pick('ppOct','auto'); $('ppFrom').value=1; $('ppTo').value=4; $('ppFrom').dispatchEvent(new Event('change'));
$('pzBpmDn').click(); ck('tempo buttons: 5 BPM slower re-times the notes',+$('pzBpm').value===95&&Math.abs(PE.tl[1].startMs-60000/95)<1); pick('pzBpm',100);

// ---- the accompaniment (the other parts)
ck('accompaniment: offered when there are other parts, off by default',!$('ppBackW').hidden&&!PP.backing);
PP.backing=true; var ev=ppBackingEvents(); ck('accompaniment: the other four parts become '+ev.length+' timed notes',ev.length===8&&ev[0].startMs===0); PP.backing=false;

// ---- piano: a grand staff (treble and bass)
ppChoosePart(2); ck('piano part: instrument and chords note',$('pzInst').value==='chromatic'&&PE.tl.length===4&&/chords/.test($('ppParts').textContent));
ck('piano: a grand staff has two clefs, two key signatures, and the G3 is on the bass staff below the treble notes',$('pzStaff').querySelectorAll('.clef').length===2&&$('pzStaff').querySelectorAll('.stk line.sl').length>=11&&(function(){var n=$('pzStaff').querySelectorAll('g.nh .head');var y=function(i){return +n[i].getAttribute('cy')};return n.length===4&&y(3)>y(0)+40})());
ppChoosePart(0); ck('violin: still one treble staff',$('pzStaff').querySelectorAll('.clef').length===1);

// ---- a file with one instrument: locked badge, loaded at once
open(${solo},'solo.musicxml');
ck('one instrument: loaded at once, instrument set and locked, badge says so',ppActive()&&PP.sum.length===1&&$('pzInst').value==='violin'&&$('pzInst').disabled&&/Detected instrument: Violin Solo/.test($('ppBadge').textContent)&&$('ppParts').hidden);
ck('one instrument: the violin scoring applies (vibrato allowance and bowed fingering)',ruleFor($('pzInst').value).wobble===40&&ruleFor($('pzInst').value).fingering==='bowed');
ck('one instrument: no accompaniment to offer',$('ppBackW').hidden);

// ---- not MusicXML
ppOpenBytes(new TextEncoder().encode('<html></html>'),'x.xml','file').then(function(ok){
  ck('a file that is not MusicXML is refused with a reason',ok===false&&/not a MusicXML/.test($('ppMsg').textContent));
  ppOpenBytes(new Uint8Array([0x4d,0x54,0x68,0x64,0,0,0,6]),'x.mid','file').then(function(){
    ck('a MIDI file is refused with a reason',/MIDI/.test($('ppMsg').textContent));
    // ---- leaving: the run stops; the Scale drills are exactly as they were
    peSetMode('wait'); peStart(); ck('a run is on',PE.running);
    showTab('scale'); ck('opening another screen stops the piece run',!PE.running&&PE.demo<0);
    ck('Scale drills: no run, nothing scored, no history added, same notes, same page',sc.running===false&&sc.slots.length===0&&RUNS.length===scaleRuns&&JSON.stringify(sc.tl.map(function(n){return n.midi}))===scalePlan&&!$('tab-scale').querySelector('[id^=pz],[id^=pp],[id^=pw]'));
    pick('scRoot',7); pick('scType','major'); pick('scInst','violin'); pick('scSpan',1); ck('a scale still builds as before',sc.tl.length===15&&sc.tl[0].noteName==='G3');
    ck('the Scale drills have no Piece option and no mode switch',!$('scType').querySelector('option[value=piece]')&&!document.querySelector('#tab-scale #ppMode'));
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
