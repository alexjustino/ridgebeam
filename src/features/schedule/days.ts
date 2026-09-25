import { useI18n } from '@/i18n/useI18n';

/** A signed number of working days, as a person says it: "2 days", "0 days", "3 days early". */
export function useDaysText() {
  const { t, tp } = useI18n();
  return (days: number): string =>
    days === 0 ? t('slip.none') : days > 0 ? tp('slip.late', days) : tp('slip.early', -days);
}
