import { z } from 'zod';

import type { WordInsert } from '@/lib/db/words';
import { extractKanji } from '@/lib/dict/furigana';
import { parseRuby, rubyToPlain } from '@/lib/ruby';
import {
  JLPT_VALUES,
  POS_LABELS,
  POS_VALUES,
  TRANSITIVITY_VALUES,
  type Pos,
} from '@/lib/types';

/**
 * Parses a bulk-import file into rows ready for `insertWord`.
 *
 * Pure on purpose: no database, no session, no value import from `lib/db` —
 * the preview the user confirms and the rows that actually get written come
 * out of this one function, so there is no second parser to disagree with the
 * first.
 *
 * The bound is here for the same reason as `MAX_BATCH` in /api/sync: a
 * generated file is not a trusted file, and one request must not ask the
 * server to insert forever.
 */
export const MAX_IMPORT_ROWS = 1000;

export type RowStatus = 'ok' | 'invalid' | 'duplicate' | 'excluded';

/**
 * One row of the file, judged. `index` is its position in the file and becomes
 * `sort_order`, which is what carries the author's ordering into the new-card
 * queue — a whole batch shares one `created_at`, so nothing else can.
 *
 * The text fields are kept even for a rejected row: the preview has to name
 * the word it is refusing. `data` is present only on a row that will be
 * written — not on a rejected one, nor on one the user struck off.
 */
export interface ParsedRow {
  index: number;
  status: RowStatus;
  /** Vietnamese, shown in the preview. Present on a row the parser refused. */
  reason?: string;
  headword: string;
  reading: string;
  meaning: string;
  data?: WordInsert;
}

export interface ParseResult {
  source: string;
  note: string | null;
  rows: ParsedRow[];
}

export type ParseOutcome =
  | { ok: true; result: ParseResult }
  | { ok: false; error: string };

/**
 * A row on its way to the browser. `data` is dropped: the preview needs to
 * name each word and say what will happen to it, and shipping the full insert
 * payload back out would double the response for nothing — the file is posted
 * again to commit, so the server re-parses rather than trusting a round trip.
 */
export type PreviewRow = Omit<ParsedRow, 'data'>;

export interface ImportReport {
  source: string;
  rows: PreviewRow[];
  counts: Record<RowStatus, number>;
  /** Both present only after a real import, absent on a dry run. */
  batchId?: string;
  inserted?: number;
}

export function toPreview(rows: readonly ParsedRow[]): PreviewRow[] {
  return rows.map(({ data: _data, ...row }) => row);
}

/**
 * The shape Claude is asked to emit. Deliberately more forgiving than
 * `wordInput` in lib/actions/words: unknown keys are ignored, `hanViet` takes
 * a bare string as well as an array, and a supplied `sentence.jp` is ignored
 * rather than trusted — see `toSentence`.
 */
const rowSchema = z.object({
  // Every message is given twice over: `error` covers a field that is missing
  // or of the wrong type, `min` covers one that is present but empty. Zod's
  // own default for the first is English, and it would be shown to the user
  // verbatim in the preview.
  headword: z.string({ error: 'Thiếu từ tiếng Nhật' }).trim().min(1, 'Thiếu từ tiếng Nhật'),
  reading: z.string({ error: 'Thiếu cách đọc' }).trim().min(1, 'Thiếu cách đọc'),
  meaning: z.string({ error: 'Thiếu nghĩa tiếng Việt' }).trim().min(1, 'Thiếu nghĩa tiếng Việt'),
  pos: z.string({ error: 'Thiếu từ loại' }).trim().min(1, 'Thiếu từ loại'),
  transitivity: z
    .enum(TRANSITIVITY_VALUES, { error: 'Tính chất động từ phải là transitive hoặc intransitive' })
    .nullish(),
  jlpt: z.enum(JLPT_VALUES, { error: 'Cấp JLPT phải là N5, N4, N3, N2 hoặc N1' }).nullish(),
  note: z.string({ error: 'Ghi chú phải là chữ' }).trim().max(2000, 'Ghi chú quá dài').nullish(),
  hanViet: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]), {
      error: 'Hán Việt phải là object dạng { "勉": ["miễn"] }',
    })
    .nullish(),
  sentence: z
    .object(
      {
        jpRuby: z
          .string({ error: 'Câu ví dụ thiếu phần tiếng Nhật' })
          .trim()
          .min(1, 'Câu ví dụ thiếu phần tiếng Nhật'),
        vi: z
          .string({ error: 'Câu ví dụ thiếu bản dịch tiếng Việt' })
          .trim()
          .min(1, 'Câu ví dụ thiếu bản dịch tiếng Việt'),
      },
      { error: 'Câu ví dụ phải là object có jpRuby và vi' },
    )
    .nullish(),
});

