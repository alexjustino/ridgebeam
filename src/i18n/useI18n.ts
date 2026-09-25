import { createContext, useContext } from 'react';

import { describeError } from '@/data/errors';
import { DEFAULT_LANGUAGE, type LanguageChoice } from '@/domain/settings';

import {
  currencyLabel,
  formatDay,
  formatInstant,
  formatNumber,
  weekdayNames,
  workingDaysList,
} from './format';
import {
  DICTIONARIES,
  pluralKey,
  translate,
  type Language,
  type MessageKey,
  type PluralBase,
  type Variables,
} from './index';

/** What a component gets from `useI18n`. */
export interface I18n {
  /** What the person chose: a language, or `system`. */
  choice: LanguageChoice;
  /** The language that choice means on this machine — what is on screen. */
  language: Language;
  /** One sentence, in that language. */
  t: (key: MessageKey, variables?: Variables) => string;
  /** A sentence about a count, in the form the language's plural rule asks for. */
  tp: (base: PluralBase, count: number, variables?: Variables) => string;
  /**
   * A failure, as a sentence in that language. A host error of a kind this build knows is
   * translated; one it does not know keeps the host's words; anything that is not a host error
   * is the one "something went wrong" sentence, with the detail sent to the console.
   */
  describeError: (error: unknown) => string;
  /** A `YYYY-MM-DD` day, a UTC instant, a number — through `Intl`. */
  day: (day: string) => string;
  instant: (instant: string) => string;
  number: (value: number) => string;
  weekdays: (width: 'long' | 'short') => string[];
  workingDays: (mask: readonly boolean[]) => string;
  currency: (code: string) => string;
}

export function build(choice: LanguageChoice, language: Language): I18n {
  const dictionary = DICTIONARIES[language];
  const t = (key: MessageKey, variables?: Variables) => translate(dictionary, key, variables);
  return {
    choice,
    language,
    t,
    tp: (base, count, variables) =>
      translate(dictionary, pluralKey(language, base, count), {
        ...variables,
        count: formatNumber(language, count),
      }),
    describeError: (error) => describeError(error, t),
    day: (day) => formatDay(language, day),
    instant: (instant) => formatInstant(language, instant),
    number: (value) => formatNumber(language, value),
    weekdays: (width) => weekdayNames(language, width),
    workingDays: (mask) => workingDaysList(language, mask),
    currency: (code) => currencyLabel(language, code),
  };
}

/** Outside a provider the product speaks English — which is what a component test sees. */
export const I18nContext = createContext<I18n>(build(DEFAULT_LANGUAGE, 'en'));

export function useI18n(): I18n {
  return useContext(I18nContext);
}
