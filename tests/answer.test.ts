import { describe, expect, it } from 'vitest';

import { checkAnswer, normaliseAnswer } from '@/lib/answer';

/**
 * The answer normaliser, table-driven. The cases that matter — 開ける, the
 * コーヒー family, and じ/ぢ — are each here.
 */

describe('normaliseAnswer', () => {
  const cases: [string, string, string][] = [
    ['leaves plain hiragana alone', 'あける', 'あける'],
    ['katakana folds to hiragana', 'アケル', 'あける'],
    ['kanji survives untouched', '開ける', '開ける'],
    ['halfwidth katakana is NFKC-folded first', 'ｱｹﾙ', 'あける'],
    ['fullwidth romaji folds to ascii and lowercases', 'ＡＫＥＲＵ', 'akeru'],
    ['ー takes the vowel of the kana before it', 'コーヒー', 'こおひい'],
    ['こうひい is a different word, not a spelling of it', 'こうひい', 'こうひい'],
    ['こおひい is the one that matches', 'こおひい', 'こおひい'],
    ['a run of ー expands each in turn', 'メール', 'めえる'],
    ['ー after ん has no vowel and is dropped', 'んー', 'ん'],
    ['leading ー has nothing to lengthen and is dropped', 'ーあ', 'あ'],
    ['spaces are stripped', ' あけ る ', 'あける'],
    ['fullwidth space is stripped', 'あけ　る', 'あける'],
    ['interpuncts are stripped', 'コーヒー・カップ', 'こおひいかっぷ'],
    ['wave dashes are stripped', '〜あける〜', 'あける'],
    ['sentence punctuation is stripped', '開ける。', '開ける'],
    ['々 is not punctuation', '人々', '人々'],
    ['voicing is preserved', 'じかん', 'じかん'],
    ['ぢ is preserved', 'はなぢ', 'はなぢ'],
    ['small kana are preserved', 'きょう', 'きょう'],
    ['っ is preserved', 'きっぷ', 'きっぷ'],
    ['ゔ folds from ヴ', 'ヴァイオリン', 'ゔぁいおりん'],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(normaliseAnswer(input)).toBe(expected);
    });
  }

  it('is idempotent', () => {
    for (const [, input] of cases) {
      expect(normaliseAnswer(normaliseAnswer(input))).toBe(normaliseAnswer(input));
    }
  });
});

describe('checkAnswer', () => {
  const akeru = { headword: '開ける', reading: 'あける' };
  const coffee = { headword: 'コーヒー', reading: 'コーヒー' };
  const jikan = { headword: '時間', reading: 'じかん' };

  const cases: [string, { headword: string; reading: string }, string, boolean][] = [
    ['the reading', akeru, 'あける', true],
    ['the reading in katakana', akeru, 'アケル', true],
    ['the headword in kanji', akeru, '開ける', true],
    ['the headword with a stray space', akeru, ' 開ける ', true],
    ['romaji left unconverted', akeru, 'akeru', false],
    ['the wrong reading of the same kanji', akeru, 'ひらける', false],
    ['a one-kana miss', akeru, 'あけろ', false],
    ['an empty attempt', akeru, '', false],
    ['whitespace only', akeru, '   ', false],
    ['コーヒー as written', coffee, 'コーヒー', true],
    ['こおひい, the expanded form', coffee, 'こおひい', true],
    ['こうひい, which is not it', coffee, 'こうひい', false],
    // No fuzzy matching means these stay apart.
    ['じ where the word has じ', jikan, 'じかん', true],
    ['ぢ where the word has じ', jikan, 'ぢかん', false],
  ];

  for (const [name, word, input, expected] of cases) {
    it(`${expected ? 'accepts' : 'rejects'} ${name}`, () => {
      expect(checkAnswer(input, word)).toBe(expected);
    });
  }
});
