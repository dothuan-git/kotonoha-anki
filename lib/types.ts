import { JLPT_VALUES, POS_VALUES, TRANSITIVITY_VALUES } from '@/lib/db/schema';

export type Pos = (typeof POS_VALUES)[number];
export type Jlpt = (typeof JLPT_VALUES)[number];
export type Transitivity = (typeof TRANSITIVITY_VALUES)[number] | null;

export { JLPT_VALUES, POS_VALUES, TRANSITIVITY_VALUES };

/** §6 ratings. `Again|Hard|Good|Easy` = 1|2|3|4, labelled in Vietnamese. */
export const RATING_LABELS = ['Quên', 'Khó', 'Được', 'Dễ'] as const;
export type RatingLabel = (typeof RATING_LABELS)[number];

export interface RubySegment {
  base: string;
  ruby?: string;
}

export interface SentenceView {
  id: string;
  jp: string;
  jpRuby: string;
  vi: string;
  source: 'ai' | 'manual' | null;
}

export interface KanjiRef {
  char: string;
  hanViet: string[];
}

/**
 * One row of /words. Replaces the prototype's flat `WordItem`: `partOfSpeech`
 * splits into `pos` + `transitivity`, the `hanViet` display string becomes
 * structured `kanji`, and the single inline example becomes `sentences`.
 *
 * Scheduling fields (`reviewCount`, `nextDueDate`, …) are deliberately absent —
 * they are a projection over review_logs and arrive in Phase 2.
 */
export interface WordView {
  id: string;
  headword: string;
  reading: string;
  meaning: string;
  pos: Pos;
  transitivity: Transitivity;
  jlpt: Jlpt | null;
  note: string | null;
  suspended: boolean;
  createdAt: string;
  kanji: KanjiRef[];
  sentences: SentenceView[];
}

export interface KanjiView {
  char: string;
  hanViet: string[];
  meaningVi: string | null;
  jlpt: Jlpt | null;
  wordCount: number;
}

/** What GET /api/lookup returns. Every field is a suggestion, not a commitment. */
export interface LookupCandidate {
  headword: string;
  reading: string;
  /** Jotoba's English glosses — a sanity check for the user, never saved. */
  glosses: string[];
  pos: Pos | null;
  transitivity: Transitivity;
  jlptHint: Jlpt | null;
  common: boolean;
  /** Headword furigana converted to §7 format, e.g. 勉強[べんきょう]. */
  headwordRuby: string | null;
  kanji: KanjiRef[];
}

export interface LookupResult {
  query: string;
  cached: boolean;
  candidates: LookupCandidate[];
}

/** §9 drafting response. */
export interface DraftResult {
  meaning: string;
  sentence: {
    jp: string;
    jpRuby: string;
    vi: string;
  };
}

/**
 * Renders `開 KHAI · 始 THỦY` — the prototype's `hanViet` string, derived
 * rather than stored. Unihan gives lowercase readings; display uppercases.
 */
export function formatHanViet(refs: readonly KanjiRef[]): string {
  const parts = refs
    .filter((k) => k.hanViet.length > 0)
    .map((k) => `${k.char} ${k.hanViet.join('/').toUpperCase()}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** Renders `Verb 2 · tha động từ`, the prototype's `partOfSpeech` line. */
export function formatPos(pos: Pos, transitivity: Transitivity): string {
  if (!transitivity) return pos;
  const vi = transitivity === 'transitive' ? 'tha động từ' : 'tự động từ';
  return `${pos} · ${vi}`;
}
