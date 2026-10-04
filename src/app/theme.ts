/**
 * The theme, the accent and the language of the document, and the copies kept for the first frame.
 *
 * The record of truth for both is the settings table in the application database. Reading it is
 * a host round trip, and the first frame cannot wait for it: a person who chose dark must not
 * watch a white window, and a screen reader must not start reading Portuguese as English. So the
 * browser store keeps a copy of each — the guess `main.tsx` paints with — and the table answers
 * a moment later and wins, and the copy is written back for the next start. A copy that
 * disagrees with the table is corrected, never consulted twice.
 */

import type { AccentRamp } from '@/data/commands';
import { readTheme, type ThemeChoice } from '@/domain/settings';
import { LANGUAGES, type Language } from '@/i18n/index';

export type { ThemeChoice };

const THEME_KEY = 'ridgebeam.theme';
const LANGUAGE_KEY = 'ridgebeam.language';

export function readStoredTheme(): ThemeChoice {
  try {
    return readTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    // A store that refuses to be read is not a reason to refuse to start.
    return readTheme(null);
  }
}

export function storeTheme(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // The choice still applies to this window; it just will not survive it.
  }
}

/**
 * Apply the theme choice. `system` removes the attribute entirely so the
 * `prefers-color-scheme` rules take over — the default must be the absence of a
 * choice, not a third value the stylesheet has to know about.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
}

/** The language the last window resolved to, or `null` when there is no copy to trust. */
export function readStoredLanguage(): Language | null {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    return (LANGUAGES as readonly (string | null)[]).includes(stored) ? (stored as Language) : null;
  } catch {
    return null;
  }
}

export function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // The language still applies to this window.
  }
}

/** The document speaks the language on screen, so assistive technology pronounces it right. */
export function applyLanguage(language: Language): void {
  document.documentElement.lang = language;
}

/** True when the window is currently rendering dark, whatever the reason. */
export function isDark(): boolean {
  const choice = document.documentElement.getAttribute('data-theme');
  if (choice === 'dark') return true;
  if (choice === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Write the Windows accent ramp into the token layer (DESIGN_SYSTEM §2: the accent colour is the
 * person's, not ours).
 *
 * Windows exposes a ramp rather than one colour because the shade that reads on white does not
 * read on near-black: light takes the first dark step for fills and text — what Fluent does, and
 * what keeps accent text at 4.5:1 — and dark takes the lighter steps. Re-applied whenever the
 * theme changes.
 */
export function applyAccent(ramp: AccentRamp): void {
  const style = document.documentElement.style;
  if (isDark()) {
    style.setProperty('--accent-base', ramp.light2);
    style.setProperty('--accent-hover', ramp.light1);
    style.setProperty('--accent-active', ramp.accent);
    style.setProperty('--accent-subtle', withAlpha(ramp.light2, 0.12));
  } else {
    style.setProperty('--accent-base', ramp.dark1);
    style.setProperty('--accent-hover', ramp.dark2);
    style.setProperty('--accent-active', ramp.dark3);
    style.setProperty('--accent-subtle', withAlpha(ramp.dark1, 0.1));
  }
}

/** `#rrggbb` plus an alpha, as an `rgb()` with a slash — the token format. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}
