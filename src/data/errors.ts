/**
 * Turning a failure into a sentence a person can act on.
 *
 * The host answers a rejected command with `{ kind, message }`: `kind` is stable and
 * machine-readable, `message` is an English sentence written for a reader. The kinds this build
 * knows are said in the window's language, from the i18n tables; a kind it does not know yet
 * keeps the host's own sentence, which is better than a paraphrase of it. Anything that is not a
 * host error at all — a bug, a missing host, a broken bridge, or the plain string Tauri answers
 * with when an argument does not fit the command before the host has seen it — is written for a
 * developer, so its detail goes to the console and the screen says what actually happened.
 */

import type { MessageKey } from '@/i18n/en';

/** The shape the host serialises a rejected command into. */
export interface HostError {
  kind: string;
  message: string;
}

function isHostError(value: unknown): value is HostError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as HostError).kind === 'string' &&
    typeof (value as HostError).message === 'string'
  );
}

/** The machine-readable kind, when the host supplied one. */
export function errorKind(error: unknown): string | null {
  return isHostError(error) ? error.kind : null;
}

/** The kinds the host names (the command contract), each with its sentence. */
const KINDS: Readonly<Record<string, MessageKey>> = {
  database: 'errors.database',
  io: 'errors.io',
  data_dir: 'errors.dataDir',
  work_folder_not_empty: 'errors.workFolderNotEmpty',
  work_not_found: 'errors.workNotFound',
  work_moved: 'errors.workMoved',
  no_work_open: 'errors.noWorkOpen',
  invalid_input: 'errors.invalidInput',
  settings_key: 'errors.settingsKey',
};

/** The sentence for a kind, or `null` when this build does not know the kind. */
export function errorKey(kind: string | null): MessageKey | null {
  if (kind === null || !Object.hasOwn(KINDS, kind)) return null;
  return KINDS[kind] ?? null;
}

type Translate = (key: MessageKey, variables?: Readonly<Record<string, string | number>>) => string;

/**
 * A failure, as a sentence in the window's language.
 *
 * Every known kind's sentence may carry the host's own words as `{detail}` — `invalid_input` does,
 * because it is about the one value that was refused and a generic sentence would lose which.
 */
export function describeError(error: unknown, t: Translate): string {
  if (!isHostError(error)) {
    console.error('unexpected failure from the host', error);
    return t('errors.unexpected');
  }
  const key = errorKey(error.kind);
  if (key === null) return error.message;
  return t(key, { detail: error.message });
}
