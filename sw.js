// PanControl Service Worker v1.8
const CACHE_NAME = 'pancontrol-v1.8';

// Archivos a cachear para uso offline
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './doraemon-intro.gif',
  // CDN externos — se cachean en primer uso
];

// ── Instalación: cachear archivos core ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activación: limpiar caches viejos ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Network first, fallback a cache ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase y APIs externas: siempre red (no cachear)
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('google') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('fonts') ||
    url.hostname.includes('cdnjs')
  ) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('', { status: 503 }))
    );
    return;
  }

  // Archivos de la app: Network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Guardar copia en cache si la respuesta es válida
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Sin internet: servir desde cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Fallback final para navegación
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('', { status: 503 });
        });
      })
  );
});
