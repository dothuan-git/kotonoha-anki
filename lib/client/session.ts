import { SESSION_KEY, openLocalDb, type GradedCard, type StoredSession } from '@/lib/client/db';
import { startOfStudyDay } from '@/lib/fsrs/day';
import type { SessionView } from '@/lib/types';

/**
 * The prefetched offline queue.
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

export async function saveSession(
  session: SessionView,
  graded: Record<string, GradedCard> = {},
  now = new Date(),
): Promise<void> {
  const db = openLocalDb();
  if (!db) return;
  try {
    const stored: StoredSession = {
      dayStart: startOfStudyDay(now).toISOString(),
      savedAt: now.getTime(),
      session,
      graded,
    };
    await (await db).put('session', stored, SESSION_KEY);
  } catch (error) {
    console.error('[session] could not save', error);
  }
}

/**
 * The stored queue and its half-graded words, if they belong to the study day
 * that is running now — and if they are still a session at all.
 *
 * The shape check is not paranoia about disk corruption. This store is written
 * by whatever build of the app ran last, and during development that can be a
 * build from ten minutes ago whose `SessionView` was a different shape; a dev
 * server compiles through type errors, so the type that guards every other
 * caller guards nothing here. Believing one of those takes the reviewer down
 * on load, which is the one thing the stored session must never do.
 *
 * Discarding it is cheap and already the designed answer to every other doubt
 * about this record: losing the stored queue costs a reload, not a review.
 */
export async function loadSession(
  now = new Date(),
): Promise<{ session: SessionView; graded: Record<string, GradedCard> } | null> {
  const db = openLocalDb();
  if (!db) return null;
  try {
    const stored = await (await db).get('session', SESSION_KEY);
    if (!stored) return null;
    if (stored.dayStart !== startOfStudyDay(now).toISOString()) return null;
    if (!isSessionView(stored.session)) {
      console.warn('[session] stored queue is not a session, discarding');
      await clearSession();
      return null;
    }
    return { session: stored.session, graded: stored.graded ?? {} };
  } catch (error) {
    console.error('[session] could not read', error);
    return null;
  }
}

/**
 * The fields the reviewer reads on its first render, before anything has had
 * a chance to check them. Deliberately shallow: this is a sanity check against
 * a session from another build, not a schema validator.
 */
export function isSessionView(value: unknown): value is SessionView {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SessionView>;
  return (
    Array.isArray(v.items) &&
    typeof v.now === 'string' &&
    typeof v.countedCards === 'object' &&
    v.countedCards !== null &&
    typeof v.limits === 'object' &&
    v.limits !== null &&
    typeof v.requestRetention === 'number'
  );
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
 * easy to get subtly wrong. The rule is "server always wins", and the two
 * exceptions are both cases where the thing that arrived is not
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
