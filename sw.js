// ══════════════════════════════════════════════════════════════
//  Tarawih Schema — Service Worker
//  v3 — stöd för array av URLs i CACHE_AUDIO
// ══════════════════════════════════════════════════════════════

const AUDIO_CACHE = 'tarawih-audio-v1';
const SHELL_CACHE = 'tarawih-shell-v3'; // Bumpad

const SHELL_ASSETS = ['./', './index.html', './favicon.ico'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      Promise.all(
        SHELL_ASSETS.map(url =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      )
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== AUDIO_CACHE && k !== SHELL_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.endsWith('.mp3')) {
    event.respondWith(audioCacheFirst(event.request));
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(shellCacheFirst(event.request));
    return;
  }
  if (
    url.pathname.endsWith('.css') || url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.ico') || url.pathname.endsWith('.png') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdnfonts.com') ||
    url.hostname.includes('googletagmanager.com')
  ) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
});

async function shellCacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request) || await cache.match('./index.html');
    if (cached) return cached;
    return new Response('<h1>Offline</h1>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

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
  const { type, url, urls, datum } = event.data || {};

  // CACHE_AUDIO — tar emot en enskild url ELLER en array av urls
  if (type === 'CACHE_AUDIO') {
    const toCache = urls || (url ? [url] : []);
    if (!toCache.length) { event.source.postMessage({ type: 'CACHE_ERROR', datum }); return; }

    try {
      const cache = await caches.open(AUDIO_CACHE);
      const mainUrl = toCache[0]; // Tarawih — obligatorisk

      // Kolla om tarawih redan finns
      const existing = await cache.match(mainUrl);

      // Cacha alla URLs sekventiellt
      for (const u of toCache) {
        const alreadyCached = await cache.match(u);
        if (alreadyCached) continue;
        try {
          const response = await fetch(u);
          if (response.ok) await cache.put(u, response);
          else if (u === mainUrl) {
            // Tarawih misslyckades — rapportera fel
            event.source.postMessage({ type: 'CACHE_ERROR', datum });
            return;
          }
          // Isha-fel ignoreras tyst
        } catch (e) {
          if (u === mainUrl) {
            event.source.postMessage({ type: 'CACHE_ERROR', datum });
            return;
          }
        }
      }

      event.source.postMessage({ type: 'CACHE_DONE', datum, cached: !!existing });
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

// ── Push-notiser (Firebase Cloud Messaging) ───────────────────
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { notification: { title: '🎙️ Nytt Tarawih-ljud!', body: 'En ny recitation har laddats upp.' } }; }

  const title   = data.notification?.title || '🎙️ Nytt Tarawih-ljud!';
  const options = {
    body:    data.notification?.body || 'En ny recitation har laddats upp.',
    icon:    './favicon.ico',
    badge:   './favicon.ico',
    tag:     'new-audio',
    renotify: true,
    data:    { url: data.data?.url || self.registration.scope },
    actions: [{ action: 'open', title: 'Öppna appen' }],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Klick på push-notis — öppna appen
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
