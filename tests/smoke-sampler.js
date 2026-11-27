// The browser side of the instrument sounds (js/app/sampler.js) in headless Edge over HTTP: the recordings load and decode, a note is played with smpPlay into an offline audio context
// and read back with the app's own detector at the pitch asked for, Hear scale plays the real instrument (not the plain tone), and a missing bank falls back to the old tone.
// Run: node tests/smoke-sampler.js
const http = require('http'), fs = require('fs'), path = require('path'), { spawn, spawnSync } = require('child_process'), os = require('os');
const root = path.join(__dirname, '..'), exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
if (!exe) { console.log('No Edge/Chrome found - skipped'); process.exit(0); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.webmanifest': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const probe = `<script>(async function(){var r=[],$=function(i){return document.getElementById(i)};
function ck(n,c){r.push((c?'PASS ':'FAIL ')+n)}
function done(){fetch('/result',{method:'POST',body:r.join('|')})}
try{
  var b=await smpLoad('violin'); ck('the violin recordings load and decode ('+(b&&b.notes.length)+' notes)',!!b&&b.notes.length===30&&b.notes.every(function(n){return n.data.length>1000&&n.onset>=0}));
  ck('smpKey maps the drills\\' instruments',smpKey('violin')==='violin'&&smpKey('chromatic')==='piano'&&smpKey('ukulele')==='ukulele'&&smpKey('guitar')==='guitar'&&smpKey('xyz')===null);
  var sr=44100, oc=new OfflineAudioContext(1,sr*3,sr); var n=smpPlay(oc,'violin',69,0.5,1.5,{}); ck('smpPlay returns a note when the bank is loaded',!!n);
  var buf=await oc.startRendering(), x=buf.getChannelData(0), c=[];
  for(var o=Math.round(1.0*sr);o+4096<=Math.round(1.9*sr);o+=735){var f=yin(x.subarray(o,o+4096),sr,300,700);if(f&&f.clarity>0.9)c.push(1200*Math.log2(f.freq/440))}
  c.sort(function(p,q){return p-q}); var med=c[c.length>>1];
  ck('a played A4 is in tune in the browser ('+(med==null?'no pitch':med.toFixed(1)+' cents')+')',c.length>5&&Math.abs(med)<8);
  var pk=0,first=-1;for(var i=0;i<x.length;i++){var a=Math.abs(x[i]);if(a>pk)pk=a}for(i=0;i<x.length;i++)if(Math.abs(x[i])>0.08*pk){first=i/sr;break}
  ck('its sound starts on the beat ('+first.toFixed(3)+' s, asked 0.5)',Math.abs(first-0.5)<0.04);
  ck('smpPlay is silent-safe without a bank',smpPlay(oc,'ukulele',60,0,1,{})===null);
  // Hear scale uses the recordings
  stSet('scInst','violin'); settingsChanged(); await smpLoad('violin');
  var played=0, realPlay=smpPlay; smpPlay=function(){played++;return realPlay.apply(this,arguments)};
  var tl=planNow().tl; refPlay(tl,{delay:0.1,inst:'violin'}); await new Promise(function(ok){setTimeout(ok,700)}); refStop(); smpPlay=realPlay;
  ck('Hear scale plays the real violin (recordings used for '+played+' notes)',played>=1);
  var osc=0, realOsc=AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator=function(){osc++;return realOsc.apply(this,arguments)};
  refPlay(tl,{delay:0.1,inst:'ukulele'}); await new Promise(function(ok){setTimeout(ok,500)}); refStop(); AudioContext.prototype.createOscillator=realOsc;
  ck('without that bank Hear scale falls back to the plain tone ('+osc+' oscillators)',osc>=1);
  var rr=await Promise.all([smpLoad('guitar'),smpLoad('ukulele'),smpLoad('piano')]); ck('banks: '+JSON.stringify(SMP.failed)+' '+rr.map(function(b){return b&&b.notes.length}).join(','),true);
  ck('all four banks decode in the browser',['violin','guitar','ukulele','piano'].every(function(k){return smpBank(k)&&smpBank(k).notes.length>=10}));
}catch(e){ck('exception '+(e&&e.stack||e),false)}
done()})()</script>`;
let finish; const done = new Promise(r => (finish = r));
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), body = []; req.on('data', d => body.push(d)); req.on('end', () => {
    if (u.pathname === '/result') { res.end('ok'); return finish(Buffer.concat(body).toString()); }
    let p = path.join(root, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)); if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end(); }
    let data = fs.readFileSync(p); if (u.pathname === '/') data = Buffer.from(data.toString().replace('</body>', probe + '</body>'));
    res.setHeader('content-type', types[path.extname(p)] || 'application/octet-stream'); res.setHeader('cache-control', 'no-store'); res.end(data);
  });
});
srv.listen(0, '127.0.0.1', async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-')), br = spawn(exe, ['--headless=new', '--disable-gpu', '--user-data-dir=' + prof, '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--window-size=420,900', 'http://127.0.0.1:' + srv.address().port + '/'], { stdio: 'ignore' });
  const to = setTimeout(() => finish('FAIL timed out (no result from the browser)'), 90000), out = await done; clearTimeout(to);
  spawnSync('taskkill', ['/PID', String(br.pid), '/T', '/F'], { stdio: 'ignore' }); srv.close();
  out.split('|').forEach(l => console.log(l)); process.exit(/FAIL/.test(out) ? 1 : 0);
});
