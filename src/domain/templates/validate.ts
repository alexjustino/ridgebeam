/**
 * Is this a template the product may apply? Every problem, each with where it is and why.
 *
 * A template is hostile input until it passes here: a file somebody sent, or a library file a
 * contributor wrote. So nothing is assumed: every object is checked for the fields it may have and
 * **no other** (data, not code: R10), every text for its languages and length, every key for its
 * shape and for resolving, every number for being whole and in range. Nothing throws for a mistake
 * in the file; every problem is returned, in document order, with a JSON path (`$.stages[0].name`)
 * and a message key the interface turns into a sentence, so a person (or a contributor, through
 * the library test) sees all that is wrong at once.
 *
 * Two levels, one validator (the plan's decision 2):
 *
 * - **Both** (a `file` and the `library`): the structure; kebab-case keys, unique in their scope;
 *   rooms, activities, needs and link endpoints that resolve; includes that name library templates,
 *   neither the template itself nor a cycle; a check's optional `photo` a boolean (slice D3); at least one stage, its own or an include's; no link
 *   from something to itself and none given twice; links that close no loop once stage endpoints
 *   are expanded (the schedule's own graph, as the host will judge them); the host's limits, with
 *   ids of at most 31 characters and keys of at most 32, so an included stage's draft key
 *   (`template-id:stage-key`) fits the host's 64.
 * - **Library only**: both languages in every text; a summary; every duration and lead time given,
 *   as a range with `min < max` ("a template carries ranges, not promises"); no `amountCents` (no
 *   prices: cost lines are labels); and no text that looks like a web address, an e-mail address
 *   or a phone number (nothing real).
 * - **File only** allows `min = max` (applied as a duration, and the apply summary says so) and
 *   amounts: a work's own export carries that work's own numbers.
 *
 * What this module is not: I/O. It receives the parsed value (or the text) and a library already
 * loaded; it never reads a file.
 */

import {
  KEY_PATTERN,
  TEMPLATE_FORMAT,
  TEMPLATE_LANGUAGES,
  TEMPLATE_LIMITS,
  type DraftEndpoint,
  type DraftLink,
  type Template,
  type TemplateOrigin,
} from './format';
import { draftCycle, draftStageKey, expansionOf, resolveEndpoint } from './expand';

/** The message keys of every problem a template can have. Each renders with its `detail`. */
export const TEMPLATE_PROBLEM_KEYS = {
  /** The text is not JSON. */
  json: 'template.problem.json',
  /** `{expected}`: an object, a list, a text or a whole number was expected here. */
  type: 'template.problem.type',
  /** `ridgebeamTemplate` is not a format this version reads: `{expected}`. */
  format: 'template.problem.format',
  /** `{field}` is not a field a template has. */
  unknownField: 'template.problem.unknownField',
  /** `{field}` is missing. */
  required: 'template.problem.required',
  /** `{value}` is not a kebab-case id or key of at most `{limit}` characters. */
  key: 'template.problem.key',
  /** `{key}` is used twice where it must be unique. */
  duplicate: 'template.problem.duplicate',
  /** A text with no language in it, or a blank one. */
  textEmpty: 'template.problem.textEmpty',
  /** A text over `{limit}` characters. */
  textTooLong: 'template.problem.textTooLong',
  /** Library: the text has no `{language}`. */
  languageMissing: 'template.problem.languageMissing',
  /** Library: text that looks like a `{kind}` (`url`, `email`, `phone`): nothing real. */
  contact: 'template.problem.contact',
  /** Not a whole number from `{min}` to `{max}`. */
  number: 'template.problem.number',
  /** A range whose `min` is above its `max`. */
  rangeOrder: 'template.problem.rangeOrder',
  /** Library: a point (`min = max`): a template carries ranges, not promises. */
  point: 'template.problem.point',
  /** Library: a duration or lead time not given. `{field}` */
  rangeRequired: 'template.problem.rangeRequired',
  /** Library: an amount on a cost line: the library carries no prices. */
  price: 'template.problem.price',
  /** A template that brings no stage at all: there is no plan to start. */
  empty: 'template.problem.empty',
  /** `{key}` names no room of the template. */
  unknownRoom: 'template.problem.unknownRoom',
  /** `{key}` names no activity of the stage (or, in a link, `stage/activity`). */
  unknownActivity: 'template.problem.unknownActivity',
  /** `{key}` names no stage in reach. */
  unknownStage: 'template.problem.unknownStage',
  /** `{key}` is a stage of more than one included template: say which, `template-id:stage-key`. */
  ambiguousStage: 'template.problem.ambiguousStage',
  /** `{value}` is not `stage-key` or `stage-key/activity-key`. */
  endpoint: 'template.problem.endpoint',
  /** `{id}` names no template of the library. */
  unknownInclude: 'template.problem.unknownInclude',
  /** The template includes itself. */
  selfInclude: 'template.problem.selfInclude',
  /** The includes go round: `{chain}`. */
  includeCycle: 'template.problem.includeCycle',
  /** The links go round: `{chain}` (the F2 sentence: this work could never start). */
  cycle: 'template.problem.cycle',
  /** A link from something to itself (the host's sentence for `dependency_add`). */
  selfLink: 'template.problem.selfLink',
  /** A link already given, the same two ends (the host's sentence for `dependency_add`). */
  duplicateLink: 'template.problem.duplicateLink',
  /** Library: the id `{id}` is not the file's name `{file}`. */
  fileName: 'template.problem.fileName',
} as const;

