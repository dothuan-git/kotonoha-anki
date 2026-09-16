import { describe, expect, it } from 'vitest';

import { startOfNextStudyDay, startOfStudyDay } from '@/lib/fsrs/day';
import {
  MIN_REPEAT_GAP,
  MIN_SIBLING_GAP,
  SHOWING_SECONDS,
  buildQueue,
  expandFaces,
  repeatSlot,
  type QueueCandidate,
  type QueueEntry,
} from '@/lib/fsrs/queue';

/** The queue order, with the caps and the same-word rule applied. */

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

  /** Never show two cards from the same word in one session. */
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

/**
 * The doubling. Ten words due is twenty showings, and the only structure the
 * shuffle has to respect is that a word's two faces do not sit together.
 */
describe('expandFaces', () => {
  const entries = (n: number): QueueEntry[] =>
    Array.from({ length: n }, (_, i) => ({
      cardId: `card-${i}`,
      wordId: `word-${i}`,
      isNew: false,
    }));

  it('asks every card from both sides', () => {
    const showings = expandFaces(entries(10), 1);
    expect(showings).toHaveLength(20);

    for (let i = 0; i < 10; i++) {
      const faces = showings.filter((s) => s.cardId === `card-${i}`).map((s) => s.face);
      expect(faces.sort()).toEqual(['meaning', 'word']);
    }
  });

  it('carries the queue entry through unchanged', () => {
    const [showing] = expandFaces([{ cardId: 'c', wordId: 'w', isNew: true }], 7);
    expect(showing).toMatchObject({ cardId: 'c', wordId: 'w', isNew: true });
  });

  /** Seeing 開ける and then "mở" is one question and its answer, not two. */
  it('keeps a word’s two faces apart, at every size and seed', () => {
    for (const words of [5, 8, 10, 12, 30, 60]) {
      for (let seed = 1; seed <= 40; seed++) {
        const showings = expandFaces(entries(words), seed);
        const at = new Map<string, number>();
        for (const [index, showing] of showings.entries()) {
          const previous = at.get(showing.cardId);
          if (previous !== undefined) {
            expect(index - previous).toBeGreaterThan(MIN_SIBLING_GAP);
          }
          at.set(showing.cardId, index);
        }
      }
    }
  });

  /**
   * Best effort, and this is the case where the effort fails: two showings
   * cannot be three apart. Adjacent beats hanging.
   */
  it('gives up rather than loops when the gap cannot exist', () => {
    const showings = expandFaces(entries(1), 3);
    expect(showings).toHaveLength(2);
    expect(showings.map((s) => s.face).sort()).toEqual(['meaning', 'word']);
  });

  /**
   * The session is stored and resumed. A queue that dealt itself again on
   * every reload would put a card you just answered back in front of you.
   */
  it('is deterministic for a seed', () => {
    const once = expandFaces(entries(8), 42);
    const twice = expandFaces(entries(8), 42);
    expect(once).toEqual(twice);
  });

  it('is not the same order for a different day', () => {
    const monday = expandFaces(entries(8), 42).map((s) => `${s.cardId}:${s.face}`);
    const tuesday = expandFaces(entries(8), 43).map((s) => `${s.cardId}:${s.face}`);
    expect(monday).not.toEqual(tuesday);
  });

  it('shuffles rather than dealing the queue in order', () => {
    const inOrder = entries(12).flatMap((e) => [`${e.cardId}:word`, `${e.cardId}:meaning`]);
    const shuffled = expandFaces(entries(12), 5).map((s) => `${s.cardId}:${s.face}`);
    expect(shuffled).not.toEqual(inOrder);
  });
});

describe('repeatSlot — a learning step spent in showings', () => {
  const minutes = (n: number) => n * 60_000;
  /** Long enough that nothing in here is clamped by the end of the day. */
  const LONG_DAY = 200;

  it('puts a longer step further back', () => {
    const again = repeatSlot(minutes(1), LONG_DAY);
    const hard = repeatSlot(minutes(6), LONG_DAY);
    const good = repeatSlot(minutes(10), LONG_DAY);

    expect(again).toBeLessThan(hard);
    expect(hard).toBeLessThan(good);
    // The point of the change: Hard is no longer two cards away.
    expect(hard).toBe(Math.round(minutes(6) / (SHOWING_SECONDS * 1000)));
  });

  it('keeps even the shortest step a couple of cards away', () => {
    expect(repeatSlot(0, LONG_DAY)).toBe(MIN_REPEAT_GAP);
    expect(repeatSlot(-minutes(5), LONG_DAY)).toBe(MIN_REPEAT_GAP);
  });

  it('falls back to the end of the day when the step outlasts it', () => {
    expect(repeatSlot(minutes(10), 4)).toBe(4);
    // An index equal to the length appends rather than dropping the card.
    expect(repeatSlot(minutes(10), 0)).toBe(0);
  });
});
