/**
 * Test support for templates: a small template to vary, the host's insert of a draft simulated as
 * a snapshot, and the host's checks of a draft restated, so a test can say "the host would accept
 * this" without a host. Nothing in them is a real place, brand or price.
 *
 * Test support only: no production module imports this file.
 */

import type { WorkSnapshot } from '../plan';
import type { PlanDraft, Provenance, Template } from '../templates/format';
import { KEY_PATTERN, TEMPLATE_LIMITS } from '../templates/format';
import { draftCycle } from '../templates/expand';
import { snapshot } from './plan';

/** Both languages, the same words: enough for a test that is not about language. */
export const both = (text: string) => ({ en: text, 'pt-BR': `${text} (pt)` });

/** A library-valid template with two stages, a room, checks, a decision, cost labels and links. */
export function sampleTemplate(parts: Partial<Template> = {}): Template {
  return {
    ridgebeamTemplate: 1,
    id: 'sample-bathroom',
    version: 1,
    title: both('Sample bathroom'),
    summary: both('A small sample of a bathroom.'),
    rooms: [{ key: 'bathroom', name: both('Bathroom') }],
    stages: [
      {
        key: 'strip-out',
        name: both('Strip-out'),
        checks: { start: [both('Is the water shut off?')], close: [both('Is the rubble gone?')] },
        costLines: [
          { label: both('Skip hire') },
          { label: both('Labour'), activity: 'remove-tiles' },
        ],
        decisions: [
          {
            key: 'tile',
            name: both('Which tile'),
            leadDays: { min: 5, max: 15 },
            needs: 'remove-tiles',
          },
        ],
        activities: [
          {
            key: 'remove-tiles',
            name: both('Remove tiles'),
            durationDays: { min: 1, max: 2 },
            rooms: ['bathroom'],
          },
          { key: 'haul', name: both('Haul rubble'), durationDays: { min: 1, max: 3 } },
        ],
      },
      {
        key: 'finishes',
        name: both('Finishes'),
        activities: [
          { key: 'tile', name: both('Lay tiles'), durationDays: { min: 3, max: 5 } },
          { key: 'grout', name: both('Grout'), durationDays: { min: 1, max: 2 } },
        ],
      },
    ],
    links: [
      { blocker: 'strip-out', blocked: 'finishes', lagDays: 0 },
      { blocker: 'finishes/tile', blocked: 'finishes/grout', lagDays: 1 },
    ],
    ...parts,
  };
}

/** A library of the templates given, by id. */
export function libraryOf(...templates: Template[]): ReadonlyMap<string, Template> {
  return new Map(templates.map((template) => [template.id, template]));
}

/**
 * What the host's `plan_apply` would refuse in a draft, as sentences a failing test can print:
 * no stage, keys that are not 1 to 64 characters or do not resolve, names out of the host's limits,
 * a range out of order, a link to itself or given twice, a cycle (src-tauri/src/commands/templates.rs).
 */
