import { randomUUID } from 'node:crypto';

import { asc, desc, eq, ilike, inArray, or } from 'drizzle-orm';

import { db } from '@/lib/db';
import { cardStates, cards, grammarPoints, grammarSentences } from '@/lib/db/schema';
import { withPlainText, type GrammarData } from '@/lib/grammar';
import type { GrammarView, Jlpt } from '@/lib/types';

/** Everything it takes to create a grammar point, already validated. */
export interface GrammarInsert extends GrammarData {
  /** Overridable so an import can stamp a batch. Defaults to now. */
  createdAt?: Date;
  sortOrder?: number;
  importBatchId?: string | null;
}

type Statement = Parameters<typeof db.batch>[0][number];
type Batch = [Statement, ...Statement[]];

/**
 * The rows one grammar point is made of, built but not sent: the point, its
 * sentences, its card, and the card's empty state.
 *
 * The same shape as `wordStatements` and for the same reason — the point and
 * its card state share one `createdAt`, because an empty log folds to
 * `createEmptyCard(created_at)` and a second timestamp would drift on the
 * first recompute.
 */
export function grammarStatements(data: GrammarInsert): {
  grammarId: string;
  statements: Statement[];
} {
  const grammarId = randomUUID();
  const cardId = randomUUID();
  const createdAt = data.createdAt ?? new Date();

  const statements: Statement[] = [
    db.insert(grammarPoints).values({
      id: grammarId,
      createdAt,
      pattern: data.pattern,
      meaning: data.meaning,
      formation: data.formation,
      note: data.note,
      jlpt: data.jlpt,
      sortOrder: data.sortOrder ?? 0,
      importBatchId: data.importBatchId ?? null,
    }),
    sentenceInsert(grammarId, data.sentences, createdAt),
    db.insert(cards).values({ id: cardId, grammarId }),
    // State 0 is `State.New`, due at creation — exactly what an empty log
    // folds to, as for a word.
    db.insert(cardStates).values({ cardId, due: createdAt, state: 0, reps: 0, lapses: 0 }),
  ];

  return { grammarId, statements };
}

function sentenceInsert(grammarId: string, sentences: GrammarData['sentences'], createdAt: Date) {
  return db.insert(grammarSentences).values(
    sentences.map((sentence, sortOrder) => ({
      grammarId,
      ...withPlainText(sentence),
      sortOrder,
      createdAt,
    })),
  );
}

/** One round trip; Neon applies a batch as a single transaction. */
export async function insertGrammar(data: GrammarInsert): Promise<string> {
  const { grammarId, statements } = grammarStatements(data);
  await db.batch(statements as Batch);
  return grammarId;
}

/**
 * Rewrites a point and its sentences.
 *
 * The sentences are replaced wholesale rather than diffed: nothing hangs off
 * a sentence — the card rotates through them by position, the log never names
 * one — so there is no history to preserve by keeping row ids.
 *
 * The card is not touched. Editing what a card says does not reset what you
 * know about it.
 */
export async function replaceGrammar(id: string, data: GrammarData): Promise<boolean> {
  const [existing] = await db
    .select({ id: grammarPoints.id, createdAt: grammarPoints.createdAt })
    .from(grammarPoints)
    .where(eq(grammarPoints.id, id))
    .limit(1);
  if (!existing) return false;

  await db.batch([
    db
      .update(grammarPoints)
      .set({
        pattern: data.pattern,
        meaning: data.meaning,
        formation: data.formation,
        note: data.note,
        jlpt: data.jlpt,
      })
      .where(eq(grammarPoints.id, id)),
    db.delete(grammarSentences).where(eq(grammarSentences.grammarId, id)),
    sentenceInsert(id, data.sentences, new Date()),
  ]);
  return true;
}

/** Rows to views, sentences attached in rotation order. One extra query. */
export async function hydrateGrammar(
  rows: readonly (typeof grammarPoints.$inferSelect)[],
): Promise<GrammarView[]> {
  if (rows.length === 0) return [];

  const sentenceRows = await db
    .select()
    .from(grammarSentences)
    .where(
      inArray(
        grammarSentences.grammarId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(grammarSentences.sortOrder), asc(grammarSentences.createdAt));

  const byPoint = new Map<string, GrammarView['sentences']>();
  for (const s of sentenceRows) {
    const list = byPoint.get(s.grammarId) ?? [];
    list.push({ id: s.id, jp: s.jp, jpRuby: s.jpRuby, vi: s.vi, source: s.source });
    byPoint.set(s.grammarId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    pattern: row.pattern,
    meaning: row.meaning,
    formation: row.formation,
    note: row.note,
    jlpt: row.jlpt as Jlpt | null,
    suspended: row.suspended,
    createdAt: row.createdAt.toISOString(),
    sentences: byPoint.get(row.id) ?? [],
  }));
}

/** /grammar/list — newest first, optionally filtered on pattern or meaning. */
export async function listGrammar(query?: string, limit = 300): Promise<GrammarView[]> {
  const q = query?.trim();
  const rows = await db
    .select()
    .from(grammarPoints)
    .where(
      q
        ? or(ilike(grammarPoints.pattern, `%${q}%`), ilike(grammarPoints.meaning, `%${q}%`))
        : undefined,
    )
    .orderBy(desc(grammarPoints.createdAt), desc(grammarPoints.sortOrder))
    .limit(limit);
  return hydrateGrammar(rows);
}

export async function getGrammar(id: string): Promise<GrammarView | null> {
  const rows = await db.select().from(grammarPoints).where(eq(grammarPoints.id, id)).limit(1);
  const [view] = await hydrateGrammar(rows);
  return view ?? null;
}

/** A grammar point is four statements; twenty points is one comfortable round trip. */
const IMPORT_CHUNK_SIZE = 20;

/**
 * Writes many grammar points, chunked — the grammar twin of `insertWords`,
 * with the same fallback: a chunk that fails is retried a point at a time,
 * so one bad row costs only itself.
 */
export async function insertGrammarRows(
  rows: readonly GrammarInsert[],
): Promise<{ index: number; grammarId?: string; error?: unknown }[]> {
  const outcomes: { index: number; grammarId?: string; error?: unknown }[] = [];

  for (let start = 0; start < rows.length; start += IMPORT_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + IMPORT_CHUNK_SIZE);
    const built = chunk.map(grammarStatements);

    try {
      await db.batch(built.flatMap((b) => b.statements) as Batch);
      built.forEach((b, i) => outcomes.push({ index: start + i, grammarId: b.grammarId }));
    } catch {
      for (const [i, row] of chunk.entries()) {
        try {
          outcomes.push({ index: start + i, grammarId: await insertGrammar(row) });
        } catch (error) {
          outcomes.push({ index: start + i, error });
        }
      }
    }
  }

  return outcomes;
}
