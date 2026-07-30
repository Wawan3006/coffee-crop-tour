// ============================================================================
// service-worker.js — enables full offline operation (app shell + assets).
// Cache-first strategy for static assets; app logic/data lives in IndexedDB
// via db.js, independent of network/service-worker cache.
// ============================================================================

const CACHE_NAME = 'coffee-crop-tour-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/utils.js',
  './js/db.js',
  './js/api.js',
  './js/auth.js',
  './js/geo.js',
  './js/charts.js',
  './js/map.js',
  './js/sync.js',
  './js/survey-form.js',
  './js/app.js',
  './js/data-seed.js',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        // runtime-cache same-origin assets for future offline use
        if (resp && resp.status === 200 && event.request.url.startsWith(self.location.origin)) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
