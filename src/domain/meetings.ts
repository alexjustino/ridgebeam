/**
 * The weekly site meeting that writes itself (slice G1, decision 2): the agenda read off the record,
 * the actions still open, and the checks a meeting's minutes pass before the host is asked to write
 * them.
 *
 * **The agenda is the record's, not the meeting's.** Every section is built from what the product
 * already computes — nothing here recomputes a rule another module owns:
 *
 * 1. **actions** still open from previous meetings (`openActions`), oldest first, overdue marked;
 * 2. **decisions** overdue or due within 14 days — the lookahead's rows, which are
 *    `decisionsDueWithin(…, WEEKLY_DECISION_WINDOW_DAYS)` (E3's one rule), most urgent first, so
 *    overdue first;
 * 3. **change orders** waiting for their decision (`changeOrderRows`, pending), with how long they
 *    waited; one waiting longer than readiness allows (`waitsTooLong`) is marked overdue;
 * 4. **snags** still open (`snagRows`), overdue first (most days past first), then by number;
 * 5. **money**: what is earned and not paid now and what falls due in the window (the lookahead's
 *    payments), then the retentions held by open snags (the runway's `held`);
 * 6. **why it is late**: one item, only while the delay ledger says the work is late — its total and
 *    its top causes (`delayLedger`);
 * 7. **the next two weeks**: what starts (the lookahead's `starting`) and who must be there (its
 *    `people`);
 * 8. **gates** coming up in the window (the lookahead's `gates`).
 *
 * Empty sections are left out; an agenda with nothing in it says so (`empty`, with its key). What
 * nobody wrote down is not on it.
 *
 * **New since the last meeting.** `since` is the last meeting's day. An item is new when the record
 * dates its appearance after that day (a change order or a snag raised later; an action raised at a
 * later meeting) or, for what the record does not date (a decision coming due, a payment, the delay,
 * the lookahead, a gate), when the last meeting's minutes have no item of the same kind about it.
 * Before the first meeting nothing is marked new: there is nothing to compare with.
 *
 * Today is an input; the domain never reads the clock. What this module is not: storage, or text.
 * It returns rows, codes and message keys.
 */

import { isIsoDay, calendarDaysBetween } from './calendar';
import { changeOrderRows, waitsTooLong, type ChangeAskedBy } from './changes';
import { delayLedger, DELAY_CAUSE_KEYS, type DelayCause } from './delay';
import type { DiaryEntry } from './diary';
import { counted, type Figure, type ReportRow } from './figure';
import type { MilestoneTrigger } from './milestones';
import {
  compareText,
  type Gate,
  type Meeting,
  type MeetingAction,
  type MeetingActionOutcome,
  type MeetingItemKind,
  type WorkSnapshot,
} from './plan';
import { LOOKAHEAD_GATE_KEYS, lookahead } from './reports/lookahead';
import { runway } from './runway';
import type { Schedule } from './schedule';
import { snagRows } from './snags';

export type {
  Meeting,
  MeetingAction,
  MeetingActionClosure,
  MeetingActionOutcome,
  MeetingAttendee,
  MeetingItem,
  MeetingItemKind,
} from './plan';

// ── Limits and words ─────────────────────────────────────────────────────────

/** What the host accepts, in characters (code points, as the host counts them). */
export const MEETING_LIMITS = {
  notes: 4_000,
  /** A name typed for somebody who is not a person of the plan: an attendee, or an action's who. */
  name: 120,
  itemTitle: 200,
  itemNote: 2_000,
  itemOutcome: 200,
  actionText: 200,
  closureNote: 500,
} as const;

/** The kinds of a minutes item, in the order the agenda lists its sections, `other` last. */
export const MEETING_ITEM_KINDS = [
  'action-carried',
  'decision',
  'change',
  'snag',
  'payment',
  'delay',
  'lookahead',
  'gate',
  'other',
] as const satisfies readonly MeetingItemKind[];

export const MEETING_ACTION_OUTCOMES = [
  'done',
  'dropped',
] as const satisfies readonly MeetingActionOutcome[];

/** The agenda's sections, in the order they are listed. */
export const AGENDA_SECTIONS = [
  'actions',
  'decisions',
  'changes',
  'snags',
  'money',
  'delay',
  'lookahead',
  'gates',
] as const;
export type AgendaSectionId = (typeof AGENDA_SECTIONS)[number];

/** The minutes kind of each section's items: one section, one kind. */
export const AGENDA_SECTION_KINDS = {
  actions: 'action-carried',
  decisions: 'decision',
  changes: 'change',
  snags: 'snag',
  money: 'payment',
  delay: 'delay',
  lookahead: 'lookahead',
  gates: 'gate',
} as const satisfies Record<AgendaSectionId, Exclude<MeetingItemKind, 'other'>>;

/** Each section's heading: "Actions still open", "Decisions due" … */
export const AGENDA_SECTION_KEYS = {
  actions: 'meetings.agenda.section.actions',
  decisions: 'meetings.agenda.section.decisions',
  changes: 'meetings.agenda.section.changes',
  snags: 'meetings.agenda.section.snags',
  money: 'meetings.agenda.section.money',
  delay: 'meetings.agenda.section.delay',
  lookahead: 'meetings.agenda.section.lookahead',
  gates: 'meetings.agenda.section.gates',
} as const satisfies Record<AgendaSectionId, string>;

