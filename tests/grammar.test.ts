import { describe, expect, it } from 'vitest';

import { MAX_GRAMMAR_SENTENCES, grammarInput, pickSentence, withPlainText } from '@/lib/grammar';

const sentence = { jpRuby: '財布[さいふ]をなくしてしまった。', vi: 'Tôi lỡ làm mất ví rồi.' };

describe('pickSentence', () => {
  /** The card moves on after every rating — the same answer twice is recall, not production. */
  it('rotates with the review count', () => {
    const list = ['a', 'b', 'c'];
    expect([0, 1, 2, 3, 4].map((reps) => pickSentence(list, reps))).toEqual([
      'a',
      'b',
      'c',
      'a',
      'b',
    ]);
  });

  it('has nothing to show for a point with no sentences', () => {
    expect(pickSentence([], 3)).toBeUndefined();
  });

  it('a single sentence is always that sentence', () => {
    expect(pickSentence(['only'], 7)).toBe('only');
  });
});

describe('grammarInput', () => {
  const base = { pattern: '〜てしまう', meaning: 'lỡ, mất rồi', sentences: [sentence] };

  it('accepts a point with one sentence', () => {
    const parsed = grammarInput.parse(base);
    expect(parsed.sentences).toHaveLength(1);
    expect(parsed.jlpt).toBeNull();
  });

  /** Blank optional fields are absent, not empty strings stored. */
  it('stores a blank formation or note as null', () => {
    const parsed = grammarInput.parse({ ...base, formation: '  ', note: '' });
    expect(parsed.formation).toBeNull();
    expect(parsed.note).toBeNull();
  });

  it('needs at least one sentence', () => {
    expect(grammarInput.safeParse({ ...base, sentences: [] }).success).toBe(false);
  });

  it(`takes at most ${MAX_GRAMMAR_SENTENCES} sentences`, () => {
    const many = Array.from({ length: MAX_GRAMMAR_SENTENCES + 1 }, () => sentence);
    expect(grammarInput.safeParse({ ...base, sentences: many }).success).toBe(false);
  });

  it('rejects a sentence that is only ruby brackets', () => {
    const empty = { jpRuby: '   ', vi: 'x' };
    expect(grammarInput.safeParse({ ...base, sentences: [empty] }).success).toBe(false);
  });

  it('rejects a sentence with no Vietnamese', () => {
    expect(
      grammarInput.safeParse({ ...base, sentences: [{ jpRuby: sentence.jpRuby, vi: ' ' }] })
        .success,
    ).toBe(false);
  });
});

describe('withPlainText', () => {
  it('derives the plain sentence from its ruby', () => {
    expect(withPlainText(sentence).jp).toBe('財布をなくしてしまった。');
  });
});
