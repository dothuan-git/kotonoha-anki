import { parseRuby } from '@/lib/ruby';

/**
 * §7: real <ruby><rb>…</rb><rt>…</rt></ruby>, not a CSS approximation, so
 * furigana survives text selection, copy-paste and screen readers.
 */
export function Ruby({ text, className }: { text: string; className?: string }) {
  const segments = parseRuby(text);

  return (
    <span className={className}>
      {segments.map((segment, i) =>
        segment.ruby ? (
          <ruby key={i}>
            <rb>{segment.base}</rb>
            <rt>{segment.ruby}</rt>
          </ruby>
        ) : (
          <span key={i}>{segment.base}</span>
        ),
      )}
    </span>
  );
}
