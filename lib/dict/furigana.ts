import { escapeRuby } from '@/lib/ruby';

/**
 * Converts Jotoba's furigana notation into the app's ruby format.
 *
 * Jotoba writes a bracket group as `[kanji|reading|reading|…]`, one reading per
 * kanji character when it can split them, otherwise one reading for the run.
 * Verified against the live API:
 *
 *   `[開|あ]ける`            → `開[あ]ける`
 *   `[勉強|べん|きょう]`      → `勉[べん]強[きょう]`
 *   `[新幹線|しん|かん|せん]` → `新[しん]幹[かん]線[せん]`
 *   `ゆっくり[滑|すべ]り`     → `ゆっくり滑[すべ]り`
 *
 * Returns null for a null/empty input — kana-only words carry no furigana.
 */
export function jotobaFuriganaToRuby(furigana: string | null | undefined): string | null {
  if (!furigana) return null;

  let out = '';
  let i = 0;

  while (i < furigana.length) {
    const ch = furigana[i]!;

    if (ch !== '[') {
      out += escapeRuby(ch);
      i++;
      continue;
    }

    const close = furigana.indexOf(']', i);
    if (close === -1) {
      out += escapeRuby(furigana.slice(i));
      break;
    }

    const group = furigana.slice(i + 1, close);
    i = close + 1;

    const [base, ...readings] = group.split('|');
    if (!base) continue;

    const chars = [...base];

    if (readings.length === chars.length) {
      // One reading per character — annotate each so /kanji can link them.
      for (let k = 0; k < chars.length; k++) {
        const reading = readings[k]!;
        out += reading ? `${escapeRuby(chars[k]!)}[${escapeRuby(reading)}]` : escapeRuby(chars[k]!);
      }
    } else {
      const reading = readings.filter((r) => r !== '').join('');
      out += reading ? `${escapeRuby(base)}[${escapeRuby(reading)}]` : escapeRuby(base);
    }
  }

  return out === '' ? null : out;
}

const KANJI_CHAR = /[々〇㐀-䶿一-鿿豈-﫿]/;

/** The kanji characters of a headword, in order, duplicates preserved. */
export function extractKanji(headword: string): string[] {
  return [...headword].filter((c) => KANJI_CHAR.test(c));
}
