import {
  DELAY_BASIS_KEYS,
  DELAY_CAUSE_KEYS,
  DELAY_PARTY_KEYS,
  DELAY_STATUS_KEYS,
  type DelayCauseRow,
  type DelayLedger,
  type DelayParty,
  type DelayPartyRow,
  type DelayTraceRow,
} from '@/domain/delay';
import type { WorkSnapshot } from '@/domain/plan';
import { signedDays } from '@/features/plan/changeWords';
import type { MessageKey } from '@/i18n/en';
import type { termsFor } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

/**
 * The words of **Why is it late?** (slice E3), in one place, so the dashboard, the weekly report and
 * the owner's snapshot say the delay ledger the same way: where the work stands against its
 * baseline, each cause and each party by name, every row of the trace, and what the record does not
 * explain. Nothing here counts a day: every number is the domain's (`delay.ts`), only said here.
 */

type Words = Pick<I18n, 't' | 'tp' | 'day' | 'number'>;
type Term = ReturnType<typeof termsFor>;

/** A number of working days inside a sentence: "1 working day", "5 working days". */
function workingDays(i18n: Words, days: number): string {
  return i18n.tp('plan.checklist.days', Math.abs(days));
}

/**
 * Where the work stands, in one sentence: late and why follows, on its baseline's date, ahead — and
 * then no cause is made up — or why nothing can be said yet (before approval, or with no forecast).
 */
export function delayStatusText(i18n: Words, term: Term, ledger: DelayLedger): string {
  return i18n.t(DELAY_STATUS_KEYS[ledger.status] as MessageKey, {
    days: workingDays(i18n, ledger.total ?? 0),
    baseline: term('baseline'),
    number: ledger.baselineNumber ?? 1,
  });
}

/** A cause, or what is left once every cause has taken its days, in the owner's words. */
export function delayCauseText(i18n: Pick<I18n, 't'>, row: Pick<DelayCauseRow, 'cause'>): string {
  return i18n.t(DELAY_CAUSE_KEYS[row.cause] as MessageKey);
}

/** Who a day is put down to, as the record names them: the owner, a person, or nobody (`null`). */
export function delayPartyText(i18n: Pick<I18n, 't'>, party: DelayParty | null): string {
  if (party === null) return i18n.t(DELAY_PARTY_KEYS.none as MessageKey);
  switch (party.kind) {
    case 'owner':
      return i18n.t(DELAY_PARTY_KEYS.owner as MessageKey);
    case 'person':
      return party.name ?? i18n.t(DELAY_PARTY_KEYS.formerPerson as MessageKey);
    case 'other':
      return party.name;
  }
}

/** A row of the by-party figure: its party by name, nobody, or what is left. */
export function delayPartyRowText(i18n: Pick<I18n, 't'>, row: DelayPartyRow): string {
  if (row.residual !== null) return i18n.t(DELAY_CAUSE_KEYS[row.residual] as MessageKey);
  return delayPartyText(i18n, row.party);
}

/** A row's working days as its value: a number, signed only when it is days won back. */
export function delayDaysValue(i18n: Pick<I18n, 'number'>, days: number): string {
  return days < 0 ? signedDays(i18n, days) : i18n.number(days);
}

/**
 * One thing the ledger counted, in words: a day — "2 Sep — the diary says why — on the way to the
 * finish: Move the waste pipe" — a late decision with its name, or a change order with its days.
 */
export function delayTraceText(i18n: Words, snapshot: WorkSnapshot, row: DelayTraceRow): string {
  const basis = i18n.t(DELAY_BASIS_KEYS[row.basis] as MessageKey);
  if (row.changeOrderId !== null) {
    return i18n.t('delay.row.change', {
      title: row.title,
      basis,
      days: signedDays(i18n, row.days),
    });
  }
  const day = row.day === null ? '' : i18n.day(row.day);
  const said =
    row.decisionId !== null
      ? i18n.t('delay.row.decision', { day, title: row.title, basis })
      : i18n.t('delay.row.day', { day, basis });
  if (row.activityIds.length === 0) return said;
  const names = new Map(snapshot.activities.map((activity) => [activity.id, activity.name]));
  const listed = row.activityIds
    .map((id) => names.get(id) ?? i18n.t('diary.entry.unknownActivity'))
    .join(', ');
  return `${said} — ${i18n.t('delay.row.activities', { names: listed })}`;
}

/** What a residual row stands for, said where its trace would be: it has none, by definition. */
export function delayResidualText(i18n: Pick<I18n, 't'>, residual: 'unexplained' | 'made-up') {
  return i18n.t(residual === 'unexplained' ? 'delay.row.residual' : 'delay.row.madeUp');
}

/**
 * The days the record does not explain — "3 working days the record does not explain." — or the
 * days it names beyond what the finish lost; `null` when everything is accounted for.
 */
export function delayLeftText(i18n: Words, ledger: DelayLedger): string | null {
  if (ledger.unexplainedDays > 0) return i18n.tp('delay.unexplained', ledger.unexplainedDays);
  if (ledger.madeUpDays > 0) return i18n.tp('delay.madeUp', ledger.madeUpDays);
  return null;
}
