import { describe, expect, it } from 'vitest';

import { LENSES } from '@/domain/settings';

import glossary from './glossary.json';
import { capitalised, lensVariants, TERM_KEYS, termFor } from './terms';

/**
 * The lens is a vocabulary table over the glossary (ADR-014), held as data and tested as data:
 * every lens named is a lens that exists, no variant is empty, every term the screens name is in
 * the glossary, and the words the plan decided are the words that come back.
 */
describe('the lens vocabulary', () => {
  it('names only the three lenses, and never an empty word', () => {
    const variants = lensVariants();
    expect(variants.length).toBeGreaterThan(0);
    for (const variant of variants) {
      expect(LENSES as readonly string[], `${variant.key} ${variant.language}`).toContain(
        variant.lens,
      );
      expect(variant.word.trim(), `${variant.key} ${variant.language} ${variant.lens}`).not.toBe(
        '',
      );
    }
  });

  it('has every term a screen names', () => {
    const keys = new Set(glossary.terms.map((term) => term.key));
    for (const key of TERM_KEYS) expect(keys, `the glossary has no ${key}`).toContain(key);
  });

  it('says the words the vocabulary table decided', () => {
    expect(termFor('en', 'owner', 'activity')).toBe('job');
    expect(termFor('en', 'owner', 'responsible')).toBe('who does it');
    expect(termFor('en', 'architect', 'activity')).toBe('work item');
    expect(termFor('en', 'engineer', 'room')).toBe('area');
    expect(termFor('en', 'engineer', 'plan')).toBe('work breakdown');
    expect(termFor('pt-BR', 'owner', 'activity')).toBe('serviço');
    expect(termFor('pt-BR', 'architect', 'stage')).toBe('fase');
    expect(termFor('pt-BR', 'owner', 'readiness')).toBe('quanto o plano está pronto');
  });

  it('falls back to the term for a lens that has no word of its own', () => {
    expect(termFor('en', 'owner', 'stage')).toBe('stage');
    expect(termFor('pt-BR', 'engineer', 'work')).toBe('obra');
  });

  it('never varies the sentence, only the word', () => {
    for (const term of glossary.terms as Array<Record<string, unknown>>) {
      for (const language of ['en', 'pt-BR'] as const) {
        const text = term[language] as { lenses?: Record<string, unknown> };
        for (const value of Object.values(text.lenses ?? {})) expect(typeof value).toBe('string');
      }
    }
  });

  it('capitalises the first letter in the language', () => {
    expect(capitalised('en', 'who does it')).toBe('Who does it');
    expect(capitalised('pt-BR', 'área')).toBe('Área');
    expect(capitalised('en', '')).toBe('');
  });
});
