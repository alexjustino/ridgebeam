/**
 * Includes and links: which templates a template brings in, and what a link's endpoint names.
 *
 * A template may include library templates (`includes`). Applying it brings in their stages first,
 * depth first and in the order given, **each template once** (a template reached twice, through two
 * includes, is expanded the first time), then its own. A template reached again while it is being
 * expanded (an include cycle, which validation refuses) is not expanded again: expansion always
 * terminates.
 *
 * In the draft a stage of the template itself keeps its key; a stage of an included template is
 * keyed `template-id:stage-key`, so two included templates may both have a `strip-out`. A link
 * names its endpoints in the scope of the template that holds it: its own stages first, then, by
 * plain key, the one stage of the templates it reaches through its includes that has that key, or
 * `template-id:stage-key` to say which when more than one does.
 *
 * Both validation and apply read includes and links through here, so the two can never disagree
 * about what a link means. The cycle a draft's links would close is found by the schedule's own
 * graph, with stage endpoints expanded (`schedule/expand.ts`), as the host will judge it.
 *
 * What this module is not: a validator of one template's fields (`validate.ts`). It performs no I/O.
 */

import type { WorkSnapshot } from '../plan';
import { cycleIfAdded } from '../schedule/expand';
import type { DraftEndpoint, DraftLink, Template, TemplateStage } from './format';

/**
 * Every template the expansion brings in, included ones first (depth first, in order, each once),
 * the template itself last. Ids the library does not have are passed over (validation reports them).
 */
export function expansionOf(
  template: Template,
  library: ReadonlyMap<string, Template>,
): Template[] {
  const seen = new Set<string>([template.id]);
  const ordered: Template[] = [];
  const visit = (current: Template) => {
    for (const id of current.includes ?? []) {
      if (seen.has(id)) continue;
      const included = library.get(id);
      if (included === undefined) continue;
      seen.add(id);
      visit(included);
    }
    ordered.push(current);
  };
  visit(template);
  return ordered;
}

/** The key a stage has in the draft: its own for the template applied, prefixed for an include. */
export function draftStageKey(owner: Template, top: Template, stage: TemplateStage): string {
  return owner === top ? stage.key : `${owner.id}:${stage.key}`;
}

/**
 * The templates a template reaches through its includes, transitively, itself excluded, among the
 * ones an expansion brought in.
 */
function reachOf(owner: Template, byId: ReadonlyMap<string, Template>): Template[] {
  const seen = new Set<string>([owner.id]);
  const reached: Template[] = [];
  const queue = [...(owner.includes ?? [])];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]!;
    if (seen.has(id)) continue;
    seen.add(id);
    const found = byId.get(id);
    if (found === undefined) continue;
    reached.push(found);
    queue.push(...(found.includes ?? []));
  }
  return reached;
}

/** What an endpoint's text names, or why it names nothing. */
export type Resolution =
  | { readonly ok: true; readonly endpoint: DraftEndpoint }
  | {
      readonly ok: false;
      readonly reason:
        'malformed' | 'unknown-template' | 'unknown-stage' | 'ambiguous-stage' | 'unknown-activity';
      /** The part that named nothing: the text, the template id, the stage key or `stage/activity`. */
      readonly name: string;
    };

/** `template-id:stage-key/activity-key`, each part optional but the stage. */
const ENDPOINT =
  /^(?:([a-z0-9]+(?:-[a-z0-9]+)*):)?([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))?$/;

/**
 * Resolve one endpoint in the scope of the template that holds the link, among the templates an
 * expansion of `top` brought in (`expansion`).
 */
