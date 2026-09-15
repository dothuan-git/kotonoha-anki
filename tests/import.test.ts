import { describe, expect, it } from 'vitest';

import { MAX_IMPORT_ROWS, countRows, parseImport } from '@/lib/import';

/**
 * The import file is written by a language model, so the interesting cases are
 * not "is this JSON" but "is this JSON subtly wrong". Each case below is a way
 * a generated file has to be allowed to be imperfect, or a way it must not be.
 */
const VALID = {
  headword: '勉強',
  reading: 'べんきょう',
  meaning: 'học tập, sự học',
  pos: 'Noun',
  jlpt: 'N5',
  sentence: {
    jpRuby: '毎日[まいにち]日本語[にほんご]を勉強[べんきょう]します。',
    vi: 'Tôi học tiếng Nhật mỗi ngày.',
  },
};

/** Parses one row and hands back the judgement on it. */
function judge(row: unknown) {
  const outcome = parseImport(JSON.stringify([row]), 'test');
  if (!outcome.ok) throw new Error(`file rejected: ${outcome.error}`);
  const parsed = outcome.result.rows[0];
  if (!parsed) throw new Error('no row parsed');
  return parsed;
}

const rowCases: Array<{ name: string; row: unknown; reason: string | null }> = [
  { name: 'a complete row is accepted', row: VALID, reason: null },
  {
    name: 'only headword, reading, meaning and pos are required',
    row: { headword: '猫', reading: 'ねこ', meaning: 'con mèo', pos: 'Noun' },
    reason: null,
  },
  {
    name: 'the Vietnamese part-of-speech label is accepted as well as the English one',
    row: { ...VALID, pos: 'Động từ loại 2' },
    reason: null,
  },
  {
    name: 'a part of speech that is neither is refused rather than guessed at',
    row: { ...VALID, pos: 'noun-ish' },
    reason: 'Từ loại không hợp lệ: "noun-ish"',
  },
  {
    name: 'a reading with kanji in it is refused, because the review screen speaks it',
    row: { ...VALID, reading: '勉強' },
    reason: 'Cách đọc phải là kana, không được có Hán tự',
  },
  {
    name: 'a missing meaning is named in Vietnamese',
    row: { headword: '猫', reading: 'ねこ', pos: 'Noun' },
    reason: 'Thiếu nghĩa tiếng Việt',
  },
  {
    name: 'a sentence with kanji but no furigana is refused',
    row: { ...VALID, sentence: { jpRuby: '毎日日本語を勉強します。', vi: 'Tôi học.' } },
    reason: 'Câu ví dụ có Hán tự nhưng chưa có furigana trong [ ]',
  },
  {
    name: 'a kana-only sentence needs no furigana, having nothing to annotate',
    row: {
      headword: 'ゆっくり',
      reading: 'ゆっくり',
      meaning: 'chậm rãi',
      pos: 'Adverb',
      sentence: { jpRuby: 'ゆっくりしてください。', vi: 'Xin cứ từ từ.' },
    },
    reason: null,
  },
  {
    name: 'a row that is not an object at all does not take the file down with it',
    row: 'べんきょう',
    reason: 'Dòng này không phải là một từ',
  },
  {
    name: 'a JLPT level outside N5-N1 is refused in Vietnamese, not in zod English',
    row: { ...VALID, jlpt: 'N6' },
    reason: 'Cấp JLPT phải là N5, N4, N3, N2 hoặc N1',
  },
  {
    name: 'a sentence that is a bare string is refused in Vietnamese',
    row: { ...VALID, sentence: 'Tôi học tiếng Nhật mỗi ngày.' },
    reason: 'Câu ví dụ phải là object có jpRuby và vi',
  },
];

