import type { Pos, Transitivity } from '@/lib/types';

/**
 * Jotoba's part-of-speech tags. §9 of the technical plan describes raw JMdict
 * strings (`v5r`, `v1`, `vt`), but Jotoba does not return those — it returns
 * tagged enums, verified against the live API:
 *
 *   飲む     [{"Verb":{"Godan":"Mu"}}, {"Verb":"Transitive"}]
 *   開ける   [{"Verb":"Ichidan"}, {"Verb":"Transitive"}]
 *   来る     [{"Verb":"Kuru"}, {"Verb":"Intransitive"}]
 *   勉強     [{"Noun":"Normal"}, {"Verb":{"Irregular":"NounOrAuxSuru"}}, {"Verb":"Transitive"}]
 *   懐かしい [{"Adjective":"Keiyoushi"}]
 *   静か     [{"Adjective":"Na"}]
 *   ゆっくり ["Adverb", "AdverbTo", {"Verb":{"Irregular":"NounOrAuxSuru"}}]
 *   を       ["Particle"]
 *
 * This is the one place tags become labels, so a label can change without a
 * migration — as long as the new label is one of `POS_VALUES`.
 */
export type JotobaPosTag = string | { [outer: string]: string | { [inner: string]: string } };

/**
 * Collapses a tag to a dotted key: `Verb.Godan.Mu`, `Verb.Ichidan`,
 * `Adjective.Na`, `Noun.Normal`, `Adverb`. Unknown shapes collapse to ''
 * rather than throwing — Jotoba may add variants and a lookup must not fail
 * because of one unrecognised sense tag.
 */
export function flattenTag(tag: JotobaPosTag): string {
  if (typeof tag === 'string') return tag;
  if (tag === null || typeof tag !== 'object') return '';

  const entry = Object.entries(tag)[0];
  if (!entry) return '';
  const [outer, value] = entry;

  if (typeof value === 'string') return `${outer}.${value}`;
  if (value && typeof value === 'object') {
    const inner = Object.entries(value)[0];
    if (inner) return `${outer}.${inner[0]}.${inner[1]}`;
  }
  return outer;
}

/**
 * `Verb 3` covers する/来る verbs. `NounOrAuxSuru` is the tag JMdict puts on
 * every noun that can take する (勉強, 予約, 開始 — most of the vocabulary a
 * learner adds), so on its own it must NOT win: 勉強 is a Noun that happens to
 * take する, not a Verb 3. Only an irregular verb with no Noun sense qualifies.
 */
function isSuruOrKuruVerb(keys: readonly string[]): boolean {
  return keys.some(
    (k) => k === 'Verb.Kuru' || k === 'Verb.Irregular.Suru' || k === 'Verb.Irregular.SuruSpecial',
  );
}

function hasNoun(keys: readonly string[]): boolean {
  return keys.some((k) => k === 'Noun' || k.startsWith('Noun.'));
}

/**
 * Maps a sense's tags onto our `pos` enum and transitivity.
 *
 * Returns `pos: null` when nothing matches — the add form leaves its selector
 * empty rather than guessing, because a wrong part of speech is worse than an
 * unset one.
 */
export function mapPos(tags: readonly JotobaPosTag[]): {
  pos: Pos | null;
  transitivity: Transitivity;
} {
  const keys = tags.map(flattenTag).filter((k) => k !== '');

  let transitivity: Transitivity = null;
  if (keys.includes('Verb.Transitive')) transitivity = 'transitive';
  else if (keys.includes('Verb.Intransitive')) transitivity = 'intransitive';

  const pos = matchPos(keys);

  // Transitivity is a property of verbs. A noun that takes する carries the
  // tag too (勉強 is marked transitive); keeping it there would be noise.
  return { pos, transitivity: pos?.startsWith('Verb') ? transitivity : null };
}

function matchPos(keys: readonly string[]): Pos | null {
  if (keys.some((k) => k.startsWith('Verb.Godan.'))) return 'Verb 1';
  if (keys.some((k) => k === 'Verb.Ichidan' || k === 'Verb.IchidanKureru')) return 'Verb 2';
  if (isSuruOrKuruVerb(keys) && !hasNoun(keys)) return 'Verb 3';

  if (keys.includes('Adjective.Keiyoushi') || keys.includes('Adjective.KeiyoushiYoiIi')) {
    return 'I-adjective';
  }
  if (keys.includes('Adjective.Na')) return 'Na-adjective';

  if (keys.includes('Counter') || keys.includes('Noun.Counter')) return 'Counter';
  if (hasNoun(keys)) return 'Noun';

  if (keys.some((k) => k === 'Adverb' || k === 'AdverbTo')) return 'Adverb';
  if (keys.includes('Particle')) return 'Particle';
  if (keys.includes('Conjunction')) return 'Conjunction';
  if (keys.includes('Expr') || keys.includes('Interjection')) return 'Expression';

  // A noun-modifying の adjective (可視の) or a prenominal (来る) has no home in
  // our eleven values; Noun is the closest honest answer.
  if (keys.includes('Adjective.No') || keys.includes('Adjective.PreNoun')) return 'Noun';

  return null;
}

/**
 * Jotoba reports JLPT on kanji as a number where 5 is easiest. A word's level
 * is NOT returned — see `pickJlptHint`.
 */
export function jlptFromNumber(n: number | null | undefined): 'N5' | 'N4' | 'N3' | 'N2' | 'N1' | null {
  switch (n) {
    case 5:
      return 'N5';
    case 4:
      return 'N4';
    case 3:
      return 'N3';
    case 2:
      return 'N2';
    case 1:
      return 'N1';
    default:
      return null;
  }
}

/**
 * A *hint* only. Jotoba carries no word-level JLPT, and the kanji levels
 * disagree with the word: 開 is N4 while 開ける is N5. The easiest constituent
 * kanji is the least-wrong guess; the user overrides it in the form.
 */
export function pickJlptHint(kanjiJlpt: readonly (number | null | undefined)[]) {
  const levels = kanjiJlpt.filter((n): n is number => typeof n === 'number');
  if (levels.length === 0) return null;
  return jlptFromNumber(Math.max(...levels));
}
