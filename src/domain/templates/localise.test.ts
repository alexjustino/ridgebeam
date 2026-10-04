import { describe, expect, it } from 'vitest';

import { isTemplateLanguage, languagesOf, localise, otherLanguage } from './localise';

describe('localise', () => {
  it('takes the language asked for, trimmed', () => {
    expect(localise({ en: ' Tiling ', 'pt-BR': 'Assentamento' }, 'en')).toEqual({
      text: 'Tiling',
      language: 'en',
      fellBack: false,
    });
    expect(localise({ en: 'Tiling', 'pt-BR': 'Assentamento' }, 'pt-BR')).toEqual({
      text: 'Assentamento',
      language: 'pt-BR',
      fellBack: false,
    });
  });

  it('falls back to the other language, and says so', () => {
    expect(localise({ en: 'Tiling' }, 'pt-BR')).toEqual({
      text: 'Tiling',
      language: 'en',
      fellBack: true,
    });
    expect(localise({ en: '  ', 'pt-BR': 'Assentamento' }, 'en')).toEqual({
      text: 'Assentamento',
      language: 'pt-BR',
      fellBack: true,
    });
  });

  it('gives nothing, not a fallback, for a text with no language', () => {
    expect(localise({}, 'en')).toEqual({ text: '', language: 'en', fellBack: false });
  });
});

describe('the two languages', () => {
  it('knows the other one', () => {
    expect(otherLanguage('en')).toBe('pt-BR');
    expect(otherLanguage('pt-BR')).toBe('en');
  });

  it('knows which a text carries', () => {
    expect(languagesOf({ en: 'A', 'pt-BR': 'B' })).toEqual(['en', 'pt-BR']);
    expect(languagesOf({ 'pt-BR': 'B', en: ' ' })).toEqual(['pt-BR']);
    expect(languagesOf({})).toEqual([]);
  });

  it.each([
    ['en', true],
    ['pt-BR', true],
    ['pt', false],
    ['fr', false],
    [null, false],
  ])('%j is a template language: %s', (value, expected) => {
    expect(isTemplateLanguage(value)).toBe(expected);
  });
});
