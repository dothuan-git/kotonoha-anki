import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { kanji, sentences, settings, wordKanji, words } from '@/lib/db/schema';
import type { Settings } from '@/lib/db/schema';
import type { KanjiView, WordView } from '@/lib/types';

/**
 * Assembles WordViews for the given word rows: one query for the kanji joins,
 * one for the sentences. Two round trips regardless of how many words, rather
 * than a per-word N+1.
 */
async function hydrate(rows: (typeof words.$inferSelect)[]): Promise<WordView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((w) => w.id);

  const [kanjiRows, sentenceRows] = await Promise.all([
    db
      .select({
        wordId: wordKanji.wordId,
        position: wordKanji.position,
        char: kanji.char,
        hanViet: kanji.hanViet,
      })
      .from(wordKanji)
      .innerJoin(kanji, eq(kanji.char, wordKanji.kanjiChar))
      .where(inArray(wordKanji.wordId, ids))
      .orderBy(asc(wordKanji.position)),
    db
      .select()
      .from(sentences)
      .where(inArray(sentences.wordId, ids))
      .orderBy(asc(sentences.createdAt)),
  ]);

  const kanjiByWord = new Map<string, WordView['kanji']>();
  for (const row of kanjiRows) {
    const list = kanjiByWord.get(row.wordId) ?? [];
    // A word can repeat a character (人人); positions keep them distinct in
    // word_kanji, but the display list wants each character once.
    if (!list.some((k) => k.char === row.char)) {
      list.push({ char: row.char, hanViet: row.hanViet });
    }
    kanjiByWord.set(row.wordId, list);
  }

  const sentencesByWord = new Map<string, WordView['sentences']>();
  for (const row of sentenceRows) {
    const list = sentencesByWord.get(row.wordId) ?? [];
    list.push({ id: row.id, jp: row.jp, jpRuby: row.jpRuby, vi: row.vi, source: row.source });
    sentencesByWord.set(row.wordId, list);
  }

  return rows.map((w) => ({
    id: w.id,
    headword: w.headword,
    reading: w.reading,
    meaning: w.meaning,
    pos: w.pos,
    transitivity: w.transitivity ?? null,
    jlpt: w.jlpt ?? null,
    note: w.note,
    suspended: w.suspended,
    createdAt: w.createdAt.toISOString(),
    kanji: kanjiByWord.get(w.id) ?? [],
    sentences: sentencesByWord.get(w.id) ?? [],
  }));
}

/** /words — newest first, optionally filtered. Search covers all three text fields. */
export async function listWords(query?: string, limit = 200): Promise<WordView[]> {
  const q = query?.trim();
  const rows = await db
    .select()
    .from(words)
    .where(
      q
        ? or(
            ilike(words.headword, `%${q}%`),
            ilike(words.reading, `%${q}%`),
            ilike(words.meaning, `%${q}%`),
          )
        : undefined,
    )
    .orderBy(desc(words.createdAt))
    .limit(limit);

  return hydrate(rows);
}

export async function getWord(id: string): Promise<WordView | null> {
  const rows = await db.select().from(words).where(eq(words.id, id)).limit(1);
  const [view] = await hydrate(rows);
  return view ?? null;
}

/**
 * /kanji — only characters that appear in a saved word. The Unihan seed puts
 * ~10k reference rows in `kanji`; the index must show the user's collection,
 * not the whole Han repertoire.
 */
export async function listKanjiInUse(): Promise<KanjiView[]> {
  const rows = await db
    .select({
      char: kanji.char,
      hanViet: kanji.hanViet,
      meaningVi: kanji.meaningVi,
      jlpt: kanji.jlpt,
      wordCount: count(sql`distinct ${wordKanji.wordId}`),
    })
    .from(kanji)
    .innerJoin(wordKanji, eq(wordKanji.kanjiChar, kanji.char))
    .groupBy(kanji.char, kanji.hanViet, kanji.meaningVi, kanji.jlpt)
    .orderBy(desc(count(sql`distinct ${wordKanji.wordId}`)), asc(kanji.char));

  return rows.map((r) => ({
    char: r.char,
    hanViet: r.hanViet,
    meaningVi: r.meaningVi,
    jlpt: r.jlpt ?? null,
    wordCount: Number(r.wordCount),
  }));
}

/** /kanji/[char] — the character plus every word that uses it. */
export async function getKanjiWithWords(
  char: string,
): Promise<{ kanji: KanjiView; words: WordView[] } | null> {
  const [row] = await db.select().from(kanji).where(eq(kanji.char, char)).limit(1);
  if (!row) return null;

  const wordRows = await db
    .select()
    .from(words)
    .innerJoin(wordKanji, and(eq(wordKanji.wordId, words.id), eq(wordKanji.kanjiChar, char)))
    .orderBy(desc(words.createdAt));

  const hydrated = await hydrate(dedupeById(wordRows.map((r) => r.words)));

  return {
    kanji: {
      char: row.char,
      hanViet: row.hanViet,
      meaningVi: row.meaningVi,
      jlpt: row.jlpt ?? null,
      wordCount: hydrated.length,
    },
    words: hydrated,
  };
}

/** The join can repeat a word when the character occurs twice in it. */
function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

export async function countWords(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(words);
  return Number(row?.n ?? 0);
}

const SETTINGS_ID = 1;

/**
 * The single settings row, created with §4's defaults on first read.
 *
 * A read, so it lives here rather than in lib/actions: every export of a
 * 'use server' module becomes a callable endpoint, and a read exported from
 * there would be reachable without a session.
 */
export async function getSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).limit(1);
  if (row) return row;

  const [created] = await db
    .insert(settings)
    .values({ id: SETTINGS_ID })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Another request created it between the select and the insert.
  const [existing] = await db
    .select()
    .from(settings)
    .where(eq(settings.id, SETTINGS_ID))
    .limit(1);
  if (!existing) throw new Error('Could not initialise settings');
  return existing;
}
