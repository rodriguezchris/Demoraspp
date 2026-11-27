const cacheName = 'bitacora-muelle-15';
const assetNames = ['./', './index.html', './styles.css', './app.js', './model.js', './almejazos.js', './report.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './intertek.png', './intertek-nuevo.webp'];
const urls = new Set(assetNames.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assetNames.map(path => new Request(path, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('bitacora-muelle-') && key !== cacheName).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    const offlinePage = () => caches.match(new URL('./index.html', self.registration.scope));
    event.respondWith(fetch(request).then(async response => {
      if (response.status < 500) return response;
      return await offlinePage() ?? response;
    }).catch(offlinePage));
    return;
  }
  if (urls.has(request.url)) {
    event.respondWith(caches.match(request).then(response => response || fetch(request)));
  }
});
