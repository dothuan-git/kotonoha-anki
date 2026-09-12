import { clearSession } from '@/lib/client/session';

/**
 * What signing out takes with it, and what it deliberately leaves behind.
 *
 * Goes: the day's stored queue, and the service worker's cached documents.
 * Both are renderings of someone's vocabulary, and leaving them on disk after
 * a sign-out means the next tab to open — before the sign-in wall catches it —
 * shows the last session's cards.
 *
 * Stays: the outbox. It holds ratings that have happened and have not reached
 * the server, and clearing it would destroy exactly what §8 exists to protect.
 * It survives the sign-out and flushes on the next sign-in. §10 admits one
 * address, so those rows can only ever belong to whoever signs back in.
 *
 * Both halves race the navigation that the sign-out action triggers, so
 * neither waits on anything it does not have to: the message goes straight to
 * the controlling worker rather than through `getRegistration`, and the
 * IndexedDB delete is left to the transaction the browser commits regardless.
 */
export function forgetLocalData(): void {
  void clearSession();

  if (typeof navigator === 'undefined') return;
  try {
    navigator.serviceWorker?.controller?.postMessage('clear-pages');
  } catch (error) {
    console.error('[forget] could not reach the service worker', error);
  }
}
