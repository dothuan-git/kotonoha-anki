import { normaliseAnswer } from '@/lib/answer';

/**
 * The confusion pairs — the pure half.
 *
 * A wrong answer typed from the meaning is only interesting if it was a *different word
 * you already know*. Typing あける for 開く is a confusion; typing あkえru is a
 * typo, and `review_logs` has already recorded it as a miss. So the question
 * this answers is narrow: does what was typed name another word in the
 * collection?
 *
 * It runs through `normaliseAnswer` and nothing else. No edit distance,
 * no fuzzy match — the same rule that decides whether an answer was right
 * decides which word it was right *about*, and a matcher that guessed here
 * would invent confusions the user never had.
 */
export interface WordIdentity {
  id: string;
  headword: string;
  reading: string;
}

/**
 * Which word was typed instead of the one asked for, if it can be said without
 * guessing.
 *
 * `null` in three cases, all of them deliberate:
 *
 * - the text matches nothing in the collection — a wrong answer, not a
 *   confusion;
 * - it matches the asked word (so the answer was in fact right, which happens
 *   when the word was edited between the attempt and the sync);
 * - it matches *two or more* other words. 上る and 登る are both のぼる; the
 *   attempt cannot say which was meant, and recording one at random would put
 *   a fact on /stats that nobody observed.
 */
export function resolveConfusion(
  typed: string,
  askedWordId: string,
  collection: readonly WordIdentity[],
): string | null {
  const attempt = normaliseAnswer(typed);
  if (attempt === '') return null;

  const matches = new Set<string>();
  for (const word of collection) {
    if (word.id === askedWordId) continue;
    if (
      normaliseAnswer(word.reading) === attempt ||
      normaliseAnswer(word.headword) === attempt
    ) {
      matches.add(word.id);
    }
  }

  const [only] = [...matches];
  return matches.size === 1 && only ? only : null;
}

/** One direction of a pair, counted. `word` is what was asked for. */
export interface ConfusionPair {
  word: WordIdentity & { meaning: string };
  typed: WordIdentity & { meaning: string };
  count: number;
  lastAt: string;
}
