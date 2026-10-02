import { daysText } from '@/features/reports/compose/words';
import { useI18n } from '@/i18n/useI18n';

/** A signed number of working days, as a person says it: "2 days", "0 days", "3 days early". */
export function useDaysText() {
  const i18n = useI18n();
  return (days: number): string => daysText(i18n, days);
}
