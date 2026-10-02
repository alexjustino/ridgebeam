import type { Endpoint, WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';

/** How the breakdown names either end of a link: "1.2 Lay the floor tile", "Stage 2 Painting". */
export function useEndpointName(
  snapshot: WorkSnapshot,
  numbers: ReadonlyMap<string, string | null>,
) {
  const { t } = useI18n();
  const term = useTerms();
  const activities = new Map(snapshot.activities.map((activity) => [activity.id, activity.name]));
  const stages = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  return (endpoint: Endpoint): string => {
    const number = numbers.get(endpoint.id) ?? '';
    if (endpoint.kind === 'stage') {
      return t('plan.link.stageOption', {
        stage: term('stage', { capital: true }),
        number,
        name: stages.get(endpoint.id) ?? '?',
      });
    }
    return `${number} ${activities.get(endpoint.id) ?? '?'}`.trim();
  };
}
