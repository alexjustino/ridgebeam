/**
 * A work, exported as a template: its shape, with its numbers stripped or kept (ADR-030).
 *
 * Always exported: the stages, their activities, the rooms, the links, the checks, the decisions
 * and the cost lines' labels, in plan order, in the work's language only. The numbers depend on the
 * choice:
 *
 * - **strip** (the default: something to share): an activity's duration becomes the range it
 *   carries from its template, or nothing; no lead time, no lag, no amount.
 * - **keep** (the work's own numbers, to start the next one like it): an activity's duration as a
 *   point (`{ min: d, max: d }`), or the range it carries when it has no duration yet; a decision's
 *   lead time as a point; every lag; and the amount of every priced line. A point comes back as
 *   the same number, so the next work starts with the numbers this one settled on.
 *
 * Keys are made from the names (kebab-case, accents folded, unique in their scope), so a template
 * exported twice from the same plan is the same template. The result validates as a `file` by
 * construction: export → validate → apply → export gives the same template back.
 *
 * What this module is not: the writing of the file (the host's `template_write`). It performs no
 * I/O.
 */

import {
  activitiesInOrder,
  compareText,
  decisionsOf,
  hasDuration,
  roomsInOrder,
  stagesInOrder,
  type Activity,
  type Endpoint,
  type WorkSnapshot,
} from '../plan';
import { stageOfLine } from '../money';
import {
  KEY_PATTERN,
  TEMPLATE_FORMAT,
  TEMPLATE_LIMITS,
  type DayRange,
  type LocalisedText,
  type Template,
  type TemplateActivity,
  type TemplateCheck,
  type TemplateCostLine,
  type TemplateDecision,
  type TemplateLanguage,
  type TemplateLink,
  type TemplateStage,
} from './format';

export interface ExportOptions {
  readonly numbers: 'strip' | 'keep';
  /** The work's language: the one text is in. */
  readonly language: TemplateLanguage;
  /**
   * The template's id; made kebab-case (at most `TEMPLATE_LIMITS.idChars`) if it is not. Not given,
   * or nothing left of it: made from the work's name, and `my-work` when nothing is left of that.
   */
  readonly id?: string;
  /** The template's title; the work's name when blank. */
  readonly title: string;
  /** The template's version; 1 when not said. */
  readonly version?: number;
}

/**
 * A kebab-case key from any text: accents folded, lowercase, anything else a hyphen, at most `limit`
 * long (a key's, `TEMPLATE_LIMITS.keyChars`, unless said); `fallback` when nothing is left. The
 * Export dialog can propose an id with it: `keyFrom('Bathroom renovation', 'my-work',
 * TEMPLATE_LIMITS.idChars)` → `bathroom-renovation`.
 */
export function keyFrom(
  text: string,
  fallback = 'template',
  limit: number = TEMPLATE_LIMITS.keyChars,
): string {
  const key = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, limit)
    .replace(/-+$/, '');
  return KEY_PATTERN.test(key) ? key : fallback;
}

/** Keys made unique in one scope: `tiling`, `tiling-2`, `tiling-3` … */
class Keys {
  private readonly taken = new Set<string>();
  constructor(private readonly fallback: string) {}

  next(name: string): string {
    const base = keyFrom(name, this.fallback);
    let key = base;
    for (let n = 2; this.taken.has(key); n += 1) {
      const suffix = `-${n}`;
      key = `${base.slice(0, TEMPLATE_LIMITS.keyChars - suffix.length).replace(/-+$/, '')}${suffix}`;
    }
    this.taken.add(key);
    return key;
  }
}

/** A text of at most `limit` characters, never blank. */
function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  const clipped = [...trimmed].slice(0, limit).join('').trim();
  return clipped === '' ? '?' : clipped;
}

function wholeIn(value: number | null, min: number, max: number): value is number {
  return value !== null && Number.isInteger(value) && value >= min && value <= max;
}

const L = TEMPLATE_LIMITS;

function rangeOf(min: number | null, max: number | null, low: number): DayRange | null {
  if (!wholeIn(min, low, L.durationMax) || !wholeIn(max, low, L.durationMax) || min > max) {
    return null;
  }
  return { min, max };
}

function durationOf(activity: Activity, keep: boolean): DayRange | undefined {
  const range = rangeOf(activity.durationMinDays, activity.durationMaxDays, L.durationMin);
  const days = activity.durationDays;
  const known = hasDuration(activity) && wholeIn(days, L.durationMin, L.durationMax);
  if (!keep) return range ?? undefined;
  // The number picked is the number kept: a range widened around it would come back as the range
  // again, and the next work would have to pick once more.
  if (known) return { min: days!, max: days! };
  return range ?? undefined;
}

/**
 * The work as a template. Pure; the host writes the file. Links whose endpoints are not in the plan,
 * and activities whose stage is not, are left out: a template holds what the plan shows.
 */
