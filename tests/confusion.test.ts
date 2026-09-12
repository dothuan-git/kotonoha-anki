import { describe, expect, it } from 'vitest';

import { resolveConfusion, type WordIdentity } from '@/lib/confusion';

/**
 * §13's confusion pairs. The question is narrow: did what was typed name
 * another word in the collection, or was it just wrong?
 */

const AKERU: WordIdentity = { id: 'w-akeru', headword: '開ける', reading: 'あける' };
const AKU: WordIdentity = { id: 'w-aku', headword: '開く', reading: 'あく' };
const NOBORU_UP: WordIdentity = { id: 'w-noboru-1', headword: '上る', reading: 'のぼる' };
const NOBORU_CLIMB: WordIdentity = { id: 'w-noboru-2', headword: '登る', reading: 'のぼる' };
const COFFEE: WordIdentity = { id: 'w-coffee', headword: 'コーヒー', reading: 'コーヒー' };

const COLLECTION = [AKERU, AKU, NOBORU_UP, NOBORU_CLIMB, COFFEE];

describe('resolveConfusion', () => {
  it('names the other word when the reading matches it', () => {
    expect(resolveConfusion('あける', AKU.id, COLLECTION)).toBe(AKERU.id);
  });

  it('names the other word when the headword was typed instead', () => {
    expect(resolveConfusion('開ける', AKU.id, COLLECTION)).toBe(AKERU.id);
  });

  it('returns null for a wrong answer that is not a word in the collection', () => {
    // A miss, and `review_logs` has already recorded it as one. There is no
    // pair here to put on /stats.
    expect(resolveConfusion('あけりゅ', AKU.id, COLLECTION)).toBeNull();
  });

  it('returns null when the attempt names the word that was asked for', () => {
    expect(resolveConfusion('あく', AKU.id, COLLECTION)).toBeNull();
  });

  it('returns null when two words share the reading', () => {
    // 上る and 登る are both のぼる. The attempt cannot say which was meant, and
    // picking one would put a fact on /stats that nobody observed.
    expect(resolveConfusion('のぼる', AKERU.id, COLLECTION)).toBeNull();
  });

  it('still resolves when only one of the two matching words is the one asked for', () => {
    expect(resolveConfusion('のぼる', NOBORU_UP.id, COLLECTION)).toBe(NOBORU_CLIMB.id);
  });

  it('compares through §6’s normaliser rather than literally', () => {
    // Same rule as the matcher that judged the answer wrong: katakana folds to
    // hiragana and ー expands to the vowel before it.
    expect(resolveConfusion('こおひい', AKU.id, COLLECTION)).toBe(COFFEE.id);
    expect(resolveConfusion('こうひい', AKU.id, COLLECTION)).toBeNull();
  });

  it('returns null for an empty or whitespace-only attempt', () => {
    // "Chưa nhớ ra" submits nothing; it is a miss, not a mix-up.
    expect(resolveConfusion('', AKU.id, COLLECTION)).toBeNull();
    expect(resolveConfusion('   ', AKU.id, COLLECTION)).toBeNull();
  });
});
