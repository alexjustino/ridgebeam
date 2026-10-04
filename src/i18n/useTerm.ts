import { useMemo } from 'react';

import { useSettings } from '@/data/queries';
import { DEFAULT_LENS, type LensChoice } from '@/domain/settings';

import { termsFor, type TermKey } from './terms';
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
  return useMemo(() => termsFor(language, lens), [language, lens]);
}

export function useTerm(key: TermKey, options?: TermOptions): string {
  return useTerms()(key, options);
}

/**
 * The lens on screen, for a sentence whose shape — not only its nouns — differs by lens: the finish
 * as a probability is "8 in 10 chances" to everyone and adds "P80" and a percentage for the
 * engineer (D1, decision 5). Read from the settings like the terms; nothing is stored in the work.
 */
export function useLens(): LensChoice {
  const settings = useSettings();
  return settings.data?.lens ?? DEFAULT_LENS;
}