/** What a minutes item is about, said in the minutes: "Action carried", "Decision" … */
export const MEETING_ITEM_KIND_KEYS = {
  'action-carried': 'meetings.item.kind.actionCarried',
  decision: 'meetings.item.kind.decision',
  change: 'meetings.item.kind.change',
  snag: 'meetings.item.kind.snag',
  payment: 'meetings.item.kind.payment',
  delay: 'meetings.item.kind.delay',
  lookahead: 'meetings.item.kind.lookahead',
  gate: 'meetings.item.kind.gate',
  other: 'meetings.item.kind.other',
} as const satisfies Record<MeetingItemKind, string>;

/** How an action was closed: "Done", "Dropped"; and an action still open. */
export const MEETING_ACTION_STATE_KEYS = {
  open: 'meetings.action.state.open',
  done: 'meetings.action.state.done',
  dropped: 'meetings.action.state.dropped',
} as const satisfies Record<'open' | MeetingActionOutcome, string>;

/** The kinds of agenda item, by what the detail says. */
export type AgendaDetailType =
  | 'action'
  | 'decision'
  | 'change'
  | 'snag'
  | 'due-now'
  | 'falling-due'
  | 'held'
  | 'delay'
  | 'starting'
  | 'person'
  | 'gate';

/**
 * The sentence each agenda item's detail is said with, its params the detail's fields. A gate is
 * said with the lookahead's own sentence (`LOOKAHEAD_GATE_KEYS`), and a delay's causes with the
 * ledger's (`DELAY_CAUSE_KEYS`).
 */
export const AGENDA_ITEM_KEYS = {
  action: 'meetings.agenda.item.action',
  decision: 'meetings.agenda.item.decision',
  change: 'meetings.agenda.item.change',
  snag: 'meetings.agenda.item.snag',
  'due-now': 'meetings.agenda.item.dueNow',
  'falling-due': 'meetings.agenda.item.fallingDue',
  held: 'meetings.agenda.item.held',
  delay: 'meetings.agenda.item.delay',
  starting: 'meetings.agenda.item.starting',
  person: 'meetings.agenda.item.person',
} as const satisfies Record<Exclude<AgendaDetailType, 'gate'>, string>;

/**
 * The agenda's own words: `empty` — "Nothing on the record for this meeting"; `newSince` — the mark
 * "New since the last meeting"; `overdue` — the mark "Overdue"; `noSchedule` — "Nothing is
 * scheduled yet, so the next two weeks say nothing".
 */
export const MEETING_AGENDA_KEYS = {
  empty: 'meetings.agenda.empty',
  newSince: 'meetings.agenda.newSince',
  overdue: 'meetings.agenda.overdue',
  noSchedule: 'meetings.agenda.noSchedule',
} as const;

/**
 * The figures' names: "Actions open", "Actions overdue"; a person's open actions (`onPerson`, the
 * name given by the group) and the actions on nobody (`nobody`).
 */
export const MEETING_LABEL_KEYS = {
  open: 'meetings.figure.open',
  overdue: 'meetings.figure.overdue',
  onPerson: 'meetings.figure.onPerson',
  nobody: 'meetings.figure.nobody',
} as const;

/** Why a meeting's minutes, or an action's closure, is refused before the host is asked. */
export const MEETING_PROBLEM_KEYS = {
  'invalid-held-on': 'meetings.problem.invalidHeldOn',
  'held-in-future': 'meetings.problem.heldInFuture',
  'notes-too-long': 'meetings.problem.notesTooLong',
  'attendee-none': 'meetings.problem.attendeeNone',
  'attendee-both': 'meetings.problem.attendeeBoth',
  'attendee-unknown-person': 'meetings.problem.attendeeUnknownPerson',
  'attendee-name-empty': 'meetings.problem.attendeeNameEmpty',
  'attendee-name-too-long': 'meetings.problem.attendeeNameTooLong',
  'attendee-duplicate': 'meetings.problem.attendeeDuplicate',
  'item-invalid-kind': 'meetings.problem.itemInvalidKind',
  'item-title-empty': 'meetings.problem.itemTitleEmpty',
  'item-title-too-long': 'meetings.problem.itemTitleTooLong',
  'item-note-too-long': 'meetings.problem.itemNoteTooLong',
  'item-outcome-too-long': 'meetings.problem.itemOutcomeTooLong',
  'action-text-empty': 'meetings.problem.actionTextEmpty',
  'action-text-too-long': 'meetings.problem.actionTextTooLong',
  'action-both': 'meetings.problem.actionBoth',
  'action-unknown-person': 'meetings.problem.actionUnknownPerson',
  'action-name-empty': 'meetings.problem.actionNameEmpty',
  'action-name-too-long': 'meetings.problem.actionNameTooLong',
  'action-invalid-due-on': 'meetings.problem.actionInvalidDueOn',
  'action-due-before-held': 'meetings.problem.actionDueBeforeHeld',
  'closure-unknown-action': 'meetings.problem.closureUnknownAction',
  'closure-already-closed': 'meetings.problem.closureAlreadyClosed',
  'closure-duplicate': 'meetings.problem.closureDuplicate',
  'closure-invalid-outcome': 'meetings.problem.closureInvalidOutcome',
  'closure-invalid-closed-on': 'meetings.problem.closureInvalidClosedOn',
  'closure-in-future': 'meetings.problem.closureInFuture',
  'closure-before-raised': 'meetings.problem.closureBeforeRaised',
  'closure-note-too-long': 'meetings.problem.closureNoteTooLong',
} as const;

