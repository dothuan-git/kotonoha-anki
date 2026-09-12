import { schedulerParams } from '@/lib/fsrs/params';
import { applyRating, type RatingValue } from '@/lib/fsrs/replay';
import { staysInSession, toCard, toPreviews, toStateView } from '@/lib/fsrs/state';
import { isLeech } from '@/lib/types';
import type { CountedCards, PendingReview, RateResult, ReviewItem } from '@/lib/types';

/**
 * The scheduler, run on the device.
 *
 * The session has to keep working with no signal, and learning steps are the
 * reason this cannot be faked with a pending spinner: `Again` on a new card
 * means "show me again in a minute", and a minute is inside the session. A
 * client that could not schedule would have to either drop the card or lie
 * about when it comes back.
 *
 * What it produces is provisional. The rating goes into the outbox, the server
 * refolds the card's whole log at sync, and whatever comes back replaces this
 * — the server always wins. That is not a fallback path: it is the normal
 * one, online and off. The two agree because both end at `applyRating` with
 * the same parameters, and because the fold is deterministic.
 */
export interface LocalRating {
  result: RateResult;
  pending: PendingReview;
}

export function rateLocally(input: {
  /** `review_logs.id`, generated on the device — the idempotency key. */
  logId: string;
  item: ReviewItem;
  rating: RatingValue;
  now: Date;
  requestRetention: number;
}): LocalRating {
  const params = schedulerParams(input.requestRetention);
  const card = toCard(input.item.state);

  // The same guard `applyReview` applies server-side. A phone whose clock
  // stepped backwards — a timezone change, an NTP correction mid-flight —
  // would otherwise write a log row that sorts before the card's own history
  // and refold it into something else entirely on sync.
  const last = card.last_review;
  const reviewedAt = last && last >= input.now ? new Date(last.getTime() + 1) : input.now;

  const next = applyRating(card, input.rating, reviewedAt, params);

  return {
    result: {
      cardId: input.item.cardId,
      state: toStateView(next.card),
      previews: toPreviews(next.card, reviewedAt, params),
      repeat: staysInSession(next.card, reviewedAt),
      // The leech flag needs nothing the device does not already have: the
      // lapse count comes off the fold that just ran, and whether the prompt
      // has been shown arrived with the card. So the prompt appears on the
      // train, at the review that earned it.
      leech: isLeech({ state: toStateView(next.card), leechAcked: input.item.leechAcked }),
    },
    pending: {
      id: input.logId,
      cardId: input.item.cardId,
      rating: input.rating,
      reviewedAt: reviewedAt.toISOString(),
    },
  };
}

/**
 * The daily caps, kept offline.
 *
 * A card counts once for the day, in the bucket it was first shown in. The
 * server's own definition, applied to the same books — which is why the
 * session carries the identities rather than two totals: a learning card the
 * server already counted this morning must not spend a second slot when it
 * comes round again on the train.
 */
export function countCard(counted: CountedCards, item: ReviewItem): CountedCards {
  if (counted[item.cardId]) return counted;
  return { ...counted, [item.cardId]: item.isNew ? 'new' : 'review' };
}
