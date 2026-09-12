import { describe, expect, it } from 'vitest';

import { jotobaFuriganaToRuby } from '@/lib/dict/furigana';
import { escapeRuby, parseRuby, rubyToPlain, rubyToReading } from '@/lib/ruby';

describe('parseRuby', () => {
  it('parses the ruby format', () => {
    expect(parseRuby('窓[まど]を開[あ]けてください。')).toEqual([
      { base: '窓', ruby: 'まど' },
      { base: 'を' },
      { base: '開', ruby: 'あ' },
      { base: 'けてください。' },
    ]);
  });

  it('annotates a whole kanji run, not just the last character', () => {
    expect(parseRuby('勉強[べんきょう]しています。')).toEqual([
      { base: '勉強', ruby: 'べんきょう' },
      { base: 'しています。' },
    ]);
  });

  it('handles consecutive annotated compounds', () => {
    expect(parseRuby('毎日[まいにち]一時間[いちじかん]、')).toEqual([
      { base: '毎日', ruby: 'まいにち' },
      { base: '一時間', ruby: 'いちじかん' },
      { base: '、' },
    ]);
  });

  it('annotates kana when there is no kanji to attach to', () => {
    expect(parseRuby('ゆっくり[ゆっくり]')).toEqual([{ base: 'ゆっくり', ruby: 'ゆっくり' }]);
  });

  it('leaves plain text as a single segment', () => {
    expect(parseRuby('ゆっくり話してください。')).toEqual([{ base: 'ゆっくり話してください。' }]);
  });

  it('returns nothing for the empty string', () => {
    expect(parseRuby('')).toEqual([]);
  });

  describe('bracket-heavy strings', () => {
    it('treats an escaped bracket as literal text', () => {
      expect(parseRuby('注[ちゅう]\\[1\\]')).toEqual([
        { base: '注', ruby: 'ちゅう' },
        { base: '[1]' },
      ]);
    });

    it('escapes brackets inside a ruby annotation', () => {
      expect(parseRuby('話[はな\\]し]')).toEqual([{ base: '話', ruby: 'はな]し' }]);
    });

    it('keeps an unclosed bracket as literal text rather than throwing', () => {
      expect(parseRuby('窓[まど]を開[')).toEqual([
        { base: '窓', ruby: 'まど' },
        { base: 'を開[' },
      ]);
    });

    it('keeps a dangling annotation visible so the mistake is obvious', () => {
      expect(parseRuby('[まど]です')).toEqual([{ base: '[まど]です' }]);
    });

    it('preserves an escaped backslash', () => {
      expect(parseRuby('a\\\\b')).toEqual([{ base: 'a\\b' }]);
    });

    it('round-trips anything escapeRuby produces', () => {
      const literal = 'a[b]c\\d[[]]';
      expect(rubyToPlain(escapeRuby(literal))).toBe(literal);
    });
  });
});

describe('rubyToPlain / rubyToReading', () => {
  const s = '窓[まど]を開[あ]けてください。';

  it('strips ruby', () => {
    expect(rubyToPlain(s)).toBe('窓を開けてください。');
  });

  it('substitutes ruby to give the reading', () => {
    expect(rubyToReading(s)).toBe('まどをあけてください。');
  });
});

describe('jotobaFuriganaToRuby', () => {
  it.each([
    ['[開|あ]ける', '開[あ]ける'],
    ['[勉強|べん|きょう]', '勉[べん]強[きょう]'],
    ['[新幹線|しん|かん|せん]', '新[しん]幹[かん]線[せん]'],
    ['ゆっくり[滑|すべ]り', 'ゆっくり滑[すべ]り'],
    ['[懐|なつ]かしい', '懐[なつ]かしい'],
  ])('%s -> %s', (input, expected) => {
    expect(jotobaFuriganaToRuby(input)).toBe(expected);
  });

  it('falls back to one annotation for the run when readings do not split evenly', () => {
    expect(jotobaFuriganaToRuby('[大人|おとな]')).toBe('大人[おとな]');
  });

  it('returns null when there is no furigana', () => {
    expect(jotobaFuriganaToRuby(null)).toBeNull();
    expect(jotobaFuriganaToRuby('')).toBeNull();
  });

  it('produces output parseRuby can read back', () => {
    const converted = jotobaFuriganaToRuby('[新幹線|しん|かん|せん]')!;
    expect(rubyToReading(converted)).toBe('しんかんせん');
    expect(rubyToPlain(converted)).toBe('新幹線');
  });
});
