import {
  MEETING_ITEM_KIND_KEYS,
  MEETING_LIMITS,
  type ActionPersonGroup,
  type AgendaItem,
  type MeetingProblem,
  type OpenActionRow,
} from '@/domain/meetings';
import type {
  Meeting,
  MeetingAction,
  MeetingAttendee,
  MeetingItemKind,
  WorkSnapshot,
} from '@/domain/plan';
import { waitedText } from '@/features/plan/changeWords';
import { decisionStatusText } from '@/features/reports/compose/words';
import type { MessageKey } from '@/i18n/en';
import type { TermKey } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

/**
 * The words of the weekly site meeting (slice G1), in one place, so the meeting screen, the
 * dashboard's card, the minutes PDF and the owner's snapshot say a meeting, an agenda item, an
 * attendee and an action the same way. Nothing here counts or decides: what is open, what is due and
 * what the agenda holds are the domain's (`meetings.ts`), and only said here.
 */

type Term = (key: TermKey, options?: { capital?: boolean }) => string;
type Words = Pick<I18n, 't' | 'tp' | 'day' | 'number' | 'money'>;

/** What a minutes item is about, in a word: "Decision", "Change order", "Raised in the meeting". */
export function kindText(i18n: Pick<I18n, 't'>, kind: MeetingItemKind): string {
  return i18n.t(MEETING_ITEM_KIND_KEYS[kind] as MessageKey);
}

/** "#2 — Oct 1, 2026": a meeting in a list. */
export function meetingLabel(i18n: Pick<I18n, 't' | 'day'>, meeting: Meeting): string {
  return i18n.t('meeting.label', { number: meeting.number, day: i18n.day(meeting.heldOn) });
}

/** A person's name by id, or the words that the person is no longer in the plan. */
function personName(i18n: Pick<I18n, 't'>, snapshot: WorkSnapshot, personId: string): string {
  return (
    snapshot.people.find((person) => person.id === personId)?.name ?? i18n.t('meeting.person.gone')
  );
}

/** Who was there, by name: the person of the plan, or the name somebody typed. */
export function attendeeName(
  i18n: Pick<I18n, 't'>,
  snapshot: WorkSnapshot,
  attendee: Pick<MeetingAttendee, 'personId' | 'name'>,
): string {
  if (attendee.personId !== null) return personName(i18n, snapshot, attendee.personId);
  return attendee.name ?? i18n.t('meeting.person.gone');
}

/** Who an action is on: a person of the plan, a name, or nobody named. */
export function actionWhoText(
  i18n: Pick<I18n, 't'>,
  snapshot: WorkSnapshot,
  action: Pick<MeetingAction, 'personId' | 'name'>,
): string {
  if (action.personId !== null) return personName(i18n, snapshot, action.personId);
  if (action.name !== null && action.name.trim() !== '') return action.name;
  return i18n.t('meeting.action.nobody');
}

/** Who an open action is on, from the domain's row: the name, gone, or nobody named. */
export function openActionWho(i18n: Pick<I18n, 't'>, row: OpenActionRow): string {
  if (row.who !== null) return row.who;
  return row.personId !== null ? i18n.t('meeting.person.gone') : i18n.t('meeting.action.nobody');
}

/** By when, from the domain's row: "by Oct 9, 2026", "overdue by 3 days — it was due on …". */
export function openActionDue(i18n: Pick<I18n, 't' | 'tp' | 'day'>, row: OpenActionRow): string {
  if (row.dueOn === null) return i18n.t('meeting.action.noDue');
  if (row.overdue && row.overdueDays !== null) {
    return i18n.tp('meeting.action.overdue', row.overdueDays, { day: i18n.day(row.dueOn) });
  }
  return i18n.t('meeting.action.byDay', { day: i18n.day(row.dueOn) });
}

/** An open action as one line: what — who — by when — from meeting #N. */
export function openActionText(i18n: Pick<I18n, 't' | 'tp' | 'day'>, row: OpenActionRow): string {
  return [
    row.text,
    openActionWho(i18n, row),
    openActionDue(i18n, row),
    i18n.t('meeting.action.from', { number: row.meetingNumber }),
  ].join(' — ');
}

