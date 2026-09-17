import { describe, expect, it } from 'vitest';

import { startOfNextStudyDay, startOfStudyDay } from '@/lib/fsrs/day';
import {
  MIN_REPEAT_GAP,
  MIN_SIBLING_GAP,
  SHOWING_SECONDS,
  buildQueue,
  expandFaces,
  repeatSlot,
  sessionSlots,
  type QueueCandidate,
  type QueueEntry,
} from '@/lib/fsrs/queue';

/** The queue order, with the session budget and the same-word rule applied. */

function review(id: string, minutesOverdue: number, wordId = `w-${id}`): QueueCandidate {
  return { cardId: id, wordId, order: -minutesOverdue };
}

function fresh(id: string, createdOrder: number, wordId = `w-${id}`): QueueCandidate {
  return { cardId: id, wordId, order: createdOrder };
}

const NO_LIMIT = 1000;

/** `buildQueue` with the streams a case does not care about left empty. */
function build(input: {
  learning?: readonly QueueCandidate[];
  reviews?: readonly QueueCandidate[];
  news?: readonly QueueCandidate[];
  cap?: number;
}): QueueEntry[] {
  return buildQueue({
    learning: input.learning ?? [],
    reviews: input.reviews ?? [],
    news: input.news ?? [],
    cap: input.cap ?? NO_LIMIT,
  });
}

