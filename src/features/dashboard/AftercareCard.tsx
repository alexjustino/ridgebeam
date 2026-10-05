import { CalendarLtr20Regular } from '@fluentui/react-icons';
import { useMemo } from 'react';

import { useNavigation } from '@/app/navigation';
import {
  AFTERCARE_LABEL_KEYS,
  aftercareFigures,
  type MaintenanceRow,
  type WarrantyRow,
} from '@/domain/aftercare';
import type { WorkSnapshot } from '@/domain/plan';
import { taskRowLine, warrantyRowLine } from '@/features/plan/aftercareWords';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';

/**
 * **After the handover** on the front door (slice G4, decision 3; pt "Depois da entrega"): how many
 * maintenance tasks are overdue (`aftercare-overdue`), how many are due in the next 30 days
 * (`aftercare-soon`) and how many warranties end in the next 90 (`aftercare-ending`) — each a number
 * that opens onto its rows, with the day and how far it is in words — and the way to the calendar of
 * what comes due on the Plan's Handover tab.
 *
 * **Hidden while the work has no warranty and no task.** The Dashboard puts it first once every
 * stage is closed (ADR-048). Every number is the domain's `aftercareFigures`, as of today.
 */
export function AftercareCard({ snapshot, today }: { snapshot: WorkSnapshot; today: string }) {
  const i18n = useI18n();
  const { t, number } = i18n;
  const navigation = useNavigation();
  const figures = useMemo(() => aftercareFigures(snapshot, today), [snapshot, today]);
  if (figures.warranties === 0 && figures.tasks === 0) return null;

  const taskRow = (row: MaintenanceRow) => <span>{taskRowLine(i18n, row)}</span>;
  const warrantyRow = (row: WarrantyRow) => <span>{warrantyRowLine(i18n, row)}</span>;

  return (
    <div data-testid="dashboard-aftercare">
      <Card
        title={t('dashboard.aftercare.title')}
        actions={
          <Button
            icon={<CalendarLtr20Regular />}
            data-testid="dashboard-aftercare-open"
            className="shrink-0"
            onClick={navigation.openAftercare}
          >
            {t('dashboard.aftercare.open')}
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <FigureRow<MaintenanceRow>
            testId="aftercare-overdue"
            size="title"
            figure={figures.overdue}
            label={t(AFTERCARE_LABEL_KEYS.overdue)}
            value={number(figures.overdue.value)}
            rowsLabel={t('dashboard.aftercare.rows.overdue')}
            renderRow={taskRow}
          />
          <FigureRow<MaintenanceRow>
            testId="aftercare-soon"
            size="title"
            figure={figures.dueSoon}
            label={t(AFTERCARE_LABEL_KEYS.dueSoon)}
            value={number(figures.dueSoon.value)}
            rowsLabel={t('dashboard.aftercare.rows.soon')}
            renderRow={taskRow}
          />
          <FigureRow<WarrantyRow>
            testId="aftercare-ending"
            size="title"
            figure={figures.endingSoon}
            label={t(AFTERCARE_LABEL_KEYS.endingSoon)}
            value={number(figures.endingSoon.value)}
            rowsLabel={t('dashboard.aftercare.rows.ending')}
            renderRow={warrantyRow}
          />
        </div>
        <p className="mt-3 text-caption text-fg-tertiary">{t('dashboard.aftercare.note')}</p>
      </Card>
    </div>
  );
}
