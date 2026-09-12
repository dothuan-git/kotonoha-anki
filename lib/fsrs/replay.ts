import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  type Card,
  type FSRSParameters,
  type Grade,
  type RecordLogItem,
} from 'ts-fsrs';

export { Rating, State };
export type { Card };

/** 1..4 = Again|Hard|Good|Easy, as stored in `review_logs.rating`. */
export type RatingValue = 1 | 2 | 3 | 4;

export const RATING_VALUES: readonly RatingValue[] = [1, 2, 3, 4];

export function isRatingValue(n: number): n is RatingValue {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

/**
 * The slice of a `review_logs` row a replay needs. `id` is only a tie-break:
 * two devices can write the same `reviewed_at` for different cards, and the
 * fold must not depend on which arrived first.
 */
export interface ReplayLog {
  id: string;
  rating: number;
  reviewedAt: Date;
}

/**
 * A card with no reviews. `createdAt` is the word's creation time, which makes
 * the empty fold reproducible: recompute derives the same `due` a year later
 * instead of "now".
 */
export function emptyCard(createdAt: Date): Card {
  return createEmptyCard(createdAt);
}

/**
 * The projection. `state(card) = logs.sortBy(reviewed_at).reduce(fsrs.next)`.
 *
 * Every card state in the app comes through here. Nothing accumulates state in
 * place, so replaying the same log always lands on the same card: ts-fsrs's
 * fuzz is seeded from `(review_time, reps, difficulty × stability)`, all of
 * which are themselves determined by the log.
 */
export function foldLogs(
  createdAt: Date,
  logs: readonly ReplayLog[],
  params: FSRSParameters,
): Card {
  const scheduler = fsrs(params);
  let card = emptyCard(createdAt);
  for (const log of sortLogs(logs)) {
    card = scheduler.next(card, log.reviewedAt, toGrade(log.rating)).card;
  }
  return card;
}

/**
 * Chronological, with `id` breaking ties. Two devices reviewing offline
 * can produce identical timestamps; without a total order the same log could
 * fold two ways.
 */
export function sortLogs<T extends ReplayLog>(logs: readonly T[]): T[] {
  return [...logs].sort(
    (a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** One review applied to a folded card. Returns the next card and its log row. */
export function applyRating(
  card: Card,
  rating: RatingValue,
  reviewedAt: Date,
  params: FSRSParameters,
): RecordLogItem {
  return fsrs(params).next(card, reviewedAt, toGrade(rating));
}

/** What each of the four buttons would schedule, for the interval preview. */
export function previewDueDates(
  card: Card,
  now: Date,
  params: FSRSParameters,
): Record<RatingValue, Date> {
  const preview = fsrs(params).repeat(card, now);
  return {
    1: preview[Rating.Again].card.due,
    2: preview[Rating.Hard].card.due,
    3: preview[Rating.Good].card.due,
    4: preview[Rating.Easy].card.due,
  };
}

function toGrade(rating: number): Grade {
  if (!isRatingValue(rating)) {
    throw new Error(`Invalid rating ${rating}; review_logs.rating is 1..4`);
  }
  return rating as Grade;
}
