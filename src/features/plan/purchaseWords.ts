import type { PurchaseEvent } from '@/domain/plan';
import {
  PURCHASE_EVENT_KEYS,
  PURCHASE_FLAG_KEYS,
  purchaseFlags,
  type PurchaseFigures,
  type PurchaseProblem,
  type PurchaseRow,
} from '@/domain/purchases';
import type { MessageKey } from '@/i18n/en';
import type { TermKey } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

/**
 * The words of a purchase (slice G2), in one place, so the Plan's Purchases tab, the dashboard's "To
 * order this week" card, the meeting's agenda, the weekly report and the owner's snapshot say a
 * purchase the same way: what needs it, its lead time, the day to order by, when it is expected, and
 * its flags in words. Nothing here counts or computes a day: every day and flag is the domain's
 * (`purchases.ts`), and only said here.
 */

type Term = (key: TermKey, options?: { capital?: boolean }) => string;

/** What needs it: "For Lay the tiles — Tiling", or the stage alone when nothing in it is placed. */
export function purchaseNeededForText(i18n: Pick<I18n, 't'>, row: PurchaseRow): string {
  const stage = row.stageName ?? i18n.t('snags.row.goneStage');
  return row.neededActivityName === null
    ? i18n.t('purchases.row.neededForStage', { stage })
    : i18n.t('purchases.row.neededFor', { activity: row.neededActivityName, stage });
}

/** "Lead time: 21 days" — calendar days, the glossary's word. */
export function purchaseLeadText(i18n: Pick<I18n, 'tp'>, term: Term, row: PurchaseRow): string {
  return i18n.tp('purchases.row.lead', row.leadDays, {
    leadTime: term('leadTime', { capital: true }),
  });
}

/**
 * The day to order by, while it is to order: "Order by: Sep 24, 2026", with how many days late when
 * it is; or that there is no day yet, because what needs it is not scheduled. `null` once ordered.
 */
export function purchaseOrderByText(
  i18n: Pick<I18n, 't' | 'tp' | 'day'>,
  term: Term,
  row: PurchaseRow,
): string | null {
  if (row.state !== 'to-order') return null;
  if (row.orderBy === null) return i18n.t('purchases.row.notScheduled');
  const said = i18n.t('purchases.row.orderBy', {
    orderBy: term('orderBy', { capital: true }),
    day: i18n.day(row.orderBy),
  });
  return row.lateToOrder && row.daysLate !== null
    ? `${said} — ${i18n.tp('purchases.row.daysLate', row.daysLate)}`
    : said;
}

/** The day it is needed — said as the plan's when the forecast could not give it. */
export function purchaseNeededOnText(
  i18n: Pick<I18n, 't' | 'day'>,
  row: PurchaseRow,
): string | null {
  if (row.neededOn === null) return null;
  return i18n.t(
    row.neededFrom === 'plan' ? 'purchases.row.neededOn.plan' : 'purchases.row.neededOn',
    {
      day: i18n.day(row.neededOn),
    },
  );
}

/**
 * Where its order stands: "Ordered on 1 Oct — expected on 22 Oct" (with how many days late when it
 * is), "Delivered on 20 Oct"; `null` while it is to order.
 */
export function purchaseOrderText(
  i18n: Pick<I18n, 't' | 'tp' | 'day'>,
  row: PurchaseRow,
): string | null {
  if (row.state === 'delivered' && row.deliveredOn !== null) {
    return i18n.t('purchases.row.delivered', { day: i18n.day(row.deliveredOn) });
  }
  if (row.state !== 'ordered' || row.orderedOn === null) return null;
  const said = i18n.t('purchases.row.ordered', {
    day: i18n.day(row.orderedOn),
    expected: row.expectedOn === null ? '—' : i18n.day(row.expectedOn),
  });
  return row.lateToArrive && row.daysLate !== null
    ? `${said} — ${i18n.tp('purchases.row.daysLate', row.daysLate)}`
    : said;
}

