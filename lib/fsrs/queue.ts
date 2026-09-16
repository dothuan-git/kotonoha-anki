import { NEW_PER_REVIEWS } from '@/lib/fsrs/params';
import type { Face } from '@/lib/types';

/** What the queue builder needs to know about a card. Nothing else. */
export interface QueueCandidate {
  cardId: string;
  wordId: string;
  /** Ordering key: `card_states.due` for reviews, the word's creation time for new cards. */
  order: number;
}

export interface QueueEntry {
  cardId: string;
  wordId: string;
  isNew: boolean;
}

/**
 * The queue order.
 *
 * Overdue reviews first, most overdue first; new cards interleaved at most one
 * per five reviews; never two cards from the same word in one session, with
 * the review card winning that collision because it is the one that is due.
 *
 * Once the reviews run out the remaining new cards follow consecutively — the
 * one-per-five rule spaces new cards *among* reviews, and on a fresh
 * collection there are no reviews to space them among.
 *
 * Pure: caps, dedupe and interleave are decided here, so the ordering is
 * testable without a database.
 */
export function buildQueue(input: {
  reviews: readonly QueueCandidate[];
  news: readonly QueueCandidate[];
  reviewLimit: number;
  newLimit: number;
}): QueueEntry[] {
  const seenWords = new Set<string>();
  const seenCards = new Set<string>();

  const take = (candidates: readonly QueueCandidate[], limit: number): QueueCandidate[] => {
    const out: QueueCandidate[] = [];
    for (const c of [...candidates].sort((a, b) => a.order - b.order || (a.cardId < b.cardId ? -1 : 1))) {
      if (out.length >= Math.max(0, limit)) break;
      if (seenWords.has(c.wordId) || seenCards.has(c.cardId)) continue;
      seenWords.add(c.wordId);
      seenCards.add(c.cardId);
      out.push(c);
    }
    return out;
  };

  // Reviews claim their words first: a due card outranks an unseen one.
  const reviews = take(input.reviews, input.reviewLimit);
  const news = take(input.news, input.newLimit);

  const queue: QueueEntry[] = [];
  let nextNew = 0;

  reviews.forEach((review, i) => {
    queue.push({ cardId: review.cardId, wordId: review.wordId, isNew: false });
    if ((i + 1) % NEW_PER_REVIEWS === 0 && nextNew < news.length) {
      const card = news[nextNew++]!;
      queue.push({ cardId: card.cardId, wordId: card.wordId, isNew: true });
    }
  });

  for (; nextNew < news.length; nextNew++) {
    const card = news[nextNew]!;
    queue.push({ cardId: card.cardId, wordId: card.wordId, isNew: true });
  }

  return queue;
}

/** One showing: a queued card, asked from one side. */
export interface QueueShowing extends QueueEntry {
  face: Face;
}

/**
 * How many other showings must sit between a word's two faces.
 *
 * Seeing 開ける and then "mở" back to back is not two questions, it is one
 * question and its answer. Three is enough to break the association without
 * making the gap so wide that a short session cannot satisfy it.
 */
export const MIN_SIBLING_GAP = 3;

/**
 * Every card, twice, shuffled — the day's queue as the reviewer sees it.
 *
 * Deliberately not the order `buildQueue` produced. That order was overdue
 * first with new cards paced one per five reviews, which is an order that
 * means something when each card appears once; doubled, it would show you a
 * word and its twin in lockstep down the whole session. So the showings are
 * shuffled outright, and the only structure kept is the gap between a word's
 * two faces.
 *
 * Dealt one slot at a time rather than shuffled and then repaired. Repairing a
 * shuffle means swapping a collision away and hoping the swap does not make
 * another one, which for a constraint this tight it often does; choosing only
 * from what is legal at each step cannot produce a collision it then has to
 * fix. Where nothing is legal — the last two showings of a one-word session —
 * it deals anyway. An answer given away at the end of a short session is a
 * smaller problem than a queue builder that cannot finish.
 *
 * Deterministic, seeded by the caller with the study day. The session is
 * stored and resumed, and a queue that reshuffled on every reload would put a
 * card you just answered back in front of you in a different position.
 */
export function expandFaces(queue: readonly QueueEntry[], seed: number): QueueShowing[] {
  const random = mulberry32(seed);
  const pool: QueueShowing[] = queue.flatMap((entry) => [
    { ...entry, face: 'word' as Face },
    { ...entry, face: 'meaning' as Face },
  ]);

  const out: QueueShowing[] = [];
  while (pool.length > 0) {
    const recent = new Set(out.slice(-MIN_SIBLING_GAP).map((s) => s.cardId));
    const remaining = new Map<string, number>();
    for (const showing of pool) {
      remaining.set(showing.cardId, (remaining.get(showing.cardId) ?? 0) + 1);
    }

    const eligible = pool.filter((s) => !recent.has(s.cardId));
    // Cards with both faces still to come go first. Dealt at random the other
    // way round, a card can end up holding both of its showings when only two
    // slots are left — and then they are adjacent no matter what is picked.
    // Spending the doubles early is what keeps the tail solvable.
    const doubles = eligible.filter((s) => remaining.get(s.cardId) === 2);
    const from = doubles.length > 0 ? doubles : eligible.length > 0 ? eligible : pool;

    const chosen = from[Math.floor(random() * from.length)]!;
    out.push(chosen);
    pool.splice(pool.indexOf(chosen), 1);
  }

  return out;
}

/**
 * A small seeded PRNG. `Math.random` would reshuffle the queue on every
 * rebuild, and the session is rebuilt whenever the page is.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How long one showing takes, near enough to turn a due time into a position.
 *
 * A rough constant on purpose. The alternative — measuring the session's own
 * pace and adapting — would make the same rating land in a different place
 * depending on how the last few cards went, which is a lot of machinery for a
 * queue position nobody can verify anyway.
 */
export const SHOWING_SECONDS = 20;

/** No repeat comes back closer than this, however short its step. */
export const MIN_REPEAT_GAP = 2;

/**
 * Where a card put back by a learning step goes in the queue.
 *
 * The step is a *time* — 1m, 6m, 10m — and the queue is a list, so the two
 * have to be reconciled by something. Standing the card back up two cards
 * later, which is what this used to do, honoured the list and ignored the
 * time: every step felt the same, and Hard on a card you had just seen put it
 * back in front of you before you had finished reading the next word.
 *
 * So the step is spent in showings instead: roughly as many other questions as
 * fit in the gap, and if the day is shorter than that, the end of the day.
 * Which is the honest answer — a 10m step at the end of a four-card session
 * cannot be served inside the session at all.
 *
 * `remaining` is the queue with the answered showing already dropped, so the
 * result is clamped to it: an index equal to its length appends.
 */
export function repeatSlot(dueInMs: number, remaining: number): number {
  const slots = Math.round(dueInMs / (SHOWING_SECONDS * 1000));
  return Math.min(Math.max(slots, MIN_REPEAT_GAP), Math.max(0, remaining));
}