export type MeetingProblemCode = keyof typeof MEETING_PROBLEM_KEYS;

/** Which part of the draft a problem is about. */
export type MeetingProblemPart = 'meeting' | 'attendee' | 'item' | 'action' | 'closure';

/** A refusal, with the key the interface says it with, and where it is in the draft. */
export interface MeetingProblem {
  readonly code: MeetingProblemCode;
  readonly messageKey: (typeof MEETING_PROBLEM_KEYS)[MeetingProblemCode];
  readonly part: MeetingProblemPart;
  /** The index in the draft's list of that part; `null` for the meeting itself, or one closure. */
  readonly index: number | null;
}

/** Every message key this module adds, for the dictionaries' completeness test. */
export const MEETING_MESSAGE_KEYS: readonly string[] = [
  ...Object.values(AGENDA_SECTION_KEYS),
  ...Object.values(MEETING_ITEM_KIND_KEYS),
  ...Object.values(MEETING_ACTION_STATE_KEYS),
  ...Object.values(AGENDA_ITEM_KEYS),
  ...Object.values(MEETING_AGENDA_KEYS),
  ...Object.values(MEETING_LABEL_KEYS),
  ...Object.values(MEETING_PROBLEM_KEYS),
];

/** How many causes the agenda's delay item names, the largest first. */
export const AGENDA_DELAY_CAUSES = 3;

// ── The record, read ─────────────────────────────────────────────────────────

/** The meetings by number (the order they were held in), then by id. */
export function meetingsInOrder(snapshot: WorkSnapshot): Meeting[] {
  return [...snapshot.meetings].sort((a, b) => a.number - b.number || compareText(a.id, b.id));
}

/** The last meeting held (the highest number), or `null` before the first. */
export function lastMeeting(snapshot: WorkSnapshot): Meeting | null {
  return meetingsInOrder(snapshot).at(-1) ?? null;
}

/** The number the next meeting's minutes take: one more than the last, 1 for the first. */
export function nextMeetingNumber(snapshot: WorkSnapshot): number {
  return snapshot.meetings.reduce((most, meeting) => Math.max(most, meeting.number), 0) + 1;
}

/**
 * Who someone on the record is, by name: the person of the plan, or the name typed; `null` for
 * nobody, and for a person no longer in the plan (the row keeps the id).
 */
export function whoOf(
  snapshot: WorkSnapshot,
  personId: string | null,
  name: string | null,
): string | null {
  if (personId !== null) return snapshot.people.find((each) => each.id === personId)?.name ?? null;
  return name;
}

/** An action still open, as the agenda, the Dashboard and the minutes read it. */
export interface OpenActionRow extends ReportRow {
  readonly actionId: string;
  /** The meeting that raised it. */
  readonly meetingId: string;
  readonly meetingNumber: number;
  /** The day it was raised: its meeting's day. */
  readonly raisedOn: string;
  readonly text: string;
  readonly personId: string | null;
  readonly name: string | null;
  /** `whoOf` the action: the person's name, or the name typed; `null` for nobody. */
  readonly who: string | null;
  readonly dueOn: string | null;
  /** Open, with a due day before today. */
  readonly overdue: boolean;
  /** Calendar days past its due day, from 1, while overdue; `null` otherwise. */
  readonly overdueDays: number | null;
}

/**
 * Every action still open (no closure), oldest first: by the meeting that raised it, then by its
 * position there. A `today` that is not a day marks nothing overdue. Never throws.
 */
export function openActions(snapshot: WorkSnapshot, today: string): OpenActionRow[] {
  const todayKnown = isIsoDay(today);
  return meetingsInOrder(snapshot).flatMap((meeting) =>
    [...meeting.actions]
      .filter((action) => action.closure === null)
      .sort((a, b) => a.position - b.position || compareText(a.id, b.id))
      .map((action) => openRow(snapshot, meeting, action, today, todayKnown)),
  );
}

function openRow(
  snapshot: WorkSnapshot,
  meeting: Meeting,
  action: MeetingAction,
  today: string,
  todayKnown: boolean,
): OpenActionRow {
  const overdue =
    todayKnown && action.dueOn !== null && isIsoDay(action.dueOn) && action.dueOn < today;
  return {
    key: `action:${action.id}`,
    itemId: action.id,
    title: action.text,
    day: action.dueOn,
    minutes: 0,
    actionId: action.id,
    meetingId: meeting.id,
    meetingNumber: meeting.number,
    raisedOn: meeting.heldOn,
    text: action.text,
    personId: action.personId,
    name: action.name,
    who: whoOf(snapshot, action.personId, action.name),
    dueOn: action.dueOn,
    overdue,
    overdueDays: overdue ? calendarDaysBetween(action.dueOn!, today) : null,
  };
}

// ── The summary: the Dashboard's card and the owner's snapshot ───────────────

/** One person's open actions: a person of the plan, somebody named, or nobody. */
export interface ActionPersonGroup {
  /** `person:<id>`, `name:<name>`, or `nobody`. */
  readonly key: string;
  readonly personId: string | null;
  /** The person's name in the plan, or the name typed; `null` for nobody and a person removed. */
  readonly name: string | null;
  readonly open: Figure<OpenActionRow>;
  readonly overdue: Figure<OpenActionRow>;
}

