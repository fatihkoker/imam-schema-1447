// ══════════════════════════════════════════════════════════════
//  Tarawih Schema — Service Worker  (Nivå 2+3)
//  v2 — bumpad för att tvinga uppdatering av gammal SW
// ══════════════════════════════════════════════════════════════

const AUDIO_CACHE = 'tarawih-audio-v1'; // Behåll audio-cache vid uppdatering
const SHELL_CACHE = 'tarawih-shell-v2'; // Bumpad → gammal shell rensas

const SHELL_ASSETS = [
  './',
  './index.html',
  './favicon.ico',
];

// ── INSTALL: cache app-skalet direkt ──────────────────────────
self.addEventListener('install', event => {
  // skipWaiting → ny SW tar över direkt utan att vänta på att gamla flikar stängs
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      // Cacha index.html med {cache: 'reload'} för att kringgå HTTP-cache
      Promise.all(
        SHELL_ASSETS.map(url =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      )
    )
  );
});

// ── ACTIVATE: rensa gamla shell-caches, behåll audio ──────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== AUDIO_CACHE && k !== SHELL_CACHE)
          .map(k => {
            console.log('[SW] Rensar gammal cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim()) // Ta över alla öppna flikar direkt
  );
});

// ── FETCH: routing-strategi ────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. MP3-filer → Cache-first (offline-stöd för nedladdade nätter)
  if (url.pathname.endsWith('.mp3')) {
    event.respondWith(audioCacheFirst(event.request));
    return;
  }

  // 2. Navigering (HTML) → Cache-first med network-fallback
  //    Viktigt: offline måste HTML servas från cache, inte failas
  if (event.request.mode === 'navigate') {
    event.respondWith(shellCacheFirst(event.request));
    return;
  }

  // 3. Statiska tillgångar (ico, png, fonts) → Stale-while-revalidate
  if (
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.png') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdnfonts.com') ||
    url.hostname.includes('googletagmanager.com')
  ) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // 4. Allt annat (HEAD-requests för ljud-check etc.) → passera igenom
});

// ── Cache-first för app-skal (HTML) ───────────────────────────
// Försöker nätverket, uppdaterar cache. Offline → cachat svar.
async function shellCacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) {
      cache.put(request, response.clone()); // Uppdatera cache i bakgrunden
    }
    return response;
  } catch {
    // Offline — returnera cachat svar
    const cached = await cache.match(request) || await cache.match('./index.html');
    if (cached) return cached;
    return new Response('<h1>Offline</h1><p>Öppna appen med internet en gång för att aktivera offline-läge.</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// ── Cache-first för audio ──────────────────────────────────────
async function audioCacheFirst(request) {
  const cache  = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Audio ej tillgängligt offline', { status: 503 });
  }
}

// ── Stale-while-revalidate för statiska tillgångar ─────────────
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await fetchPromise;
}

// ── Meddelanden från sidan ─────────────────────────────────────
self.addEventListener('message', async event => {
  const { type, url, datum } = event.data || {};

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
        event.source.postMessage({ type: 'CACHE_DONE', datum });
      } else {
        event.source.postMessage({ type: 'CACHE_ERROR', datum });
      }
    } catch {
      event.source.postMessage({ type: 'CACHE_ERROR', datum });
    }
  }

  if (type === 'CHECK_CACHED') {
    const cache  = await caches.open(AUDIO_CACHE);
    const exists = !!(await cache.match(url));
    event.source.postMessage({ type: 'CACHED_STATUS', datum, cached: exists });
  }

  if (type === 'CLEAR_AUDIO_CACHE') {
    await caches.delete(AUDIO_CACHE);
    event.source.postMessage({ type: 'CACHE_CLEARED' });
  }
});

// ── Skip waiting när sidan ber om det (från update-toast) ─────
// Obs: vi anv\u00e4nder redan self.skipWaiting() i install-event,
// s\u00e5 ny SW tar \u00f6ver automatiskt vid n\u00e4sta laddning.
// Inget extra beh\u00f6vs.
