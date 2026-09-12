import { clearSession } from '@/lib/client/session';

/**
 * What signing out takes with it, and what it deliberately leaves behind.
 *
 * Goes: the day's stored queue, and the service worker's cached documents.
 * Both are renderings of someone's vocabulary, and leaving them on disk after
 * a sign-out means the next person to open the app — or the next tab, before
 * the sign-in wall catches it — sees the last session's cards.
 *
 * Stays: the outbox. It holds ratings that have happened and have not reached
 * the server, and clearing it would destroy exactly what §8 exists to protect.
 * It survives the sign-out and flushes on the next sign-in. §10 admits one
 * address, so those rows can only ever belong to the person signing back in.
 */
export async function forgetLocalData(): Promise<void> {
  await clearSession();

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.active?.postMessage('clear-pages');
  } catch (error) {
    console.error('[forget] could not reach the service worker', error);
  }
}
