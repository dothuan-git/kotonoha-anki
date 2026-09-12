import { openLocalDb, type OutboxEntry } from '@/lib/client/db';
import { UNDO_WINDOW_MS, type PendingReview, type SyncResult } from '@/lib/types';

/**
 * §8's outbox: ratings that have happened, waiting to reach the server.
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
 * §5's undo, taken at the only point where it costs nothing.
 *
 * Returns true if the row was still here — in which case nothing was ever
 * written, there is no log to delete, and `review_logs` keeps the property §3
 * asks of it. Returns false once the entry has been flushed, and the caller
 * has to go to the server and spend the one deletion the table permits.
 *
 * The README's note for this phase asks for exactly this guard: an undone
 * review must never reach /api/sync at all.
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
 * Entries younger than §5's undo window are held back. The window is a client
 * concern — the toast is still up, the rating can still be taken back — and
 * not sending them means the common undo deletes a local row instead of a
 * committed one. An entry held back is not at risk: it is already durable in
 * IndexedDB, and the next flush sends it.
 *
 * Returns null when there was nothing to do.
 */
export function flush(now = Date.now()): Promise<SyncResult | null> {
  inFlight ??= run(now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(now: number): Promise<SyncResult | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

  const all = await pending();
  const ready = all.filter((entry) => now - entry.queuedAt >= UNDO_WINDOW_MS);
  if (ready.length === 0) return null;

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
      body: JSON.stringify({ reviews }),
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
  return result;
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
