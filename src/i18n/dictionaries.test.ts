import { describe, expect, it } from 'vitest';

import { AFTERCARE_MESSAGE_KEYS } from '@/domain/aftercare';
import { COMPARISON_LABEL_KEYS, COMPARISON_PROBLEM_KEYS } from '@/domain/baselines';
import { CHANGE_LABEL_KEYS, CHANGE_PROBLEM_KEYS } from '@/domain/changes';
import {
  DEFAULT_CHECK_KEYS,
  GATES_HELD_LABEL_KEY,
  STAGES_LABEL_KEYS,
  STAGES_READY_LABEL_KEY,
} from '@/domain/checks';
import { DASHBOARD_LABEL_KEYS, WEEK_DAY_STATUS_KEYS } from '@/domain/dashboard';
import { DECISIONS_DUE_LABEL_KEY } from '@/domain/decisions';
import {
  DELAY_BASIS_KEYS,
  DELAY_CAUSE_KEYS,
  DELAY_LABEL_KEYS,
  DELAY_PARTY_KEYS,
  DELAY_STATUS_KEYS,
} from '@/domain/delay';
import { DONE_LABEL_KEYS, LOST_CAUSE_KEYS } from '@/domain/diary';
import { DOCUMENTS_LABEL_KEYS, TARGET_KINDS } from '@/domain/documents';
import { FUNDING_MESSAGE_KEYS } from '@/domain/funding';
import { MILESTONE_MESSAGE_KEYS } from '@/domain/milestones';
import { MONEY_LABEL_KEYS, NOT_PRICED_KEY, OVER_COMMITTED_LABEL_KEY } from '@/domain/money';
import {
  READINESS_LABEL_KEY,
  READINESS_MESSAGE_KEYS,
  RULE_EXPLANATION_KEYS,
  RULE_LABEL_KEYS,
  RULE_UNCOUNTED_KEY,
} from '@/domain/readiness';
import { DIARY_ROW_STATUS_KEYS } from '@/domain/reports/diary';
import { RUNWAY_MESSAGE_KEYS, RUNWAY_NOTE_KEYS } from '@/domain/runway';
import { HANDOVER_GAP_KEYS, HANDOVER_LABEL_KEYS } from '@/domain/reports/handover';
import { LOOKAHEAD_MESSAGE_KEYS } from '@/domain/reports/lookahead';
import { SCHEDULE_BLOCKED_KEYS } from '@/domain/reports/schedule';
import { WEEKLY_LABEL_KEYS, WEEKLY_PROBLEM_KEYS } from '@/domain/reports/weekly';
import {
  OPTIONAL_QUESTION_MESSAGE_KEYS,
  PAYMENT_PLAN_QUESTION_KEYS,
  QUESTION_MESSAGE_KEYS,
} from '@/domain/questions';
import { ACTUALS_MESSAGE_KEYS } from '@/domain/schedule/actuals';
import { FORECAST_LABEL_KEYS, FORECAST_PROBLEM_KEYS } from '@/domain/schedule/forecast';
import { PROBABILITY_MESSAGE_KEYS } from '@/domain/schedule/probability';
import { SLIP_LABEL_KEY } from '@/domain/schedule/slip';
import { MEETING_MESSAGE_KEYS } from '@/domain/meetings';
import { PURCHASE_MESSAGE_KEYS } from '@/domain/purchases';
import { SNAG_MESSAGE_KEYS } from '@/domain/snags';
import { STORY_MESSAGE_KEYS } from '@/domain/reports/story';
import { WHAT_IF_LABEL_KEY, WHAT_IF_PROBLEM_KEYS } from '@/domain/schedule/whatIf';
import { LANGUAGES as LANGUAGE_CHOICES } from '@/domain/settings';
import { TEMPLATE_NOTE_KEYS } from '@/domain/templates/apply';
import { TEMPLATE_PROBLEM_KEYS } from '@/domain/templates/validate';

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
  it('have both forms: every `.one` has its `.other`', () => {
    // A `.other` alone is a word, not a plural form — a document kind called "other" — so only a
    // `.one` makes a key a plural, and then its `.other` must be there too.
    for (const key of english) {
      if (!key.endsWith('.one')) continue;
      const base = key.replace(/\.one$/, '');
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

describe('every rule is named and explained, in both languages (F3)', () => {
  it.each(LANGUAGES)(
    '%s carries each rule’s label and its one-sentence explanation',
    (language) => {
      const dictionary = DICTIONARIES[language] as Record<string, string>;
      for (const key of [
        ...Object.values(RULE_LABEL_KEYS),
        ...Object.values(RULE_EXPLANATION_KEYS),
        DECISIONS_DUE_LABEL_KEY,
        SLIP_LABEL_KEY,
        ...Object.values(DONE_LABEL_KEYS),
        'diary.figure.daysWithoutEntry',
        'diary.figure.lostDays',
        ...Object.values(STAGES_LABEL_KEYS),
        GATES_HELD_LABEL_KEY,
        ...Object.values(MONEY_LABEL_KEYS),
        OVER_COMMITTED_LABEL_KEY,
        ...Object.values(DOCUMENTS_LABEL_KEYS),
        ...TARGET_KINDS.map((kind) => `documents.target.${kind}`),
        'documents.target.detached',
        ...DEFAULT_CHECK_KEYS.start,
        ...DEFAULT_CHECK_KEYS.close,
        ...Object.values(COMPARISON_LABEL_KEYS),
        ...Object.values(COMPARISON_PROBLEM_KEYS),
        WHAT_IF_LABEL_KEY,
        ...Object.values(WHAT_IF_PROBLEM_KEYS),
        NOT_PRICED_KEY,
        ...Object.values(TEMPLATE_PROBLEM_KEYS),
        ...Object.values(DASHBOARD_LABEL_KEYS),
        ...Object.values(WEEK_DAY_STATUS_KEYS),
        ...Object.values(WEEKLY_LABEL_KEYS),
        ...Object.values(WEEKLY_PROBLEM_KEYS),
        ...Object.values(DIARY_ROW_STATUS_KEYS),
        ...Object.values(SCHEDULE_BLOCKED_KEYS),
        STAGES_READY_LABEL_KEY,
        RULE_UNCOUNTED_KEY,
        ...Object.values(QUESTION_MESSAGE_KEYS),
        ...Object.values(OPTIONAL_QUESTION_MESSAGE_KEYS),
        ...MILESTONE_MESSAGE_KEYS,
        ...Object.values(PAYMENT_PLAN_QUESTION_KEYS),
        ...Object.values(HANDOVER_GAP_KEYS),
        ...Object.values(HANDOVER_LABEL_KEYS),
        ...LOOKAHEAD_MESSAGE_KEYS,
        ...Object.values(CHANGE_PROBLEM_KEYS),
        ...Object.values(CHANGE_LABEL_KEYS),
        ...SNAG_MESSAGE_KEYS,
        ...MEETING_MESSAGE_KEYS,
        ...PURCHASE_MESSAGE_KEYS,
        ...ACTUALS_MESSAGE_KEYS,
        ...AFTERCARE_MESSAGE_KEYS,
        ...STORY_MESSAGE_KEYS,
      ]) {
        expect(dictionary[key], `${language} ${key}`).toBeTruthy();
      }
    },
  );
});

describe('the finish as a probability, in both languages (D1)', () => {
  /** Every key of a nested table of keys, flattened. */
  const keysOf = (table: object): string[] =>
    Object.values(table).flatMap((value) =>
      typeof value === 'string' ? [value] : keysOf(value as object),
    );

  it.each(LANGUAGES)('%s carries every sentence the simulation hands the interface', (language) => {
    const dictionary = DICTIONARIES[language] as Record<string, string>;
    const keys = keysOf(PROBABILITY_MESSAGE_KEYS);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) expect(dictionary[key], `${language} ${key}`).toBeTruthy();
  });

  it('says a chance in natural frequencies: "N in 10" and "N em 10"', () => {
    const frequency = PROBABILITY_MESSAGE_KEYS.frequency['in-ten'];
    expect(translate(DICTIONARIES.en, frequency, { n: 8 })).toBe('8 in 10 chances');
    expect(translate(DICTIONARIES['pt-BR'], frequency, { n: 8 })).toBe('8 em 10 chances');
    expect(
      translate(DICTIONARIES['pt-BR'], PROBABILITY_MESSAGE_KEYS.headline, {
        chance: '8 em 10 chances',
        date: '14 de novembro de 2026',
      }),
    ).toBe('8 em 10 chances de terminar até 14 de novembro de 2026');
  });
});

describe('where the money comes from and whether it lasts, in both languages (E2)', () => {
  /** The notes that count something are plurals: their key is a base, with both forms. */
  const PLURAL: ReadonlySet<string> = new Set([
    RUNWAY_NOTE_KEYS.late,
    RUNWAY_NOTE_KEYS.notPriced,
    RUNWAY_NOTE_KEYS.beyond,
    RUNWAY_NOTE_KEYS.held,
  ]);

  it.each(LANGUAGES)(
    '%s carries every key funding and the runway hand the interface',
    (language) => {
      const dictionary = DICTIONARIES[language] as Record<string, string>;
      for (const key of [...FUNDING_MESSAGE_KEYS, ...RUNWAY_MESSAGE_KEYS]) {
        if (PLURAL.has(key)) {
          expect(dictionary[`${key}.one`], `${language} ${key}.one`).toBeTruthy();
          expect(dictionary[`${key}.other`], `${language} ${key}.other`).toBeTruthy();
        } else {
          expect(dictionary[key], `${language} ${key}`).toBeTruthy();
        }
      }
    },
  );

  it('asks the question in plain words, and answers it the way a person says it', () => {
    expect(translate(DICTIONARIES['pt-BR'], 'money.runway.title')).toBe('O dinheiro vai dar?');
    expect(
      translate(DICTIONARIES['pt-BR'], 'money.runway.sentence.short', {
        week: '16 de nov.',
        short: 'R$ 4.200,00',
      }),
    ).toBe('Falta dinheiro na semana de 16 de nov. — faltam R$ 4.200,00.');
    expect(translate(DICTIONARIES.en, 'money.runway.sentence.lasts', { spare: '$1,200.00' })).toBe(
      'The money lasts to the end, with $1,200.00 to spare.',
    );
  });
});

describe('why it is late, in both languages (E3)', () => {
  it.each(LANGUAGES)(
    '%s carries every key the forecast and the ledger hand the interface',
    (language) => {
      const dictionary = DICTIONARIES[language] as Record<string, string>;
      for (const key of [
        ...Object.values(LOST_CAUSE_KEYS),
        ...Object.values(FORECAST_LABEL_KEYS),
        ...Object.values(FORECAST_PROBLEM_KEYS),
        ...Object.values(DELAY_LABEL_KEYS),
        ...Object.values(DELAY_STATUS_KEYS),
        ...Object.values(DELAY_CAUSE_KEYS),
        ...Object.values(DELAY_BASIS_KEYS),
        ...Object.values(DELAY_PARTY_KEYS),
      ]) {
        expect(dictionary[key], `${language} ${key}`).toBeTruthy();
      }
      for (const base of ['delay.unexplained', 'delay.madeUp', 'schedule.forecast.leftOut']) {
        expect(dictionary[`${base}.one`], `${language} ${base}.one`).toBeTruthy();
        expect(dictionary[`${base}.other`], `${language} ${base}.other`).toBeTruthy();
      }
    },
  );

  it('says the titles and the causes in the owner’s words', () => {
    expect(translate(DICTIONARIES['pt-BR'], DELAY_LABEL_KEYS.title)).toBe('Por que está atrasada?');
    expect(translate(DICTIONARIES['pt-BR'], FORECAST_LABEL_KEYS.title)).toBe('Do jeito que está');
    expect(translate(DICTIONARIES.en, DELAY_CAUSE_KEYS.unstated)).toBe('Lost, no cause said');
    expect(translate(DICTIONARIES['pt-BR'], DELAY_CAUSE_KEYS.unstated)).toBe(
      'Dia perdido sem causa dita',
    );
    expect(translate(DICTIONARIES['pt-BR'], DELAY_CAUSE_KEYS.unexplained)).toBe(
      'Não explicado pelo registro',
    );
  });
});

describe('what a template says, in both languages (F9)', () => {
  it.each(LANGUAGES)(
    '%s carries every note applying a template can leave, with both plural forms',
    (language) => {
      const dictionary = DICTIONARIES[language] as Record<string, string>;
      // Every note counts something, so each is said by the language's own plural rule.
      for (const key of Object.values(TEMPLATE_NOTE_KEYS)) {
        expect(dictionary[`${key}.one`], `${language} ${key}.one`).toBeTruthy();
        expect(dictionary[`${key}.other`], `${language} ${key}.other`).toBeTruthy();
      }
    },
  );
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
