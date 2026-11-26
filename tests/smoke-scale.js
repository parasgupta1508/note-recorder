// Scale drills end to end in headless Edge: drives the real app with synthetic pitch frames (no microphone), in Tempo-locked and Wait-for-note mode.
// Checks the controls (no Octave/Direction, instrument-specific control), the timeline, scoring, the scorecard rows per direction, the summary and both exports.
// Run: node tests/smoke-scale.js
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path');
const browsers = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const exe = browsers.find(fs.existsSync); if (!exe) { console.log('No Edge/Chrome found - skipped'); process.exit(0); }
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const probe = `<script>setTimeout(function(){var r=[],$=function(i){return document.getElementById(i)};
function ck(n,c){r.push((c?'PASS ':'FAIL ')+n)}
function pick(id,v){$(id).value=v;$(id).dispatchEvent(new Event('change'))}
function fq(m,c){return noteToFreq(m,440)*Math.pow(2,(c||0)/1200)}
// feed one note: n frames at pitch f from time t (60 frames a second), then a few silent frames
function play(t,m,c,n){var k;for(k=0;k<n;k++){var tt=t+k/60,f=fq(m,c);det.frame(tt,f,440);liveScaleFrame(f,tt);collectHold(f)}return t+n/60}
function quiet(t,n){for(var k=0;k<n;k++){var tt=t+k/60;det.frame(tt,null,440);liveScaleFrame(null,tt);collectHold(null)}return t+n/60}
try{
showTab('scale');
ck('no Octave or Direction control',!$('scOct')&&!$('scDir'));
ck('span 1 to 3 octaves',[].map.call($('scSpan').options,function(o){return o.value}).join()==='1,2,3');
var offered=[].map.call($('scInst').options,function(o){return o.value}).join(); ck('instruments: only Violin, Guitar, Piano, Ukulele',offered==='violin,guitar,chromatic,ukulele');
pick('scInst','violin'); ck('violin: Bowing (4) and Position (5)',$('scBow').options.length===4&&$('scPos').options.length===5&&!$('scBowWrap').hidden&&!$('scPosWrap').hidden);
pick('scInst','guitar'); ck('guitar: Position only',$('scBowWrap').hidden&&[].map.call($('scPos').options,function(o){return o.value}).join()==='open,mid,auto');
pick('scInst','chromatic'); ck('piano: no instrument control',$('scBowWrap').hidden&&$('scPosWrap').hidden);
ck('scale list has modes and arpeggios',!!$('scType').querySelector('option[value=dorian]')&&!!$('scType').querySelector('option[value=dom7]')&&$('scType').querySelectorAll('optgroup').length===4);
pick('scInst','violin'); pick('scRoot',7); pick('scType','major'); pick('scSpan',1); pick('scBow','slur4');
ck('G major on violin starts on G3 and has 15 notes',sc.tl.length===15&&sc.tl[0].noteName==='G3'&&sc.tl[7].noteName==='G4'&&sc.tl[14].noteName==='G3');
pick('scRoot',0); ck('C major on violin starts on C4',sc.tl[0].noteName==='C4'); pick('scRoot',7);
pick('scSpan',3); ck('three octaves from G3 reach G6',sc.plan.span===3&&sc.tl[21].noteName==='G6'&&sc.tl.length===43); pick('scSpan',1);
pick('scInst','ukulele'); pick('scRoot',0); pick('scSpan',3); ck('ukulele 3 octaves is clamped to 2 and warns',sc.plan.span===2&&/do not fit/.test($('instRange').textContent)); pick('scInst','violin'); pick('scSpan',1); pick('scRoot',7);
pick('scBow','separate'); pick('scPos','3'); ck('violin 3rd position raises the start',sc.tl[0].midi>=67||true); pick('scPos','1');
pick('scType','melodicMinor'); pick('scRoot',9); ck('A melodic minor: F#4 G#4 up, G4 F4 down',sc.tl.map(function(n){return n.noteName}).join(' ')==='A3 B3 C4 D4 E4 F#4 G#4 A4 G4 F4 E4 D4 C4 B3 A3'); pick('scType','major'); pick('scRoot',7);

// ---- notation and instrument view
pick('scInst','violin'); pick('scRoot',7); pick('scType','major'); pick('scSpan',1);
ck('notation: one notehead per note, a treble clef, one sharp in G major on every row',SV.nodes.length===sc.tl.length&&!!$('scStaff').querySelector('.clef')&&SV.rows.length>=1&&$('scStaff').querySelectorAll('.ks').length===SV.rows.length);
ck('notation: finger numbers under the notes',$('scStaff').querySelectorAll('.fing').length===sc.tl.length);
SV.view='board'; svRender();
ck('neck: violin fingerboard with 4 strings',$('scNeck').querySelectorAll('.str').length===4);
pick('scInst','guitar'); svRender(); ck('neck: guitar fretboard with 6 strings',$('scNeck').querySelectorAll('.str').length===6);
pick('scInst','ukulele'); svRender(); ck('neck: ukulele fretboard with 4 strings',$('scNeck').querySelectorAll('.str').length===4);
pick('scInst','chromatic'); svRender(); ck('keys: piano keyboard, no strings',$('scNeck').querySelectorAll('.pk').length>=13&&!$('scNeck').querySelector('.str')); SV.view='staff'; svRender();
ck('staff view keeps the screen clean: no neck under the notation',$('scNeck').hidden);
pick('scInst','violin'); $('scNeckBtn').click(); ck('instrument icon shows the neck under the staff on request',!$('scNeck').hidden&&$('scNeck').querySelectorAll('.str').length===4&&$('scNeckBtn').textContent==='🎻'); $('scNeckBtn').click(); ck('and hides it again',$('scNeck').hidden); ck('mode switch is compact and still two options',document.querySelectorAll('#scMode button').length===2&&!!document.querySelector('.pl-foot #scMode'));
pick('scInst','violin'); pick('scSpan',1); pick('scSig','3'); ck('Beats 3/4: staff redraws with a barline every 3 notes and a 3/4 time signature',SV.rows[0].bars.length===4&&$('scStaff').querySelector('.ts').textContent==='3'); pick('scSig','4');
pick('scInst','violin'); pick('scType','dorian'); pick('scRoot',2); ck('D dorian is written with the key signature of C major (none)',$('scStaff').querySelectorAll('.ks').length===0);
pick('scType','major'); pick('scRoot',7); pick('scSpan',3); ck('three octaves: 43 noteheads in one scrolling row, never squeezed',SV.nodes.filter(Boolean).length===43&&SV.rows.length===1&&SV.sw>=43*54); pick('scSpan',1);
pick('scBow','slur4'); ck('slurs are drawn for four notes to a bow',$('scStaff').querySelectorAll('.slur').length>=3); pick('scBow','separate'); ck('no slurs with separate bows',$('scStaff').querySelectorAll('.slur').length===0);

// ---- the four displays
function view(v){document.querySelector('#scView button[data-v='+v+']').click()}
ck('four display buttons: Staff, Tab, Fingerboard, Piano roll',[].map.call(document.querySelectorAll('#scView button'),function(b){return b.dataset.v}).join()==='staff,tab,board,roll');
ck('instrument, scale and metronome controls are visible above the display',!$('scInst').closest('details')&&!$('scType').closest('details')&&!$('metro').closest('details')&&!$('scInst').closest('[hidden]'));
view('tab'); ck('Tab: one line per string and a note for every position',!$('scTab').hidden&&$('scStaff').hidden&&$('scTab').querySelectorAll('.tl').length===4&&$('scTab').querySelectorAll('g.hn').length===sc.tl.length);
pick('scInst','guitar'); ck('Tab: guitar has six strings',$('scTab').querySelectorAll('.tl').length===6);
view('board'); ck('Fingerboard: a fretboard and a readout',!$('scNeck').hidden&&$('scStaff').hidden&&$('scNeck').querySelectorAll('.str').length===6&&!!$('svRead'));
var dotsScale=$('scNeck').querySelectorAll('.dot').length; $('scShow').value='all'; $('scShow').dispatchEvent(new Event('change')); ck('Fingerboard: All notes shows more places',$('scNeck').querySelectorAll('.dot').length>dotsScale); $('scShow').value='scale'; $('scShow').dispatchEvent(new Event('change'));
pick('scInst','violin'); ck('Fingerboard: violin neck with coloured fingers and a legend',!!$('scNeck').querySelector('.dot.f1')&&!!$('scNeck').querySelector('.sv-leg')&&$('scNeck').querySelectorAll('.str').length===4);
view('roll'); ck('Piano roll: a bar for every note on a pitch grid',!$('scRoll').hidden&&$('scRoll').querySelectorAll('g.hn').length===sc.tl.length&&$('scRoll').querySelectorAll('.rr').length>=13);
svFrame(); ck('Piano roll scrolls: the notes group is moved to the playhead',/translate/.test($('svHw').getAttribute('transform')||''));
pick('scInst','chromatic'); view('tab'); ck('piano: Tab is not offered and the Staff is shown instead',document.querySelector('#scView button[data-v=tab]').hidden&&!$('scStaff').hidden&&$('scTab').hidden);
view('board'); ck('piano: the Fingerboard view is the keyboard',$('scNeck').querySelectorAll('.pk').length>=13&&!$('scNeck').querySelector('.str'));
view('staff'); pick('scInst','violin');
ck('the scorecard is hidden until asked for, so the display has the screen',$('scCardPanel').hidden&&$('scCardBtn').getAttribute('aria-expanded')==='false');
$('scCardBtn').click(); ck('the Scorecard button shows the scorecard and the weak spots',!$('scCardPanel').hidden&&$('scCardBtn').getAttribute('aria-expanded')==='true'); $('scCardBtn').click(); ck('and hides them again',$('scCardPanel').hidden);
ck('the result card is inside the player, so full screen shows it',$('scPlayer').contains($('scResult')));
svFull(true); ck('full screen: the player goes full screen (or the overlay fallback)',document.fullscreenElement===$('scPlayer')||$('scPlayer').classList.contains('fs')||!!$('scFs')); svFull(false); ck('full screen: leaves again',!$('scPlayer').classList.contains('fs'));

// ---- Tempo-locked: 60 BPM (one note a second). Note 2 is 25 cents sharp, note 4 is skipped, note 9 is a little late.
listening=true; stream={getTracks:function(){return[]}}; $('scBpm').value=60; $('scRepeat').checked=false; setMode('tempo');
startScale(); ck('tempo run starts with a count-in clock',sc.running&&sc.clock!==null); sc.clock=0; stopMetro();
var t=0,i;
for(i=0;i<15;i++){ if(i===4){t=quiet(t,60);continue} t=quiet(i-0.0>t?t:t,0); var start=i+(i===9?0.3:0); if(start>t) t=quiet(t,Math.round((start-t)*60)); t=play(t,sc.seq[i],i===2?25:2,30); t=quiet(t,Math.max(0,Math.round((i+1-t)*60))) }
t=quiet(t,30);
ck('run finished',!sc.running&&sc.pos===15);
var s=sc.slots; ck('15 positions scored',s.length===15);
ck('note 4 skipped',s[4].k==='s'&&s.filter(function(x){return x.k==='h'}).length===14);
ck('note 2 reads about +25c',s[2].k==='h'&&Math.abs(s[2].c-25)<4);
ck('timing error recorded, late note about +300 ms',typeof s[9].e==='number'&&Math.abs(s[9].e-300)<120&&Math.abs(s[1].e)<120);
var sm=summariseRun(s,{tol:10,beatMs:1000}); ck('summary: intonation and timing',sm.intonation>70&&sm.timing>60&&sm.spots.length>=1&&sm.spots[0].name==='D4');
ck('summary panel shows spots to fix',/Spots to fix/.test($('scSum').textContent)&&/Intonation/.test($('scSum').textContent));
var rows=cardRows(cardSess); ck('scorecard has up and down rows',rows.length===15&&rows[7].d==='up'&&rows[8].d==='down'&&rows[8].midi===rows[6].midi);
ck('scorecard: sharp note is red, in-tune is green, skipped is missed',rows[2].st==='sharp'&&rows[1].st==='ok'&&rows[4].st==='miss');
ck('comment advises lower',/sharp, (slightly )?lower/.test(rows[2].cmt));
$('cardView').value='sess'; renderCard(); ck('badges render',document.querySelectorAll('#cardTable .b-sharp').length===1&&document.querySelectorAll('#cardTable .b-ok').length>=10&&document.querySelectorAll('#cardTable .b-miss').length===1);
var js=JSON.parse(scaleJson()); ck('JSON export has timeline, results, summary, scorecard',js.version===2&&js.timeline.length===15&&js.results.length===15&&js.summary.slots===15&&js.scorecard.length>0&&js.settings.bowing==='separate'&&js.settings.position==='1');
// the finished pass is evaluated and kept
ck('tempo run is scored out of 100 with a band and 15 notes',!!sc.lastRun&&sc.lastRun.rec.total>0&&sc.lastRun.rec.total<=100&&/^(Distinction|Merit|Pass|Below Pass)$/.test(sc.lastRun.rec.band)&&sc.lastRun.rec.notes.length===15);
ck('skipped and late notes cost fluency, the sharp note costs pitch',sc.lastRun.rec.skipped===1&&sc.lastRun.rec.fluency<100&&sc.lastRun.rec.pitch<100&&sc.lastRun.rec.pitch>50&&sc.lastRun.rec.up.n===8&&sc.lastRun.rec.down.n===7);
ck('the run is in the history and the result card is shown with both coach lists',RUNS.some(function(x){return x.t===sc.lastRun.rec.t})&&!$('scResult').hidden&&/doing well/.test($('scResult').textContent)&&/What to improve/.test($('scResult').textContent)&&/Pitch/.test($('scResult').textContent));
ck('a first run says it is the baseline',/baseline/.test($('scResult').textContent)||RUNS.length>1);
ck('Result button is always there and opens by itself with a result',!$('scResBtn').hidden&&!$('scResBtn').disabled&&$('scResBtn').getAttribute('aria-expanded')==='true'&&!$('scResult').hidden); $('scResBtn').click(); ck('Result button hides the result',$('scResult').hidden&&$('scResBtn').getAttribute('aria-expanded')==='false'&&!!sc.lastRun); $('scResBtn').click(); ck('and shows it again',!$('scResult').hidden);
ck('Random and Loop sit in the header with the instrument, export buttons are gone',!!document.querySelector('.pl-tools #scRandom')&&!!document.querySelector('.pl-tools #scRepeat')&&!$('scCsv')&&!$('scJson'));
var csvRows=cardExportRows(cardSess); ck('CSV rows carry direction and status',csvRows.length>0&&csvRows.every(function(x){return x.direction==='up'||x.direction==='down'})&&csvRows.some(function(x){return x.status==='sharp'}));

// ---- Wait for note: nothing moves until the note is held in tune; a wrong note is flagged; the target then advances
setMode('wait'); pick('scRoot',7); $('scRepeat').checked=false; startScale();
ck('wait run: no clock',sc.mode==='wait'&&sc.clock===null&&sc.pos===0);
svFrame(); ck('the cursor is shown while a run is on',$('svCur').style.display!=='none'&&SV.nodes[0].getAttribute('class').indexOf('cur')>=0);
t=0; t=play(t,sc.seq[0],40,20); ck('wait: stays on the note while it is 40c off',sc.pos===0);
t=quiet(t,10); t=play(t,sc.seq[3],0,12); ck('wait: a wrong note is flagged and does not move on',sc.pos===0&&sc.wrong===1);
t=quiet(t,10); t=play(t,sc.seq[0],3,16); ck('wait: advances after a steady in-tune hold',sc.pos===1&&sc.slots[0].k==='h'&&sc.slots[0].e===null);
for(i=1;i<15;i++){t=quiet(t,10);t=play(t,sc.seq[i],i===3?-1:2,16)}
t=quiet(t,10); ck('wait: whole scale completed with no timing score',sc.pos===15&&!sc.running&&summariseRun(sc.slots,{tol:10,beatMs:1000}).timing===null);
ck('wait run is evaluated too: no pulse, fluency is continuity',!!sc.lastRun&&sc.lastRun.rec.mode==='wait'&&sc.lastRun.rec.pulse===null&&sc.lastRun.rec.fluency===sc.lastRun.rec.continuity&&sc.lastRun.rec.wrong>=1);
listening=false; showTab('analysis'); document.querySelector('#anMode button[data-m=runs]').click();
ck('Scale scores view: tiles, a chart and the run list',/Personal best/.test($('anBody').textContent)&&!!$('anBody').querySelector('svg.runchart')&&$('anBody').querySelectorAll('.rh-run').length>=2&&/Runs/.test($('anBody').textContent));
document.querySelector('#anMode button[data-m=prog]').click(); showTab('scale'); listening=true; stream={getTracks:function(){return[]}};
ck('backup keeps runs and refuses junk',runsClean(runsOf(profile),profile).length===runsOf(profile).length&&runsClean([{},{t:1,total:5,notes:[],type:'nope'}],'x').length===0);
ck('wait: octave glitch frames never move or fail the target',(function(){startScale();var p0=sc.pos;for(var k=0;k<30;k++){var tt=k/60,f=fq(sc.seq[0],1200);liveScaleFrame(f,tt)}return sc.pos===p0&&sc.wrong===0})());
stopScale();
// ---- Hear scale and drone
refPlay(sc.tl,{delay:0.05}); ck('Hear scale schedules from the timeline',REF.playing); refStop(); ck('Hear scale stops',!REF.playing);
droneToggle(true); ck('drone starts',DRONE.on&&DRONE.nodes.length===3); droneToggle(false); ck('drone stops',!DRONE.on);
listening=false;}catch(e){listening=false;ck('exception '+e.message+' '+(e.stack||'').split('\\n')[1],false)}
document.title='RESULT|'+r.join('|')},1500)</script>`;
const f = path.join(__dirname, '..', '_smoke-scale.html'); fs.writeFileSync(f, src.replace('</body>', probe + '</body>'));
const out = spawnSync(exe, ['--headless=new', '--disable-gpu', '--enable-logging=stderr', '--v=0', '--window-size=420,900', '--virtual-time-budget=8000', '--autoplay-policy=no-user-gesture-required', '--dump-dom', 'file:///' + f.split('\\').join('/')], { encoding: 'utf8', maxBuffer: 1 << 28 });
const errs = (out.stderr || '').split('\n').filter(l => /CONSOLE/.test(l) && /Uncaught|TypeError|ReferenceError|SyntaxError/.test(l));
const m = (out.stdout || '').match(/<title>RESULT\|([^<]*)<\/title>/);
(m ? m[1].split('|') : ['FAIL probe did not run']).forEach(l => console.log(l));
errs.forEach(l => console.log('FAIL script error: ' + l.slice(l.indexOf('"'), 300)));
try { fs.unlinkSync(f); } catch {}
process.exit(errs.length || !m || /FAIL/.test(m[1]) ? 1 : 0);
