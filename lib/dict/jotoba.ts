import { eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { dictCache, kanji as kanjiTable } from '@/lib/db/schema';
import { extractKanji, jotobaFuriganaToRuby } from '@/lib/dict/furigana';
import { mapPos, pickJlptHint, type JotobaPosTag } from '@/lib/dict/pos';
import type { KanjiRef, LookupCandidate, LookupResult } from '@/lib/types';

const ENDPOINT = 'https://jotoba.de/api/search/words';
const TIMEOUT_MS = 5_000;
const MAX_CANDIDATES = 5;

/** The subset of Jotoba's response we rely on. Unlisted fields are kept in the cache payload. */
export interface JotobaResponse {
  words?: Array<{
    reading: { kana: string; kanji?: string | null; furigana?: string | null };
    common?: boolean;
    senses?: Array<{ glosses?: string[]; pos?: JotobaPosTag[] }>;
  }>;
  kanji?: Array<{ literal: string; jlpt?: number | null; meanings?: string[] }>;
}

/** Trims and NFKC-folds so `開ける ` and `開ける` share one cache row. */
export function normaliseQuery(q: string): string {
  return q.normalize('NFKC').trim();
}

async function fetchFromJotoba(query: string): Promise<JotobaResponse> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, language: 'English', no_english: false }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Jotoba returned ${res.status}`);
  }
  return (await res.json()) as JotobaResponse;
}

/**
 * Cache-first dictionary lookup. The raw payload is stored so a future
 * change to the mapping can be applied to already-seen words without
 * re-fetching, and so Jotoba is hit once per word ever.
 */
export async function lookup(rawQuery: string): Promise<LookupResult> {
  const query = normaliseQuery(rawQuery);
  if (!query) return { query, cached: false, candidates: [] };

  const [cachedRow] = await db
    .select()
    .from(dictCache)
    .where(eq(dictCache.headword, query))
    .limit(1);

  if (cachedRow) {
    return {
      query,
      cached: true,
      candidates: await mapResponse(cachedRow.payload as JotobaResponse, query),
    };
  }

  const payload = await fetchFromJotoba(query);

  await db
    .insert(dictCache)
    .values({ headword: query, payload })
    .onConflictDoUpdate({
      target: dictCache.headword,
      set: { payload, fetchedAt: new Date() },
    });

  return { query, cached: false, candidates: await mapResponse(payload, query) };
}

async function mapResponse(payload: JotobaResponse, query: string): Promise<LookupCandidate[]> {
  const words = payload.words ?? [];
  if (words.length === 0) return [];

  // Jotoba's JLPT levels live on the kanji objects, not the words.
  const jlptByChar = new Map<string, number | null>();
  for (const k of payload.kanji ?? []) {
    jlptByChar.set(k.literal, k.jlpt ?? null);
  }

  // An exact match on the query should lead, even if Jotoba ranked it lower.
  const ranked = [...words].sort((a, b) => score(b, query) - score(a, query));
  const candidates = ranked.slice(0, MAX_CANDIDATES);

  const allChars = [
    ...new Set(candidates.flatMap((w) => extractKanji(w.reading.kanji ?? w.reading.kana))),
  ];
  const hanViet = await loadHanViet(allChars);

  return candidates.map((w) => {
    const headword = w.reading.kanji ?? w.reading.kana;
    const chars = extractKanji(headword);

    // Tags come from the first sense: JMdict orders senses by frequency, so
    // sense 1 is the one the learner means. Later senses often carry a
    // different part of speech entirely (開ける is transitive in sense 1,
    // intransitive by sense 6).
    const firstSense = w.senses?.[0];
    const { pos, transitivity } = mapPos(firstSense?.pos ?? []);

    return {
      headword,
      reading: w.reading.kana,
      glosses: (w.senses ?? []).flatMap((s) => s.glosses ?? []).slice(0, 6),
      pos,
      transitivity,
      jlptHint: pickJlptHint(chars.map((c) => jlptByChar.get(c) ?? null)),
      common: w.common ?? false,
      headwordRuby: jotobaFuriganaToRuby(w.reading.furigana),
      kanji: chars.map((char) => ({ char, hanViet: hanViet.get(char) ?? [] })),
    };
  });
}

function score(w: NonNullable<JotobaResponse['words']>[number], query: string): number {
  let s = 0;
  if (w.reading.kanji === query || w.reading.kana === query) s += 10;
  if (w.common) s += 1;
  return s;
}

/** Hán Việt readings for the given characters, from the Unihan seed. */
export async function loadHanViet(chars: readonly string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (chars.length === 0) return map;

  const rows = await db
    .select({ char: kanjiTable.char, hanViet: kanjiTable.hanViet })
    .from(kanjiTable)
    .where(inArray(kanjiTable.char, [...chars]));

  for (const row of rows) map.set(row.char, row.hanViet);
  return map;
}

export interface KanjiFacts {
  char: string;
  jlpt: number | null;
  meanings: string[];
}

/** The kanji block of a cached payload — feeds the /kanji screen's gloss field. */
export function kanjiFacts(payload: JotobaResponse): KanjiFacts[] {
  return (payload.kanji ?? []).map((k) => ({
    char: k.literal,
    jlpt: k.jlpt ?? null,
    meanings: k.meanings ?? [],
  }));
}

export type { KanjiRef };
