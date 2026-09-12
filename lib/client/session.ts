import { SESSION_KEY, openLocalDb, type StoredSession } from '@/lib/client/db';
import { startOfStudyDay } from '@/lib/fsrs/day';
import type { SessionView } from '@/lib/types';

/**
 * §8's prefetched queue.
 *
 * The day's cards, words and sentences are already in the payload the server
 * rendered `/` with, so "prefetch" here means "keep what arrived". Writing it
 * to IndexedDB on mount is what lets the reviewer open in airplane mode: the
 * service worker serves the shell from cache, and the queue comes from here.
 *
 * It is re-saved after every rating, so what is stored is always what is left
 * to do rather than what the day started as. Close the tab on the train, open
 * it again two stations later, and the session is where you left it.
 */

/**
 * How stale a server payload may be and still be believed.
 *
 * A document served from the service worker's cache carries whatever session
 * was rendered the last time there was signal — possibly this morning's, long
 * since reviewed. The timestamp is the only thing that distinguishes it from
 * a live render, so it is what decides.
 */
export const STALE_PAYLOAD_MS = 2 * 60_000;

export async function saveSession(session: SessionView, now = new Date()): Promise<void> {
  const db = openLocalDb();
  if (!db) return;
  try {
    const stored: StoredSession = {
      dayStart: startOfStudyDay(now).toISOString(),
      savedAt: now.getTime(),
      session,
    };
    await (await db).put('session', stored, SESSION_KEY);
  } catch (error) {
    console.error('[session] could not save', error);
  }
}

/** The stored queue, if it belongs to the study day that is running now (§4). */
export async function loadSession(now = new Date()): Promise<SessionView | null> {
  const db = openLocalDb();
  if (!db) return null;
  try {
    const stored = await (await db).get('session', SESSION_KEY);
    if (!stored) return null;
    if (stored.dayStart !== startOfStudyDay(now).toISOString()) return null;
    return stored.session;
  } catch (error) {
    console.error('[session] could not read', error);
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const db = openLocalDb();
  if (!db) return;
  try {
    await (await db).delete('session', SESSION_KEY);
  } catch (error) {
    console.error('[session] could not clear', error);
  }
}

export type SessionSource = 'server' | 'resumed';

/**
 * Which queue the session should open with.
 *
 * Pure, and separate from the storage above, because it is the part that is
 * easy to get subtly wrong. The rule §8 states is "server always wins", and
 * the two exceptions are both cases where the thing that arrived is not
 * actually the server's current view:
 *
 * - **Ratings are still in the outbox.** The server has not seen them, so its
 *   queue still contains cards that have been reviewed. Resuming is not
 *   preferring the client — it is declining to believe a view that is known to
 *   be behind.
 * - **The payload is stale.** A document served from the service worker cache
 *   carries an old render. Believing it would replay a session that was
 *   finished hours ago.
 *
 * Anything else takes the server's queue, including the ordinary case of
 * opening the app with a stored session from earlier in the day and nothing
 * pending — that session was synced, and the server's view already reflects it.
 */
export function chooseSession(input: {
  server: SessionView;
  stored: SessionView | null;
  pendingCount: number;
  online: boolean;
  now: Date;
}): { session: SessionView; source: SessionSource } {
  const { server, stored } = input;
  if (!stored) return { session: server, source: 'server' };

  const stale = input.now.getTime() - Date.parse(server.now) > STALE_PAYLOAD_MS;
  if (input.pendingCount > 0 || stale || !input.online) {
    return { session: stored, source: 'resumed' };
  }
  return { session: server, source: 'server' };
}
