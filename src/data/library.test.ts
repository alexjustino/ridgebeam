import { afterEach, describe, expect, it, vi } from 'vitest';

import { LIBRARY, libraryFiles, loadLibrary } from './library';

/**
 * The loader: the files under `templates/` as the application reads them. The library test in the
 * domain holds every file to the library's rules; this holds the loader to dropping — and saying —
 * what fails, rather than shipping half a template.
 */

const template = (id: string, extra: Record<string, unknown> = {}) => ({
  ridgebeamTemplate: 1,
  id,
  version: 1,
  title: { en: `Synthetic ${id}`, 'pt-BR': `Sintético ${id}` },
  summary: { en: 'A starting point.', 'pt-BR': 'Um ponto de partida.' },
  stages: [
    {
      key: 'first',
      name: { en: 'First', 'pt-BR': 'Primeira' },
      activities: [
        {
          key: 'do-it',
          name: { en: 'Do it', 'pt-BR': 'Fazer' },
          durationDays: { min: 1, max: 3 },
        },
      ],
    },
  ],
  ...extra,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the template library as it ships', () => {
  it('is loaded from the bundled files, every one of them valid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const files = import.meta.glob<unknown>('/templates/*.json', {
      eager: true,
      import: 'default',
    });
    expect(loadLibrary(files).size).toBe(Object.keys(files).length);
    expect(warn).not.toHaveBeenCalled();
    expect(LIBRARY.size).toBe(Object.keys(files).length);
  });
});

describe('loadLibrary', () => {
  it('names each file by its path, without the folder or .json', () => {
    expect(libraryFiles({ '/templates/b.json': 1, '/templates/a.json': 2 })).toEqual([
      { name: 'a', raw: 2 },
      { name: 'b', raw: 1 },
    ]);
  });

  it('keeps a valid file, and drops — and logs — one whose id is not its name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loaded = loadLibrary({
      '/templates/good.json': template('good'),
      '/templates/misnamed.json': template('another-name'),
    });
    expect([...loaded.keys()]).toEqual(['good']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('misnamed.json');
  });

  it('drops a template whose include was dropped, rather than apply half of it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loaded = loadLibrary({
      '/templates/priced.json': template('priced', {
        stages: [
          {
            key: 'first',
            name: { en: 'First', 'pt-BR': 'Primeira' },
            costLines: [{ label: { en: 'Tiles', 'pt-BR': 'Pisos' }, amountCents: 100 }],
            activities: [
              {
                key: 'do-it',
                name: { en: 'Do it', 'pt-BR': 'Fazer' },
                durationDays: { min: 1, max: 3 },
              },
            ],
          },
        ],
      }),
      '/templates/includer.json': template('includer', { includes: ['priced'] }),
    });
    expect(loaded.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
