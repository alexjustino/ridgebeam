import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LANGUAGE,
  DEFAULT_LENS,
  DEFAULT_THEME,
  LANGUAGES,
  LENSES,
  readLanguage,
  readLens,
  readTheme,
  THEMES,
} from './settings';

describe('readTheme', () => {
  it.each(THEMES)('keeps %s, which this build knows', (choice) => {
    expect(readTheme(choice)).toBe(choice);
  });

  it('falls back to the default when nothing was stored', () => {
    expect(readTheme(null)).toBe(DEFAULT_THEME);
    expect(readTheme(undefined)).toBe(DEFAULT_THEME);
  });

  it.each([['midnight'], [''], ['Dark'], [' dark ']])(
    'falls back for %o, which is not a choice',
    (raw) => {
      expect(readTheme(raw)).toBe(DEFAULT_THEME);
    },
  );

  it('falls back for a value that is not a string at all', () => {
    expect(readTheme(2)).toBe(DEFAULT_THEME);
    expect(readTheme({ theme: 'dark' })).toBe(DEFAULT_THEME);
    expect(readTheme(['dark'])).toBe(DEFAULT_THEME);
  });

  it('never throws, whatever it is handed', () => {
    expect(() => readTheme(Symbol('dark'))).not.toThrow();
  });
});

describe('readLanguage', () => {
  it('knows exactly the system choice, English and Brazilian Portuguese', () => {
    expect(LANGUAGES).toEqual(['system', 'en', 'pt-BR']);
  });

  it.each(LANGUAGES)('keeps %s, which this build knows', (choice) => {
    expect(readLanguage(choice)).toBe(choice);
  });

  it('follows the system when nothing was stored', () => {
    expect(DEFAULT_LANGUAGE).toBe('system');
    expect(readLanguage(null)).toBe('system');
    expect(readLanguage(undefined)).toBe('system');
  });

  it.each([['pt'], ['pt-br'], ['PT-BR'], ['es'], ['en-US'], ['']])(
    'falls back for %o, which is not a language this build ships',
    (raw) => {
      expect(readLanguage(raw)).toBe(DEFAULT_LANGUAGE);
    },
  );

  it('never throws, whatever it is handed', () => {
    expect(() => readLanguage(Symbol('en'))).not.toThrow();
    expect(readLanguage(42)).toBe(DEFAULT_LANGUAGE);
    expect(readLanguage({ language: 'en' })).toBe(DEFAULT_LANGUAGE);
  });
});

describe('readLens', () => {
  it('knows the owner, the architect and the engineer', () => {
    expect(LENSES).toEqual(['owner', 'architect', 'engineer']);
  });

  it.each(LENSES)('keeps %s, which this build knows', (choice) => {
    expect(readLens(choice)).toBe(choice);
  });

  it("opens in the owner's lens when nothing was stored", () => {
    expect(DEFAULT_LENS).toBe('owner');
    expect(readLens(null)).toBe('owner');
    expect(readLens(undefined)).toBe('owner');
  });

  it.each([['Owner'], ['contractor'], [''], [' engineer']])(
    'falls back for %o, which is not a lens',
    (raw) => {
      expect(readLens(raw)).toBe(DEFAULT_LENS);
    },
  );

  it('never throws, whatever it is handed', () => {
    expect(() => readLens(Symbol('owner'))).not.toThrow();
    expect(readLens(['architect'])).toBe(DEFAULT_LENS);
  });
});