/** A person's group of open actions, named: "On Sample tiler", "On nobody named". */
export function actionGroupLabel(i18n: Pick<I18n, 't'>, group: ActionPersonGroup): string {
  return i18n.t(group.open.label as MessageKey, {
    name: group.name ?? i18n.t('meeting.person.gone'),
  });
}

/** An agenda item's title: the record's words; the delay, which has none, by its section. */
export function agendaTitle(i18n: Pick<I18n, 't'>, item: AgendaItem): string {
  return item.title.trim() === '' ? kindText(i18n, item.kind) : item.title;
}

/** The days, in words: "3 working days". */
function workingDays(i18n: Pick<I18n, 'tp'>, days: number): string {
  return i18n.tp('plan.checklist.days', days);
}

/**
 * What an agenda item says beyond its title, in one sentence from the domain's detail and key:
 * "Kitchen — Overdue by 2 working days — needed on site by Oct 9", "Snag #3, Finishes — to fix:
 * nobody named — by Oct 12". The nouns are in the lens's words.
 */
export function agendaDetailText(
  i18n: Words,
  term: Term,
  snapshot: WorkSnapshot,
  item: AgendaItem,
): string {
  const { t, tp, day, money } = i18n;
  const currency = snapshot.work.currency;
  const detail = item.detail;
  const key = item.messageKey as MessageKey;
  switch (detail.type) {
    case 'action':
      return t(key, {
        number: detail.meetingNumber,
        day: day(detail.raisedOn),
        who:
          detail.who ??
          (detail.personId !== null ? t('meeting.person.gone') : t('meeting.action.nobody')),
      });
    case 'decision':
      return t(key, {
        stage: detail.stageName,
        status: decisionStatusText(i18n, {
          status: detail.daysLeft < 0 ? 'overdue' : 'due',
          daysLeft: detail.daysLeft,
          madeAt: null,
        }),
        day: day(detail.neededBy),
      });
    case 'change':
      // A wait the record cannot count is left out of the sentence, with its dash.
      return t(key, {
        changeOrder: term('changeOrder', { capital: true }),
        number: detail.number,
        stage: detail.stageName ?? t('snags.row.goneStage'),
        day: day(detail.raisedOn),
        waited: waitedText(i18n, detail.waitedDays, item.overdue) ?? '',
      }).replace(/ — $/, '');
    case 'snag':
      return t(key, {
        snag: term('snag', { capital: true }),
        number: detail.number,
        stage: detail.stageName ?? t('snags.row.goneStage'),
        who:
          detail.personName ??
          (detail.personId !== null ? t('meeting.person.gone') : t('meeting.action.nobody')),
        due:
          item.due === null
            ? t('meeting.action.noDue')
            : detail.overdueDays !== null && item.overdue
              ? tp('meeting.action.overdue', detail.overdueDays, { day: day(item.due) })
              : t('meeting.action.byDay', { day: day(item.due) }),
      });
    case 'purchase-to-order': {
      // The purchases' own words (G2): what needs it, its lead time, the day to order by.
      const stage = detail.stageName ?? t('snags.row.goneStage');
      const orderBy =
        detail.orderBy === null
          ? t('purchases.row.notScheduled')
          : t('purchases.row.orderBy', {
              orderBy: term('orderBy', { capital: true }),
              day: day(detail.orderBy),
            });
      return t(key, {
        neededFor:
          detail.neededActivityName === null
            ? t('purchases.row.neededForStage', { stage })
            : t('purchases.row.neededFor', { activity: detail.neededActivityName, stage }),
        lead: tp('purchases.row.lead', detail.leadDays, {
          leadTime: term('leadTime', { capital: true }),
        }),
        when:
          detail.lateToOrder && detail.daysLate !== null
            ? `${orderBy} — ${tp('purchases.row.daysLate', detail.daysLate)}`
            : orderBy,
      });
    }
    case 'purchase-ordered': {
      const stage = detail.stageName ?? t('snags.row.goneStage');
      const ordered =
        detail.orderedOn === null
          ? ''
          : t('purchases.row.ordered', {
              day: day(detail.orderedOn),
              expected: detail.expectedOn === null ? '—' : day(detail.expectedOn),
            });
      return t(key, {
        neededFor:
          detail.neededActivityName === null
            ? t('purchases.row.neededForStage', { stage })
            : t('purchases.row.neededFor', { activity: detail.neededActivityName, stage }),
        when: [
          ordered,
          detail.lateToArrive && detail.daysLate !== null
            ? tp('purchases.row.daysLate', detail.daysLate)
            : '',
          detail.arrivesAfterNeeded && detail.expectedOn !== null && detail.neededOn !== null
            ? tp('purchases.row.afterNeeded', detail.daysAfterNeeded ?? 1, {
                expected: day(detail.expectedOn),
                needed: day(detail.neededOn),
              })
            : '',
        ]
          .filter((part) => part !== '')
          .join(' — '),
      });
    }
    case 'due-now':
      return t(key, { amount: money(detail.amountCents, currency) });
    case 'falling-due':
      return t(key, {
        commitment: detail.commitmentLabel,
        amount: money(detail.amountCents, currency),
        day: item.due === null ? '' : day(item.due),
      });
    case 'held':
      return t(key, {
        amount: money(detail.amountCents, currency),
        snags: i18n.number(detail.openSnags),
      });
    case 'delay': {
      const causes = [
        ...detail.causes.map((cause) =>
          t('meeting.delay.cause', {
            cause: t(cause.messageKey as MessageKey),
            days: workingDays(i18n, cause.days),
          }),
        ),
        ...(detail.unexplainedDays > 0
          ? [t('meeting.delay.unexplained', { days: workingDays(i18n, detail.unexplainedDays) })]
          : []),
      ];
      return t(key, {
        days: workingDays(i18n, detail.totalDays),
        causes: causes.length === 0 ? t('meeting.delay.noCause') : causes.join('; '),
      });
    }
    case 'starting':
      return [
        t(key, {
          stage: detail.stageName,
          start: day(detail.start),
          finish: day(detail.finish),
          who:
            detail.responsibleName === null
              ? t('reports.snapshot.nobody', {
                  responsible: term('responsible', { capital: true }),
                })
              : t('reports.snapshot.responsible', {
                  responsible: term('responsible', { capital: true }),
                  name: detail.responsibleName,
                }),
        }),
        detail.critical ? t('reports.snapshot.critical') : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' — ');
    case 'person': {
      const names = new Map(snapshot.activities.map((each) => [each.id, each.name]));
      const stages = new Map(snapshot.stages.map((each) => [each.id, each.name]));
      const on = [
        ...detail.activityIds.map((id) => names.get(id) ?? ''),
        ...detail.stageIds.map((id) => stages.get(id) ?? ''),
      ].filter((name) => name !== '');
      const trade = detail.trade ?? t('meeting.detail.noTrade');
      return on.length === 0 ? trade : t(key, { trade, activities: on.join(', ') });
    }
    case 'gate':
      return [
        t(key, { stage: item.title, day: item.due === null ? '' : day(item.due) }),
        detail.checks === 0
          ? t('reports.snapshot.gate.noChecks')
          : detail.passed
            ? t('reports.snapshot.gate.passed')
            : tp('meeting.gate.holding', detail.holding),
      ].join(' — ');
  }
}

/**
 * The domain's refusals of a meeting's minutes, said: one sentence each, with where in the draft it
 * is ("Action 2 does not say what is to be done.") and the limits it names.
 */
export function meetingProblemsText(
  i18n: Pick<I18n, 't' | 'number'>,
  problems: readonly MeetingProblem[],
): string[] {
  return [
    ...new Set(
      problems.map((problem) =>
        i18n.t(problem.messageKey as MessageKey, {
          position: problem.index === null ? '' : i18n.number(problem.index + 1),
          max: i18n.number(MEETING_LIMITS.notes),
          name: i18n.number(MEETING_LIMITS.name),
          title: i18n.number(MEETING_LIMITS.itemTitle),
          note: i18n.number(MEETING_LIMITS.itemNote),
          outcome: i18n.number(MEETING_LIMITS.itemOutcome),
          text: i18n.number(MEETING_LIMITS.actionText),
          closure: i18n.number(MEETING_LIMITS.closureNote),
        }),
      ),
    ),
  ];
}