export function resolveEndpoint(
  text: string,
  owner: Template,
  top: Template,
  expansion: readonly Template[],
): Resolution {
  const match = ENDPOINT.exec(text);
  if (match === null) return { ok: false, reason: 'malformed', name: text };
  const [, templateId, stageKey, activityKey] = match as unknown as [
    string,
    string | undefined,
    string,
    string | undefined,
  ];
  const byId = new Map(expansion.map((each) => [each.id, each]));
  const reach = reachOf(owner, byId);

  let holder: Template;
  let stage: TemplateStage | undefined;
  if (templateId !== undefined) {
    const named = templateId === owner.id ? owner : reach.find((each) => each.id === templateId);
    if (named === undefined) return { ok: false, reason: 'unknown-template', name: templateId };
    holder = named;
    stage = named.stages.find((each) => each.key === stageKey);
  } else {
    holder = owner;
    stage = owner.stages.find((each) => each.key === stageKey);
    if (stage === undefined) {
      const candidates = reach.flatMap((each) =>
        each.stages
          .filter((candidate) => candidate.key === stageKey)
          .map((candidate) => ({ each, candidate })),
      );
      if (candidates.length > 1) return { ok: false, reason: 'ambiguous-stage', name: stageKey };
      if (candidates.length === 1) {
        holder = candidates[0]!.each;
        stage = candidates[0]!.candidate;
      }
    }
  }
  if (stage === undefined) return { ok: false, reason: 'unknown-stage', name: stageKey };

  const key = draftStageKey(holder, top, stage);
  if (activityKey === undefined) {
    return { ok: true, endpoint: { kind: 'stage', stageKey: key, activityKey: null } };
  }
  if (!(stage.activities ?? []).some((activity) => activity.key === activityKey)) {
    return { ok: false, reason: 'unknown-activity', name: `${stageKey}/${activityKey}` };
  }
  return { ok: true, endpoint: { kind: 'activity', stageKey: key, activityKey } };
}

/** The draft's stages and activities, as far as a cycle check needs them. */
export interface DraftShape {
  readonly stages: ReadonlyArray<{
    readonly key: string;
    readonly activities: ReadonlyArray<{ readonly key: string }>;
  }>;
}

/** An activity's id in the synthetic plan a cycle check builds: `stage-key/activity-key`. */
function activityId(stageKey: string, activityKey: string): string {
  return `${stageKey}/${activityKey}`;
}

function endpointOf(endpoint: DraftEndpoint) {
  return endpoint.kind === 'stage'
    ? { kind: 'stage' as const, id: endpoint.stageKey }
    : { kind: 'activity' as const, id: activityId(endpoint.stageKey, endpoint.activityKey!) };
}

/** The first link that closes a loop, and the loop, as `stage-key/activity-key` ids. */
export interface DraftCycle {
  /** Index into the links given. */
  readonly index: number;
  readonly chain: readonly string[];
}

/**
 * The first link, in order, that would close a loop with the links before it, and the loop it
 * closes, or `null` when the links hold none. Judged by the schedule's graph with stage endpoints
 * expanded, exactly as the host judges each link it inserts: an activity made to wait on its own
 * stage waits on itself.
 */
export function draftCycle(shape: DraftShape, links: readonly DraftLink[]): DraftCycle | null {
  const plan: WorkSnapshot = {
    work: {
      workId: 'draft',
      name: 'draft',
      place: '',
      startDate: '2000-01-03',
      currency: 'XXX',
      createdAt: '2000-01-01T00:00:00.000Z',
      approvedAt: null,
      templateId: null,
      templateVersion: null,
      templateTitle: null,
    },
    calendar: { workingDays: '1111100', hoursPerDay: 8 },
    holidays: [],
    people: [],
    rooms: [],
    stages: shape.stages.map((stage, position) => ({
      id: stage.key,
      position,
      name: stage.key,
      startedAt: null,
      closedAt: null,
    })),
    activities: shape.stages.flatMap((stage) =>
      stage.activities.map((activity, position) => ({
        id: activityId(stage.key, activity.key),
        stageId: stage.key,
        position,
        name: activity.key,
        durationDays: null,
        durationMinDays: null,
        durationMaxDays: null,
        responsibleId: null,
        roomIds: [],
        quantity: null,
        unit: null,
      })),
    ),
    dependencies: [],
    baselines: [],
    replanning: null,
    decisions: [],
    checks: [],
    checkAnswers: [],
    careNotes: [],
    costLines: [],
    commitments: [],
    payments: [],
    documents: [],
    changeOrders: [],
    funding: [],
    fundingReceipts: [],
    snags: [],
  };

  let current = plan;
  for (const [index, link] of links.entries()) {
    const blocker = endpointOf(link.blocker);
    const blocked = endpointOf(link.blocked);
    const chain = cycleIfAdded(current, blocker, blocked);
    if (chain !== null) return { index, chain };
    current = {
      ...current,
      dependencies: [
        ...current.dependencies,
        { id: `link-${index}`, blocker, blocked, lagDays: link.lagDays },
      ],
    };
  }
  return null;
}
