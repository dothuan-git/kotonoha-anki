/**
 * Seeds `kanji.han_viet` from the Unicode Consortium's Unihan database (§9).
 *
 * Idempotent: re-running replaces each character's readings with what the file
 * says, so a Unihan revision can simply be re-applied. Nothing else on the row
 * is touched — a hand-typed `meaning_vi` survives a re-seed.
 *
 * Unicode publishes Unihan only as a zip (there is no standalone
 * Unihan_Readings.txt at the UCD URL), so the archive is downloaded once into
 * scripts/.cache and read from there on later runs.
 *
 *   npm run seed:unihan            # uses the cached download if present
 *   npm run seed:unihan -- --fresh # force re-download
 *
 * §9 warns to expect gaps on rarer characters; the add form lets a Hán Việt
 * reading be typed by hand and persists it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { unzipSync } from 'fflate';

import { db } from '../lib/db';
import { kanji } from '../lib/db/schema';

const ZIP_URL = 'https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip';
const MEMBER = 'Unihan_Readings.txt';
const CACHE_DIR = join(process.cwd(), 'scripts', '.cache');
const CACHE_FILE = join(CACHE_DIR, 'Unihan.zip');
const BATCH_SIZE = 500;

async function loadArchive(fresh: boolean): Promise<Uint8Array> {
  if (!fresh && existsSync(CACHE_FILE)) {
    console.log(`Using cached ${CACHE_FILE}`);
    return new Uint8Array(readFileSync(CACHE_FILE));
  }

  console.log(`Downloading ${ZIP_URL} …`);
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, bytes);
  console.log(`Cached ${(bytes.length / 1e6).toFixed(1)} MB`);
  return bytes;
}

/**
 * Each Unihan line is three tab-separated fields:
 *
 *   U+958B<TAB>kVietnamese<TAB>khai
 *
 * Multiple readings are space-separated. Values are kept lowercase exactly as
 * the source gives them; `formatHanViet` uppercases for display.
 */
function parseVietnameseReadings(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();

  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;

    const [codePoint, field, value] = line.split('\t');
    if (field !== 'kVietnamese' || !codePoint || !value) continue;

    const cp = Number.parseInt(codePoint.slice(2), 16);
    if (!Number.isFinite(cp)) continue;

    const readings = value.trim().split(/\s+/).filter(Boolean);
    if (readings.length === 0) continue;

    out.set(String.fromCodePoint(cp), readings);
  }

  return out;
}

async function main() {
  const archive = await loadArchive(process.argv.includes('--fresh'));

  const member = unzipSync(archive, { filter: (f) => f.name === MEMBER })[MEMBER];
  if (!member) throw new Error(`${MEMBER} not found inside the archive`);

  const readings = parseVietnameseReadings(new TextDecoder('utf-8').decode(member));
  console.log(`Parsed ${readings.size} characters with a kVietnamese reading`);

  const rows = [...readings].map(([char, hanViet]) => ({ char, hanViet }));

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await db
      .insert(kanji)
      .values(rows.slice(i, i + BATCH_SIZE))
      .onConflictDoUpdate({
        target: kanji.char,
        // Only han_viet: meaning_vi and jlpt are the user's own data.
        set: { hanViet: sql`excluded.han_viet` },
      });
    process.stdout.write(`\rUpserted ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');

  for (const char of ['開', '始', '勉', '強', '静']) {
    const [row] = await db.select().from(kanji).where(eq(kanji.char, char)).limit(1);
    console.log(`  ${char} -> ${row ? row.hanViet.join(', ') : '(missing)'}`);
  }

  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
