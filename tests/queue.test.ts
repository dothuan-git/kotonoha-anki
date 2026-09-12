import { describe, expect, it } from 'vitest';

import { startOfNextStudyDay, startOfStudyDay } from '@/lib/fsrs/day';
import { buildQueue, type QueueCandidate } from '@/lib/fsrs/queue';

/** §4's queue order, with the caps and the same-word rule applied. */

function review(id: string, minutesOverdue: number, wordId = `w-${id}`): QueueCandidate {
  return { cardId: id, wordId, order: -minutesOverdue };
}

function fresh(id: string, createdOrder: number, wordId = `w-${id}`): QueueCandidate {
  return { cardId: id, wordId, order: createdOrder };
}

const NO_LIMIT = 1000;

describe('buildQueue', () => {
  it('puts the most overdue review first', () => {
    const queue = buildQueue({
      reviews: [review('a', 10), review('b', 600), review('c', 120)],
      news: [],
      reviewLimit: NO_LIMIT,
      newLimit: NO_LIMIT,
    });
    expect(queue.map((q) => q.cardId)).toEqual(['b', 'c', 'a']);
  });

  it('interleaves at most one new card per five reviews', () => {
    const reviews = Array.from({ length: 12 }, (_, i) => review(`r${i}`, 100 - i));
    const news = Array.from({ length: 4 }, (_, i) => fresh(`n${i}`, i));

    const queue = buildQueue({ reviews, news, reviewLimit: NO_LIMIT, newLimit: NO_LIMIT });
    const positions = queue.flatMap((q, i) => (q.isNew ? [i] : []));

    expect(positions).toEqual([5, 11, 14, 15]);
    // The first two land after five reviews each; the rest follow once the
    // reviews run out, rather than being held back forever.
    expect(queue.filter((q) => q.isNew)).toHaveLength(4);
  });

  it('runs new cards consecutively when there is nothing to interleave them among', () => {
    const news = Array.from({ length: 3 }, (_, i) => fresh(`n${i}`, i));
    const queue = buildQueue({ reviews: [], news, reviewLimit: NO_LIMIT, newLimit: NO_LIMIT });
    expect(queue.map((q) => q.cardId)).toEqual(['n0', 'n1', 'n2']);
  });

  it('introduces new cards oldest first', () => {
    const queue = buildQueue({
      reviews: [],
      news: [fresh('b', 200), fresh('a', 100), fresh('c', 300)],
      reviewLimit: NO_LIMIT,
      newLimit: NO_LIMIT,
    });
    expect(queue.map((q) => q.cardId)).toEqual(['a', 'b', 'c']);
  });

  it('applies each cap independently', () => {
    const reviews = Array.from({ length: 20 }, (_, i) => review(`r${i}`, 100 - i));
    const news = Array.from({ length: 20 }, (_, i) => fresh(`n${i}`, i));

    const queue = buildQueue({ reviews, news, reviewLimit: 7, newLimit: 2 });
    expect(queue.filter((q) => !q.isNew)).toHaveLength(7);
    expect(queue.filter((q) => q.isNew)).toHaveLength(2);
  });

  it('yields nothing once a cap is spent', () => {
    const queue = buildQueue({
      reviews: [review('r0', 10)],
      news: [fresh('n0', 1)],
      reviewLimit: 0,
      newLimit: 0,
    });
    expect(queue).toEqual([]);
  });

  /** §4: never show two cards from the same word in one session. */
  it('never shows two cards from the same word', () => {
    const queue = buildQueue({
      reviews: [review('recognition', 50, 'word-1')],
      news: [fresh('production', 1, 'word-1'), fresh('other', 2, 'word-2')],
      reviewLimit: NO_LIMIT,
      newLimit: NO_LIMIT,
    });
    expect(queue.map((q) => q.cardId)).toEqual(['recognition', 'other']);
  });

  it('lets the due card win that collision, not the unseen one', () => {
    const queue = buildQueue({
      reviews: [review('due', 5, 'word-1')],
      news: [fresh('unseen', 1, 'word-1')],
      reviewLimit: NO_LIMIT,
      newLimit: NO_LIMIT,
    });
    expect(queue).toEqual([{ cardId: 'due', wordId: 'word-1', isNew: false }]);
  });

  it('orders deterministically when two cards are equally overdue', () => {
    const tie = [review('b', 30), review('a', 30)];
    expect(buildQueue({ reviews: tie, news: [], reviewLimit: NO_LIMIT, newLimit: NO_LIMIT })).toEqual(
      buildQueue({
        reviews: [...tie].reverse(),
        news: [],
        reviewLimit: NO_LIMIT,
        newLimit: NO_LIMIT,
      }),
    );
  });
});

/** The 04:00 rollover the caps are counted against. */
describe('startOfStudyDay', () => {
  it('keeps a session that ran past midnight on the day it began', () => {
    // 03:30 on the 12th, Asia/Ho_Chi_Minh (UTC+7) — still the 11th's session.
    const lateNight = new Date('2026-09-11T20:30:00Z');
    expect(startOfStudyDay(lateNight).toISOString()).toBe('2026-09-10T21:00:00.000Z');
  });

  it('rolls over at 04:00 local', () => {
    const fourAm = new Date('2026-09-11T21:00:00Z');
    expect(startOfStudyDay(fourAm).toISOString()).toBe('2026-09-11T21:00:00.000Z');
  });

  it('holds all day once it has rolled over', () => {
    const morning = new Date('2026-09-12T02:00:00Z'); // 09:00 local
    const evening = new Date('2026-09-12T15:00:00Z'); // 22:00 local
    expect(startOfStudyDay(morning).getTime()).toBe(startOfStudyDay(evening).getTime());
  });

  it('puts the next rollover exactly one day later', () => {
    const now = new Date('2026-09-12T02:00:00Z');
    const gap = startOfNextStudyDay(now).getTime() - startOfStudyDay(now).getTime();
    expect(gap).toBe(24 * 60 * 60 * 1000);
  });
});
