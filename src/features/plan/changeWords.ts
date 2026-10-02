/**
 * The sentences a change order is said in, on the screen and on the page (slice E1).
 *
 * A report says what the screen says, in the same words (DESIGN_SYSTEM §8): the Changes tab, the
 * decision dialog, the dashboard's card, the weekly report and the owner's snapshot all word a
 * change's impact, who asked, its state and the standing tally through these functions — so the page
 * sent to the owner can never word a change the screen words another way.
 *
 * Nothing here adds up money or days: every number comes from the domain (`changeImpact`,
 * `changeTally`), and these only turn it into words. Days are always working days, and say so; a
 * negative amount reads with its sign and in words ("saves"), never by a sign alone.
 *
 * `ownerWords` is the owner's lens — the screen's when the owner's lens is on, and always on the
 * owner's reports: a change the owner asked for is "a change you asked for" (decision 7).
 */

import {
  CHANGE_LIMITS,
  CHANGE_WAITING_LIMIT_DAYS,
  type ChangeEffect,
  type ChangeImpact,
  type ChangeImpactRow,
  type ChangeOrder,
  type ChangeProblem,
  type ChangeTally,
} from '@/domain/changes';
import type { WorkSnapshot } from '@/domain/plan';
import type { TermKey } from '@/i18n/terms';
import { capitalised } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

type Term = (key: TermKey, options?: { capital?: boolean }) => string;
type Words = Pick<I18n, 't' | 'tp' | 'day' | 'money' | 'number' | 'language'>;

/** "Change order #3 — Extra socket": the name a change is called by in a sentence or a title. */
export function changeName(
  i18n: Pick<I18n, 't'>,
  term: Term,
  change: Pick<ChangeOrder, 'number' | 'title'>,
): string {
  return i18n.t('changes.name', {
    changeOrder: term('changeOrder'),
    number: change.number,
    title: change.title,
  });
}

/** The same, opening a sentence or a heading. */
export function changeNameCapital(
  i18n: Pick<I18n, 't' | 'language'>,
  term: Term,
  change: Pick<ChangeOrder, 'number' | 'title'>,
): string {
  return capitalised(i18n.language, changeName(i18n, term, change));
}

/** "#3 Extra socket": a change in a list, where the list already says what it is. */
export function changeRowTitle(
  i18n: Pick<I18n, 't'>,
  change: { readonly number: number; readonly title: string },
): string {
  return i18n.t('changes.row.title', { number: change.number, title: change.title });
}

/** Signed working days as a phrase: "2 working days later", "1 working day earlier", "no working days". */
/** Approved changes' working days as a figure's value: "+2", "−1", "0" — the unit is in the label. */
export function signedDays(i18n: Pick<I18n, 'number'>, days: number): string {
  if (days > 0) return `+${i18n.number(days)}`;
  if (days < 0) return `−${i18n.number(-days)}`;
  return i18n.number(0);
}

export function changeDaysText(i18n: Pick<I18n, 't' | 'tp'>, days: number | null): string {
  if (days === null) return i18n.t('changes.days.uncounted');
  if (days === 0) return i18n.t('changes.days.none');
  return days > 0 ? i18n.tp('changes.days.later', days) : i18n.tp('changes.days.earlier', -days);
}

/** A change's money as a phrase: "costs $300.00 more", "saves $50.00", "not priced yet". */
export function changeCostText(
  i18n: Pick<I18n, 't' | 'money'>,
  cents: number | null,
  currency: string,
): string {
  if (cents === null) return i18n.t('changes.impact.cost.unpriced');
  if (cents === 0) return i18n.t('changes.impact.cost.none');
  return cents > 0
    ? i18n.t('changes.impact.cost.more', { amount: i18n.money(cents, currency) })
    : i18n.t('changes.impact.cost.less', { amount: i18n.money(-cents, currency) });
}

/** What happens to the finish, in words: "Finishes 3 working days later — on 14 Nov instead of 11 Nov". */
export function finishMoveText(
  i18n: Pick<I18n, 't' | 'tp' | 'day'>,
  move: {
    readonly days: number | null;
    readonly finishBefore: string | null;
    readonly finishAfter: string | null;
  },
): string {
  const { days, finishBefore, finishAfter } = move;
  if (days === null || finishBefore === null || finishAfter === null) {
    return i18n.t('changes.impact.uncounted');
  }
  const dates = { before: i18n.day(finishBefore), after: i18n.day(finishAfter) };
  if (days === 0) return i18n.t('changes.impact.same', dates);
  return days > 0
    ? i18n.tp('changes.impact.later', days, dates)
    : i18n.tp('changes.impact.earlier', -days, dates);
}

