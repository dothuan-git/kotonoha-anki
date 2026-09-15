import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import { cardStates, cards, kanji, sentences, wordKanji, words } from '@/lib/db/schema';
import { extractKanji } from '@/lib/dict/furigana';
import type { Jlpt, Pos, Transitivity } from '@/lib/types';

/** Everything it takes to create a word, already validated by the caller. */
export interface WordInsert {
  headword: string;
  reading: string;
  meaning: string;
  pos: Pos;
  transitivity: Transitivity;
  jlpt: Jlpt | null;
  note: string | null;
  /** Hán Việt typed by hand, for the gaps in the Unihan data. */
  hanViet: Record<string, string[]>;
  sentence: { jp: string; jpRuby: string; vi: string; source: 'ai' | 'manual' } | null;
  /** Overridable so a seed can backdate a word. Defaults to now. */
  createdAt?: Date;
  /** Position within an import, breaking the tie when a batch shares one `createdAt`. */
  sortOrder?: number;
  /** The import this word came from, or null when it was typed in by hand. */
  importBatchId?: string | null;
}

type Statement = Parameters<typeof db.batch>[0][number];
type Batch = [Statement, ...Statement[]];

/**
 * Writes a word, its kanji links, an optional first sentence, and its card.
 *
 * One card, always. The word is asked from both sides in a session — the
 * Japanese and the meaning — but those are two showings of one schedule, not
 * two cards, so there is nothing here to unlock later and nothing to wait for:
 * a word added this morning is asked both ways this evening.
 *
 * Lives here rather than inside the server action so that a seed script
 * creates rows through exactly this path. The subtle part is not the insert —
 * it is that the word and its card state share one `createdAt`, because
 * `recomputeCardState` folds an empty log to `createEmptyCard(word.created_at)`
 * and a second timestamp would make every seeded row drift on the first
 * `npm run recompute`.
 *
 * The neon-http driver has no interactive transactions, so ids are generated
 * here and the whole insert goes through `db.batch`, which Neon applies as a
 * single transaction. Order matters: kanji rows must exist before word_kanji
 * can reference them.
 *
 * Throws on a duplicate (headword, reading); callers decide what that means.
 */
export async function insertWord(data: WordInsert): Promise<string> {
  const { wordId, statements } = wordStatements(data);
  await db.batch(statements as Batch);
  return wordId;
}

/**
 * The rows one word is made of, built but not sent.
 *
 * Split out so a bulk import writes through exactly the same statements as the
 * add form rather than a second, drifting copy of them — the ids have to be
 * generated up front anyway, which is what makes the statements portable
 * between one batch and a shared one.
 */
function wordStatements(data: WordInsert): { wordId: string; statements: Statement[] } {
  const wordId = randomUUID();
  const cardId = randomUUID();
  const chars = extractKanji(data.headword);
  const createdAt = data.createdAt ?? new Date();

  const batch: Statement[] = [
    db.insert(words).values({
      id: wordId,
      createdAt,
      headword: data.headword,
      reading: data.reading,
      meaning: data.meaning,
      pos: data.pos,
      transitivity: data.transitivity,
      jlpt: data.jlpt,
      note: data.note,
      sortOrder: data.sortOrder ?? 0,
      importBatchId: data.importBatchId ?? null,
    }),
  ];

  // Ensure a kanji row exists for every character before linking to it. The
  // Unihan seed usually got there first; this covers gaps and hand-typed
  // readings without a second round trip.
  for (const char of [...new Set(chars)]) {
    const hanViet = normaliseHanViet(data.hanViet[char]);
    batch.push(
      hanViet.length > 0
        ? db
            .insert(kanji)
            .values({ char, hanViet })
            .onConflictDoUpdate({ target: kanji.char, set: { hanViet } })
        : db.insert(kanji).values({ char, hanViet: [] }).onConflictDoNothing(),
    );
  }

  chars.forEach((char, position) => {
    batch.push(db.insert(wordKanji).values({ wordId, kanjiChar: char, position }));
  });

  if (data.sentence) {
    batch.push(
      db.insert(sentences).values({
        wordId,
        jp: data.sentence.jp,
        jpRuby: data.sentence.jpRuby,
        vi: data.sentence.vi,
        source: data.sentence.source,
        createdAt,
      }),
    );
  }

  batch.push(
    db.insert(cards).values({ id: cardId, wordId }),
    // State 0 is ts-fsrs `State.New`. Due at creation so the card enters the
    // first session; the row is still a projection — an empty log folds to
    // exactly this, which is what lets `npm run recompute` reproduce it.
    db.insert(cardStates).values({ cardId, due: createdAt, state: 0, reps: 0, lapses: 0 }),
  );

  return { wordId, statements: batch };
}

/**
 * How many words share one round trip. A word is five or six statements, so a
 * chunk of twenty is a request of about a hundred — enough to make a
 * three-hundred-word import fifteen round trips instead of three hundred,
 * small enough that a rollback costs little.
 */
const IMPORT_CHUNK_SIZE = 20;

export interface InsertOutcome {
  /** Position in the array handed in, so a failure can be named in the file. */
  index: number;
  wordId?: string;
  error?: unknown;
}

/**
 * Writes many words, chunked.
 *
 * Neon applies a `db.batch` as one transaction, which is what makes the chunk
 * fast and also means one bad row takes its nineteen neighbours down with it.
 * So a failed chunk is retried a word at a time: the import gives up only on
 * the row that actually failed, and the caller learns which one. Duplicates are
 * filtered out before this point, so the slow path should stay rare.
 */
export async function insertWords(rows: readonly WordInsert[]): Promise<InsertOutcome[]> {
  const outcomes: InsertOutcome[] = [];

  for (let start = 0; start < rows.length; start += IMPORT_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + IMPORT_CHUNK_SIZE);
    const built = chunk.map(wordStatements);

    try {
      await db.batch(built.flatMap((b) => b.statements) as Batch);
      built.forEach((b, i) => outcomes.push({ index: start + i, wordId: b.wordId }));
    } catch {
      // The whole chunk rolled back, including the rows that were fine. Nothing
      // was committed, so the ids built above are simply discarded.
      for (const [i, row] of chunk.entries()) {
        try {
          outcomes.push({ index: start + i, wordId: await insertWord(row) });
        } catch (error) {
          outcomes.push({ index: start + i, error });
        }
      }
    }
  }

  return outcomes;
}

/** Stored lowercase to match Unihan; display uppercases via formatHanViet. */
export function normaliseHanViet(input: string[] | undefined): string[] {
  if (!input) return [];
  return [
    ...new Set(
      input
        .flatMap((s) => s.split(/[\s,/·]+/))
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
