import { describe, expect, it } from 'vitest';

import { grammarKey, parseGrammarImport } from '@/lib/import';

const point = {
  pattern: '〜てしまう',
  meaning: 'lỡ…, mất rồi',
  formation: 'V-て + しまう',
  jlpt: 'N4',
  sentences: [
    { jpRuby: '財布[さいふ]をなくしてしまった。', vi: 'Tôi lỡ làm mất ví rồi.' },
    { jpRuby: 'ケーキを全部[ぜんぶ]食[た]べてしまった。', vi: 'Tôi lỡ ăn hết bánh rồi.' },
  ],
};

const parse = (value: unknown) => parseGrammarImport(JSON.stringify(value), 'file');

describe('parseGrammarImport', () => {
  it('reads a bare array and an envelope alike', () => {
    const bare = parse([point]);
    const wrapped = parse({ source: 'N4 ngữ pháp', grammar: [point] });
    expect(bare.ok && bare.result.rows[0]?.status).toBe('ok');
    expect(wrapped.ok && wrapped.result.source).toBe('N4 ngữ pháp');
  });

  it('builds the row ready to insert, sentences in file order, marked as generated', () => {
    const outcome = parse([point]);
    if (!outcome.ok) throw new Error(outcome.error);
    const row = outcome.result.rows[0]!;
    expect(row).toMatchObject({ headword: '〜てしまう', reading: '', meaning: 'lỡ…, mất rồi' });
    expect(row.data).toMatchObject({ formation: 'V-て + しまう', jlpt: 'N4', sortOrder: 0 });
    expect(row.data?.sentences.map((s) => s.source)).toEqual(['ai', 'ai']);
    expect(row.data?.sentences[1]?.jpRuby).toBe(point.sentences[1]!.jpRuby);
  });

  /** A sentence with kanji is spoken from its ruby, so a bare one cannot be. */
  it('rejects a sentence with kanji and no furigana, naming which', () => {
    const bad = { ...point, sentences: [point.sentences[0], { jpRuby: '全部食べた。', vi: 'x' }] };
    const outcome = parse([bad]);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.result.rows[0]).toMatchObject({ status: 'invalid' });
    expect(outcome.result.rows[0]?.reason).toMatch(/^Câu 2:/);
  });

  it('needs at least one sentence', () => {
    const outcome = parse([{ ...point, sentences: [] }]);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.result.rows[0]?.status).toBe('invalid');
  });

  /** The same pattern with another meaning is another card; the same pair twice is a mistake. */
  it('flags a repeated pattern and meaning, not a repeated pattern', () => {
    const outcome = parse([point, { ...point, meaning: 'xong hẳn' }, point]);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.result.rows.map((r) => r.status)).toEqual(['ok', 'ok', 'invalid']);
    expect(outcome.result.rows[2]?.reason).toMatch(/dòng 1/);
  });

  it('keeps a readable name on a row it cannot parse', () => {
    const outcome = parse([{ pattern: '〜ばかり' }]);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.result.rows[0]).toMatchObject({ status: 'invalid', headword: '〜ばかり' });
  });

  it('refuses a file that is not grammar-shaped', () => {
    expect(parse({ words: [point] }).ok).toBe(false);
    expect(parseGrammarImport('not json', 'file').ok).toBe(false);
    expect(parse([]).ok).toBe(false);
  });
});

describe('grammarKey', () => {
  it('tells two meanings of one pattern apart', () => {
    expect(grammarKey({ pattern: 'a', meaning: 'b' })).not.toBe(
      grammarKey({ pattern: 'a', meaning: 'c' }),
    );
  });
});