export interface MeetingSummary {
  /** Meetings held: 0 means the card offers the first. */
  readonly held: number;
  /** The last meeting held; `null` before the first. */
  readonly last: {
    readonly meetingId: string;
    readonly number: number;
    readonly heldOn: string;
    readonly attendees: number;
    /** Actions it raised, whatever became of them. */
    readonly actions: number;
  } | null;
  /** "Actions open": every open action, oldest first. */
  readonly open: Figure<OpenActionRow>;
  /** "Actions overdue": the open ones past their day, the most days past first. */
  readonly overdue: Figure<OpenActionRow>;
  /**
   * The open actions by who: the people of the plan by name, then people no longer in the plan,
   * then the names typed, then nobody. Only groups with something open; together, exactly the
   * open rows.
   */
  readonly byPerson: readonly ActionPersonGroup[];
}

/** What the meetings left open and on whom, as of `today`. Never throws. */
export function meetingSummary(snapshot: WorkSnapshot, today: string): MeetingSummary {
  const last = lastMeeting(snapshot);
  const open = openActions(snapshot, today);
  const overdue = open
    .filter((row) => row.overdue)
    .sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0));

  const people = new Map(snapshot.people.map((person) => [person.id, person.name]));
  const scopeOf = (row: OpenActionRow): string =>
    row.personId !== null
      ? `person:${row.personId}`
      : row.name !== null
        ? `name:${row.name}`
        : 'nobody';
  const rank = (row: OpenActionRow): [number, string, string] => {
    if (row.personId !== null) {
      const name = people.get(row.personId);
      return name === undefined ? [1, '', row.personId] : [0, name, row.personId];
    }
    return row.name !== null ? [2, row.name, ''] : [3, '', ''];
  };
  const firsts = new Map<string, OpenActionRow>();
  for (const row of open) if (!firsts.has(scopeOf(row))) firsts.set(scopeOf(row), row);
  const scopes = [...firsts.entries()].sort(([, a], [, b]) => {
    const [ra, na, ia] = rank(a);
    const [rb, nb, ib] = rank(b);
    return ra - rb || compareText(na, nb) || compareText(ia, ib);
  });
  const byPerson: ActionPersonGroup[] = scopes.map(([scope, first]) => {
    const own = open.filter((row) => scopeOf(row) === scope);
    return {
      key: scope,
      personId: first.personId,
      name: first.who,
      open: counted(
        `meetings:open:${scope}`,
        scope === 'nobody' ? MEETING_LABEL_KEYS.nobody : MEETING_LABEL_KEYS.onPerson,
        own,
      ),
      overdue: counted(
        `meetings:overdue:${scope}`,
        MEETING_LABEL_KEYS.overdue,
        own.filter((row) => row.overdue),
      ),
    };
  });

  return {
    held: snapshot.meetings.length,
    last:
      last === null
        ? null
        : {
            meetingId: last.id,
            number: last.number,
            heldOn: last.heldOn,
            attendees: last.attendees.length,
            actions: last.actions.length,
          },
    open: counted('meetings:open', MEETING_LABEL_KEYS.open, open),
    overdue: counted('meetings:overdue', MEETING_LABEL_KEYS.overdue, overdue),
    byPerson,
  };
}

// ── The agenda ───────────────────────────────────────────────────────────────

/** What an agenda item says beyond its title, as data: the interface words it. */
export type AgendaDetail =
  | {
      readonly type: 'action';
      readonly meetingId: string;
      readonly meetingNumber: number;
      readonly raisedOn: string;
      readonly personId: string | null;
      readonly who: string | null;
      readonly overdueDays: number | null;
    }
  | {
      readonly type: 'decision';
      readonly stageId: string;
      readonly stageName: string;
      readonly leadTimeDays: number;
      /** The first day its stage is scheduled to start. */
      readonly neededBy: string;
      /** Working days to its deadline, signed (negative once overdue). */
      readonly daysLeft: number;
    }
  | {
      readonly type: 'change';
      readonly number: number;
      readonly stageId: string;
      readonly stageName: string | null;
      readonly askedBy: ChangeAskedBy;
      readonly raisedOn: string;
      /** Calendar days it has waited for its decision; `null` when it cannot be counted. */
      readonly waitedDays: number | null;
    }
  | {
      readonly type: 'snag';
      readonly number: number;
      readonly stageId: string;
      readonly stageName: string | null;
      readonly personId: string | null;
      readonly personName: string | null;
      readonly raisedOn: string;
      readonly overdueDays: number | null;
      readonly waitedDays: number | null;
    }
  | {
      /** Earned and not paid now (D2's "due now"), a commitment. */
      readonly type: 'due-now';
      readonly commitmentId: string;
      readonly stageId: string;
      readonly personId: string | null;
      readonly amountCents: number;
    }
  | {
      /** A milestone the schedule expects to be earned in the window. */
      readonly type: 'falling-due';
      readonly commitmentId: string;
      readonly commitmentLabel: string;
      readonly stageId: string;
      readonly personId: string | null;
      readonly trigger: MilestoneTrigger;
      /** What falls due, net of money paid ahead. */
      readonly amountCents: number;
      readonly coveredCents: number;
    }
  | {
      /** A retention held by open snags (E4): money the owner is holding. */
      readonly type: 'held';
      readonly commitmentId: string | null;
      readonly stageId: string | null;
      readonly amountCents: number;
      readonly openSnags: number;
    }
  | {
      readonly type: 'delay';
      /** Working days the forecast finishes after the baseline: the ledger's total. */
      readonly totalDays: number;
      readonly baselineNumber: number | null;
      /** The largest causes, at most `AGENDA_DELAY_CAUSES`, the most days first. */
      readonly causes: ReadonlyArray<{
        readonly cause: DelayCause;
        readonly messageKey: (typeof DELAY_CAUSE_KEYS)[DelayCause];
        readonly days: number;
      }>;
      /** Days the record does not explain. */
      readonly unexplainedDays: number;
    }
  | {
      readonly type: 'starting';
      readonly stageId: string;
      readonly stageName: string;
      readonly start: string;
      readonly finish: string;
      readonly responsibleId: string | null;
      readonly responsibleName: string | null;
      readonly critical: boolean;
    }
  | {
      /** Who must be there: a person answering for work in the window, or put on a running stage. */
      readonly type: 'person';
      readonly personId: string;
      readonly trade: string | null;
      readonly activityIds: readonly string[];
      readonly stageIds: readonly string[];
    }
  | {
      readonly type: 'gate';
      readonly stageId: string;
      readonly gate: Gate;
      readonly passed: boolean;
      readonly checks: number;
      /** How many items hold it. */
      readonly holding: number;
    };

