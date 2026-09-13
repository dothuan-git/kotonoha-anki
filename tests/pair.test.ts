import { describe, expect, it } from 'vitest';

import { resolvePair, revises, worseOf, type PriorGrade } from '@/lib/fsrs/pair';
import type { RatingValue } from '@/lib/fsrs/replay';

/**
 * A word is asked twice and graded once. These are the rules that make the
 * second answer count without letting it become a second review.
 */

const prior = (rating: RatingValue, face: 'word' | 'meaning' = 'word'): PriorGrade => ({
  logId: 'a1000000-0000-4000-8000-00000000000a',
  rating,
  face,
});

describe('worseOf', () => {
  const cases: [RatingValue, RatingValue, RatingValue][] = [
    [1, 4, 1],
    [4, 1, 1],
    [3, 2, 2],
    [2, 3, 2],
    [3, 3, 3],
  ];

  for (const [a, b, expected] of cases) {
    it(`${a} against ${b} is ${expected}`, () => {
      expect(worseOf(a, b)).toBe(expected);
    });
  }
});

describe('revises', () => {
  /** The point of the pair: the other side of the same word. */
  it('the other face revises the review standing', () => {
    expect(revises(prior(3, 'word'), 'meaning')).toBe(true);
    expect(revises(prior(3, 'meaning'), 'word')).toBe(true);
  });

  /**
   * A card put back by a learning step comes round wearing the same face, and
   * that is an ordinary second review. Folding it into the first rating would
   * leave a lapsed card stuck at its lapse: 1m then 10m is how it is meant to
   * walk out of one.
   */
  it('the same face again is a new review, not a revision', () => {
    expect(revises(prior(1, 'word'), 'word')).toBe(false);
    expect(revises(prior(1, 'meaning'), 'meaning')).toBe(false);
  });
});

describe('resolvePair', () => {
  it('a worse second answer becomes the word’s grade', () => {
    expect(resolvePair(prior(3), 1)).toEqual({ action: 'replace', rating: 1 });
    expect(resolvePair(prior(4), 2)).toEqual({ action: 'replace', rating: 2 });
  });

  /**
   * Reading a word you cannot produce is not knowing it, and the grade has to
   * say so — otherwise the half you happened to be asked first decides the
   * interval.
   */
  it('a better second answer changes nothing', () => {
    expect(resolvePair(prior(1), 4)).toEqual({ action: 'keep' });
    expect(resolvePair(prior(2), 3)).toEqual({ action: 'keep' });
  });

  it('an equal second answer changes nothing', () => {
    expect(resolvePair(prior(3), 3)).toEqual({ action: 'keep' });
  });

  /** Whatever happens, the word ends the day graded on its worse half. */
  it('always settles on the worse of the two', () => {
    const ratings: RatingValue[] = [1, 2, 3, 4];
    for (const first of ratings) {
      for (const second of ratings) {
        const outcome = resolvePair(prior(first), second);
        const settled = outcome.action === 'keep' ? first : outcome.rating;
        expect(settled).toBe(Math.min(first, second));
      }
    }
  });
});