export type TemplateProblemKey = (typeof TEMPLATE_PROBLEM_KEYS)[keyof typeof TEMPLATE_PROBLEM_KEYS];

/** One thing wrong with a template: where, which sentence, and what the sentence needs. */
export interface TemplateProblem {
  /** A JSON path into the template: `$`, `$.stages[0].activities[1].durationDays`. */
  readonly path: string;
  readonly key: TemplateProblemKey;
  readonly detail: Readonly<Record<string, string | number>>;
}

export type TemplateValidation =
  | { readonly ok: true; readonly template: Template }
  | { readonly ok: false; readonly problems: readonly TemplateProblem[] };

const K = TEMPLATE_PROBLEM_KEYS;
const L = TEMPLATE_LIMITS;

// ── Looking like something real ──────────────────────────────────────────────

const URL_LIKE =
  /\b(?:https?:\/\/|www\.)|\b[a-z0-9-]+\.(?:com|net|org|gov|edu|io|br|pt|app|dev|info|biz|co)\b/i;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** Seven or more digits in a run, spaces, dots, dashes, brackets and a leading `+` between them. */
const PHONE_LIKE = /\+?\d(?:[\s().-]*\d){6,}/;

/** What a text looks like that the library may not carry, or `null`. */
export function realLookingText(text: string): 'url' | 'email' | 'phone' | null {
  if (EMAIL_LIKE.test(text)) return 'email';
  if (URL_LIKE.test(text)) return 'url';
  if (PHONE_LIKE.test(text)) return 'phone';
  return null;
}

// ── Walking the value ────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `$.stages[0]["pt-BR"]`: a member as JSON path writes it. */
function member(path: string, name: string): string {
  return IDENTIFIER.test(name) ? `${path}.${name}` : `${path}[${JSON.stringify(name)}]`;
}

const chars = (text: string) => [...text].length;

class Walker {
  readonly problems: TemplateProblem[] = [];
  constructor(readonly origin: TemplateOrigin) {}

  get library(): boolean {
    return this.origin === 'library';
  }

  add(path: string, key: TemplateProblemKey, detail: Record<string, string | number> = {}): void {
    this.problems.push({ path, key, detail });
  }

  /** An object with only `allowed` fields and every `required` one. `null` when not an object. */
  object(
    value: unknown,
    path: string,
    allowed: readonly string[],
    required: readonly string[],
  ): Json | null {
    if (!isObject(value)) {
      this.add(path, K.type, { expected: 'object' });
      return null;
    }
    for (const field of Object.keys(value)) {
      if (!allowed.includes(field)) this.add(member(path, field), K.unknownField, { field });
    }
    for (const field of required) {
      if (!(field in value)) this.add(path, K.required, { field });
    }
    return value;
  }

