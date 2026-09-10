const CACHE_NAME = 'wmd-cache-v3';
const ASSETS = [
  '/',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/favicon.svg',
  '/favicon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API, streaming, remux, tunnel ve dinamik çağrıları asla cache'leme
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/stream') ||
    url.pathname.startsWith('/youtube-') ||
    url.pathname.startsWith('/tunnel') ||
    url.pathname.startsWith('/download') ||
    url.pathname.startsWith('/health') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // Network-First: Önce güncel sürümü ağdan al, ağ yoksa veya çevrimdışıysa cache'ten sun
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
