import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireSession } from '@/lib/auth';
import { insertGrammarRows, type GrammarInsert } from '@/lib/db/grammar';
import {
  createImportBatch,
  deleteImportBatch,
  findExistingGrammar,
  findExistingPairs,
} from '@/lib/db/imports';
import { insertWords } from '@/lib/db/words';
import type { WordInsert } from '@/lib/db/words';
import {
  applyExclusions,
  countRows,
  grammarKey,
  pairKey,
  parseGrammarImport,
  parseImport,
  toPreview,
  type ImportReport,
  type ParseOutcome,
  type ParsedRow,
} from '@/lib/import';
import type { CardKind } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * A thousand words of JSON with a sentence each is well under half a megabyte;
 * this is the bound on a file that is not what it claims to be, and it is
 * checked before the bytes are read into a string.
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Bulk import, in two passes over the same file.
 *
 * A route handler rather than a server action because the input is an upload,
 * and server action bodies are capped at 1 MB. The client posts the file once
 * with `dryRun=1` to get the preview it asks the user to confirm, then posts
 * the same bytes again to commit — so there is no half-finished import parked
 * on the server between the two, and the duplicate check is made fresh both
 * times rather than trusted from the first.
 *
 * Errors here are Vietnamese, unlike /api/sync: that route answers a
 * background replay nobody reads, and this one answers a screen.
 *
 * Words by default; `kind=grammar` takes a grammar file through the same two
 * passes — its own parser, duplicate check and insert, the same everything
 * else. See `IMPORTERS`.
 */
export async function POST(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'Chưa đăng nhập' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Không đọc được dữ liệu gửi lên' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Chưa chọn tệp' }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith('.json')) {
    return NextResponse.json({ error: 'Chỉ nhận tệp .json' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'Tệp quá lớn (tối đa 2 MB)' }, { status: 400 });
  }

  const dryRun = form.get('dryRun') !== '0';
  const excluded = parseExclusions(form.get('exclude'));
  const kind: CardKind = form.get('kind') === 'grammar' ? 'grammar' : 'word';
  // Two arms rather than one lookup, so each importer keeps its own row type.
  return kind === 'grammar'
    ? run(IMPORTERS.grammar, file, dryRun, excluded)
    : run(IMPORTERS.word, file, dryRun, excluded);
}

/** What differs between a word import and a grammar import. Nothing else does. */
interface Importer<T> {
  kind: CardKind;
  parse: (text: string, fallbackSource: string) => ParseOutcome<T>;
  /** The `ok` rows already in the book, as keys `keyOf` understands. */
  existing: (rows: ParsedRow<T>[]) => Promise<Set<string>>;
  keyOf: (row: ParsedRow<T>) => string;
  insert: (rows: T[]) => Promise<{ index: number; error?: unknown; id?: string }[]>;
  noun: string;
  revalidate: () => void;
}

const IMPORTERS = {
  word: {
    kind: 'word',
    parse: parseImport,
    existing: (rows) => findExistingPairs(rows),
    keyOf: pairKey,
    insert: async (rows) =>
      (await insertWords(rows)).map((o) => ({ index: o.index, error: o.error, id: o.wordId })),
    noun: 'từ',
    revalidate: () => {
      revalidatePath('/words');
      revalidatePath('/kanji');
    },
  } satisfies Importer<WordInsert>,
  grammar: {
    kind: 'grammar',
    parse: parseGrammarImport,
    existing: (rows) =>
      findExistingGrammar(rows.map((r) => ({ pattern: r.headword, meaning: r.meaning }))),
    keyOf: (row) => grammarKey({ pattern: row.headword, meaning: row.meaning }),
    insert: async (rows) =>
      (await insertGrammarRows(rows)).map((o) => ({
        index: o.index,
        error: o.error,
        id: o.grammarId,
      })),
    noun: 'mẫu',
    revalidate: () => {
      revalidatePath('/grammar/list');
      revalidatePath('/grammar');
    },
  } satisfies Importer<GrammarInsert>,
};

