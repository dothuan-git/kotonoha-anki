import { BACKLOG_SESSIONS, NEW_PER_REVIEWS, NEW_SHARE } from '@/lib/fsrs/params';
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

/** How a session's budget is split between the two streams that spend it. */
export interface SessionSlots {
  reviews: number;
  news: number;
}

/**
 * How many review and new cards one session may deal.
 *
 * Kept apart from `buildQueue` so the nav badge can ask the same question with
 * counts that the session answers with rows. The two used to compute this
 * separately, which is exactly the kind of duplication that drifts.
 *
 * Learning cards are dealt whatever the budget says — a card put back by a
 * step is mid-thought, and holding it to tomorrow would be absurd — but they
 * *displace* the budget rather than adding to it, so a session stays the
 * length the setting promises. Answer Quên on thirty words and the next
 * session is those thirty plus twenty others, not thirty plus fifty.
 */
export function sessionSlots(input: {
  dueReviews: number;
  newCards: number;
  learning: number;
  cap: number;
}): SessionSlots {
  const cap = Math.max(0, Math.trunc(input.cap));
  const budget = Math.max(0, cap - Math.min(input.learning, cap));

  // Measured against the setting rather than the budget left after learning
  // cards, so "two sessions behind" means the same thing on every session.
  const behind = input.dueReviews > BACKLOG_SESSIONS * cap;

  // `min(reserve, newCards)` so an unused reserve is never burned: with three
  // new words waiting, reviews get every slot but three.
  const held = behind ? 0 : Math.min(Math.round(budget * NEW_SHARE), input.newCards);

  const reviews = Math.min(input.dueReviews, budget - held);
  // Against `budget - reviews`, not `budget - held`: review slots that had no
  // reviews to fill them go to new words rather than evaporating.
  const news = Math.min(input.newCards, budget - reviews);

  return { reviews, news };
}

/**
 * The queue order.
 *
 * Learning cards first, then overdue reviews, most overdue first; new cards
 * interleaved at most one per five; never two cards from the same word in one
 * session, with the card that is further along winning that collision.
 *
 * Once the reviews run out the remaining new cards follow consecutively — the
 * one-per-five rule spaces new cards *among* reviews, and on a fresh
 * collection there are no reviews to space them among.
 *
 * Pure: the budget, dedupe and interleave are decided here, so the ordering is
 * testable without a database.
 */
export function buildQueue(input: {
  /** Put back by a learning step, inside the learn-ahead window. Always dealt. */
  learning: readonly QueueCandidate[];
  reviews: readonly QueueCandidate[];
  news: readonly QueueCandidate[];
  /** `settings.cardsPerSession`. */
  cap: number;
}): QueueEntry[] {
  const seenWords = new Set<string>();
  const seenCards = new Set<string>();

  const byOrder = (a: QueueCandidate, b: QueueCandidate) =>
    a.order - b.order || (a.cardId < b.cardId ? -1 : 1);

  // Deduped before the budget is split rather than while it is spent. The
  // slot arithmetic needs counts it can trust, and a candidate dropped for
  // sharing a word must not have cost a slot on the way out.
  const claim = (candidates: readonly QueueCandidate[]): QueueCandidate[] => {
    const out: QueueCandidate[] = [];
    for (const c of [...candidates].sort(byOrder)) {
      if (seenWords.has(c.wordId) || seenCards.has(c.cardId)) continue;
      seenWords.add(c.wordId);
      seenCards.add(c.cardId);
      out.push(c);
    }
    return out;
  };

  // Precedence: a card mid-way through its steps outranks one merely due,
  // which outranks one never seen.
  const learning = claim(input.learning);
  const dueReviews = claim(input.reviews);
  const newCards = claim(input.news);

  const slots = sessionSlots({
    dueReviews: dueReviews.length,
    newCards: newCards.length,
    learning: learning.length,
    cap: input.cap,
  });

  // Learning and review candidates share an ordering scale, so the merged
  // stream is still "most overdue first".
  const revisions = [...learning, ...dueReviews.slice(0, slots.reviews)].sort(byOrder);
  const introductions = newCards.slice(0, slots.news);

  const queue: QueueEntry[] = [];
  let nextNew = 0;

  revisions.forEach((review, i) => {
    queue.push({ cardId: review.cardId, wordId: review.wordId, isNew: false });
    if ((i + 1) % NEW_PER_REVIEWS === 0 && nextNew < introductions.length) {
      const card = introductions[nextNew++]!;
      queue.push({ cardId: card.cardId, wordId: card.wordId, isNew: true });
    }
  });

  for (; nextNew < introductions.length; nextNew++) {
    const card = introductions[nextNew]!;
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