  /** A list, or `null` (with a problem) when it is something else. */
  list(value: unknown, path: string): readonly unknown[] | null {
    if (!Array.isArray(value)) {
      this.add(path, K.type, { expected: 'array' });
      return null;
    }
    return value;
  }

  /** A kebab-case key of at most `limit` characters: a key's, or an id's (`L.idChars`). */
  key(value: unknown, path: string, limit: number = L.keyChars): string | null {
    if (typeof value !== 'string') {
      this.add(path, K.type, { expected: 'string' });
      return null;
    }
    if (!KEY_PATTERN.test(value) || value.length > limit) {
      this.add(path, K.key, { value, limit });
      return null;
    }
    return value;
  }

  /** Keys unique in their scope: the second and later of each are reported. */
  unique(keys: ReadonlyArray<{ key: string | null; path: string }>): void {
    const seen = new Set<string>();
    for (const { key, path } of keys) {
      if (key === null) continue;
      if (seen.has(key)) this.add(path, K.duplicate, { key });
      seen.add(key);
    }
  }

  /** A text in the template's languages; `extra` names the other fields it may carry. */
  text(value: unknown, path: string, limit: number, extra: readonly string[] = []): void {
    const object = this.object(value, path, [...TEMPLATE_LANGUAGES, ...extra], []);
    if (object === null) return;
    if (!TEMPLATE_LANGUAGES.some((language) => language in object)) {
      this.add(path, K.textEmpty);
      return;
    }
    for (const language of TEMPLATE_LANGUAGES) {
      const at = member(path, language);
      if (!(language in object)) {
        if (this.library) this.add(path, K.languageMissing, { language });
        continue;
      }
      const text = object[language];
      if (typeof text !== 'string') {
        this.add(at, K.type, { expected: 'string' });
        continue;
      }
      const trimmed = text.trim();
      if (trimmed === '') {
        this.add(at, K.textEmpty);
        continue;
      }
      if (chars(trimmed) > limit) this.add(at, K.textTooLong, { limit });
      if (this.library) {
        const kind = realLookingText(trimmed);
        if (kind !== null) this.add(at, K.contact, { kind });
      }
    }
  }

  whole(value: unknown, path: string, min: number, max: number): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      this.add(path, K.number, { min, max });
      return null;
    }
    return value;
  }

  /** A range of working days within `min`…`max`; the library refuses a point. */
  range(value: unknown, path: string, min: number, max: number): void {
    const object = this.object(value, path, ['min', 'max'], ['min', 'max']);
    if (object === null) return;
    const low = 'min' in object ? this.whole(object.min, member(path, 'min'), min, max) : null;
    const high = 'max' in object ? this.whole(object.max, member(path, 'max'), min, max) : null;
    if (low === null || high === null) return;
    if (low > high) this.add(path, K.rangeOrder, { min: low, max: high });
    else if (low === high && this.library) this.add(path, K.point, { days: low });
  }
}

// ── The template's own fields ────────────────────────────────────────────────

const TOP_FIELDS = [
  'ridgebeamTemplate',
  'id',
  'version',
  'title',
  'summary',
  'includes',
  'rooms',
  'stages',
  'links',
] as const;
const REQUIRED_FIELDS = ['ridgebeamTemplate', 'id', 'version', 'title', 'stages'] as const;
const ROOM_FIELDS = ['key', 'name'] as const;
const STAGE_FIELDS = ['key', 'name', 'checks', 'costLines', 'decisions', 'activities'] as const;
const ACTIVITY_FIELDS = ['key', 'name', 'durationDays', 'rooms'] as const;
const DECISION_FIELDS = ['key', 'name', 'leadDays', 'needs'] as const;
const COST_FIELDS = ['label', 'activity', 'amountCents'] as const;
const LINK_FIELDS = ['blocker', 'blocked', 'lagDays'] as const;
/** A check is a text that may also say `"photo": true` (slice D3). */
const CHECK_FIELDS = ['photo'] as const;

