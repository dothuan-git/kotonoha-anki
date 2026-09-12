import type { HTMLAttributes } from 'react';

/**
 * Furigana uses real `<ruby><rb>…</rb><rt>…</rt></ruby>`. `<rb>` was dropped
 * from the HTML Living Standard, so React ships no type for it; ruby
 * annotation itself is driven by the ruby/rt pairing and is unaffected.
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      rb: HTMLAttributes<HTMLElement>;
    }
  }
}
