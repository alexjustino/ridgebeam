import { useMemo } from 'react';

import { useToday } from '@/app/today';
import { useDiary } from '@/data/queries';
import type { DiaryEntry } from '@/domain/diary';
import type { MoneyRow } from '@/domain/money';
import {
  paymentPlans,
  type MilestoneRow,
  type MilestoneTarget,
  type MilestoneTrigger,
  type NextMilestone,
  type PaymentPlans,
  type PaymentPreview,
} from '@/domain/milestones';
import type { WorkSnapshot } from '@/domain/plan';
import type { MessageKey } from '@/i18n/en';
import type { I18n } from '@/i18n/useI18n';

/**
 * The words of a payment plan (slice D2), in one place so the Money page, the Ledger's warning, the
 * dashboard and the weekly report say a milestone the same way: its share as a percent, what fact
 * earns it, what it still waits for, and the warning before a payment ahead of the work. Nothing
 * here computes money: every amount is the domain's (`milestones.ts`), and only formatted here.
 */

type Words = Pick<I18n, 't' | 'number' | 'money' | 'day'>;

/** Basis points as the person reads a share: 3000 → "30 %", 1250 → "12.5 %". */
export function percentText(i18n: Pick<I18n, 't' | 'number'>, bp: number): string {
  return i18n.t('figure.percent', { value: i18n.number(bp / 100) });
}

/** A target's name, or what it is when it is no longer in the plan. */
function nameOf(i18n: Pick<I18n, 't'>, target: MilestoneTarget): string {
  return target.name ?? i18n.t('money.milestone.goneActivity');
}

const WHEN_KEYS: Record<MilestoneTrigger, MessageKey> = {
  advance: 'money.milestone.when.advance',
  stage_started: 'money.milestone.when.stageStarted',
  activity_finished: 'money.milestone.when.activityFinished',
  stage_closed: 'money.milestone.when.stageClosed',
  retention: 'money.milestone.when.retention',
};

/** What earns a milestone, said of its target: "when Lay the tiles is finished". */
export function whenText(
  i18n: Pick<I18n, 't'>,
  trigger: MilestoneTrigger,
  target: MilestoneTarget,
): string {
  return i18n.t(WHEN_KEYS[trigger], { name: nameOf(i18n, target) });
}

/**
 * What the next milestone waits for: "Lay the tiles is not finished yet."; a retention held by open
 * snags (E4), with how many: "Held until its snags in Tiling are fixed — still open: 2."
 */
export function pendingText(i18n: Pick<I18n, 't' | 'number'>, next: NextMilestone): string {
  return i18n.t(next.pendingKey as MessageKey, {
    name: nameOf(i18n, next.target),
    count: i18n.number(next.openSnags),
  });
}

/**
 * The warning before a payment that would put the owner ahead of the work (decision 4), or `null`
 * when the preview does not warn: the amount ahead after it, the commitment, what is earned so far,
 * and the next milestone with what it waits for.
 */
export function aheadWarningText(
  i18n: Words,
  preview: PaymentPreview,
  currency: string,
): string | null {
  if (preview.kind !== 'plan' || !preview.warn || preview.messageKey === null) return null;
  const { next } = preview;
  return i18n.t(preview.messageKey as MessageKey, {
    amount: i18n.money(preview.aheadAfterCents, currency),
    commitment: preview.label,
    earned: i18n.money(preview.earnedCents, currency),
    next: next?.label ?? '',
    share: next === null ? '' : percentText(i18n, next.shareBp),
    pending: next === null ? '' : pendingText(i18n, next),
  });
}

/**
 * One row of an earned, due or ahead figure — a milestone reached, or a payment on the commitment —
 * as parts the screen and the report join the same way: what it is, what kind of row, its day, its
 * signed amount.
 */
export function planRowParts(
  i18n: Words,
  row: MilestoneRow | MoneyRow,
  currency: string,
): { title: string; kind: string; day: string | null; amount: string } {
  if (row.source === 'milestone') {
    return {
      title: row.title,
      kind: i18n.t('money.paymentPlan.row.milestone', { share: percentText(i18n, row.shareBp) }),
      day: row.day === null ? null : i18n.day(row.day),
      amount: i18n.money(row.amountCents, currency),
    };
  }
  return {
    title: row.label,
    kind: i18n.t('money.row.payment', { seq: row.sourceId }),
    day: row.day === null ? null : i18n.day(row.day),
    amount: i18n.money(row.amountCents, currency),
  };
}

/**
 * Every commitment's payment plan as of today, from the snapshot and the diary. `null` while the
 * diary is still being read: an "activity finished" milestone cannot be said earned or not before
 * then, and a warning computed without the diary would be wrong rather than late.
 */
export function usePaymentPlans(snapshot: WorkSnapshot): {
  plans: PaymentPlans | null;
  entries: readonly DiaryEntry[] | null;
  today: string;
} {
  const diary = useDiary(true);
  const today = useToday();
  const entries = diary.data ?? null;
  const plans = useMemo(
    () => (entries === null ? null : paymentPlans(snapshot, entries, today)),
    [snapshot, entries, today],
  );
  return { plans, entries, today };
}