/** One item of the agenda. `itemId` is `refId`; `day` is `due`. */
export interface AgendaItem extends ReportRow {
  readonly section: AgendaSectionId;
  /** The kind its minutes item takes. */
  readonly kind: Exclude<MeetingItemKind, 'other'>;
  /**
   * What it is about, the minutes item's `refId`: the action, decision, change order or snag; the
   * commitment (due now) or milestone (falling due, held); the activity or person (the next two
   * weeks); `<stageId>:<gate>` for a gate; `null` for the delay.
   */
  readonly refId: string | null;
  /** The day it is due, or comes up; `null` when it has none. */
  readonly due: string | null;
  readonly overdue: boolean;
  readonly newSinceLastMeeting: boolean;
  /** The sentence its detail is said with. */
  readonly messageKey: string;
  readonly detail: AgendaDetail;
}

export interface AgendaSection {
  readonly id: AgendaSectionId;
  /** The kind every item of the section takes in the minutes (`AGENDA_SECTION_KINDS`). */
  readonly kind: AgendaItem['kind'];
  readonly labelKey: (typeof AGENDA_SECTION_KEYS)[AgendaSectionId];
  /** Never empty: an empty section is left out of the agenda. */
  readonly items: readonly AgendaItem[];
}

export interface Agenda {
  readonly today: string;
  /** The last meeting's day; `null` before the first meeting. */
  readonly since: string | null;
  /** The last meeting's id and number; `null` before the first. */
  readonly lastMeeting: { readonly meetingId: string; readonly number: number } | null;
  /** The number this meeting's minutes will take. */
  readonly number: number;
  /** The sections with something in them, in `AGENDA_SECTIONS` order. */
  readonly sections: readonly AgendaSection[];
  /** Nothing on the record for this meeting. */
  readonly empty: boolean;
  /** `MEETING_AGENDA_KEYS.empty` when `empty`; `null` otherwise. */
  readonly messageKey: string | null;
  /** The schedule placed something; without it the schedule's sections say nothing. */
  readonly placed: boolean;
}

type ItemParts = Pick<AgendaItem, 'title' | 'refId' | 'due' | 'overdue' | 'detail'>;

/**
 * This week's meeting's agenda as of `today`, from the plan, its schedule (`schedule()` of the same
 * snapshot) and every diary entry.
 *
 * `today` must be a `YYYY-MM-DD` day: anything else is a programming error, and throws a
 * `RangeError`, as the lookahead and the runway do.
 */
