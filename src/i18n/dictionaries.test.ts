import { describe, expect, it } from 'vitest';

import { READINESS_LABEL_KEY, READINESS_MESSAGE_KEYS } from '@/domain/readiness';
import { LANGUAGES as LANGUAGE_CHOICES } from '@/domain/settings';

import { en } from './en';
import {
  DICTIONARIES,
  LANGUAGE_AUTONYMS,
  LANGUAGES,
  pluralKey,
  resolveLanguage,
  translate,
  variablesOf,
  type PluralBase,
} from './index';

/**
 * The two dictionaries are one set of keys in two languages.
 *
 * The type system already refuses a dictionary with a key missing or extra; this is the second
 * gate, at run time, so a cast or a spread cannot quietly let one through — and it also checks
 * what the type cannot: that no sentence is empty, that every translation carries exactly the
 * `{variables}` its English does, that every plural has both its forms, and that every key the
 * domain hands the interface is here to be said.
 */

const english = Object.keys(en).sort();

describe.each(LANGUAGES.filter((language) => language !== 'en'))(
  'the %s dictionary',
  (language) => {
    const dictionary = DICTIONARIES[language] as Record<string, string>;
    const keys = Object.keys(dictionary).sort();

    it('has every English key', () => {
      const missing = english.filter((key) => !(key in dictionary));
      expect(missing, `missing from ${language}: ${missing.join(', ')}`).toEqual([]);
    });

    it('has no key English does not', () => {
      const extra = keys.filter((key) => !(key in en));
      expect(extra, `extra in ${language}: ${extra.join(', ')}`).toEqual([]);
    });

    it.each(english)('translates %s into a sentence', (key) => {
      expect(typeof dictionary[key]).toBe('string');
      expect(dictionary[key]?.trim(), `${language} ${key} is empty`).not.toBe('');
    });

    it.each(english)('carries the same variables as English in %s', (key) => {
      const expected = variablesOf(en[key as keyof typeof en]);
      expect(variablesOf(dictionary[key] ?? ''), `${language} ${key}`).toEqual(expected);
    });
  },
);

describe('the English dictionary', () => {
  it('has something in it, and no empty sentence', () => {
    expect(english.length).toBeGreaterThan(100);
    for (const key of english) {
      expect(en[key as keyof typeof en].trim(), key).not.toBe('');
    }
  });

  it('writes the product name as itself, in every language: Ridgebeam is never translated', () => {
    for (const language of LANGUAGES) {
      const dictionary = DICTIONARIES[language] as Record<string, string>;
      for (const [key, sentence] of Object.entries(dictionary)) {
        for (const written of sentence.match(/ridge\s?-?beam(?!_)/gi) ?? []) {
          // "ridge beam" in the name story is the English words, not the product; an environment
          // variable (RIDGEBEAM_DATA_DIR) is a name a person types, not the product's name.
          if (written.toLowerCase() === 'ridge beam') continue;
          expect(written, `${language} ${key}`).toBe('Ridgebeam');
        }
      }
    }
  });
});

describe('plurals', () => {
  it('have both forms, and each form says its count the same way', () => {
    for (const key of english) {
      if (!key.endsWith('.one') && !key.endsWith('.other')) continue;
      const base = key.replace(/\.(one|other)$/, '');
      expect(english, `${base} has no .one`).toContain(`${base}.one`);
      expect(english, `${base} has no .other`).toContain(`${base}.other`);
    }
  });

  it('pick the form each language asks for', () => {
    expect(pluralKey('en', 'readiness.missing.activity.responsible', 1)).toBe(
      'readiness.missing.activity.responsible.one',
    );
    expect(pluralKey('en', 'readiness.missing.activity.responsible', 2)).toBe(
      'readiness.missing.activity.responsible.other',
    );
    expect(pluralKey('pt-BR', 'readiness.missing.activity.duration', 1)).toBe(
      'readiness.missing.activity.duration.one',
    );
    expect(pluralKey('pt-BR', 'readiness.missing.activity.duration', 3)).toBe(
      'readiness.missing.activity.duration.other',
    );
  });
});

describe('the readiness sentences — slice F0’s proof, in both languages', () => {
  const say = (language: 'en' | 'pt-BR', base: PluralBase, count: number) =>
    translate(DICTIONARIES[language], pluralKey(language, base, count), { count });

  it('says one missing responsible in English and in Portuguese', () => {
    expect(say('en', 'readiness.missing.activity.responsible', 1)).toBe(
      '1 activity has no responsible.',
    );
    expect(say('pt-BR', 'readiness.missing.activity.responsible', 1)).toBe(
      '1 atividade não tem responsável.',
    );
  });

  it('says two missing durations in English and in Portuguese', () => {
    expect(say('en', 'readiness.missing.activity.duration', 2)).toBe(
      '2 activities have no duration.',
    );
    expect(say('pt-BR', 'readiness.missing.activity.duration', 2)).toBe(
      '2 atividades não têm duração.',
    );
  });

  it('carries every message key the domain hands the interface, with both plural forms', () => {
    for (const language of LANGUAGES) {
      const dictionary = DICTIONARIES[language] as Record<string, string>;
      for (const key of Object.values(READINESS_MESSAGE_KEYS)) {
        expect(dictionary[`${key}.one`], `${language} ${key}.one`).toBeTruthy();
        expect(dictionary[`${key}.other`], `${language} ${key}.other`).toBeTruthy();
      }
      expect(dictionary[READINESS_LABEL_KEY], `${language} ${READINESS_LABEL_KEY}`).toBeTruthy();
    }
  });
});

describe('the languages', () => {
  it('are exactly the domain’s choices, less "system"', () => {
    expect([...LANGUAGES]).toEqual(LANGUAGE_CHOICES.filter((choice) => choice !== 'system'));
  });

  it('are each named in themselves', () => {
    expect(LANGUAGE_AUTONYMS).toEqual({ en: 'English', 'pt-BR': 'Português (Brasil)' });
  });
});

describe('resolveLanguage', () => {
  it('keeps an explicit choice, whatever Windows says', () => {
    expect(resolveLanguage('en', 'pt-BR')).toBe('en');
    expect(resolveLanguage('pt-BR', 'en-US')).toBe('pt-BR');
  });

  it.each([['pt-BR'], ['pt'], ['pt-PT'], ['PT-br'], ['pt_BR']])(
    'reads %s from Windows as Brazilian Portuguese',
    (tag) => {
      expect(resolveLanguage('system', tag)).toBe('pt-BR');
    },
  );

  it.each([['en-US'], ['es-ES'], ['fr'], [''], [null], [undefined]])(
    'reads %o from Windows as English, the language there is otherwise',
    (tag) => {
      expect(resolveLanguage('system', tag)).toBe('en');
    },
  );
});

describe('translate', () => {
  it('fills the variables it is given', () => {
    expect(translate(en, 'figure.percent', { value: '50' })).toBe('50 %');
  });

  it('leaves a variable it was not given visible, rather than blank', () => {
    expect(translate(en, 'start.recent.missing', {})).toBe(
      'The folder is no longer here: {folder}',
    );
  });

  it('lists the variables a sentence carries, sorted', () => {
    expect(variablesOf('{b} and {a} and {b}')).toEqual(['a', 'b', 'b']);
  });
});
