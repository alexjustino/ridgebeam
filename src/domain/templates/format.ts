/**
 * A template: the starting point of a plan, as data.
 *
 * A template is a JSON file (`templates/<id>.json` for the library, or a file somebody has) that
 * describes rooms, stages, their activities with a range of working days, their checks, their cost
 * lines as labels, their decisions with a range of lead time, and the links between them. It is
 * data and nothing else: no field this module does not name is accepted (`validate.ts`), and
 * nothing in it is ever run (R10, ADR-029).
 *
 * A template is applied **once**, as the work's own plan (`apply.ts`): nothing links the work back
 * to it afterwards but the provenance it records. A work can be exported as a template again
 * (`export.ts`).
 *
 * ```json
 * { "ridgebeamTemplate": 1, "id": "bathroom-renovation", "version": 1,
 *   "title": { "en": "…", "pt-BR": "…" }, "summary": { "en": "…", "pt-BR": "…" },
 *   "includes": ["other-template-id"],
 *   "rooms": [ { "key": "bathroom", "name": { … } } ],
 *   "stages": [ { "key": "strip-out", "name": { … },
 *       "checks": { "start": [ { … } ], "close": [ { "en": "…", "pt-BR": "…", "photo": true } ] },
 *       "costLines": [ { "label": { … }, "activity": "remove-tiles", "amountCents": 12345 } ],
 *       "decisions": [ { "key": "tile", "name": { … }, "leadDays": { "min": 5, "max": 15 },
 *                        "needs": "remove-tiles" } ],
 *       "activities": [ { "key": "remove-tiles", "name": { … },
 *                         "durationDays": { "min": 1, "max": 2 }, "rooms": ["bathroom"] } ] } ],
 *   "links": [ { "blocker": "strip-out", "blocked": "finishes/grout", "lagDays": 0 } ] }
 * ```
 *
 * What this module is not: a parser (that is `validate.ts`) or text in any language beyond the
 * template's own.
 */

/** The format version a file declares in `ridgebeamTemplate`. Only 1 exists. */
export const TEMPLATE_FORMAT = 1;

/** The languages a template can carry text in: the product's two. */
export const TEMPLATE_LANGUAGES = ['en', 'pt-BR'] as const;

export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number];

/** A text in one language or both; at least one is present and not blank. */
export interface LocalisedText {
  readonly en?: string;
  readonly 'pt-BR'?: string;
}

/** A range of whole working days, `min` to `max` inclusive. */
export interface DayRange {
  readonly min: number;
  readonly max: number;
}

export interface TemplateRoom {
  /** kebab-case, unique among the template's rooms. Rooms of included templates merge by key. */
  readonly key: string;
  readonly name: LocalisedText;
}

export interface TemplateActivity {
  /** kebab-case, unique inside its stage. */
  readonly key: string;
  readonly name: LocalisedText;
  /**
   * How long it takes, as a range of working days (1 to 3650). Absent: not said. The library
   * always says it, as a range with `min < max`; a file may carry a point (`min = max`), which is
   * applied as the activity's duration.
   */
  readonly durationDays?: DayRange;
  /** Keys of the template's rooms it touches. */
  readonly rooms?: readonly string[];
}

/**
 * One question a stage must answer at a gate: its text, and, optionally, `"photo": true` when a
 * `yes` needs its photo — hidden work, photographed before it is covered (slice D3). Absent (or
 * `false`) is a check like any other.
 */
export interface TemplateCheck extends LocalisedText {
  readonly photo?: boolean;
}

/** The questions a stage must answer before it starts and before it closes. */
export interface TemplateChecks {
  readonly start?: readonly TemplateCheck[];
  readonly close?: readonly TemplateCheck[];
}

export interface TemplateCostLine {
  readonly label: LocalisedText;
  /** The key of an activity of the same stage, or absent for a line on the stage itself. */
  readonly activity?: string;
  /**
   * Whole cents, 0 or more. Never in the library (no prices: cost lines are labels); a work's own
   * export may keep its numbers.
   */
  readonly amountCents?: number;
}

export interface TemplateDecision {
  /** kebab-case, unique inside its stage. */
  readonly key: string;
  readonly name: LocalisedText;
  /** Working days between deciding and having (0 to 3650). The work takes the upper end. */
  readonly leadDays?: DayRange;
  /** The key of the activity of the same stage that needs it; absent: the stage's first activity. */
  readonly needs?: string;
}

export interface TemplateStage {
  /** kebab-case, unique among the template's own stages. */
  readonly key: string;
  readonly name: LocalisedText;
  readonly checks?: TemplateChecks;
  readonly costLines?: readonly TemplateCostLine[];
  readonly decisions?: readonly TemplateDecision[];
  readonly activities?: readonly TemplateActivity[];
}

