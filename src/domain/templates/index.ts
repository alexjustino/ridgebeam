/**
 * Templates: the starting point of a plan, as data (slice F9, ADR-029 and ADR-030).
 *
 * `format.ts` says what a template is; `validate.ts` whether a value is one, and every way it is
 * not; `apply.ts` turns one into the draft of a plan; `export.ts` turns a work back into one;
 * `localise.ts` picks a language and says when it could not.
 */

export * from './format';
export * from './validate';
export * from './apply';
export * from './export';
export * from './localise';
export { expansionOf } from './expand';
