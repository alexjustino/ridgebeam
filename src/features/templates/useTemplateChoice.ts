import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LIBRARY } from '@/data/library';
import { useMyTemplates, useReadTemplate } from '@/data/queries';
import { compareText } from '@/domain/plan';
import type { Template } from '@/domain/templates/format';
import { localise } from '@/domain/templates/localise';
import {
  parseTemplate,
  type TemplateProblem,
  type TemplateValidation,
} from '@/domain/templates/validate';
import { useI18n } from '@/i18n/useI18n';

import { planOf, type TemplatePlan } from './plan';

/** The picker's two values that are not a library id. */
export const EMPTY_PLAN = 'empty';
export const FROM_FILE = 'file';
/** A template of the person's own is chosen as `mine:<id>`: never a library id, never the two above. */
export const MINE_PREFIX = 'mine:';

/** A file read for the picker: reading, read and judged, or refused by the host. */
export type FileState =
  | { readonly path: string; readonly status: 'reading' }
  | { readonly path: string; readonly status: 'read'; readonly validation: TemplateValidation }
  | { readonly path: string; readonly status: 'failed'; readonly error: unknown };

/** What the picker resolves to when the person confirms. */
export type Resolved =
  | { readonly kind: 'empty' }
  | { readonly kind: 'plan'; readonly plan: TemplatePlan }
  /** Refused: the reason is on screen, under the picker (`template-problem`). */
  | { readonly kind: 'refused' };

/** A library template as the picker lists it: by id, titled in the person's language. */
export interface LibraryEntry {
  readonly id: string;
  readonly title: string;
}

/**
 * A template of the person's own (G3), as the picker lists it: checked by the domain as a `file`,
 * titled in the person's language when it is valid, by its id when it is not.
 */
export interface MineEntry {
  /** The file's name without `.json`: what it is removed by. */
  readonly id: string;
  /** The picker's value: `mine:<id>`. */
  readonly value: string;
  readonly title: string;
  /** The template when it can be used; `null` when the host or the domain refused it. */
  readonly template: Template | null;
  /** What the domain found wrong in it, in its order. */
  readonly problems: readonly TemplateProblem[];
  /** The host's sentence when the file was not read. */
  readonly hostProblem: string | null;
}

/** Wait this long after the last keystroke in the path before reading the file. */
const READ_AFTER_MS = 300;

const isJsonPath = (path: string) => /\.json$/i.test(path);

/**
 * The state of the template picker (F9): which starting point is chosen — an empty plan, a library
 * template, or a file — and, for a file, what reading and checking it found.
 *
 * A file is read by the host as text and parsed and checked by the domain as a **file** template
 * (ADR-029): read a moment after the path stops changing, for the preview, and again at the moment
 * of confirming when the path read is not the path in the field — so what is written is always what
 * the field names, never an earlier file.
 *
 * Slice G3 adds the person's own templates (`mine`), read from their folder whenever the picker
 * opens and checked the same way, as a **file**: one chosen previews and applies exactly as a
 * template from a file does, and its provenance is its id, version and title, as any template's.
 */