const fileSchema = z.union([
  z.array(z.unknown()),
  z.object({
    source: z.string().trim().nullish(),
    note: z.string().trim().nullish(),
    words: z.array(z.unknown()),
  }),
]);

/**
 * Vietnamese label back to the stored English enum.
 *
 * `POS_LABELS` is documented as display-only and nothing read back from it
 * until now. A file written by Claude may well come back in the language the
 * rest of the app speaks, and failing an import over that would be a silly
 * reason to fail one; the column still stores English either way.
 */
const POS_BY_LABEL = new Map<string, Pos>(
  (Object.entries(POS_LABELS) as [Pos, string][]).map(([pos, label]) => [
    label.toLowerCase(),
    pos,
  ]),
);
const POS_BY_VALUE = new Map<string, Pos>(POS_VALUES.map((p) => [p.toLowerCase(), p]));

function normalisePos(raw: string): Pos | null {
  const key = raw.trim().toLowerCase();
  return POS_BY_VALUE.get(key) ?? POS_BY_LABEL.get(key) ?? null;
}

/** `{ "勉": "miễn" }` and `{ "勉": ["miễn"] }` mean the same thing. */
function normaliseHanVietInput(
  input: Record<string, string | string[]> | null | undefined,
): Record<string, string[]> {
  if (!input) return {};
  return Object.fromEntries(
    Object.entries(input).map(([char, value]) => [
      char,
      typeof value === 'string' ? [value] : value,
    ]),
  );
}

export function parseImport(text: string, fallbackSource: string): ParseOutcome {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Tệp không phải JSON hợp lệ' };
  }

  const file = fileSchema.safeParse(json);
  if (!file.success) {
    return {
      ok: false,
      error: 'Tệp phải là một mảng từ, hoặc một object có trường "words"',
    };
  }

  const envelope = Array.isArray(file.data)
    ? { source: null, note: null, words: file.data }
    : file.data;

  if (envelope.words.length === 0) {
    return { ok: false, error: 'Tệp không có từ nào' };
  }
  if (envelope.words.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `Tệp có ${envelope.words.length} từ, tối đa ${MAX_IMPORT_ROWS} từ mỗi lần nhập`,
    };
  }

  // Rows keep their file position even when rejected, so `sortOrder` stays the
  // order the author wrote: a skipped row leaves a gap rather than shifting
  // everything after it.
  const seen = new Map<string, number>();
  const rows = envelope.words.map((raw, index) => parseRow(raw, index, seen));

  return {
    ok: true,
    result: {
      source: envelope.source?.trim() || fallbackSource,
      note: envelope.note?.trim() || null,
      rows,
    },
  };
}

