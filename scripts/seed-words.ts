/**
 * Seeds a starter deck of 50 N5 words (`scripts/data/n5-words.ts`).
 *
 * Rows go in through `insertWord`, the same path the add form uses, so a
 * seeded word is indistinguishable from a hand-added one — including the
 * invariant that a word and its card state share one `createdAt`, without
 * which every seeded row drifts on the first `npm run recompute`.
 *
 * Dictionary fields come from Jotoba at seed time, cached in `dict_cache`
 * as usual. The seed file carries only what a dictionary cannot give: the
 * Vietnamese meaning and one example sentence with its ruby.
 *
 *   npm run seed:words           # add what is missing
 *   npm run seed:words -- --dry  # look up and report, write nothing
 *
 * Idempotent: a word already in the book, on (headword, reading), is skipped.
 * Nothing is ever updated or deleted — re-running after editing a meaning by
 * hand will not overwrite your edit.
 */
import { and, eq } from 'drizzle-orm';

import { db } from '../lib/db';
import { words } from '../lib/db/schema';
import { insertWord, isUniqueViolation } from '../lib/db/words';
import { lookup } from '../lib/dict/jotoba';
import { parseRuby, rubyToPlain } from '../lib/ruby';
import type { LookupCandidate } from '../lib/types';
import { DECK_LEVEL, N5_WORDS, type SeedWord } from './data/n5-words';

const dry = process.argv.slice(2).includes('--dry');

/** Jotoba is a public API being asked 50 questions; space them out. */
const REQUEST_GAP_MS = 250;

let added = 0;
let skipped = 0;
const problems: string[] = [];

console.log(`${N5_WORDS.length} words${dry ? ' (dry run — nothing will be written)' : ''}\n`);

for (const [deckPosition, seed] of N5_WORDS.entries()) {
  const label = `${seed.headword} (${seed.reading})`;

  const rubyProblem = checkSentence(seed);
  if (rubyProblem) {
    problems.push(`${label}: ${rubyProblem}`);
    console.log(`  ✗ ${label} — ${rubyProblem}`);
    continue;
  }

  const [existing] = await db
    .select({ id: words.id })
    .from(words)
    .where(and(eq(words.headword, seed.headword), eq(words.reading, seed.reading)))
    .limit(1);

  if (existing) {
    skipped++;
    console.log(`  · ${label} — already in the book`);
    continue;
  }

  let candidate: LookupCandidate | undefined;
  try {
    const result = await lookup(seed.headword);
    candidate = result.candidates.find(
      (c) => c.headword === seed.headword && c.reading === seed.reading,
    );
    if (!result.cached) await sleep(REQUEST_GAP_MS);
  } catch (error) {
    problems.push(`${label}: lookup failed — ${String(error)}`);
    console.log(`  ✗ ${label} — lookup failed`);
    continue;
  }

  // No match means the reading in the seed file disagrees with the dictionary,
  // which is worth seeing rather than papering over: a wrong reading is a
  // typed card that marks a correct answer wrong.
  if (!candidate) {
    problems.push(`${label}: Jotoba returned no candidate with this reading`);
    console.log(`  ✗ ${label} — no matching dictionary entry`);
    continue;
  }

  const pos = candidate.pos ?? seed.pos;
  if (!pos) {
    problems.push(`${label}: Jotoba's tags map to no pos, and the seed gives no fallback`);
    console.log(`  ✗ ${label} — no part of speech`);
    continue;
  }

  if (dry) {
    console.log(
      `  → ${label} — ${pos}${candidate.transitivity ? ` (${candidate.transitivity})` : ''}` +
        ` · ${seed.jlpt ?? DECK_LEVEL}` +
        `${candidate.jlptHint && candidate.jlptHint !== (seed.jlpt ?? DECK_LEVEL) ? ` (Jotoba hints ${candidate.jlptHint})` : ''}` +
        ` · ${seed.meaning}`,
    );
    added++;
    continue;
  }

  try {
    await insertWord({
      headword: seed.headword,
      reading: candidate.reading,
      meaning: seed.meaning,
      pos,
      transitivity: candidate.transitivity,
      // Not candidate.jlptHint: it is derived from the kanji and often wrong.
      // The deck knows its own level; /words can correct any of them.
      jlpt: seed.jlpt ?? DECK_LEVEL,
      // Jotoba's English glosses are a sanity check, never saved. The
      // note stays empty for you to fill in from use.
      note: null,
      // Unihan already seeded these; insertWord leaves existing rows alone.
      hanViet: {},
      sentence: { ...seed.sentence, source: 'manual' },
      // The deck's own order, not the order the inserts happened to finish in.
      // Rows go in one at a time here so the clock would mostly separate them
      // anyway — but a deck has an order its author meant, and this is the
      // column that keeps it.
      sortOrder: deckPosition,
    });
    added++;
    console.log(`  ✓ ${label} — ${pos} · ${seed.meaning}`);
  } catch (error) {
    if (isUniqueViolation(error)) {
      skipped++;
      console.log(`  · ${label} — already in the book`);
      continue;
    }
    problems.push(`${label}: insert failed — ${String(error)}`);
    console.log(`  ✗ ${label} — insert failed`);
  }
}

console.log(
  `\n${added} ${dry ? 'would be added' : 'added'} · ${skipped} already present · ${problems.length} problems`,
);

if (problems.length > 0) {
  console.log('\nProblems:');
  for (const p of problems) console.log(`  ${p}`);
}

if (!dry && added > 0) {
  console.log(
    `\nRun 'npm run recompute -- --check' to confirm every new card state folds out of its (empty) log.`,
  );
}

process.exit(problems.length > 0 ? 1 : 0);

/**
 * The ruby has to round-trip to the plain sentence, or the card renders text
 * that is not the sentence. Cheap to check here, impossible to notice later.
 */
function checkSentence(seed: SeedWord): string | null {
  const plain = rubyToPlain(seed.sentence.jpRuby);
  if (plain !== seed.sentence.jp) {
    return `ruby does not match jp\n      jp:    ${seed.sentence.jp}\n      plain: ${plain}`;
  }
  if (!parseRuby(seed.sentence.jpRuby).some((s) => s.ruby)) {
    return 'sentence has no ruby at all';
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