/**
 * The impact in one sentence, as the form and the decision dialog show it: "Finishes 3 working days
 * later — on 14 November 2026 instead of 11 November 2026; costs $1,200.00 more."
 */
export function impactSentence(
  i18n: Pick<I18n, 't' | 'tp' | 'day' | 'money'>,
  impact: Pick<ChangeImpact, 'days' | 'finishBefore' | 'finishAfter' | 'costCents'>,
  currency: string,
): string {
  return i18n.t('changes.impact.sentence', {
    finish: finishMoveText(i18n, impact),
    cost: changeCostText(i18n, impact.costCents, currency),
  });
}

/**
 * The impact a decision froze, in the same sentence: the days and dates the schedule gave the day it
 * was decided, and the money copied from the change.
 */
export function decidedImpactSentence(
  i18n: Pick<I18n, 't' | 'tp' | 'day' | 'money'>,
  change: ChangeOrder,
  currency: string,
): string | null {
  const decision = change.decision;
  if (decision === null) return null;
  return impactSentence(
    i18n,
    {
      days: decision.daysDelta,
      finishBefore: decision.finishBefore,
      finishAfter: decision.finishAfter,
      costCents: decision.costCents,
    },
    currency,
  );
}

/** One row of the impact's figure, after its name: how its finish moved, or that it came or went. */
export function impactRowText(i18n: Pick<I18n, 't' | 'tp' | 'day'>, row: ChangeImpactRow): string {
  switch (row.change) {
    case 'moved':
      return i18n.t('baselines.row.moved', {
        from: i18n.day(row.beforeFinish ?? ''),
        to: i18n.day(row.afterFinish ?? ''),
        days: changeDaysText(i18n, row.days),
      });
    case 'placed':
      return i18n.t('baselines.row.placed', { to: i18n.day(row.afterFinish ?? '') });
    case 'unplaced':
      return i18n.t('baselines.row.unplaced', { from: i18n.day(row.beforeFinish ?? '') });
    case 'added':
      return row.afterFinish === null
        ? i18n.t('changes.impact.row.added', { to: '—' })
        : i18n.t('changes.impact.row.added', { to: i18n.day(row.afterFinish) });
    case 'removed':
      return i18n.t('changes.impact.row.removed', { from: i18n.day(row.beforeFinish ?? '') });
  }
}

/**
 * Who asked, as a row says it: "Asked for by the owner" — or, in the owner's words, "A change you
 * asked for" — "Asked for by Ana", or that the person is no longer in the plan.
 */
export function askedByText(
  i18n: Pick<I18n, 't'>,
  snapshot: Pick<WorkSnapshot, 'people'>,
  change: Pick<ChangeOrder, 'askedBy' | 'askedByPersonId' | 'askedByName'>,
  ownerWords: boolean,
): string {
  if (change.askedBy === 'owner') {
    return ownerWords ? i18n.t('changes.askedBy.row.you') : i18n.t('changes.askedBy.row.owner');
  }
  if (change.askedBy === 'other') {
    return i18n.t('changes.askedBy.row.named', { name: change.askedByName ?? '' });
  }
  const person = snapshot.people.find((each) => each.id === change.askedByPersonId);
  return person === undefined
    ? i18n.t('changes.askedBy.row.gone')
    : i18n.t('changes.askedBy.row.named', { name: person.name });
}

/** Where a change stands, in words: "Waiting for a decision", "Approved on 3 October 2026". */
export function changeStateText(i18n: Pick<I18n, 't' | 'day'>, change: ChangeOrder): string {
  const decision = change.decision;
  if (decision === null) return i18n.t('changes.state.pending');
  const day = i18n.day(decision.decidedOn);
  return decision.outcome === 'approved'
    ? i18n.t('changes.state.approved', { day })
    : decision.outcome === 'declined'
      ? i18n.t('changes.state.declined', { day })
      : i18n.t('changes.state.withdrawn', { day });
}

/** How long a change has waited for its decision, in calendar days, and whether that is too long. */
export function waitedText(
  i18n: Pick<I18n, 't' | 'tp' | 'number'>,
  waitedDays: number | null,
  tooLong: boolean,
): string | null {
  if (waitedDays === null) return null;
  const waited =
    waitedDays === 0 ? i18n.t('changes.waited.today') : i18n.tp('changes.waited', waitedDays);
  return tooLong
    ? `${waited} — ${i18n.t('changes.waited.tooLong', { limit: i18n.number(CHANGE_WAITING_LIMIT_DAYS) })}`
    : waited;
}

