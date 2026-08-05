// ============================================================================
// service-worker.js — enables full offline operation (app shell + assets)
// AND Background synchronization (Step: "Background synchronization").
// Cache-first strategy for static assets; app logic/data lives in IndexedDB
// via db.js, independent of network/service-worker cache.
//
// Background Sync: when the page registers the 'cct-sync' tag (see
// js/sync.js registerBackgroundSync(), called from queueForSync() while
// offline), the browser/OS may wake this service worker later -- even if no
// app tab is open -- once connectivity returns. The service worker itself
// has no access to the page's IndexedDB data model, so it does the only
// thing it safely can: postMessage() every open client, asking the page (if
// any is open) to run Sync.syncAll(). If no client is open, the flush
// happens automatically the next time the app is opened and the page's own
// 'online' listener / 45s polling timer fires -- so no queued survey is
// ever silently dropped, this is purely a "sync sooner" optimization.
// ============================================================================

const CACHE_NAME = 'coffee-crop-tour-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/utils.js',
  './js/db.js',
  './js/local-store.js',
  './js/api.js',
  './js/auth.js',
  './js/geo.js',
  './js/charts.js',
  './js/map.js',
  './js/sync.js',
  './js/sync-center.js',
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

// ---- Background synchronization ----
self.addEventListener('sync', (event) => {
  if (event.tag === 'cct-sync') {
    event.waitUntil(notifyClientsToSync());
  }
});

async function notifyClientsToSync() {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clientList.forEach(client => client.postMessage({ type: 'CCT_BACKGROUND_SYNC' }));
  return clientList.length > 0;
}