/** Check every field of one template on its own: everything but what other templates decide. */
function checkFields(walker: Walker, root: Json): void {
  if ('ridgebeamTemplate' in root && root.ridgebeamTemplate !== TEMPLATE_FORMAT) {
    walker.add('$.ridgebeamTemplate', K.format, { expected: TEMPLATE_FORMAT });
  }
  if ('id' in root) walker.key(root.id, '$.id', L.idChars);
  if ('version' in root) walker.whole(root.version, '$.version', 1, L.versionMax);
  if ('title' in root) walker.text(root.title, '$.title', L.nameChars);
  if ('summary' in root) walker.text(root.summary, '$.summary', L.summaryChars);
  else if (walker.library) walker.add('$', K.required, { field: 'summary' });

  if ('includes' in root) {
    const includes = walker.list(root.includes, '$.includes');
    if (includes !== null) {
      walker.unique(
        includes.map((value, index) => ({
          key: walker.key(value, `$.includes[${index}]`, L.idChars),
          path: `$.includes[${index}]`,
        })),
      );
    }
  }

  // The room keys, or `null` when the list itself is broken: then a reference to a room is not
  // judged, so one mistake is not reported again at every activity that names a room.
  let roomKeys: Set<string> | null = new Set<string>();
  if ('rooms' in root) {
    const rooms = walker.list(root.rooms, '$.rooms');
    if (rooms === null) roomKeys = null;
    else {
      const keys = rooms.map((value, index) => {
        const path = `$.rooms[${index}]`;
        const room = walker.object(value, path, ROOM_FIELDS, ROOM_FIELDS);
        const key = room !== null && 'key' in room ? walker.key(room.key, `${path}.key`) : null;
        if (room !== null && 'name' in room) walker.text(room.name, `${path}.name`, L.nameChars);
        if (key === null) roomKeys = null;
        else roomKeys?.add(key);
        return { key, path: `${path}.key` };
      });
      walker.unique(keys);
    }
  }

  if ('stages' in root) {
    const stages = walker.list(root.stages, '$.stages');
    if (stages !== null) {
      walker.unique(stages.map((value, index) => checkStage(walker, value, index, roomKeys)));
    }
  }

  if ('links' in root) {
    const links = walker.list(root.links, '$.links');
    links?.forEach((value, index) => {
      const path = `$.links[${index}]`;
      const link = walker.object(value, path, LINK_FIELDS, ['blocker', 'blocked']);
      if (link === null) return;
      for (const end of ['blocker', 'blocked'] as const) {
        if (end in link && typeof link[end] !== 'string') {
          walker.add(`${path}.${end}`, K.type, { expected: 'string' });
        }
      }
      if ('lagDays' in link) walker.whole(link.lagDays, `${path}.lagDays`, L.waitMin, L.waitMax);
    });
  }
}