/** One effect of a change, as the form's list and a change's row say it. */
export function effectText(
  i18n: Pick<I18n, 't' | 'tp'>,
  snapshot: Pick<WorkSnapshot, 'activities'>,
  effect: ChangeEffect,
): string {
  const nameOf = (id: string) =>
    snapshot.activities.find((activity) => activity.id === id)?.name ??
    i18n.t('changes.effect.gone');
  switch (effect.kind) {
    case 'add':
      return effect.after === null
        ? i18n.t('changes.effect.row.addFirst', {
            name: effect.name,
            days: i18n.tp('plan.checklist.days', effect.durationDays),
          })
        : i18n.t('changes.effect.row.add', {
            name: effect.name,
            days: i18n.tp('plan.checklist.days', effect.durationDays),
            after: nameOf(effect.after),
          });
    case 'duration': {
      const activity = snapshot.activities.find((each) => each.id === effect.activityId);
      return i18n.t('changes.effect.row.duration', {
        name: nameOf(effect.activityId),
        from:
          activity === undefined || activity.durationDays === null
            ? i18n.t('changes.effect.noDuration')
            : i18n.tp('plan.checklist.days', activity.durationDays),
        to: i18n.tp('plan.checklist.days', effect.durationDays),
      });
    }
    case 'remove':
      return i18n.t('changes.effect.row.remove', { name: nameOf(effect.activityId) });
  }
}

/** A refusal of the domain's, in a sentence, with the lens's nouns. */
export function problemText(
  i18n: Pick<I18n, 't' | 'number'>,
  term: Term,
  found: ChangeProblem,
): string {
  return i18n.t(found.messageKey, {
    stage: term('stage'),
    activity: term('activity'),
    max: i18n.number(CHANGE_LIMITS.durationDays),
    nameMax: i18n.number(CHANGE_LIMITS.name),
    limit: i18n.number(CHANGE_LIMITS.effects),
  });
}

/** Every refusal once, in the order found. */
export function problemsText(
  i18n: Pick<I18n, 't' | 'number'>,
  term: Term,
  found: readonly ChangeProblem[],
): string[] {
  return [...new Set(found.map((each) => problemText(i18n, term, each)))];
}

/** Money a set of changes moved, as a phrase: "$300.00 more", "$50.00 less", "no money". */
export function moneyMoveText(
  i18n: Pick<I18n, 't' | 'money'>,
  cents: number,
  currency: string,
): string {
  if (cents === 0) return i18n.t('changes.tally.money.none');
  return cents > 0
    ? i18n.t('changes.tally.money.more', { amount: i18n.money(cents, currency) })
    : i18n.t('changes.tally.money.less', { amount: i18n.money(-cents, currency) });
}

/**
 * The standing tally in two sentences, the approved changes' money and days, and who asked for all
 * of those raised: "2 changes approved: $300.00 more and 2 working days later. The 3 changes raised
 * were asked for by the owner (2) and Ana (1)."
 * Before any change is approved it says so; with nobody having asked, the second sentence is left out.
 */
export function tallySentence(
  i18n: Words,
  tally: ChangeTally,
  currency: string,
  ownerWords: boolean,
): string {
  const { t, tp } = i18n;
  const first =
    tally.approved === 0
      ? t('changes.tally.none')
      : tp('changes.tally.approved', tally.approved, {
          cost: moneyMoveText(i18n, tally.costCents, currency),
          days: tally.days === 0 ? t('changes.tally.days.none') : changeDaysText(i18n, tally.days),
        });
  if (tally.byParty.length === 0) return first;
  const parties = tally.byParty.map((party) =>
    t('changes.tally.party', {
      name:
        party.askedBy === 'owner'
          ? ownerWords
            ? t('changes.party.you')
            : t('changes.party.owner')
          : (party.name ?? t('changes.party.gone')),
      count: i18n.number(party.approved + party.declined + party.withdrawn + party.pending),
    }),
  );
  const list = new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(parties);
  // Who asked counts every change raised — approved, declined, withdrawn or waiting — and says so,
  // so it is never read as a breakdown of the approved ones the first sentence counts.
  const raised = tally.approved + tally.declined + tally.withdrawn + tally.pending;
  return `${first} ${tp('changes.tally.askedBy', raised, { parties: list })}`;
}
