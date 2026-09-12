import { describe, expect, it } from 'vitest';

import { flattenTag, jlptFromNumber, mapPos, pickJlptHint } from '@/lib/dict/pos';
import type { JotobaPosTag } from '@/lib/dict/pos';
import type { Pos, Transitivity } from '@/lib/types';

/**
 * Every `tags` array below is a verbatim copy of what jotoba.de returned for
 * that word. If Jotoba changes its enum shapes these tests fail loudly, which
 * is the point — the mapping is the seam and it must not drift silently.
 */
const cases: Array<{
  word: string;
  tags: JotobaPosTag[];
  pos: Pos | null;
  transitivity: Transitivity;
}> = [
  {
    word: '飲む — godan, transitive',
    tags: [{ Verb: { Godan: 'Mu' } }, { Verb: 'Transitive' }],
    pos: 'Verb 1',
    transitivity: 'transitive',
  },
  {
    word: '行く — godan irregular stem, intransitive',
    tags: [{ Verb: { Godan: 'IkuYuku' } }, { Verb: 'Intransitive' }],
    pos: 'Verb 1',
    transitivity: 'intransitive',
  },
  {
    word: '開ける — ichidan, transitive',
    tags: [{ Verb: 'Ichidan' }, { Verb: 'Transitive' }],
    pos: 'Verb 2',
    transitivity: 'transitive',
  },
  {
    word: '呉れる — ichidan kureru special',
    tags: [{ Verb: 'IchidanKureru' }, { Verb: 'Transitive' }],
    pos: 'Verb 2',
    transitivity: 'transitive',
  },
  {
    word: '来る — kuru, intransitive',
    tags: [{ Verb: 'Kuru' }, { Verb: 'Intransitive' }],
    pos: 'Verb 3',
    transitivity: 'intransitive',
  },
  {
    word: '為る — suru proper',
    tags: [{ Verb: { Irregular: 'Suru' } }],
    pos: 'Verb 3',
    transitivity: null,
  },
  {
    // The rule that matters: NounOrAuxSuru marks every noun that takes する,
    // so it must lose to the Noun tag. Most added vocabulary looks like this.
    word: '勉強 — noun that takes する',
    tags: [{ Noun: 'Normal' }, { Verb: { Irregular: 'NounOrAuxSuru' } }, { Verb: 'Transitive' }],
    pos: 'Noun',
    transitivity: null,
  },
  {
    word: '懐かしい — i-adjective',
    tags: [{ Adjective: 'Keiyoushi' }],
    pos: 'I-adjective',
    transitivity: null,
  },
  {
    word: '静か — na-adjective',
    tags: [{ Adjective: 'Na' }],
    pos: 'Na-adjective',
    transitivity: null,
  },
  {
    word: '静かに — adverb',
    tags: ['Adverb'],
    pos: 'Adverb',
    transitivity: null,
  },
  {
    word: 'ゆっくり — adverb, also takes する',
    tags: ['Adverb', 'AdverbTo', { Verb: { Irregular: 'NounOrAuxSuru' } }],
    pos: 'Adverb',
    transitivity: null,
  },
  {
    word: '新幹線 — plain noun',
    tags: [{ Noun: 'Normal' }],
    pos: 'Noun',
    transitivity: null,
  },
  {
    word: 'を — particle',
    tags: ['Particle'],
    pos: 'Particle',
    transitivity: null,
  },
  {
    word: '然し — conjunction',
    tags: ['Conjunction'],
    pos: 'Conjunction',
    transitivity: null,
  },
  {
    word: 'どうも有難う — expression',
    tags: ['Expr'],
    pos: 'Expression',
    transitivity: null,
  },
  {
    word: '有難う — interjection folds into Expression',
    tags: ['Interjection'],
    pos: 'Expression',
    transitivity: null,
  },
  {
    word: '幹線 — noun with の-adjective sense',
    tags: [{ Noun: 'Normal' }, { Adjective: 'No' }],
    pos: 'Noun',
    transitivity: null,
  },
  {
    word: '来る — prenominal adjective falls back to Noun',
    tags: [{ Adjective: 'PreNoun' }],
    pos: 'Noun',
    transitivity: null,
  },
  {
    word: 'unmapped tag yields no guess',
    tags: ['Prefix'],
    pos: null,
    transitivity: null,
  },
  {
    word: 'empty tag list yields no guess',
    tags: [],
    pos: null,
    transitivity: null,
  },
];

describe('mapPos', () => {
  for (const c of cases) {
    it(c.word, () => {
      expect(mapPos(c.tags)).toEqual({ pos: c.pos, transitivity: c.transitivity });
    });
  }

  it('drops transitivity from non-verbs', () => {
    // 勉強 is tagged transitive by JMdict but we store it as a Noun, and a
    // transitive noun would be nonsense in the UI.
    const { transitivity } = mapPos([{ Noun: 'Normal' }, { Verb: 'Transitive' }]);
    expect(transitivity).toBeNull();
  });

  it('survives unrecognised tag shapes without throwing', () => {
    const weird = [{ Verb: { Godan: 'Mu' } }, { Something: { Deeply: 'Nested' } }, null, 42];
    expect(mapPos(weird as unknown as JotobaPosTag[]).pos).toBe('Verb 1');
  });
});

describe('flattenTag', () => {
  it.each([
    [{ Verb: { Godan: 'Mu' } }, 'Verb.Godan.Mu'],
    [{ Verb: 'Ichidan' }, 'Verb.Ichidan'],
    [{ Adjective: 'Na' }, 'Adjective.Na'],
    [{ Noun: 'Normal' }, 'Noun.Normal'],
    ['Adverb', 'Adverb'],
    [{}, ''],
  ])('%o -> %s', (tag, expected) => {
    expect(flattenTag(tag as JotobaPosTag)).toBe(expected);
  });
});

describe('jlpt', () => {
  it('maps Jotoba numbers, where 5 is easiest', () => {
    expect(jlptFromNumber(5)).toBe('N5');
    expect(jlptFromNumber(1)).toBe('N1');
    expect(jlptFromNumber(0)).toBeNull();
    expect(jlptFromNumber(null)).toBeNull();
  });

  it('hints the easiest constituent kanji', () => {
    expect(pickJlptHint([4, 2, 3])).toBe('N4');
  });

  it('has no hint when no kanji carries a level', () => {
    expect(pickJlptHint([null, undefined])).toBeNull();
    expect(pickJlptHint([])).toBeNull();
  });
});
