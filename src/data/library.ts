/**
 * The template library: the JSON files under `templates/`, bundled into the frontend at build time.
 *
 * This is the only loader (ADR-029). The files are data and nothing else — the domain never imports
 * JSON, and nothing in a template is ever run — so each is read here as an unknown value and handed
 * to the domain as a **library** template, the strict level: both languages, ranges and never
 * points, no prices, nothing real in the text, the id its file's name, includes that resolve among
 * the library's own files. A file that fails is dropped from the library and every reason is
 * logged; the library test (`src/domain/templates/library.test.ts`) is what keeps such a file from
 * shipping, so a drop here is a defect caught late, never a state a person is left to guess at.
 */

import type { Template } from '@/domain/templates/format';
import { validateLibrary, type LibraryFile } from '@/domain/templates/validate';

/** The raw files, by path (`/templates/bathroom-renovation.json`), parsed by Vite as JSON. */
const FILES = import.meta.glob<unknown>('/templates/*.json', { eager: true, import: 'default' });

/** The library's files as the domain reads them: each file's name without `.json`, and its value. */
export function libraryFiles(files: Readonly<Record<string, unknown>>): LibraryFile[] {
  return Object.entries(files)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, raw]) => ({ name: path.replace(/^.*\//, '').replace(/\.json$/, ''), raw }));
}

/** Validate the files as the library, logging every file dropped and why. */
export function loadLibrary(
  files: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, Template> {
  const loaded = validateLibrary(libraryFiles(files));
  for (const { name, problems } of loaded.rejected) {
    console.warn(
      `template library: ${name}.json dropped —`,
      problems.map((problem) => `${problem.path}: ${problem.key}`).join('; '),
    );
  }
  return loaded.library;
}

/** The library as it ships: every template that passed, by id. */
export const LIBRARY: ReadonlyMap<string, Template> = loadLibrary(FILES);
