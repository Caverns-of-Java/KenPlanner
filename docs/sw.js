const CACHE_NAME = 'kenplanner-v5';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Never intercept API calls — always go to network
  if (event.request.url.includes('script.google.com')) {
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        const fresh = await fetch(event.request);

        // Keep an offline fallback copy for same-origin assets/documents.
        if (new URL(event.request.url).origin === self.location.origin) {
          cache.put(event.request, fresh.clone());
        }

        return fresh;
      } catch (error) {
        const cached = await cache.match(event.request);
        if (cached) {
          return cached;
        }
        throw error;
      }
    })()
  );
});
