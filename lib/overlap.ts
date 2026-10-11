import { normaliseAnswer } from '@/lib/answer';
import { rubyToReading } from '@/lib/ruby';

/**
 * How much of a grammar card's scratch-pad attempt overlaps the model
 * sentence, as a whole percentage.
 *
 * A figure to look at, not a judgement: nothing reads it but the back of the
 * card, it never reaches a rating, and `lib/answer.ts` stays exact. It is
 * Dice's coefficient over character pairs — a count of shared pairs, not an
 * edit distance — so it says "mostly the same characters" and nothing about
 * whether the sentence was right.
 *
 * The attempt is compared with the sentence as written and with its reading,
 * and the better of the two counts: you type in kana, the model has kanji, and
 * 財布 against さいふ would otherwise score zero for a correct sentence.
 *
 * `null` when nothing was written.
 */
export function overlapPercent(
  written: string,
  sentence: { jp: string; jpRuby: string },
): number | null {
  const attempt = normaliseAnswer(written);
  if (!attempt) return null;

  const scores = [sentence.jp, rubyToReading(sentence.jpRuby)].map((s) =>
    dice(attempt, normaliseAnswer(s)),
  );
  return Math.round(Math.max(...scores) * 100);
}

/** Pairs of neighbouring characters; a single character stands for itself. */
function grams(s: string): string[] {
  const chars = [...s];
  if (chars.length < 2) return chars;
  return chars.slice(1).map((c, i) => chars[i] + c);
}

function dice(a: string, b: string): number {
  const left = grams(a);
  const right = grams(b);
  if (left.length === 0 || right.length === 0) return 0;

  const pool = new Map<string, number>();
  for (const g of right) pool.set(g, (pool.get(g) ?? 0) + 1);

  let shared = 0;
  for (const g of left) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      shared++;
      pool.set(g, n - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}