export function useTemplateChoice({ allowEmpty }: { allowEmpty: boolean }) {
  const { language } = useI18n();
  const reader = useReadTemplate();
  const readText = reader.mutateAsync;

  const myTemplates = useMyTemplates();

  const entries: LibraryEntry[] = useMemo(
    () =>
      [...LIBRARY.values()]
        .map((template) => ({ id: template.id, title: localise(template.title, language).text }))
        .sort((a, b) => compareText(a.title, b.title)),
    [language],
  );

  // The person's own, each checked as any file is (ADR-029): a template of yours is hostile input
  // like any other, and one that does not pass is listed, disabled, with its reason.
  const mine: MineEntry[] = useMemo(
    () =>
      (myTemplates.data?.templates ?? [])
        .map((each): MineEntry => {
          const value = `${MINE_PREFIX}${each.id}`;
          if (each.text === null) {
            return {
              id: each.id,
              value,
              title: each.id,
              template: null,
              problems: [],
              hostProblem: each.problem,
            };
          }
          const validation = parseTemplate(each.text, 'file', LIBRARY);
          return validation.ok
            ? {
                id: each.id,
                value,
                title: localise(validation.template.title, language).text,
                template: validation.template,
                problems: [],
                hostProblem: null,
              }
            : {
                id: each.id,
                value,
                title: each.id,
                template: null,
                problems: validation.problems,
                hostProblem: null,
              };
        })
        // Those that can be used first, by title; then those that cannot, by id.
        .sort(
          (a, b) =>
            Number(a.template === null) - Number(b.template === null) ||
            compareText(a.title, b.title) ||
            compareText(a.id, b.id),
        ),
    [myTemplates.data, language],
  );

  const fallback = allowEmpty ? EMPTY_PLAN : (entries[0]?.id ?? FROM_FILE);

  const [choice, setChoice] = useState<string>(() =>
    allowEmpty ? EMPTY_PLAN : (entries[0]?.id ?? FROM_FILE),
  );
  const [path, setPath] = useState('');
  const [file, setFile] = useState<FileState | null>(null);
  const [pathMissing, setPathMissing] = useState(false);
  const latest = useRef(0);

  const readFile = useCallback(
    async (at: string): Promise<FileState> => {
      latest.current += 1;
      const request = latest.current;
      setFile({ path: at, status: 'reading' });
      let next: FileState;
      try {
        const text = await readText(at);
        next = { path: at, status: 'read', validation: parseTemplate(text, 'file', LIBRARY) };
      } catch (error) {
        next = { path: at, status: 'failed', error };
      }
      // An answer overtaken by a later read is dropped: the field has moved on.
      if (request === latest.current) setFile(next);
      return next;
    },
    [readText],
  );

  const wanted = path.trim();
  // The file as read for the path in the field now — never another path's.
  const current = file !== null && file.path === wanted ? file : null;

  useEffect(() => {
    if (choice !== FROM_FILE || !isJsonPath(wanted) || current !== null) return;
    const timer = window.setTimeout(() => void readFile(wanted), READ_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [choice, wanted, current, readFile]);

  const mineChosen = choice.startsWith(MINE_PREFIX)
    ? (mine.find((entry) => entry.value === choice) ?? null)
    : null;

  const template: Template | null =
    choice === EMPTY_PLAN
      ? null
      : choice.startsWith(MINE_PREFIX)
        ? (mineChosen?.template ?? null)
        : choice === FROM_FILE
          ? current?.status === 'read' && current.validation.ok
            ? current.validation.template
            : null
          : (LIBRARY.get(choice) ?? null);

  const preview = useMemo(
    () => (template === null ? null : planOf(template, language)),
    [template, language],
  );

  /**
   * Confirming: what the picker holds now, read again when the field names a file not yet read. A
   * template that brings no stage has no plan to start, and is refused here rather than by the host.
   */
  const resolve = useCallback(async (): Promise<Resolved> => {
    const planned = (found: Template): Resolved => {
      const plan = planOf(found, language);
      return plan.counts.stages === 0 ? { kind: 'refused' } : { kind: 'plan', plan };
    };
    if (choice === EMPTY_PLAN) return { kind: 'empty' };
    if (choice.startsWith(MINE_PREFIX)) {
      const found = mine.find((entry) => entry.value === choice)?.template ?? null;
      return found === null ? { kind: 'refused' } : planned(found);
    }
    if (choice !== FROM_FILE) {
      const found = LIBRARY.get(choice);
      return found === undefined ? { kind: 'refused' } : planned(found);
    }
    if (wanted === '') {
      setPathMissing(true);
      return { kind: 'refused' };
    }
    setPathMissing(false);
    const state =
      current !== null && current.status !== 'reading' ? current : await readFile(wanted);
    if (state.status === 'read' && state.validation.ok) return planned(state.validation.template);
    return { kind: 'refused' };
  }, [choice, wanted, current, readFile, language, mine]);

  return {
    entries,
    /** Whether "An empty plan" is offered: on a new work, not on the breakdown of an existing one. */
    allowsEmpty: allowEmpty,
    choice,
    setChoice: (next: string) => {
      setChoice(next);
      setPathMissing(false);
    },
    path,
    setPath: (next: string) => {
      setPath(next);
      setPathMissing(false);
    },
    /** The file as read for the path in the field, or `null` before it has been. */
    file: choice === FROM_FILE ? current : null,
    pathMissing: choice === FROM_FILE && pathMissing,
    /** The person's own templates (G3), by title; an invalid one has no `template`. */
    mine,
    /** The template of yours that is chosen, or `null`. */
    mineChosen,
    /** The host's sentence when more were in the folder than it listed; `null` otherwise. */
    // How many files the folder holds past the first 200, said on screen in the screen's language.
    mineNotListed: myTemplates.data?.notListed ?? 0,
    /** Why the folder could not be read, when it could not; `null` otherwise. */
    mineError: myTemplates.isError ? myTemplates.error : null,
    /** What the picker goes back to when the chosen template of yours is removed. */
    fallback,
    preview,
    resolve,
  };
}

export type TemplateChoice = ReturnType<typeof useTemplateChoice>;