/**
 * `blocker` must finish, and `lagDays` working days pass, before `blocked` may start.
 *
 * An endpoint is `stage-key` (the whole stage) or `stage-key/activity-key`. A stage of an included
 * template is named by its key when no other stage in reach has it, or as `template-id:stage-key`
 * (`template-id:stage-key/activity-key`) to say which.
 */
export interface TemplateLink {
  readonly blocker: string;
  readonly blocked: string;
  /** Working days of waiting, 0 to 3650; absent is 0. */
  readonly lagDays?: number;
}

export interface Template {
  /** The format version: `TEMPLATE_FORMAT`. */
  readonly ridgebeamTemplate: 1;
  /** kebab-case; for the library, the file's name without `.json`. */
  readonly id: string;
  /** A whole number from 1: the template's own version, recorded as the work's provenance. */
  readonly version: number;
  readonly title: LocalisedText;
  /** One or two sentences about what it covers. Required in the library. */
  readonly summary?: LocalisedText;
  /** Library ids whose stages come first, in this order, each once. */
  readonly includes?: readonly string[];
  readonly rooms?: readonly TemplateRoom[];
  readonly stages: readonly TemplateStage[];
  readonly links?: readonly TemplateLink[];
}

/** Where a template came from: the library shipped with the product, or a file somebody has. */
export type TemplateOrigin = 'library' | 'file';

// ── The draft the host applies ───────────────────────────────────────────────

/**
 * A plan to apply to an empty work in one host transaction (`plan_apply`), in the host's serde
 * shape. Rows are joined by local keys; the host gives every row a new id.
 */
export interface PlanDraft {
  readonly rooms: readonly DraftRoom[];
  readonly stages: readonly DraftStage[];
  readonly links: readonly DraftLink[];
}

export interface DraftRoom {
  readonly key: string;
  readonly name: string;
}

export interface DraftStage {
  /** Unique in the draft. */
  readonly key: string;
  readonly name: string;
  readonly activities: readonly DraftActivity[];
  readonly checks: readonly DraftCheck[];
  readonly costLines: readonly DraftCostLine[];
  readonly decisions: readonly DraftDecision[];
}

export interface DraftActivity {
  /** Unique inside its stage. */
  readonly key: string;
  readonly name: string;
  /** Set only when the template gave a point (`min = max`); a range leaves it for the person. */
  readonly durationDays: number | null;
  readonly durationMinDays: number | null;
  readonly durationMaxDays: number | null;
  /** Room keys of the draft. */
  readonly rooms: readonly string[];
}

export interface DraftCheck {
  readonly gate: 'start' | 'close';
  readonly name: string;
  /** The template's `photo`: a `yes` needs its photo. `false` when the template did not say. */
  readonly needsPhoto: boolean;
}

export interface DraftCostLine {
  readonly label: string;
  /** An activity key of the same stage, or `null` for the stage itself. */
  readonly activityKey: string | null;
  /** `null`: not priced yet. */
  readonly amountCents: number | null;
}

export interface DraftDecision {
  readonly name: string;
  /** The upper end of the range (the earlier deadline), or 0 when the template said none. */
  readonly leadTimeDays: number;
  readonly leadMinDays: number | null;
  readonly leadMaxDays: number | null;
  /** An activity key of the same stage, or `null` for the stage's first activity. */
  readonly needsKey: string | null;
}

export interface DraftEndpoint {
  readonly kind: 'stage' | 'activity';
  readonly stageKey: string;
  /** Set for an activity, `null` for a stage. */
  readonly activityKey: string | null;
}

export interface DraftLink {
  readonly blocker: DraftEndpoint;
  readonly blocked: DraftEndpoint;
  readonly lagDays: number;
}

/** Where a work's plan came from, recorded on the work; nothing links it back. */
export interface Provenance {
  readonly templateId: string;
  readonly templateVersion: number;
  /** The title in the language the work was started in. */
  readonly templateTitle: string;
}

// ── Limits (the host's, one number for one idea) ─────────────────────────────

export const TEMPLATE_LIMITS = {
  /** Room, stage, activity and decision names, and the title. */
  nameChars: 120,
  /** A check's question. */
  checkChars: 200,
  /** A cost line's label. */
  labelChars: 120,
  /** The summary: not stored by the host, shown in the preview. */
  summaryChars: 400,
  /**
   * A template's id, and a key. The host keeps keys of 1 to 64 characters, and a stage of an
   * included template is keyed `template-id:stage-key` in the draft: 31 + 1 + 32 = 64.
   */
  idChars: 31,
  keyChars: 32,
  /** A template's version: a whole number from 1 to this (the host's). */
  versionMax: 1_000_000,
  /** Durations: 1 to 3650 working days. */
  durationMin: 1,
  durationMax: 3650,
  /** Lead times and lags: 0 to 3650 working days. */
  waitMin: 0,
  waitMax: 3650,
  /** Money, whole cents: the host's ceiling. */
  amountMax: 1_000_000_000_000_000,
} as const;

/** kebab-case: lowercase letters and digits in words joined by single hyphens. */
export const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