export function meetingAgenda(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  entries: readonly DiaryEntry[],
  today: string,
): Agenda {
  if (!isIsoDay(today)) throw new RangeError(`Not a YYYY-MM-DD day: ${JSON.stringify(today)}`);
  const last = lastMeeting(snapshot);
  const since = last?.heldOn ?? null;
  const discussed = new Set((last?.items ?? []).map((item) => `${item.kind}|${item.refId ?? ''}`));

  /** New when the record dates it after the last meeting's day. */
  const datedNew = (day: string): boolean => since !== null && day > since;
  /** New when the last meeting's minutes have no item of the kind about it. */
  const undatedNew = (kind: MeetingItemKind, refId: string | null): boolean =>
    since !== null && !discussed.has(`${kind}|${refId ?? ''}`);

  const item = (
    section: AgendaSectionId,
    kind: AgendaItem['kind'],
    parts: ItemParts,
    isNew: boolean,
  ): AgendaItem => ({
    key: `${section}:${parts.detail.type}:${parts.refId ?? ''}`,
    itemId: parts.refId,
    title: parts.title,
    day: parts.due,
    minutes: 0,
    section,
    kind,
    refId: parts.refId,
    due: parts.due,
    overdue: parts.overdue,
    newSinceLastMeeting: isNew,
    messageKey:
      parts.detail.type === 'gate'
        ? LOOKAHEAD_GATE_KEYS[parts.detail.gate]
        : AGENDA_ITEM_KEYS[parts.detail.type],
    detail: parts.detail,
  });

  const ahead = lookahead(snapshot, scheduled, entries, today);

  // 1. Actions still open, oldest first.
  const actions = openActions(snapshot, today).map((row) =>
    item(
      'actions',
      'action-carried',
      {
        title: row.text,
        refId: row.actionId,
        due: row.dueOn,
        overdue: row.overdue,
        detail: {
          type: 'action',
          meetingId: row.meetingId,
          meetingNumber: row.meetingNumber,
          raisedOn: row.raisedOn,
          personId: row.personId,
          who: row.who,
          overdueDays: row.overdueDays,
        },
      },
      datedNew(row.raisedOn),
    ),
  );

  // 2. Decisions overdue or due within 14 days: the lookahead's, most urgent first.
  const decisions = ahead.decisions.rows.map((row) =>
    item(
      'decisions',
      'decision',
      {
        title: row.title,
        refId: row.decisionId,
        due: row.deadline,
        overdue: row.status === 'overdue',
        detail: {
          type: 'decision',
          stageId: row.stageId,
          stageName: row.stageName,
          leadTimeDays: row.leadTimeDays,
          neededBy: row.neededBy,
          daysLeft: row.daysLeft,
        },
      },
      undatedNew('decision', row.decisionId),
    ),
  );

  // 3. Change orders waiting for their decision, by number.
  const changes = changeOrderRows(snapshot, today)
    .filter((row) => row.state === 'pending')
    .map((row) =>
      item(
        'changes',
        'change',
        {
          title: row.title,
          refId: row.changeOrderId,
          due: null,
          overdue: waitsTooLong(row),
          detail: {
            type: 'change',
            number: row.number,
            stageId: row.stageId,
            stageName: row.stageName,
            askedBy: row.askedBy,
            raisedOn: row.raisedOn,
            waitedDays: row.waitedDays,
          },
        },
        datedNew(row.raisedOn),
      ),
    );

  // 4. Snags still open: overdue first (most days past first), then by number.
  const snags = snagRows(snapshot, today)
    .filter((row) => row.state === 'open')
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        Number(b.row.overdue) - Number(a.row.overdue) ||
        (b.row.overdueDays ?? 0) - (a.row.overdueDays ?? 0) ||
        a.index - b.index,
    )
    .map(({ row }) =>
      item(
        'snags',
        'snag',
        {
          title: row.title,
          refId: row.snagId,
          due: row.dueOn,
          overdue: row.overdue,
          detail: {
            type: 'snag',
            number: row.number,
            stageId: row.stageId,
            stageName: row.stageName,
            personId: row.personId,
            personName: row.personName,
            raisedOn: row.raisedOn,
            overdueDays: row.overdueDays,
            waitedDays: row.waitedDays,
          },
        },
        datedNew(row.raisedOn),
      ),
    );

  // 5. Money: earned and not paid now, falling due in the window, and held back as retention.
  const dueNow = ahead.payments.dueNow.rows.map((row) =>
    item(
      'money',
      'payment',
      {
        title: row.title,
        refId: row.commitmentId,
        due: today,
        overdue: false,
        detail: {
          type: 'due-now',
          commitmentId: row.commitmentId,
          stageId: row.stageId,
          personId: row.personId,
          amountCents: row.amountCents,
        },
      },
      undatedNew('payment', row.commitmentId),
    ),
  );
  const fallingDue = ahead.payments.fallingDue.rows.map((row) =>
    item(
      'money',
      'payment',
      {
        title: row.title,
        refId: row.milestoneId,
        due: row.day,
        overdue: false,
        detail: {
          type: 'falling-due',
          commitmentId: row.commitmentId,
          commitmentLabel: row.commitmentLabel,
          stageId: row.stageId,
          personId: row.personId,
          trigger: row.trigger,
          amountCents: row.amountCents,
          coveredCents: row.coveredCents,
        },
      },
      undatedNew('payment', row.milestoneId),
    ),
  );
  const held = runway(snapshot, scheduled, entries, today).held.map((row) =>
    item(
      'money',
      'payment',
      {
        title: row.title,
        refId: row.sourceId,
        due: null,
        overdue: false,
        detail: {
          type: 'held',
          commitmentId: row.commitmentId,
          stageId: row.stageId,
          amountCents: row.amountCents,
          openSnags: row.openSnags,
        },
      },
      undatedNew('payment', row.sourceId),
    ),
  );
  const money = [...dueNow, ...fallingDue, ...held];

  // 6. Why it is late: one item, only while the work is late.
  const delay: AgendaItem[] = [];
  const ledger = delayLedger(snapshot, scheduled, entries, today);
  if (ledger.status === 'late' && ledger.total !== null && ledger.figures !== null) {
    const causes = ledger.figures.byCause.rows
      .flatMap((row) =>
        row.cause === 'unexplained' || row.cause === 'made-up' || row.days <= 0
          ? []
          : [{ cause: row.cause, messageKey: DELAY_CAUSE_KEYS[row.cause], days: row.days }],
      )
      .map((each, index) => ({ each, index }))
      .sort((a, b) => b.each.days - a.each.days || a.index - b.index)
      .slice(0, AGENDA_DELAY_CAUSES)
      .map(({ each }) => each);
    delay.push(
      item(
        'delay',
        'delay',
        {
          title: '',
          refId: null,
          due: null,
          overdue: false,
          detail: {
            type: 'delay',
            totalDays: ledger.total,
            baselineNumber: ledger.baselineNumber,
            causes,
            unexplainedDays: ledger.unexplainedDays,
          },
        },
        undatedNew('delay', null),
      ),
    );
  }

  // 7. The next two weeks: what starts, and who must be there.
  const starting = ahead.starting.rows.map((row) =>
    item(
      'lookahead',
      'lookahead',
      {
        title: row.title,
        refId: row.activityId,
        due: row.start,
        overdue: false,
        detail: {
          type: 'starting',
          stageId: row.stageId,
          stageName: row.stageName,
          start: row.start,
          finish: row.finish,
          responsibleId: row.responsibleId,
          responsibleName: row.responsibleName,
          critical: row.critical,
        },
      },
      undatedNew('lookahead', row.activityId),
    ),
  );
  const people = ahead.people.rows.map((row) =>
    item(
      'lookahead',
      'lookahead',
      {
        title: row.title,
        refId: row.personId,
        due: null,
        overdue: false,
        detail: {
          type: 'person',
          personId: row.personId,
          trade: row.trade,
          activityIds: row.activityIds,
          stageIds: row.stageIds,
        },
      },
      undatedNew('lookahead', row.personId),
    ),
  );

  // 8. Gates coming up in the window, by day.
  const gates = ahead.gates.rows.map((row) => {
    const refId = `${row.stageId}:${row.gate}`;
    return item(
      'gates',
      'gate',
      {
        title: row.title,
        refId,
        due: row.day,
        overdue: false,
        detail: {
          type: 'gate',
          stageId: row.stageId,
          gate: row.gate,
          passed: row.passed,
          checks: row.checks,
          holding: row.holding.length,
        },
      },
      undatedNew('gate', refId),
    );
  });

  const lists: Record<AgendaSectionId, AgendaItem[]> = {
    actions,
    decisions,
    changes,
    snags,
    money,
    delay,
    lookahead: [...starting, ...people],
    gates,
  };
  const sections: AgendaSection[] = AGENDA_SECTIONS.flatMap((id) =>
    lists[id].length === 0
      ? []
      : [
          {
            id,
            kind: AGENDA_SECTION_KINDS[id],
            labelKey: AGENDA_SECTION_KEYS[id],
            items: lists[id],
          },
        ],
  );
  const empty = sections.length === 0;
  return {
    today,
    since,
    lastMeeting: last === null ? null : { meetingId: last.id, number: last.number },
    number: nextMeetingNumber(snapshot),
    sections,
    empty,
    messageKey: empty ? MEETING_AGENDA_KEYS.empty : null,
    placed: ahead.placed,
  };
}

