/* ================================================================
   BiosecurStick – Service Worker (PWA)
   Stratégie : Cache-First pour assets statiques, Network-First pour API
   ================================================================ */

const CACHE_NAME = 'biosecurstick-v3';
const STATIC_CACHE = 'biosecurstick-static-v3';
const API_CACHE = 'biosecurstick-api-v3';

// Ressources à mettre en cache immédiatement lors de l'installation
// NOTE: chemins relatifs → fonctionne sur localhost ET sur Render (HTTPS)
const PRECACHE_URLS = [
  '/',
  '/static/css/styles.css',
  '/static/js/main.js',
  '/static/manifest.json',
  '/static/icons/icon-512.png',
];

// ── Installation ─────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installation en cours...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Certaines ressources n\'ont pas pu être mises en cache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activation ───────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation – nettoyage des anciens caches...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// ── Interception des requêtes ─────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore les extensions de navigateur et les requêtes non-HTTP
  if (!request.url.startsWith('http')) return;

  // Les endpoints API : Network-First
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Assets statiques : Cache-First
  if (
    url.pathname.startsWith('/static/') ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdn.jsdelivr.net'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Pages HTML : Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ── Stratégies de cache ───────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Ressource non disponible hors‑ligne.', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Hors‑ligne – données non disponibles.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// ── Notification push (optionnel) ─────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  self.registration.showNotification(data.title || 'BiosecurStick', {
    body: data.body || 'Nouvelle mise à jour disponible.',
    icon: '/static/icons/icon-512.png',
    badge: '/static/icons/icon-512.png',
  });
});
