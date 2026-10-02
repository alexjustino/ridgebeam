import { Edit20Regular } from '@fluentui/react-icons';

import { breakdown, byRoom, roomsOf } from '@/domain/arrangements';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';

/**
 * The plan by room: the same rows as the breakdown, grouped where they happen (DESIGN_SYSTEM §8:
 * the same rows, never a copy).
 *
 * Every room in its order with the activities that touch it; an activity in more than one room is
 * under each, and says where else it is, so a count by eye is never a count twice without being
 * told; the activities that touch no room are one group at the end. Nothing is edited here — each
 * row offers the way back to where it is edited.
 */
export function ByRoom({
  snapshot,
  onEdit,
}: {
  snapshot: WorkSnapshot;
  onEdit: (activityId: string) => void;
}) {
  const { t } = useI18n();
  const term = useTerms();
  const groups = byRoom(snapshot);
  const numbers = new Map(breakdown(snapshot).map((row) => [row.id, row.number]));
  const stageNames = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));

  if (groups.length === 0) {
    return (
      <Card>
        <EmptyState
          title={t('plan.byRoom.emptyTitle')}
          description={t('plan.byRoom.emptyDescription')}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const heading = `room-group-${group.roomId ?? 'none'}`;
        return (
          <section
            key={group.roomId ?? 'none'}
            data-room-group={group.roomId ?? 'none'}
            aria-labelledby={heading}
            className="rounded-xl border border-stroke-subtle bg-card p-4 shadow-card"
          >
            <h2 id={heading} className="mb-2 text-body-lg font-semibold text-fg">
              {group.name ?? t('plan.byRoom.none', { room: term('room') })}
            </h2>
            {group.activities.length === 0 ? (
              <p className="text-body text-fg-tertiary">{t('plan.byRoom.nothing')}</p>
            ) : (
              <ul className="flex flex-col">
                {group.activities.map((activity) => {
                  const elsewhere = roomsOf(snapshot, activity)
                    .filter((room) => room.id !== group.roomId)
                    .map((room) => room.name);
                  return (
                    <li
                      key={activity.id}
                      className="flex items-center gap-3 border-t border-stroke-subtle py-1.5 first:border-t-0"
                    >
                      <span className="w-10 shrink-0 text-body text-fg-secondary tabular-nums">
                        {numbers.get(activity.id) ?? '—'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-body font-semibold text-fg">
                          {activity.name}
                        </span>
                        <span className="block text-caption text-fg-secondary">
                          {[
                            stageNames.get(activity.stageId) ?? '',
                            elsewhere.length > 0 && group.roomId !== null
                              ? t('plan.byRoom.alsoIn', { rooms: elsewhere.join(', ') })
                              : '',
                          ]
                            .filter((part) => part !== '')
                            .join(' — ')}
                        </span>
                      </span>
                      <Button
                        appearance="subtle"
                        icon={<Edit20Regular />}
                        onClick={() => onEdit(activity.id)}
                      >
                        {t('plan.editInBreakdown')}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