function checkStage(
  walker: Walker,
  value: unknown,
  index: number,
  roomKeys: ReadonlySet<string> | null,
): { key: string | null; path: string } {
  const path = `$.stages[${index}]`;
  const stage = walker.object(value, path, STAGE_FIELDS, ['key', 'name']);
  if (stage === null) return { key: null, path };
  const key = 'key' in stage ? walker.key(stage.key, `${path}.key`) : null;
  if ('name' in stage) walker.text(stage.name, `${path}.name`, L.nameChars);

  // Activities first: the cost lines and decisions below name them. `null` when the list is broken,
  // as for rooms: a reference is then not judged against it.
  let activityKeys: Set<string> | null = new Set<string>();
  if ('activities' in stage) {
    const activities = walker.list(stage.activities, `${path}.activities`);
    if (activities === null) activityKeys = null;
    else {
      const keys = activities.map((each, at) => {
        const where = `${path}.activities[${at}]`;
        const activity = walker.object(each, where, ACTIVITY_FIELDS, ['key', 'name']);
        if (activity === null) {
          activityKeys = null;
          return { key: null, path: where };
        }
        const activityKey = 'key' in activity ? walker.key(activity.key, `${where}.key`) : null;
        if ('name' in activity) walker.text(activity.name, `${where}.name`, L.nameChars);
        if ('durationDays' in activity) {
          walker.range(
            activity.durationDays,
            `${where}.durationDays`,
            L.durationMin,
            L.durationMax,
          );
        } else if (walker.library) {
          walker.add(where, K.rangeRequired, { field: 'durationDays' });
        }
        if ('rooms' in activity) {
          const rooms = walker.list(activity.rooms, `${where}.rooms`);
          if (rooms !== null) {
            const used = rooms.map((room, r) => {
              const roomPath = `${where}.rooms[${r}]`;
              const roomKey = walker.key(room, roomPath);
              if (roomKey !== null && roomKeys !== null && !roomKeys.has(roomKey)) {
                walker.add(roomPath, K.unknownRoom, { key: roomKey });
              }
              return { key: roomKey, path: roomPath };
            });
            walker.unique(used);
          }
        }
        if (activityKey === null) activityKeys = null;
        else activityKeys?.add(activityKey);
        return { key: activityKey, path: `${where}.key` };
      });
      walker.unique(keys);
    }
  }

  const activityRef = (value: unknown, where: string) => {
    const ref = walker.key(value, where);
    if (ref !== null && activityKeys !== null && !activityKeys.has(ref)) {
      walker.add(where, K.unknownActivity, { key: ref });
    }
  };

  if ('checks' in stage) {
    const checks = walker.object(stage.checks, `${path}.checks`, ['start', 'close'], []);
    if (checks !== null) {
      for (const gate of ['start', 'close'] as const) {
        if (!(gate in checks)) continue;
        const list = walker.list(checks[gate], `${path}.checks.${gate}`);
        list?.forEach((check, at) => {
          const where = `${path}.checks.${gate}[${at}]`;
          walker.text(check, where, L.checkChars, CHECK_FIELDS);
          if (isObject(check) && 'photo' in check && typeof check.photo !== 'boolean') {
            walker.add(`${where}.photo`, K.type, { expected: 'boolean' });
          }
        });
      }
    }
  }

  if ('costLines' in stage) {
    const lines = walker.list(stage.costLines, `${path}.costLines`);
    lines?.forEach((each, at) => {
      const where = `${path}.costLines[${at}]`;
      const line = walker.object(each, where, COST_FIELDS, ['label']);
      if (line === null) return;
      if ('label' in line) walker.text(line.label, `${where}.label`, L.labelChars);
      if ('activity' in line) activityRef(line.activity, `${where}.activity`);
      if ('amountCents' in line) {
        if (walker.library) walker.add(`${where}.amountCents`, K.price);
        else walker.whole(line.amountCents, `${where}.amountCents`, 0, L.amountMax);
      }
    });
  }

  if ('decisions' in stage) {
    const decisions = walker.list(stage.decisions, `${path}.decisions`);
    if (decisions !== null) {
      const keys = decisions.map((each, at) => {
        const where = `${path}.decisions[${at}]`;
        const decision = walker.object(each, where, DECISION_FIELDS, ['key', 'name']);
        if (decision === null) return { key: null, path: where };
        const decisionKey = 'key' in decision ? walker.key(decision.key, `${where}.key`) : null;
        if ('name' in decision) walker.text(decision.name, `${where}.name`, L.nameChars);
        if ('leadDays' in decision) {
          walker.range(decision.leadDays, `${where}.leadDays`, L.waitMin, L.waitMax);
        } else if (walker.library) {
          walker.add(where, K.rangeRequired, { field: 'leadDays' });
        }
        if ('needs' in decision) activityRef(decision.needs, `${where}.needs`);
        return { key: decisionKey, path: `${where}.key` };
      });
      walker.unique(keys);
    }
  }

  return { key, path: `${path}.key` };
}

// ── Across templates: includes, links, cycles ────────────────────────────────

/**
 * The first include cycle reachable from the template, as the ids that go round and the index of
 * the template's own include it was reached through; `null` when there is none.
 */
function includeCycle(
  template: Template,
  library: ReadonlyMap<string, Template>,
): { index: number; chain: string[] } | null {
  // The template itself is only ever met on the stack (below), so its includes come from the call.
  const includesOf = (id: string): readonly string[] => library.get(id)?.includes ?? [];
  const done = new Set<string>();

  const visit = (id: string, stack: string[]): string[] | null => {
    const at = stack.indexOf(id);
    if (at !== -1) return [...stack.slice(at), id];
    if (done.has(id)) return null;
    stack.push(id);
    for (const next of includesOf(id)) {
      const found = visit(next, stack);
      if (found !== null) return found;
    }
    stack.pop();
    done.add(id);
    return null;
  };

  const includes = template.includes ?? [];
  for (const [index, id] of includes.entries()) {
    if (id === template.id) continue;
    const found = visit(id, [template.id]);
    if (found !== null) return { index, chain: found };
  }
  return null;
}

