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

/**
 * Does this showing revise the review already standing, or add one?
 *
 * Only the *other* face revises. A card put back by a learning step comes
 * round again wearing the same face, and that is an ordinary second review —
 * 1m then 10m is how a lapsed card is meant to walk, and collapsing it into
 * the first rating would leave the card stuck at its lapse forever.
 */
export function revises(prior: PriorGrade, face: Face): boolean {
  return prior.face !== face;
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
 * The first row is taken back and the worse one written in its place, which
 * is why the outbox holds a card's rating back while its twin is still
 * unanswered: taken back before it was ever sent, the correction costs no
 * deletion and `review_logs` keeps its append-only property.
 */
export type PairOutcome =
  | { action: 'keep' }
  | { action: 'replace'; rating: RatingValue };

export function resolvePair(prior: PriorGrade, second: RatingValue): PairOutcome {
  const worse = worseOf(prior.rating, second);
  return worse === prior.rating ? { action: 'keep' } : { action: 'replace', rating: worse };
}
