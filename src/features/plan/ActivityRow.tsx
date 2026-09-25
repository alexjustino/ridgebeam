import { ArrowDown20Regular, ArrowUp20Regular, Delete20Regular } from '@fluentui/react-icons';
import { useEffect, useId, useRef, useState } from 'react';

import { LIMITS } from '@/data/commands';
import { useSetActivityRooms, useUpdateActivity } from '@/data/queries';
import type { Direction } from '@/domain/ordering';
import type { Activity, Person, Room } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { IconButton } from '@/ui/IconButton';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

import { chordDirection } from './moves';
import { NameField } from './NameField';
import type { Outcome } from './outcome';

/** The columns of an activity's first line, shared with the stage's column heads. */
export const ACTIVITY_COLUMNS =
  'grid grid-cols-[2.75rem_minmax(0,1fr)_7rem_11rem_auto] items-start gap-2';

/**
 * One activity, as the breakdown edits it: its number, name, duration in working days and who
 * answers for it on the first line; the rooms it touches and how much of it there is on the
 * second.
 *
 * Each field is kept the moment it holds something the host can keep — a duration as soon as it
 * is a whole number of working days, a responsible or a room as soon as one is picked, a quantity
 * as soon as it is a number, a name when the field is left. What was typed is never replaced by
 * the host's answer while the row is on screen, so a refusal leaves the typing where it was to be
 * corrected. Beside the quantity, the amount the host kept is read back in words.
 *
 * Alt+ArrowUp/Down from any control in the row moves it inside its stage; the buttons do the same.
 */
