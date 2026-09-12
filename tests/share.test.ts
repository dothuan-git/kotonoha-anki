import { describe, expect, it } from 'vitest';

import { MAX_SHARE_QUERY, shareQuery } from '@/lib/share';

/**
 * §10's share target. Table-driven, because the interesting part is not the
 * code — it is the range of things Android actually hands a share target, none
 * of which is documented anywhere and all of which arrive in the same three
 * fields.
 */

const CASES: { name: string; input: Parameters<typeof shareQuery>[0]; expect: string }[] = [
  {
    name: 'a word shared as plain text',
    input: { text: '開ける' },
    expect: '開ける',
  },
  {
    name: 'a word with the sharing app’s garnish around it',
    input: { text: 'Look up 開ける in the dictionary' },
    expect: '開ける',
  },
  {
    name: 'text wins over title',
    input: { title: '辞書', text: '勉強' },
    expect: '勉強',
  },
  {
    name: 'title when the text has nothing Japanese in it',
    input: { title: '猫 - Jisho.org', text: 'Shared via Jisho' },
    expect: '猫',
  },
  {
    name: 'the word out of a percent-encoded URL',
    input: { url: 'https://jisho.org/search/%E9%96%8B%E3%81%91%E3%82%8B' },
    expect: '開ける',
  },
  {
    name: 'the word out of a URL that is not encoded at all',
    input: { url: 'https://jotoba.de/search/食べる' },
    expect: '食べる',
  },
  {
    name: 'katakana, with its long vowel mark intact',
    input: { text: 'コーヒー' },
    expect: 'コーヒー',
  },
  {
    name: '々, which is neither kana nor kanji',
    input: { text: '人々' },
    expect: '人々',
  },
  {
    name: 'romaji, kept rather than discarded — the add form converts it',
    input: { text: 'akeru' },
    expect: 'akeru',
  },
  {
    name: 'a URL with nothing Japanese in it, which is not a headword',
    input: { url: 'https://example.com/page' },
    expect: '',
  },
  {
    name: 'nothing at all',
    input: {},
    expect: '',
  },
  {
    name: 'whitespace only',
    input: { text: '   ', title: '' },
    expect: '',
  },
  {
    name: 'a stray % that is not an escape sequence',
    input: { text: '50% 割引' },
    expect: '割引',
  },
];

describe('shareQuery', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      expect(shareQuery(testCase.input)).toBe(testCase.expect);
    });
  }

  /**
   * A shared article arrives as a paragraph. §7 rules out tokenising it, so
   * the honest thing is to cap it and let the form be edited — not to guess
   * where the first word ends.
   */
  it('caps a shared sentence rather than guessing a word boundary', () => {
    const long = '窓'.repeat(MAX_SHARE_QUERY + 20);
    expect(shareQuery({ text: long })).toHaveLength(MAX_SHARE_QUERY);
  });

  it('does not segment a phrase it can reach in full', () => {
    expect(shareQuery({ text: '窓を開けてください' })).toBe('窓を開けてください');
  });
});
