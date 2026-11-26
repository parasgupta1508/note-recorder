// Service worker: makes the app installable and usable offline.
// Bump CACHE whenever you change any file, so installed copies pick up the update.
const CACHE = 'tuner-v68';
const VENDOR = 'tuner-vendor-v1';   // the Detailed-analysis files live in their own cache, so a new app version does not delete them
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/lab.css',
  './css/scale.css',
  './js/core/pitch.js',
  './js/core/music.js',
  './js/core/instruments.js',
  './js/core/scales.js',
  './js/core/scoring.js',
  './js/core/evaluation.js',
  './js/core/history.js',
  './js/core/coach.js',
  './js/core/visual.js',
  './js/core/segmenter.js',
  './js/core/listening.js',
  './js/core/detailed.js',
  './js/core/midi.js',
  './js/core/musicxml.js',
  './js/core/piece.js',
  './js/core/library.js',
  './js/core/compare.js',
  './js/core/schema.js',
  './js/core/engines/registry.js',
  './js/core/engines/f0-yin.js',
  './js/core/engines/f0-swiftf0.js',
  './js/core/engines/f0-alt.js',
  './js/core/engines/segmenter-classic.js',
  './js/core/engines/transcriber-basicpitch.js',
  './js/core/engines/contract.js',
  './js/app/base.js',
  './js/app/engines/settings.js',
  './js/app/engines/basicpitch.js',
  './js/app/engines/lab-helper.js',
  './js/app/tuner.js',
  './js/app/practice.js',
  './js/app/analysis.js',
  './js/app/players.js',
  './js/app/metronome.js',
  './js/app/reference.js',
  './js/app/selftest.js',
  './js/app/settings-ui.js',
  './js/app/practice-engine.js',
  './js/app/scale-visual.js',
  './js/app/scale-history.js',
  './js/app/recorder.js',
  './js/app/chart.js',
  './js/app/audio.js',
  './js/app/profiles.js',
  './js/app/engines/ui.js',
  './js/app/library-db.js',
  './js/app/pieces.js',
  './js/app/piece-view.js',
  './js/app/lab.js',
  './js/app/main.js',
  './js/app/install.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== VENDOR).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first (so updates show up when online), falling back to the cache when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).pathname.includes('/vendor/')) {   // big, rarely changing: cache first, fill on first use
    e.respondWith(caches.open(VENDOR).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })   // revalidate with the server: the browser's own 10-minute cache must never mix old and new files
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
