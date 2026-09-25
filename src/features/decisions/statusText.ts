import type { DecisionRow } from '@/domain/decisions';
import { useI18n } from '@/i18n/useI18n';

/**
 * A decision's status, as a person says it: "Due in 3 working days", "Due today", "Overdue by 2
 * working days", "Made on 25 September 2026", "No deadline yet". One function for the breakdown,
 * the Decisions page and the dashboard, so the three can never word the same state two ways.
 */
export function useStatusText() {
  const { t, tp, day } = useI18n();
  return (row: Pick<DecisionRow, 'status' | 'daysLeft' | 'madeAt'>): string => {
    switch (row.status) {
      case 'made':
        return t('decisions.status.made', { day: day((row.madeAt ?? '').slice(0, 10)) });
      case 'unknown':
        return t('decisions.status.unknown');
      case 'overdue':
        return tp('decisions.status.overdue', Math.abs(row.daysLeft ?? 0));
      case 'due':
        return (row.daysLeft ?? 0) === 0
          ? t('decisions.status.today')
          : tp('decisions.status.due', row.daysLeft ?? 0);
    }
  };
}
