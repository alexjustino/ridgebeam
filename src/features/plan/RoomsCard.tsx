import {
  Add20Regular,
  ArrowDown20Regular,
  ArrowUp20Regular,
  Delete20Regular,
} from '@fluentui/react-icons';
import { useState } from 'react';

import { useAddRoom, useRemoveRoom, useRenameRoom, type MoveKind } from '@/data/queries';
import type { Direction } from '@/domain/ordering';
import { roomsInOrder, type Room, type WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { IconButton } from '@/ui/IconButton';

import { AddForm } from './AddForm';
import { chordDirection } from './moves';
import { NameField } from './NameField';
import type { Outcome } from './outcome';

type Mover = (
  kind: MoveKind,
  id: string,
  direction: Direction,
  siblings: readonly string[],
  name: string,
) => void;

/**
 * The rooms or areas of the work — the architect's and the owner's map of it. Each is a row with
 * an order, renamed in place and moved like any other row. Removing one leaves every activity in
 * the plan; they simply stop touching it, and the question says so first.
 */
export function RoomsCard({
  snapshot,
  outcome,
  mover,
}: {
  snapshot: WorkSnapshot;
  outcome: Outcome;
  mover: Mover;
}) {
  const { t, tp } = useI18n();
  const term = useTerms();
  const add = useAddRoom();
  const rename = useRenameRoom();
  const remove = useRemoveRoom();
  const [removal, setRemoval] = useState<Room | null>(null);
  const rooms = roomsInOrder(snapshot);
  const ids = rooms.map((room) => room.id);

  const touching = (room: Room) =>
    snapshot.activities.filter((activity) => activity.roomIds.includes(room.id)).length;

  return (
    <Card title={t('plan.rooms.title')} description={t('plan.rooms.description')}>
      {rooms.length === 0 ? (
        <p className="mb-3 text-body text-fg-tertiary">{t('plan.rooms.empty')}</p>
      ) : (
        <ol className="mb-3 flex flex-col gap-1">
          {rooms.map((room) => (
            <li
              key={room.id}
              data-room-id={room.id}
              className="flex items-start gap-1"
              onKeyDown={(event) => {
                const direction = chordDirection(event);
                if (direction === null) return;
                event.preventDefault();
                event.stopPropagation();
                mover('room', room.id, direction, ids, room.name);
              }}
            >
              <NameField
                key={room.name}
                value={room.name}
                label={t('plan.fieldOf', {
                  field: term('room', { capital: true }),
                  name: room.name,
                })}
                onCommit={(name) =>
                  rename.mutate(
                    { id: room.id, name },
                    { onSuccess: outcome.kept, onError: outcome.refused },
                  )
                }
              />
              <IconButton
                data-testid="room-up"
                icon={<ArrowUp20Regular />}
                label={t('plan.move.up', { name: room.name })}
                onClick={() => mover('room', room.id, 'up', ids, room.name)}
              />
              <IconButton
                data-testid="room-down"
                icon={<ArrowDown20Regular />}
                label={t('plan.move.down', { name: room.name })}
                onClick={() => mover('room', room.id, 'down', ids, room.name)}
              />
              <Button
                appearance="subtle"
                icon={<Delete20Regular />}
                data-testid="room-remove"
                onClick={() => setRemoval(room)}
              >
                {t('plan.remove')}
              </Button>
            </li>
          ))}
        </ol>
      )}
      <AddForm
        label={t('plan.toAdd', { what: term('room', { capital: true }) })}
        inputTestId="room-add-name"
        buttonTestId="room-add"
        buttonLabel={t('plan.add', { what: term('room') })}
        icon={<Add20Regular />}
        pending={add.isPending}
        onAdd={(name, done) =>
          add.mutate(name, {
            onSuccess: () => {
              outcome.kept();
              done();
            },
            onError: outcome.refused,
          })
        }
      />

      <ConfirmDialog
        open={removal !== null}
        title={removal === null ? '' : t('plan.confirm.removeTitle', { name: removal.name })}
        confirmLabel={t('plan.remove')}
        danger
        pending={remove.isPending}
        onCancel={() => setRemoval(null)}
        onConfirm={() => {
          if (removal === null) return;
          remove.mutate(removal.id, {
            onSuccess: () => {
              outcome.kept();
              setRemoval(null);
            },
            onError: (error) => {
              outcome.refused(error);
              setRemoval(null);
            },
          });
        }}
      >
        {removal === null
          ? null
          : touching(removal) === 0
            ? t('plan.confirm.roomNone')
            : tp('plan.confirm.roomBody', touching(removal))}
      </ConfirmDialog>
    </Card>
  );
}
