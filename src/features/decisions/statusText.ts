import type { DecisionRow } from '@/domain/decisions';
import { decisionStatusText } from '@/features/reports/compose/words';
import { useI18n } from '@/i18n/useI18n';

/**
 * A decision's status, as a person says it: "Due in 3 working days", "Due today", "Overdue by 2
 * working days", "Made on 25 September 2026", "No deadline yet". One function for the breakdown,
 * the Decisions page, the dashboard and the weekly report, so none can word the same state two ways.
 */
export function useStatusText() {
  const i18n = useI18n();
  return (row: Pick<DecisionRow, 'status' | 'daysLeft' | 'madeAt'>): string =>
    decisionStatusText(i18n, row);
}
