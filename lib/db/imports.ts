import { count, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { grammarPoints, importBatches, words } from '@/lib/db/schema';
import { grammarKey, pairKey } from '@/lib/import';
import type { CardKind, ImportBatchView } from '@/lib/types';

/**
 * Which of these words are already in the book, as a set of `pairKey`s.
 *
 * One query rather than a select per row, and ahead of the insert rather than
 * catching 23505 afterwards: the user is shown what will be skipped *before*
 * agreeing to the import, which a constraint violation cannot do. The insert
 * still has the unique index behind it — this narrows the preview, it does not
 * replace the guarantee.
 */
export async function findExistingPairs(
  pairs: readonly { headword: string; reading: string }[],
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();

  // Filtering on the headword alone keeps this to one bounded `in` list; the
  // reading is matched in memory, where the pair is cheap to check.
  const rows = await db
    .select({ headword: words.headword, reading: words.reading })
    .from(words)
    .where(inArray(words.headword, [...new Set(pairs.map((p) => p.headword))]));

  const wanted = new Set(pairs.map(pairKey));
  return new Set(rows.map(pairKey).filter((key) => wanted.has(key)));
}

/** `findExistingPairs` for grammar: which of these points are already in the book. */
export async function findExistingGrammar(
  points: readonly { pattern: string; meaning: string }[],
): Promise<Set<string>> {
  if (points.length === 0) return new Set();

  const rows = await db
    .select({ pattern: grammarPoints.pattern, meaning: grammarPoints.meaning })
    .from(grammarPoints)
    .where(inArray(grammarPoints.pattern, [...new Set(points.map((p) => p.pattern))]));

  const wanted = new Set(points.map(grammarKey));
  return new Set(rows.map(grammarKey).filter((key) => wanted.has(key)));
}

export async function createImportBatch(input: {
  kind?: CardKind;
  source: string;
  note: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(importBatches)
    .values({ kind: input.kind ?? 'word', source: input.source, note: input.note })
    .returning({ id: importBatches.id });

  if (!row) throw new Error('Could not create import batch');
  return row.id;
}

/**
 * The import history on /add/bulk or /grammar/add/bulk, newest first — each
 * screen lists its own kind.
 *
 * `wordCount` is counted rather than stored because it is not the size of the
 * file: rows deleted since are gone from it, which is exactly what the undo
 * button needs to say out loud before it runs.
 */
export async function listImportBatches(kind: CardKind = 'word'): Promise<ImportBatchView[]> {
  const owner = kind === 'grammar' ? grammarPoints : words;
  const rows = await db
    .select({
      id: importBatches.id,
      source: importBatches.source,
      note: importBatches.note,
      createdAt: importBatches.createdAt,
      wordCount: count(owner.id),
    })
    .from(importBatches)
    .leftJoin(owner, eq(owner.importBatchId, importBatches.id))
    .where(eq(importBatches.kind, kind))
    .groupBy(importBatches.id, importBatches.source, importBatches.note, importBatches.createdAt)
    .orderBy(desc(importBatches.createdAt));

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    wordCount: Number(r.wordCount),
  }));
}

/**
 * Undoes an import: the words it created, then the batch row itself.
 *
 * The schema's `set null` deliberately makes deleting a batch row *not* delete
 * its words, so this does both explicitly. Cascades take the sentences, cards,
 * card_states, review_logs and confusions with each word — a word imported and
 * then studied for a month loses that history too, which is why the caller
 * asks first.
 */
export async function deleteImportBatch(id: string): Promise<number> {
  // Both kinds, whichever the batch held: the other delete simply finds nothing.
  const [deletedWords, deletedGrammar] = await Promise.all([
    db.delete(words).where(eq(words.importBatchId, id)).returning({ id: words.id }),
    db
      .delete(grammarPoints)
      .where(eq(grammarPoints.importBatchId, id))
      .returning({ id: grammarPoints.id }),
  ]);

  await db.delete(importBatches).where(eq(importBatches.id, id));
  return deletedWords.length + deletedGrammar.length;
}
