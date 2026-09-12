'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the device thinks it has a connection.
 *
 * `navigator.onLine` is a weak signal — it says the interface is up, not that
 * anything is reachable — so nothing in §8 depends on it for correctness. The
 * outbox retries regardless and the sync response is the only thing believed.
 * This is here to tell the user why their ratings have not left yet, which is
 * exactly the sort of question a weak signal is good enough to answer.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
