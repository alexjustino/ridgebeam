/**
 * The person's choices: theme, language and lens — the shape every choice takes.
 *
 * Pure data with readers that never throw. A stored value this build does not recognise —
 * written by a newer version, or edited by hand — falls back to the default rather than
 * breaking the screen, because a preference is a convenience and a screen that will not render
 * is not.
 *
 * Where the choices are kept is not decided here. The domain neither reads nor writes them: the
 * host keeps them in the application database's `settings` table (docs/DATA_MODEL.md), and the
 * interface hands each raw value to its reader. The theme also has a browser-store mirror in
 * `app/theme.ts`, read before the first paint so that no window flashes the wrong theme.
 *
 * What this module is not: a dictionary. What each choice is called on screen, in each language,
 * belongs to the i18n tables; this module holds only the choices.
 */

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeChoice = 'system';

/** Read a stored value — anything at all — as a theme choice. */
export function readTheme(raw: unknown): ThemeChoice {
  return (THEMES as readonly unknown[]).includes(raw) ? (raw as ThemeChoice) : DEFAULT_THEME;
}

/**
 * The language the product speaks. `system` follows Windows; the others are BCP 47 tags of the
 * languages the product ships in (SPEC §2.13: English and Portuguese from F0).
 */
export const LANGUAGES = ['system', 'en', 'pt-BR'] as const;
export type LanguageChoice = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: LanguageChoice = 'system';

/** Read a stored value — anything at all — as a language choice. */
export function readLanguage(raw: unknown): LanguageChoice {
  return (LANGUAGES as readonly unknown[]).includes(raw)
    ? (raw as LanguageChoice)
    : DEFAULT_LANGUAGE;
}

/**
 * The lens a work is shown through: the same rows in the owner's, the architect's or the
 * engineer's words (SPEC §2.13). Nothing is stored per lens; this is only which one was chosen.
 */
export const LENSES = ['owner', 'architect', 'engineer'] as const;
export type LensChoice = (typeof LENSES)[number];

/** A new work opens in the owner's lens (docs/DATA_MODEL.md). */
export const DEFAULT_LENS: LensChoice = 'owner';

/** Read a stored value — anything at all — as a lens choice. */
export function readLens(raw: unknown): LensChoice {
  return (LENSES as readonly unknown[]).includes(raw) ? (raw as LensChoice) : DEFAULT_LENS;
}