/** How one session's budget is split, with no rows involved. */
describe('sessionSlots', () => {
  const slots = (dueReviews: number, newCards: number, learning = 0, cap = 50) =>
    sessionSlots({ dueReviews, newCards, learning, cap });

  it('gives a fresh collection the whole session', () => {
    // Nothing is due, so the reserve does not cap what new words may take.
    expect(slots(0, 100)).toEqual({ reviews: 0, news: 50 });
  });

  it('holds a fifth back for new words', () => {
    expect(slots(80, 100)).toEqual({ reviews: 40, news: 10 });
  });

  it('gives unfilled review slots to new words', () => {
    expect(slots(20, 100)).toEqual({ reviews: 20, news: 30 });
  });

  it('never burns a reserve larger than the new words waiting', () => {
    expect(slots(80, 0)).toEqual({ reviews: 50, news: 0 });
    expect(slots(80, 3)).toEqual({ reviews: 47, news: 3 });
  });

  it('stops introducing new words once two sessions behind', () => {
    // 100 due at a cap of 50 is exactly the threshold, and is not yet behind.
    expect(slots(99, 100)).toEqual({ reviews: 40, news: 10 });
    expect(slots(100, 100)).toEqual({ reviews: 40, news: 10 });
    expect(slots(101, 100)).toEqual({ reviews: 50, news: 0 });
  });

  it('lets learning cards displace the budget rather than add to it', () => {
    // Thirty free riders leave twenty slots, split as any twenty would be.
    expect(slots(80, 100, 30)).toEqual({ reviews: 16, news: 4 });
    // More learning cards than the cap leaves nothing for anything else.
    expect(slots(80, 100, 60)).toEqual({ reviews: 0, news: 0 });
  });

  it('deals nothing at a budget of zero', () => {
    expect(slots(80, 100, 0, 0)).toEqual({ reviews: 0, news: 0 });
  });

  it('still reserves a new slot at the smallest allowed budget', () => {
    // The floor `lib/actions/settings.ts` pins: below five, the reserve would
    // round to zero and new words would silently never appear. Ten due is the
    // most a cap of five can carry without the backlog brake firing.
    expect(slots(10, 100, 0, 5)).toEqual({ reviews: 4, news: 1 });
  });

  it('never deals more than the budget, whatever the mix', () => {
    for (const cap of [5, 13, 50, 200]) {
      for (const due of [0, 1, 7, 50, 500]) {
        for (const unseen of [0, 1, 7, 50, 500]) {
          for (const learning of [0, 3, 40]) {
            const s = sessionSlots({ dueReviews: due, newCards: unseen, learning, cap });
            expect(s.reviews + s.news + Math.min(learning, cap)).toBeLessThanOrEqual(cap);
            expect(s.reviews).toBeLessThanOrEqual(due);
            expect(s.news).toBeLessThanOrEqual(unseen);
            expect(s.reviews).toBeGreaterThanOrEqual(0);
            expect(s.news).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

describe('buildQueue', () => {
  it('puts the most overdue review first', () => {
    const queue = build({ reviews: [review('a', 10), review('b', 600), review('c', 120)] });
    expect(queue.map((q) => q.cardId)).toEqual(['b', 'c', 'a']);
  });

  it('interleaves at most one new card per five reviews', () => {
    const reviews = Array.from({ length: 12 }, (_, i) => review(`r${i}`, 100 - i));
    const news = Array.from({ length: 4 }, (_, i) => fresh(`n${i}`, i));

    const queue = build({ reviews, news });
    const positions = queue.flatMap((q, i) => (q.isNew ? [i] : []));

    expect(positions).toEqual([5, 11, 14, 15]);
    // The first two land after five reviews each; the rest follow once the
    // reviews run out, rather than being held back forever.
    expect(queue.filter((q) => q.isNew)).toHaveLength(4);
  });

  it('runs new cards consecutively when there is nothing to interleave them among', () => {
    const news = Array.from({ length: 3 }, (_, i) => fresh(`n${i}`, i));
    expect(build({ news }).map((q) => q.cardId)).toEqual(['n0', 'n1', 'n2']);
  });

  it('introduces new cards oldest first', () => {
    const queue = build({ news: [fresh('b', 200), fresh('a', 100), fresh('c', 300)] });
    expect(queue.map((q) => q.cardId)).toEqual(['a', 'b', 'c']);
  });

  it('splits one budget between the two streams', () => {
    const reviews = Array.from({ length: 20 }, (_, i) => review(`r${i}`, 100 - i));
    const news = Array.from({ length: 20 }, (_, i) => fresh(`n${i}`, i));

    const queue = build({ reviews, news, cap: 10 });
    expect(queue.filter((q) => !q.isNew)).toHaveLength(8);
    expect(queue.filter((q) => q.isNew)).toHaveLength(2);
    expect(queue).toHaveLength(10);
  });

  it('yields nothing once the budget is spent', () => {
    expect(build({ reviews: [review('r0', 10)], news: [fresh('n0', 1)], cap: 0 })).toEqual([]);
  });

  /** Never show two cards from the same word in one session. */
  it('never shows two cards from the same word', () => {
    const queue = build({
      reviews: [review('recognition', 50, 'word-1')],
      news: [fresh('production', 1, 'word-1'), fresh('other', 2, 'word-2')],
    });
    expect(queue.map((q) => q.cardId)).toEqual(['recognition', 'other']);
  });

  it('lets the due card win that collision, not the unseen one', () => {
    const queue = build({
      reviews: [review('due', 5, 'word-1')],
      news: [fresh('unseen', 1, 'word-1')],
    });
    expect(queue).toEqual([{ cardId: 'due', wordId: 'word-1', isNew: false }]);
  });

  it('lets a learning card win that collision over a merely due one', () => {
    const queue = build({
      learning: [review('stepping', 1, 'word-1')],
      reviews: [review('due', 500, 'word-1')],
    });
    expect(queue.map((q) => q.cardId)).toEqual(['stepping']);
  });

  it('orders deterministically when two cards are equally overdue', () => {
    const tie = [review('b', 30), review('a', 30)];
    expect(build({ reviews: tie })).toEqual(build({ reviews: [...tie].reverse() }));
  });
});

/**
 * Learning cards ride free in the sense that the budget cannot drop them — a
 * card mid-way through its steps is mid-thought. They still spend the budget,
 * so a session stays the length the setting promises.
 */
describe('buildQueue with learning cards', () => {
  it('deals them even when the budget is zero', () => {
    const queue = buildQueue({
      learning: [review('l0', 1), review('l1', 2)],
      reviews: [review('r0', 500)],
      news: [fresh('n0', 1)],
      cap: 0,
    });
    expect(queue.map((q) => q.cardId)).toEqual(['l1', 'l0']);
  });

  it('displaces the rest of the session rather than adding to it', () => {
    const learning = Array.from({ length: 10 }, (_, i) => review(`l${i}`, 1 + i));
    const reviews = Array.from({ length: 60 }, (_, i) => review(`r${i}`, 1000 - i));
    const news = Array.from({ length: 20 }, (_, i) => fresh(`n${i}`, i));

    const queue = buildQueue({ learning, reviews, news, cap: 50 });

    // Ten free riders, then a forty-slot budget split 32/8.
    expect(queue).toHaveLength(50);
    expect(queue.filter((q) => q.isNew)).toHaveLength(8);
  });

  it('keeps the merged review stream most-overdue-first', () => {
    const queue = buildQueue({
      learning: [review('soon', -5)],
      reviews: [review('ancient', 900), review('recent', 10)],
      news: [],
      cap: 50,
    });
    // The learning card is due five minutes out, so it sorts last.
    expect(queue.map((q) => q.cardId)).toEqual(['ancient', 'recent', 'soon']);
  });

  it('spaces new cards among free riders as it would among reviews', () => {
    const learning = Array.from({ length: 10 }, (_, i) => review(`l${i}`, 10 - i));
    const news = Array.from({ length: 2 }, (_, i) => fresh(`n${i}`, i));

    const queue = buildQueue({ learning, reviews: [], news, cap: 50 });
    expect(queue.flatMap((q, i) => (q.isNew ? [i] : []))).toEqual([5, 11]);
  });
});

/** The 04:00 rollover /stats buckets against, and the queue shuffle is seeded by. */
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
