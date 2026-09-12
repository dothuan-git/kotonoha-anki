/*
 * The service worker.
 *
 * Its job is narrow: make sure that opening the app with no signal produces
 * the reviewer rather than the browser's dinosaur. The queue itself is not
 * here — it is in IndexedDB, put there by the session on mount — so this only
 * has to serve the shell that runs it.
 *
 * API responses are never cached, and the same logic rules out one more
 * thing worth calling out explicitly: React's flight payloads. A cached
 * `?_rsc=` response is a session rendered at some past moment, and serving it
 * as though it were current would hand the reviewer cards that have already
 * been answered. Documents are cached — the reviewer has to open somehow —
 * but they carry a timestamp the client checks before believing them.
 *
 * Hand-written rather than generated. It is eighty lines, it never has to grow,
 * and a build step that emits a service worker is a build step that can emit a
 * wrong one.
 */

const VERSION = 'kotonoha-v1';
const SHELL = `${VERSION}-shell`;
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;

/** Everything needed to render the offline fallback with no network at all. */
const PRECACHE = ['/offline.html', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * The one message this worker takes. Signing out leaves cached documents for
 * an account that is no longer signed in; on a shared device that is a leak,
 * and on any device it is a stale page waiting to confuse someone.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'clear-pages') {
    event.waitUntil(caches.delete(PAGES));
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Fonts. Cached because the reviewer is unreadable without them: a card in
  // a fallback sans-serif is a different card.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Never cache API responses. /api/sync in particular must never be
  // answered from a cache — a replayed batch response would tell the client
  // its outbox had been accepted when it had not.
  if (url.pathname.startsWith('/api/')) return;

  // A flight payload is a render from a moment that has passed. Letting one
  // out of a cache would resurrect an answered session mid-navigation.
  if (url.searchParams.has('_rsc') || request.headers.get('RSC') === '1') return;

  // Hashed and immutable — the filename changes when the contents do.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(pageOrOffline(request));
    return;
  }

  event.respondWith(cacheFirst(request, ASSETS));
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type !== 'opaque') {
    const cache = await caches.open(cacheName);
    void cache.put(request, response.clone());
  }
  return response;
}

/**
 * Network first, because a document is the one thing that must be current when
 * it can be. The cached copy is the fallback, and the offline page is the
 * fallback's fallback.
 */
async function pageOrOffline(request) {
  try {
    const response = await fetch(request);
    // A redirect means the sign-in wall, or /api/share bouncing to /add.
    // Neither is a page worth remembering under this URL.
    if (response.ok && !response.redirected) {
      const cache = await caches.open(PAGES);
      void cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return (await caches.match('/offline.html')) ?? Response.error();
  }
}
