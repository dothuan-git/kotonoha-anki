import type { RubySegment } from '@/lib/types';

/**
 * Parses the ruby format: `窓[まど]を開[あ]けてください。`
 *
 * A bracket group annotates the run of characters immediately before it. `\[`
 * and `\]` are literal brackets. An unclosed `[` is emitted as literal text
 * rather than throwing — a half-typed sentence in the add form must still
 * render while the user is mid-keystroke.
 *
 * Ruby is authored at add time and stored, never generated at runtime: 開ける
 * is あける but 開く is あく, and no browser-side tokeniser resolves that.
 */
export function parseRuby(input: string): RubySegment[] {
  const segments: RubySegment[] = [];
  let base = '';

  const pushBase = () => {
    if (base) {
      segments.push({ base });
      base = '';
    }
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (ch === '\\') {
      const next = input[i + 1];
      if (next === '[' || next === ']' || next === '\\') {
        base += next;
        i++;
        continue;
      }
      base += ch;
      continue;
    }

    if (ch === '[') {
      const close = findClosingBracket(input, i);
      if (close === -1) {
        // No terminator: the rest is literal.
        base += input.slice(i);
        break;
      }

      const ruby = unescapeBrackets(input.slice(i + 1, close));
      const annotated = takeAnnotatedBase(base);

      if (annotated === '') {
        // `[まど]` with nothing before it — keep it visible as text so the
        // mistake is obvious in the editor instead of silently vanishing.
        base += `[${ruby}]`;
      } else {
        base = base.slice(0, base.length - annotated.length);
        pushBase();
        segments.push({ base: annotated, ruby });
      }

      i = close;
      continue;
    }

    base += ch;
  }

  pushBase();
  return segments;
}

function findClosingBracket(input: string, openIndex: number): number {
  for (let i = openIndex + 1; i < input.length; i++) {
    if (input[i] === '\\') {
      i++;
      continue;
    }
    if (input[i] === ']') return i;
  }
  return -1;
}

function unescapeBrackets(s: string): string {
  return s.replace(/\\([[\]\\])/g, '$1');
}

const KANJI = /[々〇㐀-䶿一-鿿豈-﫿]/;

/**
 * Decides how much of the preceding text a bracket group annotates.
 *
 * For `窓[まど]` that is the kanji run `窓`. For `ゆっくり[ゆっくり]` — no kanji
 * at all — it is the whole accumulated run, which is what makes katakana and
 * kana headwords annotatable.
 */
function takeAnnotatedBase(base: string): string {
  if (base === '') return '';

  const chars = [...base];
  const last = chars[chars.length - 1]!;

  if (!KANJI.test(last)) return base;

  let start = chars.length;
  while (start > 0 && KANJI.test(chars[start - 1]!)) start--;
  return chars.slice(start).join('');
}

/** Escapes a literal string so `parseRuby` returns it unchanged. */
export function escapeRuby(s: string): string {
  return s.replace(/([[\]\\])/g, '\\$1');
}

/** The plain Japanese text, ruby stripped. */
export function rubyToPlain(input: string): string {
  return parseRuby(input)
    .map((s) => s.base)
    .join('');
}

/** The reading only — ruby where annotated, base where not. */
export function rubyToReading(input: string): string {
  return parseRuby(input)
    .map((s) => s.ruby ?? s.base)
    .join('');
}
