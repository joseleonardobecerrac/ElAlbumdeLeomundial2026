// ═══════════════════════════════════════════════════════════
// SERVICE WORKER — Álbum Mundial 2026
// Estrategia: Cache First para assets, Network First para datos
// ═══════════════════════════════════════════════════════════

// Firebase Messaging en el SW (para notificaciones push en background)
// Se importa condicionalmente para no romper si no está configurado
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
} catch(e) {
  console.warn('[SW] Firebase Messaging no disponible:', e.message);
}

const SW_VERSION   = 'v1.1.0';
const CACHE_STATIC = `album26-static-${SW_VERSION}`;
const CACHE_IMAGES = `album26-images-${SW_VERSION}`;
const CACHE_FONTS  = `album26-fonts-${SW_VERSION}`;

// ── Firebase Messaging Background Handler ────────────────
// Se inicializa solo si Firebase está disponible en el SW
let _messaging = null;
try {
  if (typeof firebase !== 'undefined') {
    firebase.initializeApp({
      apiKey: "AIzaSyAHhIXlurMt4UIML3E2Ku8_cr8Uht9e8yc",
      authDomain: "algum-mundial-2026.firebaseapp.com",
      projectId: "algum-mundial-2026",
      storageBucket: "algum-mundial-2026.firebasestorage.app",
      messagingSenderId: "905949505139",
      appId: "1:905949505139:web:25a1b183edeaa72edb2c06",
    });
    _messaging = firebase.messaging();

    // Manejar mensajes en background (app cerrada o en otra pestaña)
    _messaging.onBackgroundMessage(payload => {
      console.log('[SW] FCM background message:', payload);
      const { notification, data } = payload;
      const title = notification?.title || '📦 Álbum Mundial 2026';
      const options = {
        body: notification?.body || '¡Tienes contenido nuevo!',
        icon: '/icon-192.png',
        badge: '/icon-96.png',
        tag: data?.type || 'album26',
        renotify: true,
        data: { url: data?.url || '/' },
        actions: [
          { action: 'open', title: '📦 Abrir' },
          { action: 'dismiss', title: 'Luego' },
        ],
      };
      return self.registration.showNotification(title, options);
    });
  }
} catch(e) {
  console.warn('[SW] Error inicializando Firebase Messaging:', e.message);
}

// Assets que se pre-cachean en la instalación (shell de la app)
const STATIC_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/firebase.js',
  './js/theme.js',
  './js/chatbot.js',
  './js/search.js',
  './js/data.js',
  './js/state.js',
  './js/scorers.js',
  './js/gamedata.js',
  './js/app.js',
  './js/worldmap.js',
  './js/ranking.js',
  './js/limited.js',
  './js/favorite.js',
  './js/animated-stickers.js',
  './manifest.json',
  './offline.html',
  './icon-96.png',
  './icon-192.png',
  './icon-512.png',
];

// Dominios que van a la caché de imágenes (banderas, fotos)
const IMAGE_HOSTS = ['flagcdn.com', 'lh3.googleusercontent.com'];

// Dominios que siempre van a red (Firebase, Anthropic API)
const NETWORK_ONLY = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebase.googleapis.com',
  'api.anthropic.com',
  'fonts.googleapis.com',  // solo el CSS de fonts va a red para frescura
];

// ── INSTALL ───────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing', SW_VERSION);
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        console.log('[SW] Pre-caching app shell');
        return cache.addAll(STATIC_SHELL);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pre-cache error (some files may not exist yet):', err))
  );
});

// ── ACTIVATE ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating', SW_VERSION);
  event.waitUntil(
    Promise.all([
      // Delete old caches from previous versions
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(k => k.startsWith('album26-') && ![CACHE_STATIC, CACHE_IMAGES, CACHE_FONTS].includes(k))
            .map(k => {
              console.log('[SW] Deleting old cache:', k);
              return caches.delete(k);
            })
        )
      ),
      // Take control of all clients immediately
      self.clients.claim(),
    ])
  );
});

// ── FETCH ─────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Skip non-GET requests
  if(request.method !== 'GET') return;

  // 2. Skip chrome-extension and other non-http schemes
  if(!url.protocol.startsWith('http')) return;

  // 3. Network-only: Firebase, Anthropic, etc.
  if(NETWORK_ONLY.some(host => url.hostname.includes(host))) {
    event.respondWith(fetch(request));
    return;
  }

  // 4. Google Fonts woff2 — Cache First, long TTL
  if(url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, CACHE_FONTS));
    return;
  }

  // 5. Flag images (flagcdn.com) — Cache First, 7 days
  if(IMAGE_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(cacheFirst(request, CACHE_IMAGES));
    return;
  }

  // 6. Player images from assets/players/ — Cache First
  if(url.pathname.startsWith('/assets/players/')) {
    event.respondWith(cacheFirst(request, CACHE_IMAGES));
    return;
  }

  // 7. App shell (HTML, CSS, JS) — Stale While Revalidate
  if(
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(staleWhileRevalidate(request, CACHE_STATIC));
    return;
  }

  // 8. Everything else — Network First with cache fallback
  event.respondWith(networkFirst(request, CACHE_STATIC));
});

// ── CACHE STRATEGIES ──────────────────────────────────────

// Cache First: serve from cache, fetch and update if missing
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if(cached) return cached;
  try {
    const response = await fetch(request);
    if(response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 408, statusText: 'Offline' });
  }
}

// Stale While Revalidate: serve cache immediately, update in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then(response => {
    if(response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || await networkFetch || offlineFallback(request);
}

// Network First: try network, fall back to cache
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if(response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

// Offline fallback page
function offlineFallback(request) {
  if(request.destination === 'document') {
    return caches.match('./offline.html') || caches.match('./index.html');
  }
  return new Response(JSON.stringify({ offline: true, error: 'Sin conexión a internet' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

// ── BACKGROUND SYNC ───────────────────────────────────────
self.addEventListener('sync', event => {
  if(event.tag === 'album-sync') {
    console.log('[SW] Background sync: album-sync');
    event.waitUntil(syncAlbumData());
  }
});

async function syncAlbumData() {
  // Background sync is handled by Firebase SDK's own offline persistence
  // This is a hook for future custom sync logic
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'SYNC_COMPLETE' }));
}

// ── PUSH NOTIFICATIONS ────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  const title = data.title || '📦 Álbum Mundial 2026';
  const options = {
    body: data.body || '¡Tu sobre diario está listo!',
    icon: '/icon-192.png',
    badge: '/icon-96.png',
    tag: data.tag || 'album26',
    renotify: true,
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: '📦 Abrir sobre' },
      { action: 'dismiss', title: 'Luego' },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if(event.action === 'dismiss') return;
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});

// ── MESSAGE HANDLER ───────────────────────────────────────
self.addEventListener('message', event => {
  if(event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if(event.data?.type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: SW_VERSION });
  }
  if(event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('album26-')).map(k => caches.delete(k)))
    ).then(() => event.source?.postMessage({ type: 'CACHE_CLEARED' }));
  }
});

console.log('[SW] Script loaded', SW_VERSION);
