import { NEW_PER_REVIEWS } from '@/lib/fsrs/params';

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
 * §4's queue order.
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