export function exportTemplate(snapshot: WorkSnapshot, options: ExportOptions): Template {
  const keep = options.numbers === 'keep';
  const say = (name: string, limit: number): LocalisedText => ({
    [options.language]: clip(name, limit),
  });

  const roomKeys = new Keys('room');
  const roomKey = new Map<string, string>();
  const rooms = roomsInOrder(snapshot).map((room) => {
    const key = roomKeys.next(room.name);
    roomKey.set(room.id, key);
    return { key, name: say(room.name, L.nameChars) };
  });

  const stageKeys = new Keys('stage');
  const stageKey = new Map<string, string>();
  /** Activity id → `stage-key/activity-key`, and its key inside the stage. */
  const activityKey = new Map<string, { stage: string; key: string }>();
  const ordered = activitiesInOrder(snapshot);

  const stages = stagesInOrder(snapshot).map((stage): TemplateStage => {
    const key = stageKeys.next(stage.name);
    stageKey.set(stage.id, key);

    const keys = new Keys('activity');
    const activities = ordered
      .filter((activity) => activity.stageId === stage.id)
      .map((activity): TemplateActivity => {
        const own = keys.next(activity.name);
        activityKey.set(activity.id, { stage: key, key: own });
        const durationDays = durationOf(activity, keep);
        const touched = [...activity.roomIds]
          .map((id) => roomKey.get(id))
          .filter((each): each is string => each !== undefined)
          .sort(compareText);
        return {
          key: own,
          name: say(activity.name, L.nameChars),
          ...(durationDays === undefined ? {} : { durationDays }),
          ...(touched.length === 0 ? {} : { rooms: [...new Set(touched)] }),
        };
      });

    const byGate = (gate: 'start' | 'close') =>
      snapshot.checks
        .filter((check) => check.stageId === stage.id && check.gate === gate)
        .sort((a, b) => a.position - b.position || compareText(a.id, b.id))
        .map((check): TemplateCheck => ({
          ...say(check.name, L.checkChars),
          ...(check.needsPhoto ? { photo: true } : {}),
        }));
    const start = byGate('start');
    const close = byGate('close');

    const costLines = snapshot.costLines
      .filter((line) => stageOfLine(snapshot, line) === stage.id)
      .map((line): TemplateCostLine => {
        const on = line.activityId === null ? undefined : activityKey.get(line.activityId);
        const amount = keep && wholeIn(line.amountCents, 0, L.amountMax) ? line.amountCents : null;
        return {
          label: say(line.label, L.labelChars),
          ...(on === undefined || on.stage !== key ? {} : { activity: on.key }),
          ...(amount === null ? {} : { amountCents: amount }),
        };
      });

    const decisionKeys = new Keys('decision');
    const decisions = decisionsOf(snapshot, stage.id).map((decision): TemplateDecision => {
      let leadDays: DayRange | undefined;
      if (keep && wholeIn(decision.leadTimeDays, L.waitMin, L.waitMax)) {
        // Applying takes a lead range's upper end, so only the lead itself comes back as itself.
        leadDays = { min: decision.leadTimeDays, max: decision.leadTimeDays };
      }
      return {
        key: decisionKeys.next(decision.name),
        name: say(decision.name, L.nameChars),
        ...(leadDays === undefined ? {} : { leadDays }),
      };
    });

    return {
      key,
      name: say(stage.name, L.nameChars),
      ...(start.length + close.length === 0
        ? {}
        : {
            checks: {
              ...(start.length === 0 ? {} : { start }),
              ...(close.length === 0 ? {} : { close }),
            },
          }),
      ...(costLines.length === 0 ? {} : { costLines }),
      ...(decisions.length === 0 ? {} : { decisions }),
      ...(activities.length === 0 ? {} : { activities }),
    };
  });

  const endpoint = (end: Endpoint): string | null => {
    if (end.kind === 'stage') return stageKey.get(end.id) ?? null;
    const found = activityKey.get(end.id);
    return found === undefined ? null : `${found.stage}/${found.key}`;
  };
  const links: TemplateLink[] = [];
  for (const dependency of snapshot.dependencies) {
    const blocker = endpoint(dependency.blocker);
    const blocked = endpoint(dependency.blocked);
    if (blocker === null || blocked === null) continue;
    const lag =
      keep && wholeIn(dependency.lagDays, L.waitMin, L.waitMax) ? dependency.lagDays : null;
    links.push({ blocker, blocked, ...(lag === null ? {} : { lagDays: lag }) });
  }

  const version = options.version;
  return {
    ridgebeamTemplate: TEMPLATE_FORMAT,
    id: keyFrom(options.id ?? '', keyFrom(snapshot.work.name, 'my-work', L.idChars), L.idChars),
    version:
      version !== undefined && Number.isInteger(version) && version >= 1 && version <= L.versionMax
        ? version
        : 1,
    title: say(options.title.trim() === '' ? snapshot.work.name : options.title, L.nameChars),
    ...(rooms.length === 0 ? {} : { rooms }),
    stages,
    ...(links.length === 0 ? {} : { links }),
  };
}

/** The template as the file's text: two-space JSON and a final newline. */
export function templateText(template: Template): string {
  return `${JSON.stringify(template, null, 2)}\n`;
}
