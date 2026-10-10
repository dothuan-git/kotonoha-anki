import { describe, expect, it } from 'vitest';

import {
  grammarDraft,
  grammarPatch,
  readRow,
  replaceRow,
  unfence,
  wordDraft,
  wordPatch,
} from '@/lib/import-edit';
import { parseGrammarImport, parseImport } from '@/lib/import';
import { MAX_GRAMMAR_SENTENCES } from '@/lib/grammar';

const cat = { headword: '猫', reading: 'ねこ', meaning: 'con mèo', pos: 'Noun' };
/** Rejected by the parser: kanji in the sentence, no furigana. */
const study = {
  headword: '勉強',
  reading: 'べんきょう',
  meaning: 'học tập',
  pos: 'Danh từ',
  hanViet: { 勉: ['miễn'] },
  sentence: { jpRuby: '毎日勉強します。', vi: 'Tôi học mỗi ngày.' },
};

describe('readRow / replaceRow', () => {
  it('finds a row in a bare array and in the envelope alike', () => {
    expect(readRow(JSON.stringify([cat]), 'word', 0)).toEqual(cat);
    expect(readRow(JSON.stringify({ source: 's', words: [cat] }), 'word', 0)).toEqual(cat);
    expect(readRow(JSON.stringify({ grammar: [{ pattern: 'x' }] }), 'grammar', 0)).toEqual({
      pattern: 'x',
    });
  });

  it('reads a row that is not an object as empty, and a missing one as nothing', () => {
    expect(readRow('["ねこ"]', 'word', 0)).toEqual({});
    expect(readRow('[]', 'word', 0)).toBeNull();
    expect(readRow('not json', 'word', 0)).toBeNull();
  });

  it('replaces one row and keeps the envelope and every other row', () => {
    const text = JSON.stringify({ source: 'Bài 1', note: 'n', words: [cat, study] });
    const next = replaceRow(text, 'word', 1, { ...study, reading: 'x' });
    expect(JSON.parse(next!)).toEqual({
      source: 'Bài 1',
      note: 'n',
      words: [cat, { ...study, reading: 'x' }],
    });
    expect(replaceRow(text, 'word', 5, cat)).toBeNull();
  });
});

describe('word drafts', () => {
  /** The whole point: a rejected row, fixed in the form, passes the real parser. */
  it('turns a rejected row into one the parser accepts, keeping what the form does not show', () => {
    const text = JSON.stringify([cat, study]);
    expect(parseOk(parseImport(text, 'f'))[1]?.status).toBe('invalid');

    const draft = wordDraft(readRow(text, 'word', 1)!);
    // The Vietnamese label preselects the enum value.
    expect(draft.pos).toBe('Noun');
    draft.sentence.jpRuby = '毎日[まいにち]勉強[べんきょう]します。';

    const fixed = replaceRow(text, 'word', 1, { ...readRow(text, 'word', 1), ...wordPatch(draft) });
    const rows = parseOk(parseImport(fixed!, 'f'));
    expect(rows[1]?.status).toBe('ok');
    expect(rows[1]?.data?.hanViet).toEqual({ 勉: ['miễn'] });
  });

  it('drops transitivity off a non-verb, and a sentence left blank', () => {
    const patch = wordPatch({
      ...wordDraft(cat),
      transitivity: 'transitive',
      sentence: { jpRuby: ' ', vi: '' },
    });
    expect(patch.transitivity).toBeUndefined();
    expect(patch.sentence).toBeUndefined();
    expect(JSON.parse(JSON.stringify(patch))).not.toHaveProperty('sentence');
  });

  it('leaves a value the parser would refuse unselected rather than guessing', () => {
    expect(wordDraft({ ...cat, jlpt: 'N6', pos: 'noun-ish' })).toMatchObject({ jlpt: '', pos: '' });
  });
});

describe('grammar drafts', () => {
  const point = {
    pattern: '〜てしまう',
    meaning: 'lỡ',
    sentences: [{ jpRuby: '全部食べた。', vi: 'x' }],
  };

  it('offers every sentence slot and saves only the filled ones', () => {
    const draft = grammarDraft(point);
    expect(draft.sentences).toHaveLength(MAX_GRAMMAR_SENTENCES);

    draft.sentences[0] = { jpRuby: '全部[ぜんぶ]食[た]べてしまった。', vi: 'Tôi lỡ ăn hết.' };
    const text = JSON.stringify([point]);
    const fixed = replaceRow(text, 'grammar', 0, { ...point, ...grammarPatch(draft) });
    const rows = parseOk(parseGrammarImport(fixed!, 'f'));
    expect(rows[0]?.status).toBe('ok');
    expect(rows[0]?.data?.sentences).toHaveLength(1);
  });

  it('cuts a file over the sentence cap down to it', () => {
    const many = Array.from({ length: MAX_GRAMMAR_SENTENCES + 2 }, (_, i) => ({
      jpRuby: `文${i}`,
      vi: `${i}`,
    }));
    expect(grammarPatch(grammarDraft({ ...point, sentences: many })).sentences).toHaveLength(
      MAX_GRAMMAR_SENTENCES,
    );
  });
});

describe('unfence', () => {
  const file = JSON.stringify({ words: [cat] }, null, 2);

  it('drops the one code block around a pasted reply', () => {
    expect(unfence('```json\n' + file + '\n```')).toBe(file);
    expect(unfence('\n```\r\n' + file + '\r\n```\n')).toBe(file);
    expect(parseOk(parseImport(unfence('```json\n' + file + '\n```'), 'f'))[0]?.status).toBe('ok');
  });

  it('leaves unfenced text, and a fence that does not enclose it, alone', () => {
    expect(unfence(file)).toBe(file);
    const trailing = file + '\n```\nmore\n```';
    expect(unfence(trailing)).toBe(trailing);
  });
});

function parseOk<T>(outcome: { ok: true; result: { rows: T[] } } | { ok: false; error: string }) {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result.rows;
}
