import { openLocalDb, type OutboxEntry } from '@/lib/client/db';
import {
  UNDO_WINDOW_MS,
  type PendingConfusion,
  type PendingReview,
  type SyncResult,
} from '@/lib/types';

/**
 * The offline outbox: ratings that have happened, waiting to reach the server.
 *
 * Every rating goes through here, online and off. There is no second path for
 * the connected case — that is the point. An offline review and an online one
 * are the same row taking the same route, so they cannot drift apart, and the
 * connected case is simply the one where the queue drains immediately.
 */

/** Nothing in flight, so a second flush would just re-POST the same batch. */
let inFlight: Promise<SyncResult | null> | null = null;

export async function enqueue(pending: PendingReview, queuedAt = Date.now()): Promise<void> {
  const db = openLocalDb();
  if (!db) return;
  try {
    await (await db).put('outbox', { ...pending, queuedAt });
  } catch (error) {
    // Nothing to fall back to, and nothing worth breaking the session over:
    // the rating is still on screen and still in the client's own state. It
    // will be lost if the tab closes before the next flush, which is the cost
    // of a browser that will not give us a store.
    console.error('[outbox] could not queue', error);
  }
}

/**
 * A wrong answer that might name another word, queued for the server
 * to resolve.
 *
 * Not held back for the undo window the way a rating is. Undo takes back a
 * *rating*; the attempt still happened, and the pair it might name is true
 * whether or not the grade was kept. It is also not worth failing anything
 * over — the miss itself is already in `review_logs`.
 */
export async function noteConfusion(entry: PendingConfusion): Promise<void> {
  const db = openLocalDb();
  if (!db) return;
  try {
    await (await db).put('confusions', entry);
  } catch (error) {
    console.error('[outbox] could not queue confusion', error);
  }
}

export async function pending(): Promise<OutboxEntry[]> {
  const db = openLocalDb();
  if (!db) return [];
  try {
    return await (await db).getAllFromIndex('outbox', 'by-reviewed-at');
  } catch (error) {
    console.error('[outbox] could not read', error);
    return [];
  }
}

export async function pendingCount(): Promise<number> {
  const db = openLocalDb();
  if (!db) return 0;
  try {
    return await (await db).count('outbox');
  } catch {
    return 0;
  }
}

/**
 * Take a rating back before it is sent — the point at which it costs nothing.
 *
 * Two callers. Undo, which is the obvious one. And the pair rule: when a
 * word's second face is graded worse than its first, the first rating is
 * pulled back and the worse one queued in its place, which works precisely
 * because `flush` held it while the twin was outstanding.
 *
 * Returns true if the row was still here — in which case nothing was ever
 * written, there is no log to delete, and `review_logs` keeps its append-only
 * property. Returns false once the entry has been flushed, and the caller has
 * to decide what to do about a review the server already holds.
 *
 * An undone review must never reach /api/sync at all — this is the guard
 * that makes that true.
 */
export async function takeBack(logId: string): Promise<boolean> {
  const db = openLocalDb();
  if (!db) return false;
  try {
    const handle = await db;
    const tx = handle.transaction('outbox', 'readwrite');
    const existing = await tx.store.get(logId);
    if (existing) await tx.store.delete(logId);
    await tx.done;
    return existing !== undefined;
  } catch (error) {
    console.error('[outbox] could not take back', error);
    return false;
  }
}

/**
 * POST what is ready to /api/sync and drop what the server took.
 *
 * Two reasons an entry is held back, and neither puts it at risk: it is
 * already durable in IndexedDB, and the next flush sends it.
 *
 * The first is the undo window. The toast is still up and the rating can still
 * be taken back, so not sending it means the common undo deletes a local row
 * instead of a committed one.
 *
 * The second is the pair. A word is asked twice in a session and graded once,
 * so while the other face is still somewhere in the queue this rating is not
 * final — its twin may come back worse and replace it. Held here, that
 * replacement is a local swap; sent, it would cost a deletion from a table
 * that only permits one. `hold` is the set of cards still to be asked.
 *
 * Returns null when there was nothing to do.
 */
export function flush(
  hold: ReadonlySet<string> = new Set(),
  now = Date.now(),
): Promise<SyncResult | null> {
  inFlight ??= run(hold, now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(hold: ReadonlySet<string>, now: number): Promise<SyncResult | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

  const all = await pending();
  const ready = all.filter(
    (entry) => now - entry.queuedAt >= UNDO_WINDOW_MS && !hold.has(entry.cardId),
  );
  const confusions = await pendingConfusions();
  if (ready.length === 0 && confusions.length === 0) return null;

  const reviews: PendingReview[] = ready.map(({ id, cardId, rating, reviewedAt }) => ({
    id,
    cardId,
    rating,
    reviewedAt,
  }));

  let result: SyncResult;
  try {
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reviews, confusions }),
    });
    // 401 included: signed out mid-session, so keep the batch and let the next
    // flush try once the session is back. Nothing here is lossy on a retry.
    if (!response.ok) return null;
    result = (await response.json()) as SyncResult;
  } catch {
    // Offline, or the request never completed. The outbox is unchanged.
    return null;
  }

  // Applied and permanently rejected both leave. A rejection that stayed would
  // be retried on every flush for the rest of the collection's life, and would
  // hold up every review queued behind it.
  await drop([...result.applied, ...result.rejected.map((r) => r.id)]);
  // The server has seen every confusion in the batch, whether it resolved to a
  // word or to nothing. Keeping the unresolved ones would mean re-asking the
  // same question of the same collection on every flush, forever.
  await dropConfusions(confusions.map((c) => c.id));
  return result;
}

async function pendingConfusions(): Promise<PendingConfusion[]> {
  const db = openLocalDb();
  if (!db) return [];
  try {
    return await (await db).getAll('confusions');
  } catch (error) {
    console.error('[outbox] could not read confusions', error);
    return [];
  }
}

async function dropConfusions(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = openLocalDb();
  if (!db) return;
  try {
    const handle = await db;
    const tx = handle.transaction('confusions', 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  } catch (error) {
    console.error('[outbox] could not drop synced confusions', error);
  }
}

async function drop(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = openLocalDb();
  if (!db) return;
  try {
    const handle = await db;
    const tx = handle.transaction('outbox', 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  } catch (error) {
    console.error('[outbox] could not drop synced entries', error);
  }
}
