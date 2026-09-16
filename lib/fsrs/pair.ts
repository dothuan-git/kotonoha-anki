import type { RatingValue } from '@/lib/fsrs/replay';
import type { Face } from '@/lib/types';

/**
 * The pair rule: a word is asked twice in a session and graded once.
 *
 * The alternative was two schedules per word — a forward card and a reverse
 * card, each with its own due date. This is the other choice: one card, one
 * due date, shown from both sides, and the two answers collapsed into a single
 * review. Knowing 開ける on sight and being able to produce it from "mở" are
 * not treated as separate skills with separate intervals; they are two
 * questions about one thing you either know or do not.
 *
 * Which means the grade has to be the *worse* of the two. A word you can read
 * but cannot produce is not a word you knew — grading it on the half you
 * happened to be asked first would schedule it as though it were.
 *
 * Nothing here is stateful and nothing here talks to the log. The screen holds
 * what the first face was graded, and these functions say what the second one
 * should do about it.
 */

/** The most recent review this card was given in this session. */
export interface PriorGrade {
  /** `review_logs.id` of the row it wrote. */
  logId: string;
  rating: RatingValue;
  /** Which showing wrote it. The pair rule only applies across the two faces. */
  face: Face;
}

/** A showing as this rule needs to see it: which side, and why it is here. */
export interface Showing {
  face: Face;
  /**
   * This showing is a card put back by a learning step, not one of the two the
   * day dealt.
   */
  repeat?: boolean;
}

/**
 * Does this showing revise the review already standing, or add one?
 *
 * A learning-step repeat always adds. 1m then 10m is how a lapsed card walks
 * out of its lapse, and collapsing the second step into the first rating would
 * leave it stuck there forever. Otherwise the pair rule applies: only the
 * *other* face of the word revises what the first one wrote.
 *
 * The flag is what decides it, not the face. A repeat wears the face it was
 * dealt with, so as long as it came straight back the face said the same
 * thing — but a step long enough to put the repeat behind the word's other
 * face made that reading wrong, and silently: the step would be read as the
 * second half of the pair and the card would stop walking.
 */
export function revises(prior: PriorGrade, showing: Showing): boolean {
  if (showing.repeat) return false;
  return prior.face !== showing.face;
}

/** Again < Hard < Good < Easy, which is already the numbering. */
export function worseOf(a: RatingValue, b: RatingValue): RatingValue {
  return a <= b ? a : b;
}

/**
 * What the second face of a card does to the review its twin already wrote.
 *
 * `keep` — the second answer was as good or better, so the review stands and
 * nothing at all is written. The card has had its review today.
 *
 * `replace` — the second answer was worse, so it becomes the word's grade.
 * Cheap if the first row has not reached the server yet — taken back before
 * it was ever sent, which costs no deletion. Once it has, the corrected
 * rating is simply queued under the same id, and `applyReview` on the server
 * is what turns "a review under an id it has already seen, priced
 * differently" into a replacement rather than a duplicate.
 */
export type PairOutcome =
  | { action: 'keep' }
  | { action: 'replace'; rating: RatingValue };

export function resolvePair(prior: PriorGrade, second: RatingValue): PairOutcome {
  const worse = worseOf(prior.rating, second);
  return worse === prior.rating ? { action: 'keep' } : { action: 'replace', rating: worse };
}
