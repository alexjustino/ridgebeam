/**
 * A template, applied: the draft of a plan the host inserts in one transaction.
 *
 * Applying **never invents a number**. An activity takes the template's range and no duration
 * (`durationDays` stays `null` until a person picks: "Use the upper end of each range", or types
 * one); only a point (`min = max`, which a file may carry and the library never does) is applied as
 * the duration, and the notes say so. A decision takes the **upper** end of its lead-time range as
 * its lead time (the earlier deadline: the conservative reading) and keeps the range for display. A
 * cost line keeps its label and has no amount unless the template (a work's own export) carried
 * one. Checks and rooms are copied as they are (a check's `photo` is the draft's `needsPhoto`); links
 * are copied with their lag.
 *
 * Included templates come first, each once, in order (`expand.ts`); their rooms merge with the
 * template's by key, the first name given winning.
 *
 * The draft is in the chosen language; a text missing in it is taken in the other, and the notes
 * say how many. The result also carries the provenance the work records: where the plan came from,
 * and nothing that links it back.
 *
 * The template must have passed `validateTemplate` against the same library. What this module is
 * not: the host's transaction, or a validator. It performs no I/O.
 */

import { draftStageKey, expansionOf, resolveEndpoint } from './expand';
import type {
  DayRange,
  DraftActivity,
  DraftDecision,
  DraftLink,
  DraftRoom,
  DraftStage,
  LocalisedText,
  PlanDraft,
  Provenance,
  Template,
  TemplateLanguage,
} from './format';
import { localise } from './localise';

/** The message keys of what applying a template says about what it did. */
export const TEMPLATE_NOTE_KEYS = {
  /** `{count}` activities had a single number of days, applied as their duration. */
  pointDurations: 'template.note.pointDurations',
  /** `{count}` texts were not in the language chosen and were taken in `{language}`. */
  languageFallback: 'template.note.languageFallback',
  /** `{count}` templates were included: `{titles}`. */
  includes: 'template.note.includes',
} as const;

export type TemplateNoteKey = (typeof TEMPLATE_NOTE_KEYS)[keyof typeof TEMPLATE_NOTE_KEYS];

/** One thing applying did that the person should know, as a message key and its variables. */
export interface TemplateNote {
  readonly key: TemplateNoteKey;
  readonly params: Readonly<Record<string, string | number>>;
}

export interface AppliedTemplate {
  readonly draft: PlanDraft;
  readonly notes: readonly TemplateNote[];
  /** What the work records about where its plan came from. */
  readonly provenance: Provenance;
}

/** The draft's view of a range: both ends, or neither. */
function ends(range: DayRange | undefined): { min: number | null; max: number | null } {
  return range === undefined ? { min: null, max: null } : { min: range.min, max: range.max };
}

/**
 * Turn a validated template into the draft of a plan, in `language`, with its includes expanded
 * from `library`. Never throws.
 */
export function applyTemplate(
  template: Template,
  library: ReadonlyMap<string, Template>,
  language: TemplateLanguage,
): AppliedTemplate {
  // Texts taken in the other language: how many, and which it was.
  const fallback = { count: 0, language: language };
  const text = (value: LocalisedText): string => {
    const localised = localise(value, language);
    if (localised.fellBack) {
      fallback.count += 1;
      fallback.language = localised.language;
    }
    return localised.text;
  };

  const expansion = expansionOf(template, library);
  let points = 0;

  const rooms: DraftRoom[] = [];
  const roomKeys = new Set<string>();
  for (const owner of expansion) {
    for (const room of owner.rooms ?? []) {
      if (roomKeys.has(room.key)) continue;
      roomKeys.add(room.key);
      rooms.push({ key: room.key, name: text(room.name) });
    }
  }

  const stages: DraftStage[] = expansion.flatMap((owner) =>
    owner.stages.map((stage): DraftStage => {
      const activities = (stage.activities ?? []).map((activity): DraftActivity => {
        const range = ends(activity.durationDays);
        const point = range.min !== null && range.min === range.max;
        if (point) points += 1;
        return {
          key: activity.key,
          name: text(activity.name),
          durationDays: point ? range.min : null,
          durationMinDays: range.min,
          durationMaxDays: range.max,
          rooms: [...(activity.rooms ?? [])],
        };
      });
      return {
        key: draftStageKey(owner, template, stage),
        name: text(stage.name),
        activities,
        checks: [
          ...(stage.checks?.start ?? []).map((check) => ({
            gate: 'start' as const,
            name: text(check),
            needsPhoto: check.photo === true,
          })),
          ...(stage.checks?.close ?? []).map((check) => ({
            gate: 'close' as const,
            name: text(check),
            needsPhoto: check.photo === true,
          })),
        ],
        costLines: (stage.costLines ?? []).map((line) => ({
          label: text(line.label),
          activityKey: line.activity ?? null,
          amountCents: line.amountCents ?? null,
        })),
        decisions: (stage.decisions ?? []).map((decision): DraftDecision => {
          const range = ends(decision.leadDays);
          return {
            name: text(decision.name),
            // The upper end: the earlier deadline. None said is none to wait for.
            leadTimeDays: range.max ?? 0,
            leadMinDays: range.min,
            leadMaxDays: range.max,
            needsKey: decision.needs ?? null,
          };
        }),
      };
    }),
  );

  const links: DraftLink[] = [];
  for (const owner of expansion) {
    for (const link of owner.links ?? []) {
      const blocker = resolveEndpoint(link.blocker, owner, template, expansion);
      const blocked = resolveEndpoint(link.blocked, owner, template, expansion);
      // A validated template resolves every endpoint; one that does not is not invented.
      if (!blocker.ok || !blocked.ok) continue;
      links.push({
        blocker: blocker.endpoint,
        blocked: blocked.endpoint,
        lagDays: link.lagDays ?? 0,
      });
    }
  }

  const templateTitle = text(template.title);
  const included = expansion.filter((each) => each !== template);
  const includedTitles = included.map((each) => text(each.title));

  const notes: TemplateNote[] = [];
  if (included.length > 0) {
    notes.push({
      key: TEMPLATE_NOTE_KEYS.includes,
      params: { count: included.length, titles: includedTitles.join(', ') },
    });
  }
  if (points > 0) notes.push({ key: TEMPLATE_NOTE_KEYS.pointDurations, params: { count: points } });
  if (fallback.count > 0) {
    notes.push({
      key: TEMPLATE_NOTE_KEYS.languageFallback,
      params: { count: fallback.count, language: fallback.language },
    });
  }

  return {
    draft: { rooms, stages, links },
    notes,
    provenance: {
      templateId: template.id,
      templateVersion: template.version,
      templateTitle,
    },
  };
}

/** What the Start screen's preview counts: stages, activities, decisions and checks. */
export interface DraftCounts {
  readonly stages: number;
  readonly activities: number;
  readonly decisions: number;
  readonly checks: number;
}

export function draftCounts(draft: PlanDraft): DraftCounts {
  let activities = 0;
  let decisions = 0;
  let checks = 0;
  for (const stage of draft.stages) {
    activities += stage.activities.length;
    decisions += stage.decisions.length;
    checks += stage.checks.length;
  }
  return { stages: draft.stages.length, activities, decisions, checks };
}
