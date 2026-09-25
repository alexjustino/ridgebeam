import { useEffect, useMemo, type ReactNode } from 'react';

import { applyLanguage, storeLanguage } from '@/app/theme';
import { useSettings } from '@/data/queries';
import { DEFAULT_LANGUAGE } from '@/domain/settings';

import { resolveLanguage } from './index';
import { build, I18nContext } from './useI18n';

/**
 * The language of every screen, from one place.
 *
 * It reads the `language` setting, like the theme, and resolves `system` against the language
 * the webview reports for Windows. A new choice is set into the settings cache the moment it is
 * pressed, and every screen re-renders in the new language at once — no screen holds a sentence
 * of its own. The document's `lang` follows, so a screen reader pronounces the Portuguese as
 * Portuguese, and a copy is kept for the next window's first frame.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const choice = settings.data?.language ?? DEFAULT_LANGUAGE;
  const navigatorLanguage = typeof navigator === 'undefined' ? null : navigator.language;
  const language = resolveLanguage(choice, navigatorLanguage);

  const value = useMemo(() => build(choice, language), [choice, language]);

  useEffect(() => {
    applyLanguage(language);
    // Only an answer from the table is worth remembering; the guess made before it is not.
    if (settings.data !== undefined) storeLanguage(language);
  }, [language, settings.data]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