function checkAcross(
  walker: Walker,
  template: Template,
  library: ReadonlyMap<string, Template>,
): void {
  let includesSound = true;
  for (const [index, id] of (template.includes ?? []).entries()) {
    const path = `$.includes[${index}]`;
    if (id === template.id) {
      walker.add(path, K.selfInclude, { id });
      includesSound = false;
    } else if (!library.has(id)) {
      walker.add(path, K.unknownInclude, { id });
      includesSound = false;
    }
  }
  const cycle = includeCycle(template, library);
  if (cycle !== null) {
    walker.add(`$.includes[${cycle.index}]`, K.includeCycle, { chain: cycle.chain.join(' → ') });
    includesSound = false;
  }

  const expansion = expansionOf(template, library);
  const stageCount = expansion.reduce((sum, each) => sum + each.stages.length, 0);
  // Only judged when every include down the tree is there: a missing one is the problem then.
  const reachable = expansion.every((each) =>
    (each.includes ?? []).every((id) => id === template.id || library.has(id)),
  );
  if (includesSound && reachable && stageCount === 0) walker.add('$.stages', K.empty);

  // The template's own links, resolved in its scope.
  const own: DraftLink[] = [];
  let linksSound = true;
  for (const [index, link] of (template.links ?? []).entries()) {
    const resolve = (end: 'blocker' | 'blocked') => {
      const resolved = resolveEndpoint(link[end], template, template, expansion);
      if (resolved.ok) return resolved.endpoint;
      const path = `$.links[${index}].${end}`;
      if (resolved.reason === 'malformed') walker.add(path, K.endpoint, { value: resolved.name });
      else if (resolved.reason === 'unknown-template')
        walker.add(path, K.unknownInclude, { id: resolved.name });
      else if (resolved.reason === 'ambiguous-stage')
        walker.add(path, K.ambiguousStage, { key: resolved.name });
      else if (resolved.reason === 'unknown-activity')
        walker.add(path, K.unknownActivity, { key: resolved.name });
      else walker.add(path, K.unknownStage, { key: resolved.name });
      return null;
    };
    const blocker = resolve('blocker');
    const blocked = resolve('blocked');
    if (blocker === null || blocked === null) {
      linksSound = false;
      continue;
    }
    own.push({ blocker, blocked, lagDays: link.lagDays ?? 0 });
  }
  if (!includesSound || !linksSound) return;

  // The included templates' links come first, as apply lays them; a loop closes on the template's.
  const inherited: DraftLink[] = [];
  for (const owner of expansion) {
    if (owner === template) continue;
    for (const link of owner.links ?? []) {
      const blocker = resolveEndpoint(link.blocker, owner, template, expansion);
      const blocked = resolveEndpoint(link.blocked, owner, template, expansion);
      if (blocker.ok && blocked.ok) {
        inherited.push({ blocker: blocker.endpoint, blocked: blocked.endpoint, lagDays: 0 });
      }
    }
  }
  const shape = {
    stages: expansion.flatMap((owner) =>
      owner.stages.map((stage) => ({
        key: draftStageKey(owner, template, stage),
        activities: stage.activities ?? [],
      })),
    ),
  };
  const links = [...inherited, ...own];
  /** Where a link of the expanded plan was written: the template's own, or an include's. */
  const pathOf = (index: number) =>
    index >= inherited.length ? `$.links[${index - inherited.length}]` : '$.includes';

  // What the host refuses before it looks for a loop: a link from something to itself, and the
  // same link twice (the same two ends as written, as `dependency_add` compares them).
  let repeated = false;
  const seen = new Set<string>();
  const end = (at: DraftEndpoint) => `${at.kind}\u0000${at.stageKey}\u0000${at.activityKey ?? ''}`;
  links.forEach((link, index) => {
    const pair = `${end(link.blocker)}\u0001${end(link.blocked)}`;
    if (end(link.blocker) === end(link.blocked)) {
      walker.add(pathOf(index), K.selfLink);
      repeated = true;
    } else if (seen.has(pair)) {
      walker.add(pathOf(index), K.duplicateLink);
      repeated = true;
    }
    seen.add(pair);
  });
  if (repeated) return;

  const found = draftCycle(shape, links);
  if (found !== null) {
    walker.add(pathOf(found.index), K.cycle, { chain: found.chain.join(' → ') });
  }
}

