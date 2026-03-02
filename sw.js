// ══════════════════════════════════════════════════════════════
//  Tarawih Schema — Service Worker  (Nivå 2+3)
//  Cache-first för MP3, Network-first för HTML/CSS/JS
// ══════════════════════════════════════════════════════════════

const CACHE_NAME    = 'tarawih-v1';
const AUDIO_CACHE   = 'tarawih-audio-v1';
const SHELL_CACHE   = 'tarawih-shell-v1';

// App-skal som alltid ska cachas vid installation
const SHELL_ASSETS = [
  './',
  './index.html',
  './favicon.ico',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600&family=Share+Tech+Mono&display=swap'
];

// ── INSTALL: cache app-skalet ──────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      cache.addAll(SHELL_ASSETS).catch(() => {}) // Tyst fel om font-URL misslyckas
    )
  );
});

// ── ACTIVATE: rensa gamla caches ──────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => ![CACHE_NAME, AUDIO_CACHE, SHELL_CACHE].includes(k))
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: routing-strategi ────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. MP3-filer → Cache-first (offline-stöd)
  if (url.pathname.endsWith('.mp3')) {
    event.respondWith(audioCacheFirst(event.request));
    return;
  }

  // 2. Navigering (HTML) → Network-first med cache-fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, SHELL_CACHE));
    return;
  }

  // 3. Statiska tillgångar → Stale-while-revalidate
  if (
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.png') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdnfonts.com')
  ) {
    event.respondWith(staleWhileRevalidate(event.request, SHELL_CACHE));
    return;
  }

  // 4. Allt annat → network
});

// ── Cache-first för audio ──────────────────────────────────────
async function audioCacheFirst(request) {
  const cache    = await caches.open(AUDIO_CACHE);
  const cached   = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()); // cache tyst
    }
    return response;
  } catch {
    return new Response('Audio ej tillgängligt offline', { status: 503 });
  }
}

// ── Network-first med fallback ─────────────────────────────────
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

// ── Stale-while-revalidate ─────────────────────────────────────
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await fetchPromise;
}

// ── Meddelanden från sidan ─────────────────────────────────────
self.addEventListener('message', async event => {
  const { type, url, datum } = event.data || {};

  // Nedladdningsförfrågan från sidan
  if (type === 'CACHE_AUDIO') {
    try {
      const cache    = await caches.open(AUDIO_CACHE);
      const existing = await cache.match(url);
      if (existing) {
        event.source.postMessage({ type: 'CACHE_DONE', datum, cached: true });
        return;
      }
      const response = await fetch(url);
      if (response.ok) {
        await cache.put(url, response);
        event.source.postMessage({ type: 'CACHE_DONE', datum, cached: false });
      } else {
        event.source.postMessage({ type: 'CACHE_ERROR', datum });
      }
    } catch {
      event.source.postMessage({ type: 'CACHE_ERROR', datum });
    }
  }

  // Kontrollera om en URL redan är cachad
  if (type === 'CHECK_CACHED') {
    const cache  = await caches.open(AUDIO_CACHE);
    const exists = !!(await cache.match(url));
    event.source.postMessage({ type: 'CACHED_STATUS', datum, cached: exists });
  }

  // Rensa audio-cache
  if (type === 'CLEAR_AUDIO_CACHE') {
    await caches.delete(AUDIO_CACHE);
    event.source.postMessage({ type: 'CACHE_CLEARED' });
  }
});
