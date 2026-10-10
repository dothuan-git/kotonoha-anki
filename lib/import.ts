import { z } from 'zod';

import type { GrammarInsert } from '@/lib/db/grammar';
import type { WordInsert } from '@/lib/db/words';
import { extractKanji } from '@/lib/dict/furigana';
import { MAX_GRAMMAR_SENTENCES } from '@/lib/grammar';
import { parseRuby, rubyToPlain } from '@/lib/ruby';
import {
  JLPT_VALUES,
  POS_LABELS,
  POS_VALUES,
  TRANSITIVITY_VALUES,
  type Jlpt,
  type Pos,
  type Transitivity,
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
export interface ParsedRow<T = WordInsert> {
  index: number;
  status: RowStatus;
  /** Vietnamese, shown in the preview. Present on a row the parser refused. */
  reason?: string;
  /** A word's headword, or a grammar point's pattern. */
  headword: string;
  /** Empty for a grammar point. */
  reading: string;
  meaning: string;
  data?: T;
}

export interface ParseResult<T = WordInsert> {
  source: string;
  note: string | null;
  rows: ParsedRow<T>[];
}

export type ParseOutcome<T = WordInsert> =
  | { ok: true; result: ParseResult<T> }
  | { ok: false; error: string };

/** What the preview's detail dialog shows for a row that parsed. */
export type PreviewDetail =
  | {
      kind: 'word';
      pos: Pos;
      transitivity: Transitivity;
      jlpt: Jlpt | null;
      note: string | null;
      hanViet: Record<string, string[]>;
      sentence: { jpRuby: string; vi: string } | null;
    }
  | {
      kind: 'grammar';
      formation: string | null;
      jlpt: Jlpt | null;
      note: string | null;
      sentences: { jpRuby: string; vi: string }[];
    };

/**
 * A row on its way to the browser. `data` is dropped for `detail`: the
 * display fields only, never the insert payload — the file is posted again to
 * commit, so the server re-parses rather than trusting a round trip.
 *
 * `detail` is present on every row that parsed, including one later found to
 * be a duplicate, so the preview can show what the file says about it.
 */
export type PreviewRow = Omit<ParsedRow<unknown>, 'data'> & { detail?: PreviewDetail };

export interface ImportReport {
  source: string;
  rows: PreviewRow[];
  counts: Record<RowStatus, number>;
  /** Both present only after a real import, absent on a dry run. */
  batchId?: string;
  inserted?: number;
}

/**
 * `details` is keyed by file position and taken from the parse, before the
 * duplicate check and the exclusions clear `data` — so a skipped row keeps
 * its detail without its insert payload surviving the skip.
 */
export function toPreview(
  rows: readonly ParsedRow<unknown>[],
  details: ReadonlyMap<number, PreviewDetail> = new Map(),
): PreviewRow[] {
  return rows.map(({ data: _data, ...row }) => {
    const detail = details.get(row.index);
    return detail ? { ...row, detail } : row;
  });
}

/** The details of every row that parsed, by file position. */
export function previewDetails<T>(
  rows: readonly ParsedRow<T>[],
  detailOf: (data: T) => PreviewDetail,
): Map<number, PreviewDetail> {
  const details = new Map<number, PreviewDetail>();
  for (const row of rows) if (row.data) details.set(row.index, detailOf(row.data));
  return details;
}

export function wordDetail(word: WordInsert): PreviewDetail {
  return {
    kind: 'word',
    pos: word.pos,
    transitivity: word.transitivity,
    jlpt: word.jlpt,
    note: word.note,
    hanViet: word.hanViet,
    sentence: word.sentence && { jpRuby: word.sentence.jpRuby, vi: word.sentence.vi },
  };
}

export function grammarDetail(point: GrammarInsert): PreviewDetail {
  return {
    kind: 'grammar',
    formation: point.formation,
    jlpt: point.jlpt,
    note: point.note,
    sentences: point.sentences.map(({ jpRuby, vi }) => ({ jpRuby, vi })),
  };
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

export function normalisePos(raw: string): Pos | null {
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
function toSentence(
  input: { jpRuby: string; vi: string },
): { jp: string; jpRuby: string; vi: string; source: 'ai' } | string {
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
export function applyExclusions<T>(
  rows: readonly ParsedRow<T>[],
  excluded: ReadonlySet<number>,
): ParsedRow<T>[] {
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

/**
 * The grammar file, as Claude is asked to emit it — see
 * docs/import-format.md. Forgiving in the same ways as `rowSchema`: unknown
 * keys are ignored, and a supplied `jp` is ignored in favour of the ruby.
 */
const grammarRowSchema = z.object({
  pattern: z.string({ error: 'Thiếu mẫu ngữ pháp' }).trim().min(1, 'Thiếu mẫu ngữ pháp'),
  meaning: z.string({ error: 'Thiếu nghĩa tiếng Việt' }).trim().min(1, 'Thiếu nghĩa tiếng Việt'),
  formation: z.string({ error: 'Cách chia phải là chữ' }).trim().max(500).nullish(),
  note: z.string({ error: 'Ghi chú phải là chữ' }).trim().max(2000, 'Ghi chú quá dài').nullish(),
  jlpt: z.enum(JLPT_VALUES, { error: 'Cấp JLPT phải là N5, N4, N3, N2 hoặc N1' }).nullish(),
  sentences: z
    .array(
      z.object(
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
        { error: 'Mỗi câu ví dụ phải là object có jpRuby và vi' },
      ),
      { error: 'Thiếu danh sách câu ví dụ' },
    )
    .min(1, 'Cần ít nhất một câu ví dụ')
    .max(MAX_GRAMMAR_SENTENCES, `Tối đa ${MAX_GRAMMAR_SENTENCES} câu ví dụ`),
});

const grammarFileSchema = z.union([
  z.array(z.unknown()),
  z.object({
    source: z.string().trim().nullish(),
    note: z.string().trim().nullish(),
    grammar: z.array(z.unknown()),
  }),
]);

/**
 * The identity of a grammar point: the same pattern can carry two meanings
 * (〜ばかり "only" and "just did"), each its own card.
 */
export function grammarKey(point: { pattern: string; meaning: string }): string {
  return `${point.pattern}\u0000${point.meaning}`;
}

/** Parses a grammar bulk-import file into rows ready for `insertGrammar`. */
export function parseGrammarImport(
  text: string,
  fallbackSource: string,
): ParseOutcome<GrammarInsert> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Tệp không phải JSON hợp lệ' };
  }

  const file = grammarFileSchema.safeParse(json);
  if (!file.success) {
    return {
      ok: false,
      error: 'Tệp phải là một mảng mẫu ngữ pháp, hoặc một object có trường "grammar"',
    };
  }

  const envelope = Array.isArray(file.data)
    ? { source: null, note: null, grammar: file.data }
    : file.data;

  if (envelope.grammar.length === 0) {
    return { ok: false, error: 'Tệp không có mẫu ngữ pháp nào' };
  }
  if (envelope.grammar.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `Tệp có ${envelope.grammar.length} mẫu, tối đa ${MAX_IMPORT_ROWS} mẫu mỗi lần nhập`,
    };
  }

  const seen = new Map<string, number>();
  const rows = envelope.grammar.map((raw, index) => parseGrammarRow(raw, index, seen));

  return {
    ok: true,
    result: {
      source: envelope.source?.trim() || fallbackSource,
      note: envelope.note?.trim() || null,
      rows,
    },
  };
}

function parseGrammarRow(
  raw: unknown,
  index: number,
  seen: Map<string, number>,
): ParsedRow<GrammarInsert> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      index,
      headword: '',
      reading: '',
      meaning: '',
      status: 'invalid',
      reason: 'Dòng này không phải là một mẫu ngữ pháp',
    };
  }

  const parsed = grammarRowSchema.safeParse(raw);
  if (!parsed.success) {
    const loose = raw as Partial<Record<string, unknown>>;
    return {
      index,
      headword: typeof loose.pattern === 'string' ? loose.pattern : '',
      reading: '',
      meaning: typeof loose.meaning === 'string' ? loose.meaning : '',
      status: 'invalid',
      reason: parsed.error.issues[0]?.message ?? 'Dòng không hợp lệ',
    };
  }

  const row = parsed.data;
  const identity = { index, headword: row.pattern, reading: '', meaning: row.meaning };
  const invalid = (reason: string): ParsedRow<GrammarInsert> => ({
    ...identity,
    status: 'invalid',
    reason,
  });

  const key = grammarKey(row);
  const firstSeen = seen.get(key);
  if (firstSeen !== undefined) {
    return invalid(`Trùng với dòng ${firstSeen + 1} trong tệp`);
  }
  seen.set(key, index);

  // The same furigana rule a word's example sentence is held to: a sentence
  // with kanji is spoken from its ruby, so it must have some.
  const sentences: GrammarInsert['sentences'] = [];
  for (const [i, input] of row.sentences.entries()) {
    const sentence = toSentence(input);
    if (typeof sentence === 'string') return invalid(`Câu ${i + 1}: ${sentence}`);
    sentences.push({ jpRuby: sentence.jpRuby, vi: sentence.vi, source: sentence.source });
  }

  return {
    ...identity,
    status: 'ok',
    data: {
      pattern: row.pattern,
      meaning: row.meaning,
      formation: row.formation?.trim() || null,
      note: row.note?.trim() || null,
      jlpt: row.jlpt ?? null,
      sentences,
      sortOrder: index,
    },
  };
}
