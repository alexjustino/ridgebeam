import { useMemo } from 'react';

import { useDiary } from '@/data/queries';
import { peopleTable } from '@/domain/people';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';

/**
 * Everyone on the work (slice F7, ADR-026): a contact each — trade, phone, e-mail, availability —
 * the stages they are expected on, and what the record says of them. Presence comes from the diary,
 * never from the contact: the days an entry had them on site, and the last one. What is still owed
 * to them is the money page's own figure. Edited in the breakdown's People card; read here.
 */
export function PeopleTab({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, tp, day, money } = useI18n();
  const diary = useDiary(true);
  const rows = useMemo(() => peopleTable(snapshot, diary.data ?? []), [snapshot, diary.data]);
  const stageNames = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState title={t('people.emptyTitle')} description={t('people.emptyDescription')} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-3xl text-body text-fg-secondary">{t('people.lead')}</p>
      <ol className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.personId} data-person-id={row.personId}>
            <Card>
              <div className="flex flex-col gap-1">
                <h2 className="text-body-lg font-semibold text-fg">{row.name}</h2>
                <p className="text-body text-fg-secondary">{row.trade ?? t('people.noTrade')}</p>
                {[row.phone, row.email, row.availability].some((value) => value !== null) && (
                  <p data-selectable className="text-body text-fg">
                    {[row.phone, row.email, row.availability]
                      .filter((value): value is string => value !== null)
                      .join(' · ')}
                  </p>
                )}
                {row.note !== null && (
                  <p className="text-caption whitespace-pre-line text-fg-secondary">{row.note}</p>
                )}
                <p className="text-body text-fg">
                  {row.stageIds.length === 0
                    ? t('people.noStages')
                    : row.stageIds.map((id) => stageNames.get(id) ?? id).join(', ')}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-body">
                  <span data-testid="person-days-on-site" className="text-fg">
                    {row.daysOnSite.length === 0
                      ? t('people.days.none')
                      : tp('people.days', row.daysOnSite.length)}
                  </span>
                  <span data-testid="person-last-on-site" className="text-fg-secondary">
                    {row.lastOnSite === null
                      ? t('people.lastNever')
                      : t('people.last', { day: day(row.lastOnSite) })}
                  </span>
                  <span data-testid="person-owed" className="text-fg-secondary tabular-nums">
                    {t('people.owed', { amount: money(row.owed.value, snapshot.work.currency) })}
                  </span>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
