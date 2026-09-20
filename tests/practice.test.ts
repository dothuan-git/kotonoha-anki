import { describe, expect, it } from 'vitest';

import { practiceRecorder } from '@/lib/client/recorder';
import { practicePage } from '@/lib/practice';

/**
 * Where a practice session sits in the collection.
 *
 * Practice ignores due dates, so it walks the collection newest-first in
 * pages and wraps at the end. The boundaries are the whole of the risk here:
 * an empty collection, a collection shorter than one page, and a page number
 * from a stored session the collection has since outgrown.
 */
describe('practicePage', () => {
  it('splits a collection into pages of the session size', () => {
    expect(practicePage(0, 120, 50)).toEqual({ page: 0, pages: 3 });
    expect(practicePage(1, 120, 50)).toEqual({ page: 1, pages: 3 });
    expect(practicePage(2, 120, 50)).toEqual({ page: 2, pages: 3 });
  });

  /**
   * There is no end to reach. Finishing the oldest page starts again at the
   * newest, which by then has not been seen for several sessions.
   */
  it('wraps past the last page instead of running out', () => {
    expect(practicePage(3, 120, 50).page).toBe(0);
    expect(practicePage(4, 120, 50).page).toBe(1);
    expect(practicePage(7, 120, 50).page).toBe(1);
  });

  /** A stored page number from a collection that has since shrunk. */
  it('brings an out-of-range page back inside the collection', () => {
    expect(practicePage(99, 30, 50)).toEqual({ page: 0, pages: 1 });
    expect(practicePage(-1, 120, 50).page).toBe(2);
    expect(practicePage(-4, 120, 50).page).toBe(2);
  });

  /**
   * One page, always. A session of zero cards is a finish screen, and
   * "trang 1/0" is not a thing to render.
   */
  it('reports one page for a collection too small to fill one', () => {
    expect(practicePage(0, 0, 50)).toEqual({ page: 0, pages: 1 });
    expect(practicePage(0, 1, 50)).toEqual({ page: 0, pages: 1 });
    expect(practicePage(0, 50, 50)).toEqual({ page: 0, pages: 1 });
    expect(practicePage(0, 51, 50)).toEqual({ page: 0, pages: 2 });
  });

  it('survives a nonsense session size rather than dividing by zero', () => {
    expect(practicePage(0, 120, 0)).toEqual({ page: 0, pages: 120 });
    expect(practicePage(0, 120, -5)).toEqual({ page: 0, pages: 120 });
  });
});

/**
 * The one property the whole mode rests on.
 *
 * Practice must not touch the schedule, and the way that is enforced is that
 * every call which would leave the device is a no-op. If any of these ever
 * starts doing something, a drill silently reschedules the collection — so
 * they are pinned here rather than left to a reading of `ReviewScreen`.
 */
describe('practiceRecorder', () => {
  const entry = {
    id: '00000000-0000-4000-8000-000000000000',
    cardId: '00000000-0000-4000-8000-000000000001',
    rating: 1 as const,
    reviewedAt: '2026-09-20T00:00:00.000Z',
  };

  it('queues nothing, so no rating can reach review_logs', async () => {
    await expect(practiceRecorder.enqueue(entry, Date.now())).resolves.toBeUndefined();
    await expect(practiceRecorder.pendingCount()).resolves.toBe(0);
    await expect(practiceRecorder.pendingEntries()).resolves.toEqual([]);
  });

  /** Nothing was ever sent, so undo never has to ask the server. */
  it('always takes a rating back for free', async () => {
    await expect(practiceRecorder.takeBack(entry.id)).resolves.toBe(true);
  });

  it('never flushes and never records a confusion', async () => {
    await expect(practiceRecorder.flush()).resolves.toBeNull();
    await expect(
      practiceRecorder.noteConfusion({
        id: entry.id,
        cardId: entry.cardId,
        typed: 'あける',
        observedAt: entry.reviewedAt,
      }),
    ).resolves.toBeUndefined();
  });

  /** Unreachable — `takeBack` never returns false — but inert if reached. */
  it('refuses the server-side writes rather than making them', async () => {
    await expect(practiceRecorder.undoOnServer(entry.id)).resolves.toMatchObject({ ok: false });
    await expect(practiceRecorder.acknowledgeLeech(entry.cardId)).resolves.toMatchObject({
      ok: false,
    });
  });
});
