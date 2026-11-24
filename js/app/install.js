// Install-as-app button and service worker registration.

// Offline / installable: only works on https:// or localhost (silently skipped on file://).
// ----- install as an app (PWA) -----
(function () {
  let dip = null; const btn = document.getElementById('installBtn'), txt = document.getElementById('instText');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) txt.textContent = 'Installed. This is running as an app.';
  else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) txt.textContent = 'To install on iPhone or iPad: tap the Share button, then “Add to Home Screen”.';
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); dip = e; btn.classList.remove('hide'); });
  btn.onclick = async () => { if (!dip) return; dip.prompt(); try { await dip.userChoice; } catch {} dip = null; btn.classList.add('hide'); try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {} };
  window.addEventListener('appinstalled', () => { btn.classList.add('hide'); txt.textContent = 'Installed. Open it from your home screen or app list.'; });
})();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
