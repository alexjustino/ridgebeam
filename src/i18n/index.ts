/**
 * The i18n core: the two dictionaries, the language a choice resolves to, and translation.
 *
 * No React here — `react.tsx` is the one file in `src/i18n/` that knows about components — so
 * the rules below are tested as plain functions. And no domain rule depends on this module:
 * `src/domain/` returns message keys and counts, and only the interface turns them into
 * sentences.
 */

import type { LanguageChoice } from '@/domain/settings';

import { en, type Dictionary, type MessageKey } from './en';
import { ptBR } from './pt-BR';

export type { Dictionary, MessageKey };

/** The languages the product ships in (SPEC §2.13), as BCP 47 tags. */
export const LANGUAGES = ['en', 'pt-BR'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DICTIONARIES: Record<Language, Dictionary> = {
  en,
  'pt-BR': ptBR,
};

/**
 * Each language, named in itself. The picker shows these in every language — a person who
 * cannot read the current one must still find their own — so they are the same everywhere and
 * belong to no dictionary.
 */
export const LANGUAGE_AUTONYMS: Record<Language, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};

/**
 * The language a choice means on this machine.
 *
 * An explicit choice is itself. `system` reads the language the webview reports for Windows:
 * any Portuguese is Brazilian Portuguese, because that is the translation there is; everything
 * else, and nothing at all, is English.
 */
export function resolveLanguage(
  choice: LanguageChoice,
  navigatorLanguage: string | null | undefined,
): Language {
  if (choice !== 'system') return choice;
  const tag = (navigatorLanguage ?? '').trim().toLowerCase();
  if (tag === 'pt' || tag.startsWith('pt-') || tag.startsWith('pt_')) return 'pt-BR';
  return 'en';
}

/** Values for a sentence's `{variables}`. */
export type Variables = Readonly<Record<string, string | number>>;

const VARIABLE = /\{(\w+)\}/g;

/**
 * One sentence, with its `{variables}` filled in.
 *
 * A variable the caller did not supply is left as written rather than replaced with nothing:
 * `{version}` on screen is a visible defect, and an empty gap is an invisible one.
 */
export function translate(dictionary: Dictionary, key: MessageKey, variables?: Variables): string {
  const sentence = dictionary[key];
  if (variables === undefined) return sentence;
  return sentence.replace(VARIABLE, (whole, name: string) =>
    Object.hasOwn(variables, name) ? String(variables[name]) : whole,
  );
}

/** The `{variables}` a sentence carries, sorted — what a translation must carry too. */
export function variablesOf(sentence: string): string[] {
  return [...sentence.matchAll(VARIABLE)].map((match) => match[1] ?? '').sort();
}

/**
 * A sentence that changes with a count is two keys: `<base>.one` and `<base>.other`. This is the
 * set of bases, derived from the table, so asking for a plural the table does not have is a type
 * error.
 */
export type PluralBase = BaseOf<MessageKey>;

type BaseOf<Key> = Key extends `${infer Base}.one`
  ? `${Base}.other` extends MessageKey
    ? Base
    : never
  : never;

/**
 * The key for a count, by the language's own plural rule (`Intl.PluralRules`).
 *
 * Only two forms exist in the tables, because English and Portuguese need only two; any category
 * that is not `one` takes `other`. Note that Portuguese calls 0 `one` — a caller that can have
 * nothing to count says so with a sentence of its own rather than "0 atividade".
 */
export function pluralKey(language: Language, base: PluralBase, count: number): MessageKey {
  const category = new Intl.PluralRules(language).select(count);
  return (category === 'one' ? `${base}.one` : `${base}.other`) as MessageKey;
}