describe('parseImport — one row at a time', () => {
  for (const testCase of rowCases) {
    it(testCase.name, () => {
      const row = judge(testCase.row);
      if (testCase.reason === null) {
        expect(row.status).toBe('ok');
        expect(row.data).toBeDefined();
      } else {
        expect(row.status).toBe('invalid');
        expect(row.reason).toBe(testCase.reason);
        expect(row.data).toBeUndefined();
      }
    });
  }

  it('derives the plain sentence from the furigana rather than trusting the file', () => {
    const row = judge({
      ...VALID,
      // A generated file will sometimes disagree with itself. The ruby wins,
      // because it is the field that cannot be reconstructed from the other.
      sentence: { ...VALID.sentence, jp: 'completely wrong' },
    });

    expect(row.data?.sentence?.jp).toBe('毎日日本語を勉強します。');
    expect(row.data?.sentence?.jpRuby).toBe(VALID.sentence.jpRuby);
  });

  it('marks an imported sentence as generated', () => {
    expect(judge(VALID).data?.sentence?.source).toBe('ai');
  });

  it('keeps transitivity on a verb', () => {
    const row = judge({
      headword: '開ける',
      reading: 'あける',
      meaning: 'mở',
      pos: 'Verb 2',
      transitivity: 'transitive',
    });
    expect(row.data?.transitivity).toBe('transitive');
  });

  it('strips transitivity from anything that is not a verb', () => {
    expect(judge({ ...VALID, transitivity: 'transitive' }).data?.transitivity).toBeNull();
  });

  it('accepts a bare string of Hán Việt as well as a list', () => {
    const row = judge({ ...VALID, hanViet: { 勉: 'miễn', 強: ['cường'] } });
    expect(row.data?.hanViet).toEqual({ 勉: ['miễn'], 強: ['cường'] });
  });
});

describe('parseImport — the file as a whole', () => {
  it('takes a bare array and names the batch after the file', () => {
    const outcome = parseImport(JSON.stringify([VALID]), 'bai-12');
    expect(outcome).toMatchObject({ ok: true, result: { source: 'bai-12' } });
  });

  it('lets the file name the batch itself', () => {
    const outcome = parseImport(
      JSON.stringify({ source: 'Minna bài 12', words: [VALID] }),
      'bai-12',
    );
    expect(outcome).toMatchObject({ ok: true, result: { source: 'Minna bài 12' } });
  });

  it('refuses a second copy of a word, pointing at the line that had it first', () => {
    const outcome = parseImport(JSON.stringify([VALID, VALID]), 'test');
    if (!outcome.ok) throw new Error(outcome.error);

    expect(outcome.result.rows[0]?.status).toBe('ok');
    expect(outcome.result.rows[1]?.status).toBe('invalid');
    expect(outcome.result.rows[1]?.reason).toBe('Trùng với dòng 1 trong tệp');
  });

  it('allows one headword twice when the readings differ', () => {
    const outcome = parseImport(
      JSON.stringify([
        { headword: '開ける', reading: 'あける', meaning: 'mở', pos: 'Verb 2' },
        { headword: '開ける', reading: 'ひらける', meaning: 'mở ra', pos: 'Verb 2' },
      ]),
      'test',
    );
    if (!outcome.ok) throw new Error(outcome.error);
    expect(countRows(outcome.result.rows).ok).toBe(2);
  });

  it('gives every row the file order to carry, gaps and all', () => {
    const outcome = parseImport(
      JSON.stringify([VALID, { headword: '猫' }, { headword: '犬', reading: 'いぬ', meaning: 'con chó', pos: 'Noun' }]),
      'test',
    );
    if (!outcome.ok) throw new Error(outcome.error);

    // A rejected row still spends its position, so the words that survive keep
    // the order they were written in rather than sliding forward.
    expect(outcome.result.rows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(outcome.result.rows[0]?.data?.sortOrder).toBe(0);
    expect(outcome.result.rows[2]?.data?.sortOrder).toBe(2);
  });

  it('counts what the preview has to say out loud', () => {
    const outcome = parseImport(JSON.stringify([VALID, VALID, { headword: '猫' }]), 'test');
    if (!outcome.ok) throw new Error(outcome.error);
    expect(countRows(outcome.result.rows)).toEqual({ ok: 1, duplicate: 0, invalid: 2 });
  });

  const fileCases: Array<{ name: string; text: string; error: string }> = [
    {
      name: 'something that is not JSON is rejected as a file, not as a row',
      text: 'Chắc chắn rồi! Đây là danh sách từ:',
      error: 'Tệp không phải JSON hợp lệ',
    },
    {
      name: 'JSON that is neither an array nor a words object is rejected',
      text: '{"vocabulary":[]}',
      error: 'Tệp phải là một mảng từ, hoặc một object có trường "words"',
    },
    { name: 'an empty file is rejected', text: '[]', error: 'Tệp không có từ nào' },
  ];

  for (const testCase of fileCases) {
    it(testCase.name, () => {
      expect(parseImport(testCase.text, 'test')).toEqual({ ok: false, error: testCase.error });
    });
  }

  it('refuses a file past the row cap before parsing any of it', () => {
    const outcome = parseImport(
      JSON.stringify(Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => VALID)),
      'test',
    );
    expect(outcome.ok).toBe(false);
  });
});
