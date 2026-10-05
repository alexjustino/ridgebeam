/**
 * What a chosen template becomes: the plan the host is asked to write, where it came from, what the
 * preview counts, and the notes the person is told once it is applied.
 *
 * The domain turns the template into a draft and its provenance (`applyTemplate`) and counts it
 * (`draftCounts`); the preview therefore counts exactly what will be written, includes expanded,
 * never the template's own top level.
 */

import type { PlanToApply } from '@/data/commands';
import { LIBRARY } from '@/data/library';
import {
  applyTemplate,
  draftCarriesNumbers,
  draftCounts,
  type DraftCounts,
  type TemplateNote,
} from '@/domain/templates/apply';
import type { Template, TemplateLanguage } from '@/domain/templates/format';
import { localise } from '@/domain/templates/localise';
import type { I18n } from '@/i18n/useI18n';

export interface TemplatePlan {
  readonly plan: PlanToApply;
  readonly notes: readonly TemplateNote[];
  readonly counts: DraftCounts;
  /** A duration as a point or a priced line came with it: the preview says so (G3). */
  readonly carriesNumbers: boolean;
  /** The title in the person's language (or the other, when the file has only that). */
  readonly title: string;
  readonly summary: string | null;
}

export function planOf(template: Template, language: TemplateLanguage): TemplatePlan {
  const { draft, notes, provenance } = applyTemplate(template, LIBRARY, language);
  return {
    plan: { draft, provenance },
    notes,
    counts: draftCounts(draft),
    carriesNumbers: draftCarriesNumbers(draft),
    title: provenance.templateTitle,
    summary: template.summary === undefined ? null : localise(template.summary, language).text,
  };
}

/** "4 stages · 12 activities · 3 decisions · 8 checks", each counted in the language's own plural. */
export function countsText(counts: DraftCounts, tp: I18n['tp']): string {
  return [
    tp('templates.count.stages', counts.stages),
    tp('templates.count.activities', counts.activities),
    tp('templates.count.decisions', counts.decisions),
    tp('templates.count.checks', counts.checks),
  ].join(' · ');
}