export function draftProblems(draft: PlanDraft): string[] {
  const problems: string[] = [];
  const L = TEMPLATE_LIMITS;
  const text = (where: string, value: string, limit: number) => {
    if (value.trim() === '') problems.push(`${where}: blank`);
    if ([...value].length > limit) problems.push(`${where}: over ${limit} characters`);
  };
  const whole = (where: string, value: number | null, min: number, max: number) => {
    if (value !== null && (!Number.isInteger(value) || value < min || value > max)) {
      problems.push(`${where}: ${value} not in ${min}..${max}`);
    }
  };
  const bothOrNeither = (where: string, min: number | null, max: number | null) => {
    if ((min === null) !== (max === null)) problems.push(`${where}: one end of a range`);
    if (min !== null && max !== null && min > max) problems.push(`${where}: min above max`);
  };

  const key = (where: string, value: string) => {
    if (value.length === 0 || value.length > 64 || value.trim() !== value) {
      problems.push(`${where}: key "${value}" is not 1 to 64 characters with no space around it`);
    }
  };
  if (draft.stages.length === 0) problems.push('stages: none, so there is nothing to start');

  const roomKeys = new Set(draft.rooms.map((room) => room.key));
  draft.rooms.forEach((room, r) => key(`rooms[${r}].key`, room.key));
  if (roomKeys.size !== draft.rooms.length) problems.push('rooms: a key twice');
  draft.rooms.forEach((room, r) => text(`rooms[${r}].name`, room.name, L.nameChars));

  const stageKeys = new Set(draft.stages.map((stage) => stage.key));
  if (stageKeys.size !== draft.stages.length) problems.push('stages: a key twice');
  const activitiesOf = new Map(
    draft.stages.map((stage) => [stage.key, new Set(stage.activities.map((each) => each.key))]),
  );

  draft.stages.forEach((stage, s) => {
    const at = `stages[${s}]`;
    text(`${at}.name`, stage.name, L.nameChars);
    key(`${at}.key`, stage.key);
    const own = activitiesOf.get(stage.key)!;
    if (own.size !== stage.activities.length) problems.push(`${at}: an activity key twice`);
    stage.activities.forEach((activity, a) => {
      const where = `${at}.activities[${a}]`;
      text(`${where}.name`, activity.name, L.nameChars);
      key(`${where}.key`, activity.key);
      whole(`${where}.durationDays`, activity.durationDays, L.durationMin, L.durationMax);
      whole(`${where}.durationMinDays`, activity.durationMinDays, L.durationMin, L.durationMax);
      whole(`${where}.durationMaxDays`, activity.durationMaxDays, L.durationMin, L.durationMax);
      bothOrNeither(where, activity.durationMinDays, activity.durationMaxDays);
      for (const room of activity.rooms) {
        if (!roomKeys.has(room)) problems.push(`${where}: room ${room} not in the draft`);
      }
    });
    stage.checks.forEach((check, c) => text(`${at}.checks[${c}].name`, check.name, L.checkChars));
    stage.costLines.forEach((line, c) => {
      const where = `${at}.costLines[${c}]`;
      text(`${where}.label`, line.label, L.labelChars);
      whole(`${where}.amountCents`, line.amountCents, 0, L.amountMax);
      if (line.activityKey !== null && !own.has(line.activityKey)) {
        problems.push(`${where}: activity ${line.activityKey} not in the stage`);
      }
    });
    stage.decisions.forEach((decision, d) => {
      const where = `${at}.decisions[${d}]`;
      text(`${where}.name`, decision.name, L.nameChars);
      whole(`${where}.leadTimeDays`, decision.leadTimeDays, L.waitMin, L.waitMax);
      bothOrNeither(where, decision.leadMinDays, decision.leadMaxDays);
      if (decision.needsKey !== null && !own.has(decision.needsKey)) {
        problems.push(`${where}: needs ${decision.needsKey}, not in the stage`);
      }
    });
  });

  draft.links.forEach((link, l) => {
    for (const end of [link.blocker, link.blocked]) {
      const activities = activitiesOf.get(end.stageKey);
      if (activities === undefined) problems.push(`links[${l}]: stage ${end.stageKey} unknown`);
      else if (end.kind === 'activity' && !activities.has(end.activityKey ?? '')) {
        problems.push(`links[${l}]: activity ${end.stageKey}/${end.activityKey} unknown`);
      }
      if ((end.kind === 'stage') !== (end.activityKey === null)) {
        problems.push(`links[${l}]: kind and activity key disagree`);
      }
    }
    whole(`links[${l}].lagDays`, link.lagDays, L.waitMin, L.waitMax);
  });

  const ends = draft.links.map((link) =>
    [link.blocker, link.blocked].map((end) => `${end.kind}/${end.stageKey}/${end.activityKey}`),
  );
  ends.forEach(([blocker, blocked], l) => {
    if (blocker === blocked) problems.push(`links[${l}]: from something to itself`);
    if (ends.findIndex(([b, d]) => b === blocker && d === blocked) < l) {
      problems.push(`links[${l}]: already in the plan`);
    }
  });

  if (problems.length === 0) {
    const cycle = draftCycle(draft, draft.links);
    if (cycle !== null) problems.push(`links[${cycle.index}]: cycle ${cycle.chain.join(' → ')}`);
  }
  return problems;
}

/**
 * What the host refuses in a provenance: an id that is not kebab-case of at most 64 characters, a
 * version that is not a whole number from 1 to 1 000 000, a title blank or over 120 characters.
 */
