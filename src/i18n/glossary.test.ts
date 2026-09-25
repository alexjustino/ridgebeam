import { describe, expect, it } from 'vitest';

import glossary from './glossary.json';
import { LANGUAGES } from './index';

/**
 * The glossary is data: every term the product shows, with its plain sentence, in every language
 * the product speaks (SPEC §2.13). It is rendered into docs/GLOSSARY.md by a script and a gate
 * holds the two together; this test holds the data itself — a term that is missing a language is
 * a term one half of the people it is for cannot read.
 */

interface Entry {
  term: string;
  sentence: string;
}

type Term = { key: string } & Record<string, unknown>;

const terms = glossary.terms as Term[];

describe('the glossary', () => {
  it('speaks exactly the languages the product ships in', () => {
    expect(glossary.languages).toEqual([...LANGUAGES]);
  });

  it('has terms, each under a key of its own', () => {
    expect(terms.length).toBeGreaterThan(20);
    const keys = terms.map((term) => term.key);
    expect(new Set(keys).size, 'duplicate keys').toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z][A-Za-z]*$/);
  });

  it.each(terms.map((term) => [term.key, term] as const))(
    'gives %s a term and a plain sentence in every language',
    (_key, term) => {
      for (const language of LANGUAGES) {
        const entry = term[language] as Entry | undefined;
        expect(entry, `${term.key} has no ${language}`).toBeDefined();
        expect(entry?.term.trim(), `${term.key} ${language} term`).not.toBe('');
        expect(entry?.sentence.trim(), `${term.key} ${language} sentence`).not.toBe('');
        // A plain sentence is a sentence: it ends like one.
        expect(entry?.sentence.trim(), `${term.key} ${language} sentence`).toMatch(/[.!?"”]$/);
      }
    },
  );

  it('names every term the F0 screens use', () => {
    const keys = new Set(terms.map((term) => term.key));
    for (const used of [
      'work',
      'stage',
      'activity',
      'duration',
      'responsible',
      'calendar',
      'workingDay',
      'holiday',
      'finishDate',
      'readiness',
      'missing',
      'person',
      'lens',
      'lensOwner',
      'lensArchitect',
      'lensEngineer',
      'dashboard',
      'figure',
    ]) {
      expect(keys, `the glossary has no ${used}`).toContain(used);
    }
  });
});
