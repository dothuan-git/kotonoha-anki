import { describe, expect, it } from 'vitest';

import type { RatingValue } from '@/lib/fsrs/replay';
import { csvField, mergeMissed, missedWords, toCsv, type MissedWord, type Showing } from '@/lib/recap';

/**
 * The recap folds a session's showings into one row per word. Three things can
 * go wrong and all of them are quiet: a word asked twice counted twice, a word
 * forgotten and then walked back through its learning steps dropped because
 * the last answer was fine, and a Vietnamese meaning carrying a comma turning
 * into two CSV columns.
 */

const show = (
  cardId: string,
  rating: RatingValue,
  word: Partial<Showing['item']['word']> = {},
): Showing => ({
  rating,
  item: {
    cardId,
    word: { headword: `語${cardId}`, reading: `ご${cardId}`, meaning: `nghĩa ${cardId}`, ...word },
  },
});

const missed = (cardId: string, rating: 1 | 2, meaning = `nghĩa ${cardId}`): MissedWord => ({
  cardId,
  headword: `語${cardId}`,
  reading: `ご${cardId}`,
  meaning,
  rating,
});

describe('missedWords', () => {
  it('keeps a word forgotten first and answered well on its learning step', () => {
    // Quên, then the card comes back at 1m and 10m wearing the same face.
    const rows = missedWords([show('a', 1), show('a', 3), show('a', 3)]);
    expect(rows).toEqual([missed('a', 1)]);
  });

  it('grades the pair on the worse face whichever came first', () => {
    // `replace` — the good answer stood and the bad one took it back.
    expect(missedWords([show('a', 4), show('a', 2)])).toEqual([missed('a', 2)]);
    // `keep` — the bad answer already stood and the good one wrote nothing.
    expect(missedWords([show('b', 2), show('b', 4)])).toEqual([missed('b', 2)]);
  });

  it('leaves out a word that was never graded worse than Được', () => {
    expect(missedWords([show('a', 3), show('a', 4)])).toEqual([]);
  });

  it('counts a word once however many times it was shown', () => {
    const rows = missedWords([show('a', 1), show('a', 1), show('a', 2)]);
    expect(rows).toEqual([missed('a', 1)]);
  });

  it('puts Quên before Khó, and keeps the session order within a rating', () => {
    const rows = missedWords([show('a', 2), show('b', 1), show('c', 2), show('d', 1)]);
    expect(rows.map((row) => row.cardId)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('takes the word as it read on the last showing, not the first', () => {
    // The meaning was rewritten mid-session through the leech prompt.
    const rows = missedWords([show('a', 1), show('a', 3, { meaning: 'mở, bật' })]);
    expect(rows[0]).toEqual(missed('a', 1, 'mở, bật'));
  });

  it('is empty for a session where nothing was answered', () => {
    expect(missedWords([])).toEqual([]);
  });
});

describe('mergeMissed', () => {
  it('carries the morning list into the afternoon session', () => {
    expect(mergeMissed([missed('a', 1)], [missed('b', 2)])).toEqual([missed('a', 1), missed('b', 2)]);
  });

  it('keeps the worse of the two ratings for a word in both', () => {
    expect(mergeMissed([missed('a', 1)], [missed('a', 2)])).toEqual([missed('a', 1)]);
    expect(mergeMissed([missed('a', 2)], [missed('a', 1)])).toEqual([missed('a', 1)]);
  });

  it('takes the newer text for a word whose meaning was rewritten', () => {
    const rows = mergeMissed([missed('a', 1, 'mở')], [missed('a', 2, 'mở, bật')]);
    expect(rows).toEqual([missed('a', 1, 'mở, bật')]);
  });

  it('re-sorts the union rather than appending to it', () => {
    const rows = mergeMissed([missed('a', 2)], [missed('b', 1)]);
    expect(rows.map((row) => row.cardId)).toEqual(['b', 'a']);
  });
});

describe('toCsv', () => {
  it('writes three columns and no header', () => {
    expect(toCsv([missed('a', 1), missed('b', 2)])).toBe('語a,ごa,nghĩa a\r\n語b,ごb,nghĩa b');
  });

  it('quotes a meaning carrying a comma so it stays one column', () => {
    expect(toCsv([missed('a', 1, 'mở, bật')])).toBe('語a,ごa,"mở, bật"');
  });

  it('is empty for an empty recap', () => {
    expect(toCsv([])).toBe('');
  });
});

describe('csvField', () => {
  const cases: [string, string][] = [
    ['mở', 'mở'],
    ['mở, bật', '"mở, bật"'],
    ['gọi là "sensei"', '"gọi là ""sensei"""'],
    ['hai\ndòng', '"hai\ndòng"'],
    ['', ''],
  ];

  for (const [input, expected] of cases) {
    it(`leaves ${JSON.stringify(input)} as ${JSON.stringify(expected)}`, () => {
      expect(csvField(input)).toBe(expected);
    });
  }
});
