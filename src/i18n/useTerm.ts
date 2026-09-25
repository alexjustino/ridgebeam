import { useCallback } from 'react';

import { useSettings } from '@/data/queries';
import { DEFAULT_LENS } from '@/domain/settings';

import { capitalised, termFor, type TermKey } from './terms';
import { useI18n } from './useI18n';

export interface TermOptions {
  /** Opening a sentence, a heading or a column: the first letter in capitals. */
  capital?: boolean;
}

/**
 * The glossary's word for a noun, in the window's language and the person's lens.
 *
 * The lens is read from the settings, like the language, so switching it re-renders every screen
 * in the new words at once and writes nothing to the work. `useTerms` gives a function for a
 * screen that names several nouns; `useTerm` is the one-noun form.
 */
export function useTerms(): (key: TermKey, options?: TermOptions) => string {
  const { language } = useI18n();
  const settings = useSettings();
  const lens = settings.data?.lens ?? DEFAULT_LENS;
  return useCallback(
    (key: TermKey, options?: TermOptions) => {
      const word = termFor(language, lens, key);
      return options?.capital === true ? capitalised(language, word) : word;
    },
    [language, lens],
  );
}

export function useTerm(key: TermKey, options?: TermOptions): string {
  return useTerms()(key, options);
}