/** "Expected on 22 Oct, needed on 15 Oct: 7 days after — the work will wait for it."; or `null`. */
export function purchaseAfterNeededText(
  i18n: Pick<I18n, 'tp' | 'day'>,
  row: PurchaseRow,
): string | null {
  if (!row.arrivesAfterNeeded || row.expectedOn === null || row.neededOn === null) return null;
  return i18n.tp('purchases.row.afterNeeded', row.daysAfterNeeded ?? 1, {
    expected: i18n.day(row.expectedOn),
    needed: i18n.day(row.neededOn),
  });
}

/** Orders that fell through: "An order fell through, on 2 Oct."; `null` when none did. */
export function purchaseFellThroughText(
  i18n: Pick<I18n, 'tp' | 'day'>,
  row: PurchaseRow,
): string | null {
  if (row.fellThrough === 0 || row.lastFellThroughOn === null) return null;
  return i18n.tp('purchases.row.fellThrough', row.fellThrough, {
    day: i18n.day(row.lastFellThroughOn),
  });
}

/** The row's flags in words, in the domain's order: "Late to order", "Order this week" … */
export function purchaseFlagWords(i18n: Pick<I18n, 't'>, row: PurchaseRow): string[] {
  return purchaseFlags(row).map((flag) => i18n.t(PURCHASE_FLAG_KEYS[flag] as MessageKey));
}

/** A flag that is bad news — late, or arriving after it is needed — rather than a reminder. */
export function purchaseLate(row: PurchaseRow): boolean {
  return row.lateToOrder || row.lateToArrive || row.arrivesAfterNeeded;
}

/**
 * A purchase as one line, where a list already says what it is: its name and quantity, what needs
 * it, the day to order by or where its order stands, and its flags — the figures' rows, the
 * agenda's detail and the reports' rows.
 */
export function purchaseRowLine(
  i18n: Pick<I18n, 't' | 'tp' | 'day'>,
  term: Term,
  row: PurchaseRow,
): string {
  const name = row.quantity === null ? row.name : `${row.name} (${row.quantity})`;
  return [
    name,
    purchaseNeededForText(i18n, row),
    purchaseOrderByText(i18n, term, row) ?? purchaseOrderText(i18n, row),
    purchaseAfterNeededText(i18n, row),
    // The sentence before already says it arrives after it is needed: not said twice.
    ...purchaseFlags(row)
      .filter((flag) => flag !== 'arrivesAfterNeeded')
      .map((flag) => i18n.t(PURCHASE_FLAG_KEYS[flag] as MessageKey)),
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' — ');
}

/** One fact of its story: "Ordered on 1 Oct — recorded by Sample author". */
export function purchaseEventText(i18n: Pick<I18n, 't' | 'day'>, event: PurchaseEvent): string {
  return i18n.t('purchases.history.line', {
    event: i18n.t(PURCHASE_EVENT_KEYS[event.kind] as MessageKey),
    day: i18n.day(event.day),
    author: event.authorName,
  });
}

/**
 * What to order and what is late, in sentences: "2 purchases to order this week. 1 of them is late to
 * order. 1 ordered purchase is late to arrive." — or that there is nothing. Counted by the domain.
 */
export function purchaseSentence(i18n: Pick<I18n, 't' | 'tp'>, figures: PurchaseFigures): string {
  const week = figures.toOrderThisWeek.value;
  const late = figures.lateToOrder.value;
  const arriving = figures.lateToArrive.value;
  const after = figures.arrivesAfterNeeded.value;
  if (week === 0 && arriving === 0 && after === 0) return i18n.t('purchases.sentence.none');
  return [
    week > 0 ? i18n.tp('purchases.sentence.week', week) : null,
    late > 0 ? i18n.tp('purchases.sentence.late', late) : null,
    arriving > 0 ? i18n.tp('purchases.sentence.arriving', arriving) : null,
    after > 0 ? i18n.tp('purchases.sentence.afterNeeded', after) : null,
  ]
    .filter((part) => part !== null)
    .join(' ');
}

/** The domain's refusals, said: one sentence each, the nouns in the lens's words. */
export function purchaseProblemsText(
  i18n: Pick<I18n, 't'>,
  term: Term,
  problems: readonly PurchaseProblem[],
): string[] {
  return [
    ...new Set(
      problems.map((problem) =>
        i18n.t(problem.messageKey as MessageKey, {
          stage: term('stage'),
          activity: term('activity'),
        }),
      ),
    ),
  ];
}
