/**
 * The terms: the glossary's nouns, as each lens says them, in each language (ADR-014).
 *
 * A lens is a vocabulary table over the glossary. A term entry may carry, per language, a
 * `lenses` object naming the word the engineer, the architect or the owner uses instead; a lens
 * it does not name says the term itself. The sentence that explains a term never varies by lens —
 * only the word does. Nothing here is stored anywhere: which lens is on screen is a setting of the
 * person's, and the work never knows it.
 *
 * Pure: a language, a lens and a key in, a word out. `useTerm` is the React side.
 */

import { LENSES, type LensChoice } from '@/domain/settings';

import glossary from './glossary.json';
import { LANGUAGES, type Language } from './index';

/** The glossary keys the interface names on screen. A test holds each to the glossary. */
export const TERM_KEYS = [
  'work',
  'plan',
  'stage',
  'activity',
  'duration',
  'responsible',
  'calendar',
  'workingDay',
  'holiday',
  'finishDate',
  'readiness',
  'person',
  'room',
  'quantity',
] as const;

export type TermKey = (typeof TERM_KEYS)[number];

interface Text {
  term: string;
  sentence: string;
  lenses?: Partial<Record<LensChoice, string>>;
}

type Entry = { key: string } & Partial<Record<Language, Text>>;

const ENTRIES: ReadonlyMap<string, Entry> = new Map(
  (glossary.terms as Entry[]).map((entry) => [entry.key, entry]),
);

/**
 * The word a lens uses for a term, in a language: the lens's own when the glossary gives one,
 * otherwise the term. A key the glossary does not have is shown as itself — a visible defect,
 * and one the glossary test refuses before it can ship.
 */
export function termFor(language: Language, lens: LensChoice, key: TermKey): string {
  const text = ENTRIES.get(key)?.[language];
  if (text === undefined) return key;
  return text.lenses?.[lens] ?? text.term;
}

/** The same word opening a sentence or a heading. */
export function capitalised(language: Language, word: string): string {
  return word.length === 0 ? word : word.charAt(0).toLocaleUpperCase(language) + word.slice(1);
}

/** Every word each lens changes, for the tests and for anybody reading this file. */
export function lensVariants(): Array<{
  key: string;
  language: Language;
  lens: string;
  word: string;
}> {
  const found: Array<{ key: string; language: Language; lens: string; word: string }> = [];
  for (const entry of ENTRIES.values()) {
    for (const language of LANGUAGES) {
      for (const [lens, word] of Object.entries(entry[language]?.lenses ?? {})) {
        found.push({ key: entry.key, language, lens, word: word ?? '' });
      }
    }
  }
  return found;
}

export { LENSES };
