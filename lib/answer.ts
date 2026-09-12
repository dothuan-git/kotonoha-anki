/**
 * Answer matching for production cards.
 *
 * No fuzzy matching and no edit-distance tolerance: in an SRS a near miss is a
 * miss, and a matcher that forgives じ for ぢ teaches the wrong reading. The
 * escape hatch for a genuine mistype is the "gõ nhầm" button, which discards
 * the attempt without writing a review log at all — a UI affordance, never a
 * loosening of this comparison.
 */

/** Katakana → hiragana. Covers ァ..ヶ; ヽヾ and ・ are handled as punctuation. */
const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KANA_SHIFT = 0x60;

/**
 * The vowel each kana ends on, for expanding ー. Built by row rather than by
 * rule because the small kana and the voiced rows do not follow one.
 */
const VOWEL_OF_KANA: Record<string, string> = {
  ...row('あかがさざただなはばぱまやゃらわゎぁ', 'あ'),
  ...row('いきぎしじちぢにひびぴみりゐぃ', 'い'),
  ...row('うくぐすずつづぬふぶぷむゆゅるゔぅ', 'う'),
  ...row('えけげせぜてでねへべぺめれゑぇ', 'え'),
  ...row('おこごそぞとどのほぼぽもよょろをぉ', 'お'),
};

function row(kana: string, vowel: string): Record<string, string> {
  return Object.fromEntries([...kana].map((k) => [k, vowel]));
}

/**
 * Everything discarded before comparing: whitespace, interpuncts and wave
 * dashes, and ordinary sentence punctuation in both widths.
 *
 * Deliberately not a `　-〿` block sweep — that range also holds 々,
 * which is part of 人々 and must survive into the headword comparison.
 */
const PUNCTUATION =
  /[\s・･〜～~、。，．,.！!？?：:；;…‥「」『』【】〈〉《》（）()\[\]｛｝{}ー]/g;

/**
 * The normal form used for comparison.
 *
 * Order is load-bearing: ー takes its vowel from the kana before it, so the
 * katakana has to be hiragana before the expansion runs, and the expansion has
 * to run before ー is swept up as punctuation.
 */
export function normaliseAnswer(input: string): string {
  const folded = katakanaToHiragana(input.normalize('NFKC').toLowerCase());
  return expandProlongedSound(folded).replace(PUNCTUATION, '');
}

function katakanaToHiragana(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    out +=
      code >= KATAKANA_START && code <= KATAKANA_END
        ? String.fromCodePoint(code - KANA_SHIFT)
        : ch;
  }
  return out;
}

/**
 * コーヒー → こおひい. The vowel comes from the preceding kana, which is why
 * こうひい is a different answer and not an accepted spelling of it.
 *
 * A ー with nothing usable before it (ん, a kanji, string start) is left alone
 * and falls to the punctuation sweep.
 */
function expandProlongedSound(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch !== 'ー') {
      out += ch;
      continue;
    }
    const vowel = VOWEL_OF_KANA[out[out.length - 1] ?? ''];
    out += vowel ?? ch;
  }
  return out;
}

/**
 * Is this what the card was asking for?
 *
 * A card asking for the word accepts the reading or the headword — typing
 * 開ける instead of あける is a correct answer, not a lucky one. A card asking
 * for the reading cannot: it has the headword on screen, so accepting it back
 * would be marking the card's own prompt correct.
 *
 * Both sides go through `normaliseAnswer` rather than a literal
 * `input === headword`, so that a trailing space or a katakana headword typed
 * in kana is not marked wrong; nothing about the comparison itself is loosened.
 */
export function checkAnswer(
  input: string,
  word: { headword: string; reading: string },
  expect: 'word' | 'reading' = 'word',
): boolean {
  const attempt = normaliseAnswer(input);
  if (attempt === '') return false;
  if (attempt === normaliseAnswer(word.reading)) return true;
  return expect === 'word' && attempt === normaliseAnswer(word.headword);
}
