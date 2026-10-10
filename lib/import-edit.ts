import { MAX_GRAMMAR_SENTENCES } from '@/lib/grammar';
import { normalisePos } from '@/lib/import';
import {
  JLPT_VALUES,
  TRANSITIVITY_VALUES,
  type CardKind,
  type Jlpt,
  type Pos,
} from '@/lib/types';

/**
 * Fixing a row of an import file before it is imported.
 *
 * The edit is made to the file itself — the row is rewritten in the JSON and
 * the whole file is checked again — so an edited row goes through the same
 * parser, duplicate check and insert as every other. Nothing here decides
 * what is valid; it only moves values between the file and a form.
 *
 * Keys the form does not show (`hanViet`, anything unknown) are carried over
 * from the row as they were.
 */
export type RawRow = Record<string, unknown>;

const ROWS_KEY: Record<CardKind, 'words' | 'grammar'> = { word: 'words', grammar: 'grammar' };

/** The file's row list, whether it is a bare array or inside the envelope. */
function rowsOf(file: unknown, kind: CardKind): unknown[] | null {
  if (Array.isArray(file)) return file;
  if (file && typeof file === 'object') {
    const rows = (file as RawRow)[ROWS_KEY[kind]];
    if (Array.isArray(rows)) return rows;
  }
  return null;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * One row as the file has it, or null if there is no such row. A row that is
 * not an object at all comes back empty: it is still a row to be fixed.
 */
export function readRow(text: string, kind: CardKind, index: number): RawRow | null {
  const rows = rowsOf(parse(text), kind);
  if (!rows || index < 0 || index >= rows.length) return null;
  const row = rows[index];
  return row && typeof row === 'object' && !Array.isArray(row) ? { ...(row as RawRow) } : {};
}

/** The file with one row replaced, or null if it has no such row. */
export function replaceRow(text: string, kind: CardKind, index: number, row: RawRow): string | null {
  const file = parse(text);
  const rows = rowsOf(file, kind);
  if (!rows || index < 0 || index >= rows.length) return null;
  rows[index] = row;
  return JSON.stringify(file, null, 2);
}

/**
 * Pasted text as the file it stands for. The prompts ask for one JSON code
 * block, so a paste of the whole reply arrives fenced; the one enclosing
 * fence is dropped and anything else is left for the parser to judge.
 */
export function unfence(text: string): string {
  const fenced = /^\s*```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(text);
  return fenced?.[1] ?? text;
}

export interface SentenceDraft {
  jpRuby: string;
  vi: string;
}

export interface WordDraft {
  headword: string;
  reading: string;
  meaning: string;
  pos: Pos | '';
  transitivity: (typeof TRANSITIVITY_VALUES)[number] | '';
  jlpt: Jlpt | '';
  note: string;
  sentence: SentenceDraft;
}

export interface GrammarDraft {
  pattern: string;
  meaning: string;
  formation: string;
  jlpt: Jlpt | '';
  note: string;
  /** Always `MAX_GRAMMAR_SENTENCES` long; blank ones are dropped on save. */
  sentences: SentenceDraft[];
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

function sentenceDraft(value: unknown): SentenceDraft {
  if (!value || typeof value !== 'object') return { jpRuby: '', vi: '' };
  const sentence = value as RawRow;
  return { jpRuby: text(sentence.jpRuby), vi: text(sentence.vi) };
}

/** Only a value the parser would accept preselects; anything else asks again. */
function oneOf<T extends string>(values: readonly T[], value: unknown): T | '' {
  const candidate = text(value);
  return (values as readonly string[]).includes(candidate) ? (candidate as T) : '';
}

const isBlank = (sentence: SentenceDraft) => !sentence.jpRuby.trim() && !sentence.vi.trim();

/** `undefined` drops the key from the rewritten file. */
const optional = (value: string) => (value.trim() ? value : undefined);

export function wordDraft(row: RawRow): WordDraft {
  return {
    headword: text(row.headword),
    reading: text(row.reading),
    meaning: text(row.meaning),
    pos: normalisePos(text(row.pos)) ?? '',
    transitivity: oneOf(TRANSITIVITY_VALUES, row.transitivity),
    jlpt: oneOf(JLPT_VALUES, row.jlpt),
    note: text(row.note),
    sentence: sentenceDraft(row.sentence),
  };
}

export function wordPatch(draft: WordDraft): RawRow {
  return {
    headword: draft.headword,
    reading: draft.reading,
    meaning: draft.meaning,
    pos: draft.pos,
    transitivity:
      draft.pos.startsWith('Verb') && draft.transitivity ? draft.transitivity : undefined,
    jlpt: draft.jlpt || undefined,
    note: optional(draft.note),
    sentence: isBlank(draft.sentence)
      ? undefined
      : { jpRuby: draft.sentence.jpRuby, vi: draft.sentence.vi },
  };
}

export function grammarDraft(row: RawRow): GrammarDraft {
  const sentences = Array.isArray(row.sentences) ? row.sentences : [];
  return {
    pattern: text(row.pattern),
    meaning: text(row.meaning),
    formation: text(row.formation),
    jlpt: oneOf(JLPT_VALUES, row.jlpt),
    note: text(row.note),
    sentences: Array.from({ length: MAX_GRAMMAR_SENTENCES }, (_, i) =>
      sentenceDraft(sentences[i]),
    ),
  };
}

export function grammarPatch(draft: GrammarDraft): RawRow {
  return {
    pattern: draft.pattern,
    meaning: draft.meaning,
    formation: optional(draft.formation),
    jlpt: draft.jlpt || undefined,
    note: optional(draft.note),
    sentences: draft.sentences
      .filter((sentence) => !isBlank(sentence))
      .map(({ jpRuby, vi }) => ({ jpRuby, vi })),
  };
}
