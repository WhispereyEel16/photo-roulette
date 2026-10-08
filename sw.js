/* Photo Roulette v3: cache local app files, use network-first for navigation.
   Firebase handles LIVE data online; it is not included in this offline cache. */
const CACHE = 'photo-roulette-v3.0';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './firebase-config.js', './live-sync.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('photo-roulette-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => response.ok ? response : caches.match('./index.html')).catch(() => caches.match('./index.html')));
  } else if (['index.html','manifest.webmanifest','sw.js','firebase-config.js','live-sync.js'].some(name=>url.pathname.endsWith('/'+name))) {
    event.respondWith(fetch(event.request).then(response=>response.ok?response:caches.match(event.request)).catch(()=>caches.match(event.request)));
  } else {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