// ── Checking before the host is asked ────────────────────────────────────────

/** Who was there, as the interface asks the host to record it: exactly one of the two. */
export interface MinutesAttendeeDraft {
  readonly personId: string | null;
  readonly name: string | null;
}

/** One item of the minutes: the agenda's title, what was said, what was done. */
export interface MinutesItemDraft {
  readonly kind: MeetingItemKind;
  readonly refId: string | null;
  readonly title: string;
  readonly note: string | null;
  readonly outcome: string | null;
}

/** An action raised at the meeting: what, who (a person, somebody named, or nobody), by when. */
export interface MinutesActionDraft {
  readonly text: string;
  readonly personId: string | null;
  readonly name: string | null;
  readonly dueOn: string | null;
}

/** An open action closed at the meeting: on the meeting's day. */
export interface MinutesClosureDraft {
  readonly actionId: string;
  readonly outcome: MeetingActionOutcome;
  readonly note: string | null;
}

/** The minutes as the interface asks the host to write them, at the close, in one go. */
export interface MinutesDraft {
  readonly heldOn: string;
  readonly notes: string | null;
  /** In order: each one's position is its index. */
  readonly attendees: readonly MinutesAttendeeDraft[];
  readonly items: readonly MinutesItemDraft[];
  readonly actions: readonly MinutesActionDraft[];
  readonly closures: readonly MinutesClosureDraft[];
}

/** An action closed between meetings. */
export interface ActionClosureDraft {
  readonly actionId: string;
  readonly outcome: MeetingActionOutcome;
  readonly closedOn: string;
  readonly note: string | null;
}

const length = (text: string): number => [...text].length;

function problem(
  code: MeetingProblemCode,
  part: MeetingProblemPart,
  index: number | null = null,
): MeetingProblem {
  return { code, messageKey: MEETING_PROBLEM_KEYS[code], part, index };
}

/** Every action on the record, with the meeting that raised it. */
function actionsById(
  snapshot: WorkSnapshot,
): Map<string, { action: MeetingAction; raisedOn: string }> {
  const found = new Map<string, { action: MeetingAction; raisedOn: string }>();
  for (const meeting of snapshot.meetings) {
    for (const action of meeting.actions)
      found.set(action.id, { action, raisedOn: meeting.heldOn });
  }
  return found;
}

/** A name typed for somebody: not blank, at most `MEETING_LIMITS.name`. */
function nameProblem(
  name: string,
  empty: MeetingProblemCode,
  tooLong: MeetingProblemCode,
): MeetingProblemCode | null {
  if (name.trim() === '') return empty;
  return length(name) > MEETING_LIMITS.name ? tooLong : null;
}

/**
 * Check a meeting's minutes before they are written: a day that is a day and not after today; notes
 * of at most 4 000 characters; each attendee a person of the plan or a name (1–120), exactly one,
 * nobody twice; each item of a known kind, a title of 1–200, what was said at most 2 000, what was
 * done at most 200; each action a text of 1–200, a who that is a person of the plan or a name or
 * nobody (never both), a due day that is a day and not before the meeting; each closure an open
 * action of the record, closed once, `done` or `dropped`, not before the meeting that raised it, a
 * note of at most 500. Every problem, in that order; `[]` when none. Never throws.
 */
