import { worseOf } from '@/lib/fsrs/pair';
import type { RatingValue } from '@/lib/fsrs/replay';

/**
 * The end-of-day recap: which words you failed today, as rows you can take
 * somewhere else.
 *
 * Derived from the session's *showings*, not from the review standing for each
 * word. The two disagree, and the difference matters. `graded[cardId]` holds
 * the rating the scheduler is acting on, which a learning step overwrites:
 * press Quên, walk 1m → 10m answering Được, and what stands is a 3. That is
 * the right answer for the scheduler and the wrong one here — you forgot the
 * word this morning, and a recap that omits it is a recap of the wrong thing.
 * So every showing counts, and the worst grade pressed is the one kept.
 *
 * Pure, and separate from the screen, because the folding is the part that is
 * easy to get subtly wrong — a word is asked twice, can come back on a
 * learning step, and can be undone — while the rendering is not.
 */

/** Ratings that put a word in the recap: 1 Quên, 2 Khó. */
export type MissedRating = 1 | 2;

const WORST_PASSING: RatingValue = 2;

export interface MissedWord {
  cardId: string;
  headword: string;
  reading: string;
  meaning: string;
  /** The worst grade pressed for this word today. */
  rating: MissedRating;
}

/**
 * One rating, as the reviewer records it. Structural rather than
 * `ReviewScreen`'s own `Answered`, so the screen's array satisfies it without
 * a conversion and the tests need three fields instead of a whole `ReviewItem`.
 */
export interface Showing {
  rating: RatingValue;
  item: {
    cardId: string;
    word: { headword: string; reading: string; meaning: string };
  };
}

/**
 * The words graded Quên or Khó, worst first.
 *
 * `worseOf` rather than a comparison written here: it is the same rule the
 * pair uses to decide which of two faces a word is scheduled on, and a recap
 * that ranked them differently would be saying two things about one answer.
 *
 * Insertion order survives within a rating — a Map keeps it — so the list
 * reads in the order the session went rather than in some arbitrary shuffle
 * of equally-bad words.
 */
export function missedWords(showings: readonly Showing[]): MissedWord[] {
  const worst = new Map<string, MissedWord>();

  for (const { rating, item } of showings) {
    const standing = worst.get(item.cardId);
    // Not yet missed and this rating is fine: nothing to record. A later
    // showing of the same word can still put it in the list.
    if (!standing && rating > WORST_PASSING) continue;

    const combined = standing ? worseOf(standing.rating, rating) : rating;
    worst.set(item.cardId, {
      cardId: item.cardId,
      headword: item.word.headword,
      reading: item.word.reading,
      meaning: item.word.meaning,
      // Narrowed by the guard above and by `worseOf` never returning worse
      // than its inputs — a standing entry is already 1 or 2.
      rating: combined as MissedRating,
    });
  }

  return sorted([...worst.values()]);
}

/**
 * Two recaps of the same study day, folded into one.
 *
 * The screen holds only the session running in front of it, and the study day
 * can hold several — finish the morning's cards, close the tab, come back at
 * noon. `stored` is what earlier sessions left in IndexedDB and `current` is
 * what this one has produced, so the union is the day.
 *
 * `current` wins on the word's text: a meaning rewritten mid-session through
 * the leech prompt or the edit panel should read as rewritten. It does not win
 * on the rating — the worse of the two does, for the same reason one session
 * keeps the worse of two faces.
 */
export function mergeMissed(
  stored: readonly MissedWord[],
  current: readonly MissedWord[],
): MissedWord[] {
  const merged = new Map<string, MissedWord>();
  for (const word of stored) merged.set(word.cardId, word);

  for (const word of current) {
    const earlier = merged.get(word.cardId);
    merged.set(word.cardId, {
      ...word,
      rating: earlier ? (worseOf(earlier.rating, word.rating) as MissedRating) : word.rating,
    });
  }

  return sorted([...merged.values()]);
}

/** Quên before Khó; within a rating, the order they were answered in. */
function sorted(words: MissedWord[]): MissedWord[] {
  return words.sort((a, b) => a.rating - b.rating);
}

/**
 * The recap as CSV: headword, reading, meaning. No header row — it is meant to
 * be pasted straight into a sheet or an import, where a header is a row to
 * delete.
 *
 * Quoting is not optional here. Vietnamese meanings routinely carry commas
 * ("mở, bật"), and an unquoted one silently becomes two columns — the kind of
 * damage nobody notices until the import is already wrong.
 */
export function toCsv(words: readonly MissedWord[]): string {
  return words
    .map((word) => [word.headword, word.reading, word.meaning].map(csvField).join(','))
    .join('\r\n');
}

/** RFC 4180: quote if the field could otherwise break the row, and double any quote inside. */
export function csvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}
