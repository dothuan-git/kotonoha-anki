import { describe, expect, it } from 'vitest';

import { overlapPercent } from '@/lib/overlap';

const sentence = { jp: '財布をなくしてしまった。', jpRuby: '財布[さいふ]をなくしてしまった。' };

describe('overlapPercent', () => {
  it('is null when nothing was written', () => {
    expect(overlapPercent('', sentence)).toBeNull();
    expect(overlapPercent('  。 ', sentence)).toBeNull();
  });

  it('is 100 for the sentence itself, punctuation aside', () => {
    expect(overlapPercent('財布をなくしてしまった', sentence)).toBe(100);
  });

  it('scores a correct sentence typed in kana against the reading', () => {
    expect(overlapPercent('さいふをなくしてしまった', sentence)).toBe(100);
  });

  it('is partial for a partly matching attempt', () => {
    const p = overlapPercent('さいふをなくした', sentence)!;
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(100);
  });

  it('is 0 for an unrelated attempt', () => {
    expect(overlapPercent('あめ', sentence)).toBe(0);
  });

  it('does not count a repeated pair more often than the model has it', () => {
    expect(overlapPercent('ししししし', { jp: 'しし', jpRuby: 'しし' })).toBeLessThan(100);
  });
});
