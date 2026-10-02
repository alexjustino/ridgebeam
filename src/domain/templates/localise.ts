/**
 * A template's text in the language a person works in, and what to do when it is not there.
 *
 * A text in the library carries both languages; a file may carry one. Asked for a language the
 * text does not have, the other is used and the caller is told (`fellBack`), so the apply summary
 * can say "some text was only in English" instead of showing a Portuguese plan with an English
 * stage in it and saying nothing.
 */

import { TEMPLATE_LANGUAGES, type LocalisedText, type TemplateLanguage } from './format';

export interface Localised {
  /** The text, trimmed. */
  readonly text: string;
  /** The language the text is in. */
  readonly language: TemplateLanguage;
  /** Whether the language asked for was missing and the other was used. */
  readonly fellBack: boolean;
}

/** The other of the two languages. */
export function otherLanguage(language: TemplateLanguage): TemplateLanguage {
  return language === 'en' ? 'pt-BR' : 'en';
}

/** Is this a language a template carries? */
export function isTemplateLanguage(value: unknown): value is TemplateLanguage {
  return (TEMPLATE_LANGUAGES as readonly unknown[]).includes(value);
}

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The text in `language`, or in the other language when it has none (and it says so). A text with
 * neither (which validation refuses) is the empty string, in the language asked for, not a fallback.
 */
export function localise(text: LocalisedText, language: TemplateLanguage): Localised {
  const wanted = text[language];
  if (present(wanted)) return { text: wanted.trim(), language, fellBack: false };
  const other = otherLanguage(language);
  const instead = text[other];
  if (present(instead)) return { text: instead.trim(), language: other, fellBack: true };
  return { text: '', language, fellBack: false };
}

/**
 * The languages a text carries, in the product's order. The Start screen can say "English only"
 * for a file template.
 */
export function languagesOf(text: LocalisedText): TemplateLanguage[] {
  return TEMPLATE_LANGUAGES.filter((language) => present(text[language]));
}