export function validateMinutes(
  snapshot: WorkSnapshot,
  draft: MinutesDraft,
  today: string,
): MeetingProblem[] {
  const problems: MeetingProblem[] = [];
  const people = new Set(snapshot.people.map((person) => person.id));

  const heldKnown = isIsoDay(draft.heldOn);
  if (!heldKnown) problems.push(problem('invalid-held-on', 'meeting'));
  else if (isIsoDay(today) && draft.heldOn > today) {
    problems.push(problem('held-in-future', 'meeting'));
  }
  if (draft.notes !== null && length(draft.notes) > MEETING_LIMITS.notes) {
    problems.push(problem('notes-too-long', 'meeting'));
  }

  const seen = new Set<string>();
  draft.attendees.forEach((attendee, index) => {
    const at = (code: MeetingProblemCode) => problems.push(problem(code, 'attendee', index));
    if (attendee.personId === null && attendee.name === null) return at('attendee-none');
    if (attendee.personId !== null && attendee.name !== null) return at('attendee-both');
    let identity: string;
    if (attendee.personId !== null) {
      if (!people.has(attendee.personId)) return at('attendee-unknown-person');
      identity = `person:${attendee.personId}`;
    } else {
      const named = nameProblem(attendee.name!, 'attendee-name-empty', 'attendee-name-too-long');
      if (named !== null) return at(named);
      identity = `name:${attendee.name!.trim().toLowerCase()}`;
    }
    if (seen.has(identity)) return at('attendee-duplicate');
    seen.add(identity);
  });

  draft.items.forEach((each, index) => {
    const at = (code: MeetingProblemCode) => problems.push(problem(code, 'item', index));
    const kind: string = each.kind;
    if (!(MEETING_ITEM_KINDS as readonly string[]).includes(kind)) at('item-invalid-kind');
    if (each.title.trim() === '') at('item-title-empty');
    else if (length(each.title) > MEETING_LIMITS.itemTitle) at('item-title-too-long');
    if (each.note !== null && length(each.note) > MEETING_LIMITS.itemNote) at('item-note-too-long');
    if (each.outcome !== null && length(each.outcome) > MEETING_LIMITS.itemOutcome) {
      at('item-outcome-too-long');
    }
  });

  draft.actions.forEach((action, index) => {
    const at = (code: MeetingProblemCode) => problems.push(problem(code, 'action', index));
    if (action.text.trim() === '') at('action-text-empty');
    else if (length(action.text) > MEETING_LIMITS.actionText) at('action-text-too-long');
    if (action.personId !== null && action.name !== null) at('action-both');
    else if (action.personId !== null && !people.has(action.personId)) {
      at('action-unknown-person');
    } else if (action.name !== null) {
      const named = nameProblem(action.name, 'action-name-empty', 'action-name-too-long');
      if (named !== null) at(named);
    }
    if (action.dueOn !== null) {
      if (!isIsoDay(action.dueOn)) at('action-invalid-due-on');
      else if (heldKnown && action.dueOn < draft.heldOn) at('action-due-before-held');
    }
  });

  const actions = actionsById(snapshot);
  const closed = new Set<string>();
  draft.closures.forEach((closure, index) => {
    const at = (code: MeetingProblemCode) => problems.push(problem(code, 'closure', index));
    const known = actions.get(closure.actionId);
    if (known === undefined) return at('closure-unknown-action');
    if (closed.has(closure.actionId)) return at('closure-duplicate');
    closed.add(closure.actionId);
    if (known.action.closure !== null) at('closure-already-closed');
    const outcome: string = closure.outcome;
    if (!(MEETING_ACTION_OUTCOMES as readonly string[]).includes(outcome)) {
      at('closure-invalid-outcome');
    }
    if (heldKnown && isIsoDay(known.raisedOn) && draft.heldOn < known.raisedOn) {
      at('closure-before-raised');
    }
    if (closure.note !== null && length(closure.note) > MEETING_LIMITS.closureNote) {
      at('closure-note-too-long');
    }
  });

  return problems;
}

/**
 * Check an action's closure between meetings: an action of the record not closed already; `done` or
 * `dropped`; a day that is a day, not after today and not before the meeting that raised it; a note
 * of at most 500 characters. Every problem; `[]` when none. Never throws.
 */
export function validateActionClosure(
  snapshot: WorkSnapshot,
  draft: ActionClosureDraft,
  today: string,
): MeetingProblem[] {
  const known = actionsById(snapshot).get(draft.actionId);
  if (known === undefined) return [problem('closure-unknown-action', 'closure')];
  const problems: MeetingProblem[] = [];
  const at = (code: MeetingProblemCode) => problems.push(problem(code, 'closure'));
  if (known.action.closure !== null) at('closure-already-closed');
  const outcome: string = draft.outcome;
  if (!(MEETING_ACTION_OUTCOMES as readonly string[]).includes(outcome)) {
    at('closure-invalid-outcome');
  }
  if (!isIsoDay(draft.closedOn)) at('closure-invalid-closed-on');
  else {
    if (isIsoDay(today) && draft.closedOn > today) at('closure-in-future');
    if (isIsoDay(known.raisedOn) && draft.closedOn < known.raisedOn) at('closure-before-raised');
  }
  if (draft.note !== null && length(draft.note) > MEETING_LIMITS.closureNote) {
    at('closure-note-too-long');
  }
  return problems;
}