function parseRow(raw: unknown, index: number, seen: Map<string, number>): ParsedRow {
  // Caught before zod so the reason is about the row rather than about JSON.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      index,
      headword: '',
      reading: '',
      meaning: '',
      status: 'invalid',
      reason: 'Dòng này không phải là một từ',
    };
  }

  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) {
    // Best-effort identity for the preview: the row failed validation but may
    // still carry a readable headword to name it by.
    const loose = raw as Partial<Record<string, unknown>> | null;
    return {
      index,
      headword: typeof loose?.headword === 'string' ? loose.headword : '',
      reading: typeof loose?.reading === 'string' ? loose.reading : '',
      meaning: '',
      status: 'invalid',
      reason: parsed.error.issues[0]?.message ?? 'Dòng không hợp lệ',
    };
  }

  const row = parsed.data;
  const identity = {
    index,
    headword: row.headword,
    reading: row.reading,
    meaning: row.meaning,
  };
  const invalid = (reason: string): ParsedRow => ({ ...identity, status: 'invalid', reason });

  const pos = normalisePos(row.pos);
  if (!pos) {
    return invalid(`Từ loại không hợp lệ: "${row.pos}"`);
  }

  // The review screen speaks this field. A reading with kanji in it is a bug
  // that surfaces only as the wrong audio, months later.
  if (extractKanji(row.reading).length > 0) {
    return invalid('Cách đọc phải là kana, không được có Hán tự');
  }

  const key = pairKey(row);
  const firstSeen = seen.get(key);
  if (firstSeen !== undefined) {
    return invalid(`Trùng với dòng ${firstSeen + 1} trong tệp`);
  }
  seen.set(key, index);

  const sentence = row.sentence ? toSentence(row.sentence) : null;
  if (typeof sentence === 'string') {
    return invalid(sentence);
  }

  return {
    ...identity,
    status: 'ok',
    data: {
      headword: row.headword,
      reading: row.reading,
      meaning: row.meaning,
      pos,
      // Transitivity belongs to verbs; `mapPos` strips it for everything else
      // and a generated file should not be able to put it back.
      transitivity: pos.startsWith('Verb') ? (row.transitivity ?? null) : null,
      jlpt: row.jlpt ?? null,
      note: row.note?.trim() || null,
      hanViet: normaliseHanVietInput(row.hanViet),
      sentence,
      sortOrder: index,
    },
  };
}

/**
 * Builds the sentence, or returns the Vietnamese reason it cannot be.
 *
 * `jp` is derived from `jpRuby` rather than read from the file. The seed
 * script checks that the two agree because a human typed both; here nobody
 * did, and "the plain text disagrees with the furigana" is the likeliest thing
 * for a generated file to get subtly wrong. Deriving it removes the failure
 * mode instead of reporting it.
 */
function toSentence(input: { jpRuby: string; vi: string }): WordInsert['sentence'] | string {
  const jp = rubyToPlain(input.jpRuby);
  if (jp.trim() === '') {
    return 'Câu ví dụ rỗng sau khi bỏ furigana';
  }

  // Only a sentence that actually contains kanji needs furigana — a kana-only
  // sentence has nothing to annotate.
  if (extractKanji(jp).length > 0 && !parseRuby(input.jpRuby).some((s) => s.ruby)) {
    return 'Câu ví dụ có Hán tự nhưng chưa có furigana trong [ ]';
  }

  // Generated, and the column exists to record that.
  return { jp, jpRuby: input.jpRuby, vi: input.vi, source: 'ai' as const };
}

/**
 * The identity of a word. The unique index is on the pair, because the same
 * headword recurs with a different reading (開ける/あける vs 開ける/ひらける).
 */
export function pairKey(word: { headword: string; reading: string }): string {
  return `${word.headword} ${word.reading}`;
}

/**
 * Drops the rows the user struck off in the preview.
 *
 * Kept here, beside the parser, so the rows that reach `insertWord` are still
 * the output of one function. The row stays in the list with its position
 * intact — `sortOrder` is the file's order, and a removed word spends its
 * place the same way a rejected one does.
 */
export function applyExclusions(
  rows: readonly ParsedRow[],
  excluded: ReadonlySet<number>,
): ParsedRow[] {
  if (excluded.size === 0) return [...rows];

  // No reason: the row carries the "Đã bỏ" label and a button to put it back,
  // which says more than a sentence would.
  return rows.map((row) =>
    row.status === 'ok' && excluded.has(row.index)
      ? { ...row, status: 'excluded' as const, data: undefined }
      : row,
  );
}

/**
 * Preview totals, and what decides whether the import button does anything.
 *
 * Takes anything with a status so the preview screen can retally its own rows
 * as they are struck off, without asking the server again.
 */
export function countRows(
  rows: readonly { status: RowStatus }[],
): Record<RowStatus, number> {
  return {
    ok: rows.filter((r) => r.status === 'ok').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    invalid: rows.filter((r) => r.status === 'invalid').length,
    excluded: rows.filter((r) => r.status === 'excluded').length,
  };
}
