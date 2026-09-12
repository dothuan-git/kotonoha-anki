'use client';

import { useEffect } from 'react';

/**
 * Registers §8's service worker, and only in production.
 *
 * In development it does the opposite and tears down anything already
 * registered. A worker caching hashed dev chunks that are rebuilt on every
 * keystroke does not produce a faster dev server; it produces an afternoon
 * spent wondering why an edit did nothing.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.map((r) => r.unregister()));
      return;
    }

    // After load: registration competes with the page's own requests for
    // bandwidth, and the first paint matters more than the second visit.
    const register = () => {
      void navigator.serviceWorker.register('/sw.js').catch((error) => {
        // Nothing here is load-bearing while there is a connection, and the
        // reviewer works without it. Offline is what is lost.
        console.error('[sw] registration failed', error);
      });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