// ── Entry points ─────────────────────────────────────────────────────────────

/**
 * Validate a parsed template for where it came from. `library` is the library already loaded,
 * which `includes` name. Never throws: every problem is returned.
 */
export function validateTemplate(
  raw: unknown,
  origin: TemplateOrigin,
  library: ReadonlyMap<string, Template>,
): TemplateValidation {
  const walker = new Walker(origin);
  const root = walker.object(raw, '$', TOP_FIELDS, REQUIRED_FIELDS);
  if (root === null) return { ok: false, problems: walker.problems };
  checkFields(walker, root);
  if (walker.problems.length > 0) return { ok: false, problems: walker.problems };

  const template = root as unknown as Template;
  checkAcross(walker, template, library);
  if (walker.problems.length > 0) return { ok: false, problems: walker.problems };
  return { ok: true, template };
}

/** Parse a template's text (a file's contents) and validate it. Not JSON is one problem. */
export function parseTemplate(
  text: string,
  origin: TemplateOrigin,
  library: ReadonlyMap<string, Template>,
): TemplateValidation {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problems: [{ path: '$', key: K.json, detail: {} }] };
  }
  return validateTemplate(raw, origin, library);
}

/** One library file: its name without `.json`, and its parsed contents. */
export interface LibraryFile {
  readonly name: string;
  readonly raw: unknown;
}

export interface LoadedLibrary {
  /** The templates that passed, by id. */
  readonly library: ReadonlyMap<string, Template>;
  /** The files that did not, with every problem, in the order given. */
  readonly rejected: ReadonlyArray<{
    readonly name: string;
    readonly problems: readonly TemplateProblem[];
  }>;
}

/**
 * Validate the whole library at once, as the loader and the library test do. A file whose id is
 * not its name is refused; so is one whose include was refused, until what is left holds together.
 * Includes resolve among the library's own files.
 */
export function validateLibrary(files: readonly LibraryFile[]): LoadedLibrary {
  /** Problems by the file's index: two files may claim one name, and each is answered. */
  const rejected = new Map<number, TemplateProblem[]>();
  /** Id → the index of the file that holds it, for the files that passed so far. */
  const holder = new Map<string, number>();
  const candidates = new Map<string, Template>();

  // First every file on its own, its includes not yet looked at.
  files.forEach((file, index) => {
    const walker = new Walker('library');
    const root = walker.object(file.raw, '$', TOP_FIELDS, REQUIRED_FIELDS);
    if (root !== null) checkFields(walker, root);
    if (walker.problems.length === 0) {
      const template = root as unknown as Template;
      if (template.id !== file.name) {
        walker.add('$.id', K.fileName, { id: template.id, file: file.name });
      } else if (candidates.has(template.id)) {
        walker.add('$.id', K.duplicate, { key: template.id });
      } else {
        candidates.set(template.id, template);
        holder.set(template.id, index);
      }
    }
    if (walker.problems.length > 0) rejected.set(index, walker.problems);
  });

  // Then across files, until nothing more falls out: a refused include refuses who includes it.
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, template] of candidates) {
      const result = validateTemplate(template, 'library', candidates);
      if (result.ok) continue;
      rejected.set(holder.get(id)!, [...result.problems]);
      candidates.delete(id);
      changed = true;
    }
  }

  return {
    library: candidates,
    rejected: files.flatMap((file, index) => {
      const problems = rejected.get(index);
      return problems === undefined ? [] : [{ name: file.name, problems }];
    }),
  };
}