export function provenanceProblems(provenance: Provenance): string[] {
  const problems: string[] = [];
  if (!KEY_PATTERN.test(provenance.templateId) || provenance.templateId.length > 64) {
    problems.push(`templateId: "${provenance.templateId}" is not kebab-case of at most 64`);
  }
  const version = provenance.templateVersion;
  if (!Number.isInteger(version) || version < 1 || version > 1_000_000) {
    problems.push(`templateVersion: ${version} is not 1..1000000`);
  }
  const title = provenance.templateTitle;
  if (title.trim() !== title || title === '' || [...title].length > 120) {
    problems.push(`templateTitle: "${title}" is not a trimmed title of at most 120`);
  }
  return problems;
}

/**
 * The work the host's `plan_apply` would leave: every draft row inserted with a new id, positions in
 * draft order, into an empty work. Ids are readable (`s1`, `s1-a2`) so a failing test is too.
 */
export function snapshotFromDraft(
  draft: PlanDraft,
  parts: Partial<WorkSnapshot> = {},
): WorkSnapshot {
  const roomId = new Map(draft.rooms.map((room, r) => [room.key, `r${r + 1}`]));
  const stageId = new Map(draft.stages.map((stage, s) => [stage.key, `s${s + 1}`]));
  const activityId = (stageKey: string, key: string) => {
    const stage = draft.stages.find((each) => each.key === stageKey)!;
    return `${stageId.get(stageKey)}-a${stage.activities.findIndex((each) => each.key === key) + 1}`;
  };

  return snapshot({
    rooms: draft.rooms.map((room, r) => ({
      id: roomId.get(room.key)!,
      position: r + 1,
      name: room.name,
    })),
    stages: draft.stages.map((stage, s) => ({
      id: stageId.get(stage.key)!,
      position: s + 1,
      name: stage.name,
      startedAt: null,
      closedAt: null,
    })),
    activities: draft.stages.flatMap((stage) =>
      stage.activities.map((activity, a) => ({
        id: activityId(stage.key, activity.key),
        stageId: stageId.get(stage.key)!,
        position: a + 1,
        name: activity.name,
        durationDays: activity.durationDays,
        durationMinDays: activity.durationMinDays,
        durationMaxDays: activity.durationMaxDays,
        responsibleId: null,
        roomIds: activity.rooms.map((key) => roomId.get(key)!),
        quantity: null,
        unit: null,
      })),
    ),
    checks: draft.stages.flatMap((stage) =>
      stage.checks.map((check, c) => ({
        id: `${stageId.get(stage.key)}-c${c + 1}`,
        stageId: stageId.get(stage.key)!,
        gate: check.gate,
        position: c + 1,
        name: check.name,
      })),
    ),
    costLines: draft.stages.flatMap((stage) =>
      stage.costLines.map((line, c) => ({
        id: `${stageId.get(stage.key)}-l${c + 1}`,
        stageId: stageId.get(stage.key)!,
        activityId: line.activityKey === null ? null : activityId(stage.key, line.activityKey),
        label: line.label,
        amountCents: line.amountCents,
      })),
    ),
    decisions: draft.stages.flatMap((stage) =>
      stage.decisions.map((decision, d) => ({
        id: `${stageId.get(stage.key)}-d${d + 1}`,
        stageId: stageId.get(stage.key)!,
        position: d + 1,
        name: decision.name,
        leadTimeDays: decision.leadTimeDays,
        leadMinDays: decision.leadMinDays,
        leadMaxDays: decision.leadMaxDays,
        madeAt: null,
        answer: null,
      })),
    ),
    dependencies: draft.links.map((link, l) => {
      const end = (endpoint: (typeof link)['blocker']) =>
        endpoint.kind === 'stage'
          ? { kind: 'stage' as const, id: stageId.get(endpoint.stageKey)! }
          : { kind: 'activity' as const, id: activityId(endpoint.stageKey, endpoint.activityKey!) };
      return {
        id: `dep-${l + 1}`,
        blocker: end(link.blocker),
        blocked: end(link.blocked),
        lagDays: link.lagDays,
      };
    }),
    ...parts,
  });
}
