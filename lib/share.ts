/**
 * The share target, as a pure function.
 *
 * Android hands a Web Share Target three fields and no promise about which of
 * them holds anything useful. A dictionary app shares `text`; a browser shares
 * `title` and `url`; some share the word inside the URL and nothing else.
 *
 * So: take the first field that actually contains Japanese, and hand back the
 * run of Japanese it contains. Everything else — the surrounding English, the
 * app's "Shared from …" garnish, the URL scaffolding — is noise the add form
 * would only have to be cleared of.
 *
 * What this deliberately does not do is segment. Sharing a whole sentence
 * gives you the whole sentence in the box; no browser-side tokeniser can
 * tell 開ける from 開く, and guessing a word boundary here would
 * be the same mistake one layer up. Trimming it is a keystroke.
 */

/** Kana, kanji, 々, and half-width katakana. */
const JAPANESE_RUN = /[\u3005\u3040-\u30ff\u4e00-\u9fff\uff66-\uff9f]+/;

/**
 * Long enough for a phrase worth keeping, short enough that a shared article
 * cannot arrive as a headword. The form is editable either way.
 */
export const MAX_SHARE_QUERY = 32;

export interface SharePayload {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}

export function shareQuery(payload: SharePayload): string {
  const candidates = [payload.text, payload.title, payload.url]
    .map((v) => v?.trim() ?? '')
    .filter((v) => v.length > 0);

  for (const candidate of candidates) {
    // A shared URL often carries the word percent-encoded in its path, the way
    // jisho.org/search/%E9%96%8B%E3%81%91%E3%82%8B does.
    const match = JAPANESE_RUN.exec(candidate) ?? JAPANESE_RUN.exec(decodeSafely(candidate));
    if (match) return match[0].slice(0, MAX_SHARE_QUERY);
  }

  // Nothing Japanese anywhere. Hand back the first field rather than an empty
  // form — romaji is a legitimate thing to have shared, and the add form
  // converts it as you type.
  const fallback = candidates.find((c) => !isUrl(c)) ?? '';
  return fallback.slice(0, MAX_SHARE_QUERY);
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A stray % that is not an escape. Nothing to decode, then.
    return value;
  }
}

function isUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}