async function run<T extends { createdAt?: Date; importBatchId?: string | null }>(
  importer: Importer<T>,
  file: File,
  dryRun: boolean,
  excluded: ReadonlySet<number>,
) {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return NextResponse.json({ error: 'Không đọc được nội dung tệp' }, { status: 400 });
  }

  const parsed = importer.parse(text, stripExtension(file.name));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { source, note, rows } = parsed.result;

  let checked: ParsedRow<T>[];
  try {
    checked = await markDuplicates(importer, rows);
  } catch (error) {
    console.error('[import] duplicate check failed', error);
    return NextResponse.json(
      { error: `Không kiểm tra được ${importer.noun} trùng` },
      { status: 503 },
    );
  }

  const marked = applyExclusions(checked, excluded);
  const counts = countRows(marked);

  if (dryRun) {
    return NextResponse.json({ source, rows: toPreview(marked), counts } satisfies ImportReport);
  }

  if (counts.ok === 0) {
    return NextResponse.json(
      { error: `Không có ${importer.noun} nào hợp lệ để nhập` },
      { status: 400 },
    );
  }

  try {
    const inserted = await commit(importer, marked, { source, note });
    importer.revalidate();
    return NextResponse.json({
      source,
      rows: toPreview(marked),
      // Recounted: `commit` demotes any row the database refused.
      counts: countRows(marked),
      batchId: inserted.batchId,
      inserted: inserted.count,
    } satisfies ImportReport);
  } catch (error) {
    console.error('[import] failed', error);
    return NextResponse.json({ error: `Không nhập được ${importer.noun}` }, { status: 503 });
  }
}

/** Flips the rows already in the book from `ok` to `duplicate`. */
async function markDuplicates<T>(
  importer: Importer<T>,
  rows: ParsedRow<T>[],
): Promise<ParsedRow<T>[]> {
  const candidates = rows.filter((r) => r.status === 'ok');
  const existing = await importer.existing(candidates);
  const reason = importer.kind === 'grammar' ? 'Đã có trong kho ngữ pháp' : 'Đã có trong sổ từ';

  return rows.map((row) =>
    row.status === 'ok' && existing.has(importer.keyOf(row))
      ? { ...row, status: 'duplicate' as const, reason, data: undefined }
      : row,
  );
}

/**
 * Writes the batch and its words. Mutates `rows` in place so that a row the
 * database refused still reaches the response as a failure with a reason,
 * rather than silently reading as imported.
 *
 * Every word takes the same `createdAt` — they arrive together and the clock
 * does not tick between them — which is what puts the whole batch in one place
 * in the new-card queue and leaves `sortOrder` to carry the file's order.
 */
async function commit<T extends { createdAt?: Date; importBatchId?: string | null }>(
  importer: Importer<T>,
  rows: ParsedRow<T>[],
  batch: { source: string; note: string | null },
): Promise<{ batchId?: string; count: number }> {
  const batchId = await createImportBatch({ ...batch, kind: importer.kind });
  const createdAt = new Date();

  const pending = rows.filter((r) => r.status === 'ok' && r.data);
  const payload: T[] = pending.map((r) => ({
    ...(r.data as T),
    createdAt,
    importBatchId: batchId,
  }));

  const outcomes = await importer.insert(payload);

  let count = 0;
  for (const outcome of outcomes) {
    const row = pending[outcome.index];
    if (!row) continue;
    if (outcome.id) {
      count++;
      continue;
    }
    console.error(`[import] row ${row.index} failed`, outcome.error);
    row.status = 'invalid';
    row.reason = `Không lưu được ${importer.noun} này`;
  }

  // An import that wrote nothing leaves no batch behind to wonder about.
  if (count === 0) {
    await deleteImportBatch(batchId);
    return { count };
  }

  return { batchId, count };
}

/**
 * The rows the user struck off in the preview, by file position.
 *
 * Positions rather than words: the file is re-parsed on commit, so the index
 * means the same row both times, and nothing about the word itself has to be
 * trusted from the round trip. A malformed field is read as "nothing was
 * removed" — the preview is still shown before anything is written, so the
 * worst it can do is import a word the user asked to drop, which the batch
 * undo covers.
 */
function parseExclusions(raw: FormDataEntryValue | null): ReadonlySet<number> {
  if (typeof raw !== 'string' || raw === '') return new Set();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[import] unreadable exclude field');
    return new Set();
  }

  if (!Array.isArray(parsed)) return new Set();
  return new Set(parsed.filter((i): i is number => Number.isInteger(i)));
}

function stripExtension(filename: string): string {
  return filename.replace(/\.json$/i, '');
}
