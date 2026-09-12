'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { kanji, sentences, wordKanji, words } from '@/lib/db/schema';
import { insertWord, isUniqueViolation, normaliseHanViet } from '@/lib/db/words';
import { extractKanji } from '@/lib/dict/furigana';
import { JLPT_VALUES, POS_VALUES, TRANSITIVITY_VALUES } from '@/lib/types';

const wordInput = z.object({
  headword: z.string().trim().min(1, 'Chưa nhập từ'),
  reading: z.string().trim().min(1, 'Chưa nhập cách đọc'),
  meaning: z.string().trim().min(1, 'Chưa nhập nghĩa'),
  pos: z.enum(POS_VALUES),
  transitivity: z.enum(TRANSITIVITY_VALUES).nullable().default(null),
  jlpt: z.enum(JLPT_VALUES).nullable().default(null),
  note: z.string().trim().max(2000).nullable().default(null),
  /** Hán Việt typed by hand, for the Unihan gaps §9 warns about. */
  hanViet: z.record(z.string(), z.array(z.string())).default({}),
  sentence: z
    .object({
      jp: z.string().trim().min(1),
      jpRuby: z.string().trim().min(1),
      vi: z.string().trim().min(1),
      source: z.enum(['ai', 'manual']).default('manual'),
    })
    .nullable()
    .default(null),
});

export type WordInput = z.input<typeof wordInput>;
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const OK: ActionResult = { ok: true, data: undefined };

/**
 * Creates a word from the add form. The write itself is `insertWord`, shared
 * with the seed script so both produce identical rows; this layer is the
 * session check, validation and cache invalidation around it.
 */
export async function createWord(input: WordInput): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSession();
  } catch {
    return fail('Chưa đăng nhập');
  }

  const parsed = wordInput.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ');
  }
  const data = parsed.data;

  let wordId: string;
  try {
    wordId = await insertWord(data);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail('Từ này đã có trong sổ (cùng cách đọc)');
    }
    console.error('[createWord] failed', error);
    return fail('Không lưu được từ');
  }

  revalidatePath('/words');
  revalidatePath('/kanji');
  return { ok: true, data: { id: wordId } };
}

const updateInput = wordInput.partial().extend({ id: z.string().uuid() });

/** Inline edit from /words. Kanji links are rebuilt only if the headword changed. */
export async function updateWord(input: z.input<typeof updateInput>): Promise<ActionResult> {
  try {
    await requireSession();
  } catch {
    return fail('Chưa đăng nhập');
  }

  const parsed = updateInput.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ');
  }
  const { id, sentence, hanViet: _hanViet, ...fields } = parsed.data;

  const patch = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as Partial<typeof words.$inferInsert>;

  try {
    const [existing] = await db.select().from(words).where(eq(words.id, id)).limit(1);
    if (!existing) return fail('Không tìm thấy từ');

    if (Object.keys(patch).length > 0) {
      await db.update(words).set(patch).where(eq(words.id, id));
    }

    if (patch.headword && patch.headword !== existing.headword) {
      await rebuildKanjiLinks(id, patch.headword);
    }

    if (sentence) {
      const [first] = await db
        .select({ id: sentences.id })
        .from(sentences)
        .where(eq(sentences.wordId, id))
        .limit(1);

      if (first) {
        await db
          .update(sentences)
          .set({ jp: sentence.jp, jpRuby: sentence.jpRuby, vi: sentence.vi })
          .where(eq(sentences.id, first.id));
      } else {
        await db.insert(sentences).values({ wordId: id, ...sentence });
      }
    }
  } catch (error) {
    if (isUniqueViolation(error)) return fail('Từ này đã có trong sổ (cùng cách đọc)');
    console.error('[updateWord] failed', error);
    return fail('Không cập nhật được từ');
  }

  revalidatePath('/words');
  revalidatePath('/kanji');
  return OK;
}

async function rebuildKanjiLinks(wordId: string, headword: string) {
  await db.delete(wordKanji).where(eq(wordKanji.wordId, wordId));

  const chars = extractKanji(headword);
  if (chars.length === 0) return;

  for (const char of [...new Set(chars)]) {
    await db.insert(kanji).values({ char, hanViet: [] }).onConflictDoNothing();
  }
  await db
    .insert(wordKanji)
    .values(chars.map((char, position) => ({ wordId, kanjiChar: char, position })));
}

/**
 * Deletes a word outright. §4 forbids *auto*-deleting or auto-suspending on
 * leeches; an explicit delete by the user is a different thing. Cascades take
 * the sentences, cards, card_states and review_logs with it.
 */
export async function deleteWord(id: string): Promise<ActionResult> {
  try {
    await requireSession();
  } catch {
    return fail('Chưa đăng nhập');
  }

  try {
    await db.delete(words).where(eq(words.id, id));
  } catch (error) {
    console.error('[deleteWord] failed', error);
    return fail('Không xoá được từ');
  }

  revalidatePath('/words');
  revalidatePath('/kanji');
  return OK;
}

/** §4: never auto-suspend. This is the manual toggle. */
export async function setSuspended(id: string, suspended: boolean): Promise<ActionResult> {
  try {
    await requireSession();
  } catch {
    return fail('Chưa đăng nhập');
  }

  await db.update(words).set({ suspended }).where(eq(words.id, id));
  revalidatePath('/words');
  return OK;
}

/** Hand-typed Hán Việt for a character, from /kanji or the add form. */
export async function setKanjiDetails(
  char: string,
  details: { hanViet?: string[]; meaningVi?: string | null },
): Promise<ActionResult> {
  try {
    await requireSession();
  } catch {
    return fail('Chưa đăng nhập');
  }

  const patch: Partial<typeof kanji.$inferInsert> = {};
  if (details.hanViet) patch.hanViet = normaliseHanViet(details.hanViet);
  if (details.meaningVi !== undefined) patch.meaningVi = details.meaningVi;

  await db
    .insert(kanji)
    .values({ char, hanViet: patch.hanViet ?? [], meaningVi: patch.meaningVi ?? null })
    .onConflictDoUpdate({ target: kanji.char, set: patch });

  revalidatePath('/kanji');
  revalidatePath(`/kanji/${char}`);
  return OK;
}


