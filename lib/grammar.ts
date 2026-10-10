import { z } from 'zod';

import { rubyToPlain } from '@/lib/ruby';
import { JLPT_VALUES } from '@/lib/types';

/**
 * Grammar points, as data: what a valid one looks like and which of its
 * sentences a card shows. Pure — the add form, the server action and the
 * importer all validate through the same schema, and none of it touches the
 * database.
 */

/**
 * Two, so the card alternates and the answer cannot be learned as one string,
 * and each one stays worth writing well.
 */
export const MAX_GRAMMAR_SENTENCES = 2;

/** An optional text field: blank means absent, not an empty string stored. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const grammarSentenceInput = z.object({
  /** Ruby format: 財布[さいふ]をなくしてしまった。 `jp` is derived from it. */
  jpRuby: z
    .string()
    .trim()
    .min(1, 'Câu tiếng Nhật đang trống')
    .refine((value) => rubyToPlain(value).trim() !== '', 'Câu tiếng Nhật đang trống'),
  vi: z.string().trim().min(1, 'Câu tiếng Việt đang trống'),
  source: z.enum(['ai', 'manual']).default('manual'),
});

export const grammarInput = z.object({
  pattern: z.string().trim().min(1, 'Chưa nhập mẫu ngữ pháp').max(200),
  meaning: z.string().trim().min(1, 'Chưa nhập nghĩa').max(500),
  /** How it attaches: V-て + しまう. */
  formation: optionalText(500),
  note: optionalText(2000),
  jlpt: z.enum(JLPT_VALUES).nullable().default(null),
  sentences: z
    .array(grammarSentenceInput)
    .min(1, 'Cần ít nhất một câu ví dụ')
    .max(MAX_GRAMMAR_SENTENCES, `Tối đa ${MAX_GRAMMAR_SENTENCES} câu ví dụ`),
});

export type GrammarInput = z.input<typeof grammarInput>;
export type GrammarData = z.output<typeof grammarInput>;

/** A sentence ready to store: the plain text derived once, here. */
export function withPlainText<T extends { jpRuby: string }>(sentence: T): T & { jp: string } {
  return { ...sentence, jp: rubyToPlain(sentence.jpRuby) };
}

/**
 * Which example a grammar card shows.
 *
 * Keyed on the card's review count, so it is the same on every device and
 * across a reload — nothing to store — and moves on after every rating,
 * including a learning step: answer Quên and the card comes back asking with
 * a different sentence, which is the point. Recalling the answer you gave a
 * minute ago is not producing the pattern.
 */
export function pickSentence<T>(sentences: readonly T[], reps: number): T | undefined {
  if (sentences.length === 0) return undefined;
  const at = ((Math.trunc(reps) % sentences.length) + sentences.length) % sentences.length;
  return sentences[at];
}