export function ActivityRow({
  activity,
  number,
  people,
  rooms,
  outcome,
  focus,
  onFocused,
  onMove,
  onRemove,
}: {
  activity: Activity;
  number: string | null;
  people: readonly Person[];
  rooms: readonly Room[];
  outcome: Outcome;
  /** Asked to take the focus — from "Edit in the breakdown" on another arrangement. */
  focus: boolean;
  onFocused: () => void;
  onMove: (direction: Direction) => void;
  onRemove: () => void;
}) {
  const { t, number: formatNumber } = useI18n();
  const term = useTerms();
  const update = useUpdateActivity();
  const setRooms = useSetActivityRooms();
  const hint = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [duration, setDuration] = useState(
    activity.durationDays === null ? '' : String(activity.durationDays),
  );
  const [durationInvalid, setDurationInvalid] = useState(false);
  const [responsible, setResponsible] = useState(activity.responsibleId ?? '');
  const [roomIds, setRoomIds] = useState<readonly string[]>(activity.roomIds);
  const [quantity, setQuantity] = useState(
    activity.quantity === null ? '' : String(activity.quantity),
  );
  const [quantityInvalid, setQuantityInvalid] = useState(false);
  const [unit, setUnit] = useState(activity.unit ?? '');
  const [unitWaits, setUnitWaits] = useState(false);

  useEffect(() => {
    if (!focus) return;
    nameRef.current?.focus();
    nameRef.current?.scrollIntoView({ block: 'center' });
    onFocused();
  }, [focus, onFocused]);

  const keep = (patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate(
      { id: activity.id, patch },
      { onSuccess: outcome.kept, onError: outcome.refused },
    );

  const editDuration = (next: string) => {
    setDuration(next);
    if (next.trim() === '') {
      setDurationInvalid(false);
      if (activity.durationDays !== null) keep({ durationDays: null });
      return;
    }
    const days = Number(next);
    if (!Number.isInteger(days) || days < 1 || days > LIMITS.durationDays) {
      setDurationInvalid(true);
      return;
    }
    setDurationInvalid(false);
    if (days !== activity.durationDays) keep({ durationDays: days });
  };

  /** A quantity the host can keep, or `null` for none, or `undefined` for not a number. */
  const readQuantity = (text: string): number | null | undefined => {
    if (text.trim() === '') return null;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };

  const editQuantity = (next: string) => {
    setQuantity(next);
    const value = readQuantity(next);
    if (value === undefined) {
      setQuantityInvalid(true);
      return;
    }
    setQuantityInvalid(false);
    if (value === null) {
      // No quantity, no unit: the host clears both, and so does the row.
      setUnit('');
      setUnitWaits(false);
      if (activity.quantity !== null) keep({ quantity: null });
      return;
    }
    const typedUnit = unit.trim();
    setUnitWaits(false);
    keep(typedUnit === '' ? { quantity: value } : { quantity: value, unit: typedUnit });
  };

  const editUnit = (next: string) => {
    setUnit(next);
    const typed = next.trim();
    const value = readQuantity(quantity);
    if (value === null || value === undefined) {
      // A unit needs an amount first; it waits in the field until there is one.
      setUnitWaits(typed !== '');
      return;
    }
    setUnitWaits(false);
    keep({ unit: typed === '' ? null : typed });
  };

  const toggleRoom = (roomId: string, touches: boolean) => {
    const chosen = new Set(roomIds);
    if (touches) chosen.add(roomId);
    else chosen.delete(roomId);
    // In the rooms' own order, so the set the host keeps reads the way the card lists it.
    const next = rooms.filter((room) => chosen.has(room.id)).map((room) => room.id);
    setRoomIds(next);
    setRooms.mutate(
      { id: activity.id, roomIds: next },
      { onSuccess: outcome.kept, onError: outcome.refused },
    );
  };

  const kept =
    activity.quantity === null
      ? null
      : [formatNumber(activity.quantity), activity.unit ?? ''].join(' ').trim();

  return (
    <li
      data-activity-id={activity.id}
      className="flex flex-col gap-2 border-t border-stroke-subtle py-2"
      onKeyDown={(event) => {
        const direction = chordDirection(event);
        if (direction === null) return;
        event.preventDefault();
        event.stopPropagation();
        onMove(direction);
      }}
    >
      <div className={ACTIVITY_COLUMNS}>
        <span data-testid="row-number" className="pt-1.5 text-body text-fg-secondary tabular-nums">
          {number ?? '—'}
        </span>
        <NameField
          ref={nameRef}
          value={activity.name}
          label={t('plan.fieldOf', {
            field: term('activity', { capital: true }),
            name: activity.name,
          })}
          onCommit={(name) => keep({ name })}
        />
        <span className="flex flex-col">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={LIMITS.durationDays}
            step={1}
            data-testid="activity-duration"
            aria-label={t('plan.fieldOf', {
              field: term('duration', { capital: true }),
              name: activity.name,
            })}
            aria-invalid={durationInvalid}
            aria-describedby={durationInvalid ? `${hint}-duration` : undefined}
            value={duration}
            onChange={(event) => editDuration(event.target.value)}
          />
          {durationInvalid && (
            <span id={`${hint}-duration`} className="mt-1 text-caption text-fg-secondary">
              {t('plan.invalid.duration', { max: formatNumber(LIMITS.durationDays) })}
            </span>
          )}
        </span>
        <Select
          data-testid="activity-responsible"
          aria-label={t('plan.fieldOf', {
            field: term('responsible', { capital: true }),
            name: activity.name,
          })}
          value={responsible}
          onChange={(event) => {
            const chosen = event.target.value;
            setResponsible(chosen);
            keep({ responsibleId: chosen === '' ? null : chosen });
          }}
        >
          <option value="">{t('plan.activity.notKnown')}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
        <span className="flex items-center gap-0.5">
          <IconButton
            data-testid="activity-up"
            icon={<ArrowUp20Regular />}
            label={t('plan.move.up', { name: activity.name })}
            onClick={() => onMove('up')}
          />
          <IconButton
            data-testid="activity-down"
            icon={<ArrowDown20Regular />}
            label={t('plan.move.down', { name: activity.name })}
            onClick={() => onMove('down')}
          />
          <Button
            appearance="subtle"
            icon={<Delete20Regular />}
            data-testid="activity-remove"
            onClick={onRemove}
          >
            {t('plan.remove')}
          </Button>
        </span>
      </div>

      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-2">
        <span aria-hidden="true" />
        <fieldset data-testid="activity-rooms" className="flex min-w-0 flex-col gap-1">
          <legend className="mb-1 text-caption font-semibold text-fg-tertiary">
            {term('room', { capital: true })}
          </legend>
          {rooms.length === 0 ? (
            <span className="text-caption text-fg-tertiary">
              {t('plan.rooms.noneYet', { room: term('room') })}
            </span>
          ) : (
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              {rooms.map((room) => (
                <label key={room.id} className="flex items-center gap-1.5 text-body text-fg">
                  <Checkbox
                    label={room.name}
                    checked={roomIds.includes(room.id)}
                    onChange={(touches) => toggleRoom(room.id, touches)}
                  />
                  <span>{room.name}</span>
                </label>
              ))}
            </span>
          )}
        </fieldset>
        <span className="flex flex-col gap-1">
          <span className="text-caption font-semibold text-fg-tertiary">
            {term('quantity', { capital: true })}
          </span>
          <span className="grid grid-cols-[6rem_5rem] gap-1">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              data-testid="activity-quantity"
              aria-label={t('plan.fieldOf', {
                field: term('quantity', { capital: true }),
                name: activity.name,
              })}
              aria-invalid={quantityInvalid}
              aria-describedby={`${hint}-quantity`}
              value={quantity}
              onChange={(event) => editQuantity(event.target.value)}
            />
            <Input
              data-testid="activity-unit"
              aria-label={t('plan.unitOf', { name: activity.name })}
              placeholder={t('plan.unit')}
              maxLength={LIMITS.unit}
              aria-describedby={`${hint}-quantity`}
              value={unit}
              onChange={(event) => editUnit(event.target.value)}
            />
          </span>
          <span id={`${hint}-quantity`} className="min-h-4 text-caption text-fg-tertiary">
            {quantityInvalid
              ? t('plan.invalid.quantity')
              : unitWaits
                ? t('plan.invalid.unitNeedsQuantity')
                : kept !== null
                  ? t('plan.quantity.kept', { amount: kept })
                  : ''}
          </span>
        </span>
      </div>
    </li>
  );
}
